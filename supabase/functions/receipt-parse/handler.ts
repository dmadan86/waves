/**
 * receipt-parse — a photograph becomes line items (ADR-008 / TDR §6).
 *
 * The model reads the receipt; it does not decide anything. What it returns is
 * checked against the receipt's own arithmetic by @waves/core before anybody
 * sees a number, and a bill that does not add up comes back flagged for
 * correction rather than quietly becoming an expense. "AI proposes, human
 * confirms" only means something if the human is told what to look at.
 *
 * The API key lives here and only here (ADR-008 / TDR §11) — it is never in the
 * app bundle, and the client cannot reach the model except through this
 * function, which checks membership and quota first.
 *
 * The request handling lives here as a function over injected boundaries so it
 * can be unit-tested; `index.ts` wires in the real ones.
 *
 * Exact-match cache: the same image (same sha256) parsed with the same model,
 * prompt version and currency hint returns the stored parse instead of paying
 * for the model again. See the quota notes at `handleReceiptParse`.
 */

import { checkReceipt, type ParsedReceipt } from '../_shared/core.js';
import { HttpError, json, requireMembership, type SupabaseClient } from '../_shared/auth.ts';

/** The media type Anthropic is told, keyed off the stored object's extension. */
function mediaTypeForPath(path: string): 'image/png' | 'image/webp' | 'image/jpeg' {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  return 'image/jpeg';
}

interface ParseRequest {
  groupId: string;
  receiptId?: string;
  /** Object path in the private `receipts` bucket. */
  storagePath?: string;
  /** A pasted bill (Swiggy, Zomato, a WhatsApp message) instead of a photo. */
  rawText?: string;
  source?: 'camera' | 'gallery' | 'text_paste';
  currency?: string;
}

/**
 * The shape the model must return. Enforced by structured outputs, so the
 * response is parseable by construction rather than by hope — no regex, no
 * retry-on-bad-JSON loop.
 *
 * Every amount is an integer in **minor units** (ADR-003). Asking for paise
 * rather than rupees is what keeps a float from ever existing between the
 * photograph and the ledger.
 */
const RECEIPT_SCHEMA = {
  type: 'object',
  properties: {
    merchant: { type: ['string', 'null'] },
    date: { type: ['string', 'null'], description: 'ISO date, YYYY-MM-DD, or null' },
    currency: { type: 'string', description: 'ISO 4217 code, e.g. INR' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          qty: { type: 'number' },
          unitPrice: { type: ['integer', 'null'] },
          total: { type: 'integer' },
          confidence: { type: 'number', description: '0 to 1' },
        },
        required: ['label', 'qty', 'unitPrice', 'total', 'confidence'],
        additionalProperties: false,
      },
    },
    subtotal: { type: ['integer', 'null'] },
    taxes: {
      type: 'array',
      items: {
        type: 'object',
        properties: { label: { type: 'string' }, amount: { type: 'integer' } },
        required: ['label', 'amount'],
        additionalProperties: false,
      },
    },
    serviceCharge: { type: ['integer', 'null'] },
    tip: { type: ['integer', 'null'] },
    discounts: {
      type: 'array',
      items: {
        type: 'object',
        properties: { label: { type: 'string' }, amount: { type: 'integer' } },
        required: ['label', 'amount'],
        additionalProperties: false,
      },
    },
    grandTotal: { type: 'integer' },
  },
  required: [
    'merchant',
    'date',
    'currency',
    'items',
    'subtotal',
    'taxes',
    'serviceCharge',
    'tip',
    'discounts',
    'grandTotal',
  ],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = `You transcribe restaurant and shop receipts into structured data.

Read what is printed. Do not compute, correct, or tidy: if the receipt's own
arithmetic is wrong, return its numbers as printed — a separate check compares
your reading against the printed total, and that check only works if you have
not silently fixed anything.

Amounts are integers in the currency's minor unit. ₹320.50 is 32050. A receipt
printed in whole rupees still returns paise: ₹320 is 32000.

Receipts are frequently Indian and may be in Tamil, Hindi, or another regional
script, often mixed with English. Transcribe item names in the script they are
printed in. Pasted text bills from Swiggy, Zomato or WhatsApp arrive without a
photograph and read the same way.

Confidence is your own, per line, from 0 to 1. A crisp printed line is near 1.
Report low confidence when a line is faded, cut off, ambiguous, or you are
guessing at a digit — a flagged line gets a human's attention, and that is much
cheaper than a wrong number reaching somebody's ledger.

Combo meals and modifiers printed as separate indented lines under a parent
item are separate line items if they carry their own price, and part of the
parent if they do not.`;

export const MODEL = 'claude-opus-5';
/**
 * ADR-011: a scan costs real money, so the quota is enforced server-side — and
 * the number now comes from `waves_receipt_scan_quota()`, which reads what the
 * person is entitled to. It used to be a 20 here and a second 20 inside that
 * function, which is two places to forget when somebody pays.
 *
 * This is only the floor to fall back to. Not zero, because a database that
 * answered oddly should not lock out somebody who has paid; not unlimited, for
 * the obvious reason.
 */
const FALLBACK_SCAN_LIMIT = 20;

/** 32-bit FNV-1a, enough to notice that a prompt changed (not a security hash). */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

const TRANSCRIBE_PHOTO = (currency: string) =>
  `Transcribe this receipt. Currency is ${currency} unless the receipt says otherwise.`;
const TRANSCRIBE_TEXT = (currency: string, rawText: string) =>
  `Transcribe this bill. Currency is ${currency}.\n\n${rawText}`;

/**
 * Part of the cache key. Derived from everything that shapes the model's
 * answer except the image: the system prompt, the output schema and the
 * per-request instruction wording. Edit any of them and every older cache
 * entry stops matching; bump the leading number to force that by hand.
 */
export const PROMPT_VERSION = `1-${fnv1a(
  JSON.stringify([SYSTEM_PROMPT, RECEIPT_SCHEMA, TRANSCRIBE_PHOTO(' '), TRANSCRIBE_TEXT(' ', ' ')]),
)}`;

/** The shape a cached or fresh parse must have before it is stored or trusted. */
export function isParsedReceipt(value: unknown): value is ParsedReceipt {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  const isInt = (x: unknown) => typeof x === 'number' && Number.isInteger(x);
  return (
    typeof v.currency === 'string' &&
    isInt(v.grandTotal) &&
    Array.isArray(v.items) &&
    v.items.every((i) => {
      const item = i as Record<string, unknown> | null;
      return (
        typeof item === 'object' &&
        item !== null &&
        typeof item.label === 'string' &&
        typeof item.qty === 'number' &&
        isInt(item.total)
      );
    }) &&
    Array.isArray(v.taxes) &&
    Array.isArray(v.discounts)
  );
}

/** Lowercase hex sha256 of the bytes. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface Deps {
  readonly env: (name: string) => string | undefined;
  readonly caller: SupabaseClient;
  readonly service: SupabaseClient;
  readonly fetch: typeof fetch;
  /** Throws a 429 HttpError when the caller is going too fast. */
  readonly rateLimit: (profileId: string) => Promise<void>;
  /** The stored image's bytes (service role). */
  readonly readImage: (path: string) => Promise<Uint8Array>;
  /** Overrides {@link PROMPT_VERSION} (tests). */
  readonly promptVersion?: string;
}

export async function handleReceiptParse(request: Request, deps: Deps): Promise<Response> {
  {
    if (request.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Use POST');

    const apiKey = deps.env('ANTHROPIC_API_KEY');
    if (!apiKey) {
      throw new HttpError(
        503,
        'SCANNING_UNAVAILABLE',
        'Receipt scanning is not configured on this Waves server',
      );
    }

    const body = (await request.json()) as ParseRequest;
    if (!body.storagePath && !body.rawText) {
      throw new HttpError(400, 'NOTHING_TO_PARSE', 'Send a photo or some text');
    }

    const caller = deps.caller;
    const { profileId } = await requireMembership(caller, body.groupId);
    const service = deps.service;

    // Speed first, then the monthly allowance. Both refuse with a 429 and they
    // are not the same refusal: this one says slow down, the next says you have
    // spent what you are entitled to this month.
    await deps.rateLimit(profileId);

    const { data: quota } = await caller.rpc('waves_receipt_scan_quota');
    const row = quota as { used?: number; limit?: number } | null;
    const used = Number(row?.used ?? 0);
    const limit = Number.isFinite(Number(row?.limit)) ? Number(row?.limit) : FALLBACK_SCAN_LIMIT;

    // Quota before the model call, never after — the point is not to spend the
    // money, not to notice afterwards that we did. A cache hit spends nothing,
    // so it is not refused for quota and does not count against it (below).
    const assertQuota = (): void => {
      if (used >= limit) {
        throw new HttpError(
          429,
          'SCAN_QUOTA_REACHED',
          `You have used all ${limit} scans this month. Adding items by hand is free and always will be.`,
        );
      }
    };

    // The per-group receipt ceiling (ADR-011). Checked before the model call
    // for the same reason as the quota: refuse a spend that would be capped at
    // record time anyway. Paid groups are exempt inside the RPC; a `false` here
    // means an unpaid group that has filled its free receipts. `record_receipt`
    // enforces the same rule as the real boundary, so this is only to save the
    // model call and give a clean 429 instead of a raised `RECEIPT_CAP`.
    //
    // Pass the receipt id so a re-parse of an *existing* receipt (an update) is
    // not refused at cap: the recorder lets an update through, and the gate must
    // agree or a legitimate re-scan is blocked with a spend that never happens.
    //
    // This one applies to a cache hit too: a hit still stores a new receipt in
    // the group, and the ceiling limits stored receipts (a product limit), not
    // model spend.
    const assertGroupCeiling = async (): Promise<void> => {
      const { data: canAdd } = await caller.rpc('waves_can_add_receipt', {
        p_group_id: body.groupId,
        p_receipt_id: body.receiptId ?? null,
      });
      if (canAdd === false) {
        throw new HttpError(
          429,
          'RECEIPT_CAP_REACHED',
          'This group has reached its receipt limit. Upgrade or add storage to add more.',
        );
      }
    };

    const content: unknown[] = [];
    const currency = body.currency ?? 'INR';
    const version = deps.promptVersion ?? PROMPT_VERSION;
    // Only a photo on its own is cacheable: pasted text is already cheap to
    // resend, and text beside a photo is part of the question.
    let cacheKey: string | null = null;
    let cached: ParsedReceipt | null = null;
    if (body.storagePath) {
      // IDOR guard: the download runs with the service role, which bypasses
      // bucket RLS. `groupId` was checked by requireMembership above; the client
      // uploads to `${groupId}/${receiptId}.ext`, so require that prefix or a
      // caller could read another group's receipt by passing its object path.
      if (!body.storagePath.startsWith(`${body.groupId}/`)) {
        throw new HttpError(403, 'FORBIDDEN', 'That image does not belong to this group');
      }
      // Read with the service role from whichever backend holds it (R2 for new
      // uploads, Supabase Storage for anything from before the cut-over) and
      // sent as base64: the model never gets a URL into our storage.
      let bytes: Uint8Array;
      try {
        bytes = await deps.readImage(body.storagePath);
      } catch (readError) {
        const message = readError instanceof Error ? readError.message : 'No such image';
        throw new HttpError(400, 'IMAGE_UNREADABLE', message);
      }
      if (!body.rawText) {
        cacheKey = await sha256Hex(bytes);
        cached = await cacheGet(service, cacheKey, version, currency);
      }
      if (!cached) {
        content.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: mediaTypeForPath(body.storagePath),
            data: encodeBase64(bytes),
          },
        });
      }
    }

    if (cached) {
      // A hit: no model call, so no spend to bound. It does not count as a scan
      // (see `waves_record_receipt`'s p_cached), but the group ceiling stands.
      await assertGroupCeiling();
      const check = checkReceipt(cached);
      const status = check.reconciles && check.problems.length === 0 ? 'parsed' : 'needs_review';
      const { data: receiptId, error: recordError } = await service.rpc('waves_record_receipt', {
        p_group_id: body.groupId,
        p_receipt_id: body.receiptId ?? null,
        p_profile_id: profileId,
        p_source: body.source ?? 'camera',
        p_storage_path: body.storagePath ?? null,
        p_raw_text: null,
        p_parsed: cached,
        p_status: status,
        p_input_tokens: 0,
        p_output_tokens: 0,
        p_cached: true,
      });
      if (recordError) throw new HttpError(500, 'INTERNAL', recordError.message);
      console.log(JSON.stringify({ fn: 'receipt-parse', cache: 'hit' }));
      return json({ receiptId, status, parsed: cached, check, quota: { used, limit } });
    }

    assertQuota();
    await assertGroupCeiling();

    content.push({
      type: 'text',
      text: body.rawText ? TRANSCRIBE_TEXT(currency, body.rawText) : TRANSCRIBE_PHOTO(currency),
    });

    const response = await deps.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 16000,
        system: SYSTEM_PROMPT,
        // Transcription, not deliberation: low effort keeps a scan cheap, which
        // is what lets the free tier be generous (ADR-011).
        output_config: {
          effort: 'low',
          format: { type: 'json_schema', schema: RECEIPT_SCHEMA },
        },
        messages: [{ role: 'user', content }],
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      console.error('anthropic error', response.status, detail.slice(0, 500));

      // Say *why*, not just that it failed. "The scanner could not read that
      // just now" told the person nothing and told whoever had to debug it
      // less — the only copy of the reason was in a log nobody watching a
      // phone can reach. The upstream type and message are the model's
      // complaint about the request, never about the key, so they are safe to
      // pass on.
      let reason = '';
      try {
        const upstream = JSON.parse(detail) as { error?: { type?: string; message?: string } };
        reason = [upstream.error?.type, upstream.error?.message].filter(Boolean).join(': ');
      } catch {
        reason = detail.slice(0, 200);
      }
      throw new HttpError(
        502,
        'SCAN_FAILED',
        `The scanner could not read that just now (${response.status}${reason ? ` ${reason}` : ''})`,
      );
    }

    const message = (await response.json()) as {
      content: { type: string; text?: string }[];
      stop_reason?: string;
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    // A refusal is a successful HTTP 200 with an empty content array, so
    // reading content[0] unconditionally would throw on the one case we most
    // want to report clearly.
    if (message.stop_reason === 'refusal') {
      throw new HttpError(422, 'SCAN_REFUSED', 'The scanner declined to read that image');
    }

    const text = message.content?.find((block) => block.type === 'text')?.text;
    if (!text) throw new HttpError(502, 'SCAN_FAILED', 'The scanner returned nothing');

    const parsed = JSON.parse(text) as ParsedReceipt;

    // The receipt's own checksum. This is what stands between a misread digit
    // and somebody's ledger.
    const check = checkReceipt(parsed);
    const status = check.reconciles && check.problems.length === 0 ? 'parsed' : 'needs_review';

    // Remember it only when it is a complete, schema-valid parse that adds up.
    // A bill that needs review is not kept: the person is likely to retry, and a
    // retry should get a fresh read, not the same misread again.
    if (cacheKey && status === 'parsed' && isParsedReceipt(parsed)) {
      await cachePut(service, cacheKey, version, currency, parsed);
    }

    const { data: receiptId, error: recordError } = await service.rpc('waves_record_receipt', {
      p_group_id: body.groupId,
      p_receipt_id: body.receiptId ?? null,
      p_profile_id: profileId,
      p_source: body.source ?? (body.rawText ? 'text_paste' : 'camera'),
      p_storage_path: body.storagePath ?? null,
      p_raw_text: body.rawText ?? null,
      p_parsed: parsed,
      p_status: status,
      p_input_tokens: message.usage?.input_tokens ?? 0,
      p_output_tokens: message.usage?.output_tokens ?? 0,
    });
    if (recordError) throw new HttpError(500, 'INTERNAL', recordError.message);

    return json({
      receiptId,
      status,
      parsed,
      check,
      quota: { used: used + 1, limit },
    });
  }
}

/** Cache read. Any failure is a miss: the cache must never break a scan. */
async function cacheGet(
  service: SupabaseClient,
  sha256: string,
  version: string,
  currency: string,
): Promise<ParsedReceipt | null> {
  try {
    const { data, error } = await service.rpc('waves_receipt_cache_get', {
      p_sha256: sha256,
      p_model: MODEL,
      p_schema_version: version,
      p_currency: currency,
    });
    if (error || !isParsedReceipt(data)) return null;
    return data;
  } catch {
    return null;
  }
}

/** Cache write, best effort. */
async function cachePut(
  service: SupabaseClient,
  sha256: string,
  version: string,
  currency: string,
  parsed: ParsedReceipt,
): Promise<void> {
  try {
    await service.rpc('waves_receipt_cache_put', {
      p_sha256: sha256,
      p_model: MODEL,
      p_schema_version: version,
      p_currency: currency,
      p_result: parsed,
    });
  } catch (error) {
    console.error('receipt cache write failed', error instanceof Error ? error.message : error);
  }
}

/** Deno has no Buffer; chunked so a large image cannot blow the call stack. */
function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}
