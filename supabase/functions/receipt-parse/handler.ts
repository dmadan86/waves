/**
 * receipt-parse — a photograph becomes line items (ADR-008 / TDR §6).
 *
 * The model reads the receipt; it does not decide anything. What it returns is
 * checked against the receipt's own arithmetic by @waves/core before anybody
 * sees a number, and a bill that does not add up comes back flagged for
 * correction rather than quietly becoming an expense. "AI proposes, human
 * confirms" only means something if the human is told what to look at.
 *
 * The OpenRouter key lives here and only here (ADR-008 / TDR §11) — it is never in the
 * app bundle, and the client cannot reach the model except through this
 * function, which checks membership and quota first.
 *
 * The request handling lives here as a function over injected boundaries so it
 * can be unit-tested; `index.ts` wires in the real ones.
 *
 * Models are reached through OpenRouter (one key), tried in order. Requests
 * are routed only to providers that neither store nor train on the prompt: a
 * receipt is a record of what somebody bought.
 *
 * Exact-match cache: the same image (same sha256) parsed with the same prompt
 * version and currency hint returns the stored parse instead of paying for the
 * model again. Whichever model answered, the result is interchangeable, so the
 * cache key carries a fixed tag, not the model name. See the quota notes at `handleReceiptParse`.
 */

import { checkReceipt, type ParsedReceipt } from '../_shared/core.js';
import { HttpError, json, requireMembership, type SupabaseClient } from '../_shared/auth.ts';

/** The media type the model is told, keyed off the stored object's extension. */
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

/**
 * Tried in order through OpenRouter; the first to return a valid parse wins.
 * Override with `RECEIPT_MODELS` (comma-separated) to change without a deploy.
 */
export const RECEIPT_MODELS = ['anthropic/claude-haiku-5.5', 'google/gemini-3.5-flash'];

/**
 * The `model` column of the parse cache. Constant on purpose: which model
 * answered must not decide whether an identical photo is a hit.
 */
export const CACHE_MODEL_TAG = 'receipt-openrouter';

/** The models to try: the env override when it names any, else the defaults. */
export function receiptModels(env: (name: string) => string | undefined): string[] {
  const fromEnv = (env('RECEIPT_MODELS') ?? '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  return fromEnv.length > 0 ? fromEnv : RECEIPT_MODELS;
}
/**
 * ADR-011: a scan costs real money, so the quota is enforced server-side, as an
 * atomic reservation (`waves_receipt_scan_reserve`, service role) taken before
 * the model is asked and never after: a burst of parallel requests at the last
 * scan admits exactly one, and a database that cannot answer refuses (there is
 * no fallback allowance — a spend gate fails closed).
 */

/** A pasted bill is a few hundred characters; this is many bills. */
export const MAX_RAW_TEXT_CHARS = 8_000;
const SOURCES: ReadonlySet<string> = new Set(['camera', 'gallery', 'text_paste']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ScanReservation {
  used: number;
  limit: number;
  allowed: boolean;
}

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

    const apiKey = deps.env('OPENROUTER_API_KEY');
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
    // Everything the recorder will refuse is refused HERE, before any spend: a
    // scan whose record step fails after the model answered used to be a scan
    // nobody paid for.
    if (typeof body.rawText === 'string' && body.rawText.length > MAX_RAW_TEXT_CHARS) {
      throw new HttpError(413, 'TEXT_TOO_LONG', 'That is too much text for one bill');
    }
    if (body.source !== undefined && !SOURCES.has(String(body.source))) {
      throw new HttpError(400, 'BAD_SOURCE', 'source must be camera, gallery or text_paste');
    }
    if (body.receiptId !== undefined && !UUID.test(String(body.receiptId))) {
      throw new HttpError(400, 'BAD_RECEIPT_ID', 'receiptId must be a uuid');
    }

    const caller = deps.caller;
    const { profileId } = await requireMembership(caller, body.groupId);
    const service = deps.service;

    // Speed first, then the monthly allowance. Both refuse with a 429 and they
    // are not the same refusal: this one says slow down, the next says you have
    // spent what you are entitled to this month.
    await deps.rateLimit(profileId);

    // A receipt id that already exists in ANOTHER group is refused by the
    // recorder; find that out before the model is paid, not after.
    if (body.receiptId) {
      const { data: existing, error: lookupError } = await service
        .from('receipts')
        .select('group_id')
        .eq('id', body.receiptId)
        .maybeSingle();
      if (lookupError) throw new HttpError(503, 'SCANNING_UNAVAILABLE', lookupError.message);
      const owner = (existing as { group_id?: string } | null)?.group_id;
      if (owner && owner !== body.groupId) {
        throw new HttpError(403, 'FORBIDDEN', 'That receipt belongs to a different group');
      }
    }

    // The reservation: one scan taken atomically against the month, before the
    // model call, never after. A cache hit spends nothing, so it is served
    // without one and does not count (below). Fails closed: no answer from the
    // database is a refusal, never a free scan.
    const reserveScan = async (): Promise<ScanReservation> => {
      const { data, error } = await service.rpc('waves_receipt_scan_reserve', {
        p_profile: profileId,
      });
      const row = data as ScanReservation | null;
      if (error || !row || typeof row.allowed !== 'boolean') {
        throw new HttpError(
          503,
          'SCANNING_UNAVAILABLE',
          'Receipt scanning is not available right now',
        );
      }
      if (!row.allowed) {
        throw new HttpError(
          429,
          'SCAN_QUOTA_REACHED',
          `You have used all ${row.limit} scans this month. Adding items by hand is free and always will be.`,
        );
      }
      return row;
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
        // Keyed with the group, so the same photo bytes in another group are
        // another entry: a hit never hands one group another's parse.
        cacheKey = await sha256Hex(
          new Uint8Array([...new TextEncoder().encode(`${body.groupId}|`), ...bytes]),
        );
        cached = await cacheGet(service, cacheKey, version, currency);
      }
      if (!cached) {
        content.push({
          type: 'image_url',
          image_url: {
            url: `data:${mediaTypeForPath(body.storagePath)};base64,${encodeBase64(bytes)}`,
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
      const { data: quotaNow } = await caller.rpc('waves_receipt_scan_quota');
      const q = quotaNow as { used?: number; limit?: number } | null;
      return json({
        receiptId,
        status,
        parsed: cached,
        check,
        quota: { used: Number(q?.used ?? 0), limit: Number(q?.limit ?? 0) },
      });
    }

    // Cheap refusals before the reservation (a refused request reserves nothing),
    // then the reservation, then the spend.
    await assertGroupCeiling();
    const { used, limit } = await reserveScan();

    content.push({
      type: 'text',
      text: body.rawText ? TRANSCRIBE_TEXT(currency, body.rawText) : TRANSCRIBE_PHOTO(currency),
    });

    const attempt = await askModels(deps, apiKey, receiptModels(deps.env), content);
    const { parsed, model: answeredBy, usage } = attempt;

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

    // The scan was reserved above; the recorder must not count it twice
    // (p_reserved). Whatever happens from here, the reservation stands: the
    // model has been paid.
    const { data: receiptId, error: recordError } = await service.rpc('waves_record_receipt', {
      p_group_id: body.groupId,
      p_receipt_id: body.receiptId ?? null,
      p_profile_id: profileId,
      p_source: body.source ?? (body.rawText ? 'text_paste' : 'camera'),
      p_storage_path: body.storagePath ?? null,
      p_raw_text: body.rawText ?? null,
      p_parsed: parsed,
      p_status: status,
      p_input_tokens: usage.prompt_tokens ?? 0,
      p_output_tokens: usage.completion_tokens ?? 0,
      p_cached: false,
      p_reserved: true,
    });
    console.log(JSON.stringify({ fn: 'receipt-parse', cache: 'miss', model: answeredBy, usage }));
    if (recordError) throw new HttpError(500, 'INTERNAL', recordError.message);

    return json({
      receiptId,
      status,
      parsed,
      check,
      quota: { used, limit },
    });
  }
}

interface Answer {
  parsed: ParsedReceipt;
  model: string;
  usage: { prompt_tokens?: number; completion_tokens?: number };
}

/** A model's text as JSON, tolerating a ``` fence around it. */
function parseJsonText(text: string): unknown {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  return JSON.parse(trimmed);
}

/**
 * Ask each model in turn. Moves on after a non-OK response, a network error or
 * a body that is not a valid receipt, so the one that answered is known. If all
 * fail, the last failure is raised in the same shape as before.
 */
async function askModels(
  deps: Deps,
  apiKey: string,
  models: readonly string[],
  content: unknown[],
): Promise<Answer> {
  let failure: HttpError = new HttpError(502, 'SCAN_FAILED', 'The scanner returned nothing');
  for (const model of models) {
    const request = (lowEffort: boolean) =>
      deps.fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          'x-title': 'Waves receipts',
        },
        body: JSON.stringify({
          model,
          max_tokens: 16000,
          // Transcription, not deliberation: low effort keeps a scan cheap,
          // which is what lets the free tier be generous (ADR-011).
          ...(lowEffort ? { reasoning: { effort: 'low' } } : {}),
          // Only providers that neither store nor train on the receipt.
          provider: { data_collection: 'deny' },
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'receipt', strict: true, schema: RECEIPT_SCHEMA },
          },
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content },
          ],
        }),
      });
    try {
      let response = await request(true);
      // A model that does not know the effort knob says so with a 400; ask plainly.
      if (response.status === 400) response = await request(false);

      if (!response.ok) {
        const detail = await response.text();
        console.error('openrouter error', model, response.status, detail.slice(0, 500));
        // Say *why*, not just that it failed: the upstream message is the
        // provider's complaint about the request, never about the key.
        let reason = '';
        try {
          const upstream = JSON.parse(detail) as {
            error?: { type?: string; code?: string | number; message?: string };
          };
          reason = [upstream.error?.type, upstream.error?.message].filter(Boolean).join(': ');
        } catch {
          reason = detail.slice(0, 200);
        }
        failure = new HttpError(
          502,
          'SCAN_FAILED',
          `The scanner could not read that just now (${response.status}${reason ? ` ${reason}` : ''})`,
        );
        continue;
      }

      const completion = (await response.json()) as {
        choices?: { message?: { content?: string | null; refusal?: string | null } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const text = completion.choices?.[0]?.message?.content;
      if (!text) {
        failure = new HttpError(502, 'SCAN_FAILED', 'The scanner returned nothing');
        continue;
      }
      const parsed = parseJsonText(text);
      if (!isParsedReceipt(parsed)) {
        console.error('openrouter invalid receipt', model);
        failure = new HttpError(502, 'SCAN_FAILED', 'The scanner returned something unreadable');
        continue;
      }
      return { parsed, model, usage: completion.usage ?? {} };
    } catch (error) {
      console.error(
        'openrouter call failed',
        model,
        error instanceof Error ? error.message : error,
      );
      failure = new HttpError(502, 'SCAN_FAILED', 'The scanner could not read that just now');
    }
  }
  throw failure;
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
      p_model: CACHE_MODEL_TAG,
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
      p_model: CACHE_MODEL_TAG,
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
