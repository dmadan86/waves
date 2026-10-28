/**
 * receipt-parse with its exact-match cache: a hit skips the model, a miss
 * stores only a complete parse that reconciles, a changed prompt version
 * misses, and the quota/ceiling rules differ for a hit as ADR-011 intends.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  handleReceiptParse,
  isParsedReceipt,
  CACHE_MODEL_TAG,
  RECEIPT_MODELS,
  PROMPT_VERSION,
  sha256Hex,
  type Deps,
} from './handler.ts';

const GOOD = {
  merchant: 'Cafe',
  date: null,
  currency: 'INR',
  items: [{ label: 'Tea', qty: 2, unitPrice: 5000, total: 10000, confidence: 0.9 }],
  subtotal: 10000,
  taxes: [],
  serviceCharge: null,
  tip: null,
  discounts: [],
  grandTotal: 10000,
};
/** Parses, but its lines do not add up to the printed total. */
const OFF = { ...GOOD, grandTotal: 99999 };

const IMAGE = new Uint8Array([1, 2, 3, 4]);

interface Options {
  cache?: Map<string, unknown>;
  used?: number;
  limit?: number;
  canAdd?: boolean;
  model?: unknown;
  promptVersion?: string;
  noKey?: boolean;
  env?: Record<string, string>;
}

function setup(options: Options = {}) {
  const cache = options.cache ?? new Map<string, unknown>();
  const keyOf = (a: Record<string, string>) =>
    [a.p_sha256, a.p_model, a.p_schema_version, a.p_currency].join('|');
  const rpcLog: { name: string; args: Record<string, unknown> }[] = [];
  const service = {
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      rpcLog.push({ name, args });
      if (name === 'waves_receipt_cache_get') {
        return { data: cache.get(keyOf(args as Record<string, string>)) ?? null, error: null };
      }
      if (name === 'waves_receipt_cache_put') {
        cache.set(keyOf(args as Record<string, string>), args.p_result);
        return { data: null, error: null };
      }
      if (name === 'waves_record_receipt') return { data: 'receipt-1', error: null };
      if (name === 'waves_receipt_scan_reserve') {
        // The atomic reservation: allowed while under the limit, counted when it is.
        const used = options.used ?? 0;
        const limit = options.limit ?? 20;
        return {
          data: { used: Math.min(used + 1, limit), limit, allowed: used < limit, tier: 'free' },
          error: null,
        };
      }
      return { data: null, error: null };
    }),
    from: vi.fn(() => {
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq']) q[m] = () => q;
      q.maybeSingle = async () => ({ data: null, error: null });
      return q;
    }),
  };
  const caller = {
    auth: { getUser: async () => ({ data: { user: { id: 'p1' } }, error: null }) },
    rpc: vi.fn(async (name: string) => {
      if (name === 'waves_my_member_id') return { data: 'm1', error: null };
      if (name === 'waves_receipt_scan_quota') {
        return { data: { used: options.used ?? 0, limit: options.limit ?? 20 }, error: null };
      }
      if (name === 'waves_can_add_receipt') return { data: options.canAdd ?? true, error: null };
      return { data: null, error: null };
    }),
  };
  const fetchMock = vi.fn(async (_url?: unknown, _init?: unknown) =>
    Response.json({
      choices: [{ message: { content: JSON.stringify(options.model ?? GOOD) } }],
      usage: { prompt_tokens: 1000, completion_tokens: 200 },
    }),
  );
  const deps = {
    env: (n: string) =>
      n === 'OPENROUTER_API_KEY' ? (options.noKey ? undefined : 'key') : options.env?.[n],
    caller,
    service,
    fetch: fetchMock,
    rateLimit: async () => undefined,
    readImage: async () => IMAGE,
    promptVersion: options.promptVersion,
  } as unknown as Deps;
  const request = (body: Record<string, unknown> = {}) =>
    new Request('https://x/receipt-parse', {
      method: 'POST',
      body: JSON.stringify({ groupId: 'g1', storagePath: 'g1/r.jpg', ...body }),
    });
  return { deps, fetchMock, cache, rpcLog, caller, request };
}

const recorded = (log: { name: string; args: Record<string, unknown> }[]) =>
  log.find((c) => c.name === 'waves_record_receipt')!.args;

describe('receipt-parse exact-match cache', () => {
  it('a miss calls the model once, stores the parse, and counts as a scan', async () => {
    const t = setup();
    const res = await handleReceiptParse(t.request(), t.deps);
    const body = await res.json();
    expect(t.fetchMock).toHaveBeenCalledTimes(1);
    expect(body.status).toBe('parsed');
    expect(body.quota).toEqual({ used: 1, limit: 20 });
    expect(t.cache.size).toBe(1);
    const [key, value] = [...t.cache.entries()][0]!;
    // The key is salted with the group: the same bytes in another group miss.
    const salted = new Uint8Array([...new TextEncoder().encode('g1|'), ...IMAGE]);
    expect(key).toBe(`${await sha256Hex(salted)}|${CACHE_MODEL_TAG}|${PROMPT_VERSION}|INR`);
    expect(value).toEqual(GOOD);
    expect(recorded(t.rpcLog).p_cached).toBe(false);
    expect(recorded(t.rpcLog).p_reserved).toBe(true);
    expect(recorded(t.rpcLog).p_input_tokens).toBe(1000);
  });

  it('a hit skips the model, is recorded as cached, and does not count as a scan', async () => {
    const t = setup();
    await handleReceiptParse(t.request(), t.deps);
    t.fetchMock.mockClear();
    t.rpcLog.length = 0;

    const res = await handleReceiptParse(t.request(), t.deps);
    const body = await res.json();
    expect(t.fetchMock).not.toHaveBeenCalled();
    expect(body.parsed).toEqual(GOOD);
    expect(body.status).toBe('parsed');
    expect(body.receiptId).toBe('receipt-1');
    // Not +1: nothing was spent.
    expect(body.quota).toEqual({ used: 0, limit: 20 });
    const args = recorded(t.rpcLog);
    expect(args.p_cached).toBe(true);
    expect(args.p_input_tokens).toBe(0);
    expect(args.p_output_tokens).toBe(0);
    expect(args.p_storage_path).toBe('g1/r.jpg');
  });

  it('a hit is served even when the monthly scan quota is used up', async () => {
    const warm = setup();
    await handleReceiptParse(warm.request(), warm.deps);
    const t = setup({ cache: warm.cache, used: 20, limit: 20 });
    const res = await handleReceiptParse(t.request(), t.deps);
    expect(res.status).toBe(200);
    expect(t.fetchMock).not.toHaveBeenCalled();
  });

  it('a miss at quota is still refused before the model', async () => {
    const t = setup({ used: 20, limit: 20 });
    await expect(handleReceiptParse(t.request(), t.deps)).rejects.toMatchObject({
      status: 429,
      code: 'SCAN_QUOTA_REACHED',
    });
    expect(t.fetchMock).not.toHaveBeenCalled();
  });

  it('the group receipt ceiling applies to a hit too', async () => {
    const warm = setup();
    await handleReceiptParse(warm.request(), warm.deps);
    const t = setup({ cache: warm.cache, canAdd: false });
    await expect(handleReceiptParse(t.request(), t.deps)).rejects.toMatchObject({
      status: 429,
      code: 'RECEIPT_CAP_REACHED',
    });
    expect(t.rpcLog.some((c) => c.name === 'waves_record_receipt')).toBe(false);
  });

  it('does not store a parse that fails to reconcile', async () => {
    const t = setup({ model: OFF });
    const body = await (await handleReceiptParse(t.request(), t.deps)).json();
    expect(body.status).toBe('needs_review');
    expect(t.cache.size).toBe(0);
    expect(t.rpcLog.some((c) => c.name === 'waves_receipt_cache_put')).toBe(false);
  });

  it('does not store a malformed parse', async () => {
    const t = setup({ model: { merchant: 'x' } });
    await handleReceiptParse(t.request(), t.deps).catch(() => undefined);
    expect(t.cache.size).toBe(0);
  });

  it('does not store when the model call fails', async () => {
    const t = setup();
    t.fetchMock.mockResolvedValue(new Response('{"error":{"type":"x"}}', { status: 500 }));
    await expect(handleReceiptParse(t.request(), t.deps)).rejects.toMatchObject({ status: 502 });
    expect(t.cache.size).toBe(0);
  });

  it('a different PROMPT_VERSION misses and calls the model again', async () => {
    const t = setup({ promptVersion: 'old' });
    await handleReceiptParse(t.request(), t.deps);
    expect(t.fetchMock).toHaveBeenCalledTimes(1);

    const bumped = setup({ cache: t.cache, promptVersion: 'new' });
    await handleReceiptParse(bumped.request(), bumped.deps);
    expect(bumped.fetchMock).toHaveBeenCalledTimes(1);
    expect(t.cache.size).toBe(2);
  });

  it('a different currency hint misses', async () => {
    const t = setup();
    await handleReceiptParse(t.request(), t.deps);
    const other = setup({ cache: t.cache });
    await handleReceiptParse(other.request({ currency: 'USD' }), other.deps);
    expect(other.fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never caches pasted text, or text sent beside a photo', async () => {
    const t = setup();
    await handleReceiptParse(t.request({ storagePath: undefined, rawText: 'Tea 100' }), t.deps);
    await handleReceiptParse(t.request({ rawText: 'Tea 100' }), t.deps);
    expect(t.cache.size).toBe(0);
    expect(t.rpcLog.some((c) => c.name === 'waves_receipt_cache_get')).toBe(false);
  });

  it('treats a broken cache lookup as a miss', async () => {
    const t = setup();
    const original = t.deps.service.rpc as ReturnType<typeof vi.fn>;
    original.mockImplementationOnce(async () => {
      throw new Error('db down');
    });
    const res = await handleReceiptParse(t.request(), t.deps);
    expect(res.status).toBe(200);
    expect(t.fetchMock).toHaveBeenCalledTimes(1);
  });

  it('still refuses another group’s image before looking anything up', async () => {
    const t = setup();
    await expect(
      handleReceiptParse(t.request({ storagePath: 'other-group/r.jpg' }), t.deps),
    ).rejects.toMatchObject({ status: 403 });
    expect(t.rpcLog.some((c) => c.name === 'waves_receipt_cache_get')).toBe(false);
  });
});

const sentBody = (call: unknown[]) => JSON.parse((call[1] as { body: string }).body);

describe('receipt-parse on OpenRouter', () => {
  it('falls back to the second model on a 500 and reports who answered', async () => {
    const t = setup();
    t.fetchMock.mockResolvedValueOnce(
      new Response('{"error":{"message":"boom"}}', { status: 500 }),
    );
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const res = await handleReceiptParse(t.request(), t.deps);
    expect(res.status).toBe(200);
    expect(t.fetchMock).toHaveBeenCalledTimes(2);
    expect(sentBody(t.fetchMock.mock.calls[0]!).model).toBe(RECEIPT_MODELS[0]);
    expect(sentBody(t.fetchMock.mock.calls[1]!).model).toBe(RECEIPT_MODELS[1]);
    const logged = log.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain(RECEIPT_MODELS[1]);
    log.mockRestore();
    expect(recorded(t.rpcLog).p_input_tokens).toBe(1000);
    expect(recorded(t.rpcLog).p_output_tokens).toBe(200);
  });

  it('falls back when a model returns a body that is not a receipt', async () => {
    const t = setup();
    t.fetchMock.mockResolvedValueOnce(
      Response.json({ choices: [{ message: { content: '```json\n{"merchant":"x"}\n```' } }] }),
    );
    const res = await handleReceiptParse(t.request(), t.deps);
    expect(res.status).toBe(200);
    expect(t.fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a model once without reasoning on a 400', async () => {
    const t = setup();
    t.fetchMock.mockResolvedValueOnce(new Response('{}', { status: 400 }));
    await handleReceiptParse(t.request(), t.deps);
    expect(t.fetchMock).toHaveBeenCalledTimes(2);
    expect(sentBody(t.fetchMock.mock.calls[0]!).reasoning).toEqual({ effort: 'low' });
    const second = sentBody(t.fetchMock.mock.calls[1]!);
    expect(second.reasoning).toBeUndefined();
    expect(second.model).toBe(RECEIPT_MODELS[0]);
  });

  it('fails with SCAN_FAILED when every model fails', async () => {
    const t = setup();
    t.fetchMock.mockResolvedValue(new Response('{"error":{"message":"down"}}', { status: 503 }));
    await expect(handleReceiptParse(t.request(), t.deps)).rejects.toMatchObject({
      status: 502,
      code: 'SCAN_FAILED',
    });
    expect(t.cache.size).toBe(0);
  });

  it('is 503 SCANNING_UNAVAILABLE without OPENROUTER_API_KEY', async () => {
    const t = setup({ noKey: true });
    await expect(handleReceiptParse(t.request(), t.deps)).rejects.toMatchObject({
      status: 503,
      code: 'SCANNING_UNAVAILABLE',
    });
    expect(t.fetchMock).not.toHaveBeenCalled();
  });

  it('respects the RECEIPT_MODELS env override', async () => {
    const t = setup({ env: { RECEIPT_MODELS: ' vendor/a , ,vendor/b ' } });
    t.fetchMock.mockResolvedValueOnce(new Response('{}', { status: 500 }));
    await handleReceiptParse(t.request(), t.deps);
    expect(sentBody(t.fetchMock.mock.calls[0]!).model).toBe('vendor/a');
    expect(sentBody(t.fetchMock.mock.calls[1]!).model).toBe('vendor/b');
  });

  it('sends no-retention routing, a json_schema format and the image as a data URL', async () => {
    const t = setup();
    await handleReceiptParse(t.request(), t.deps);
    const [url, init] = t.fetchMock.mock.calls[0]! as [string, { headers: Record<string, string> }];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(init.headers.authorization).toBe('Bearer key');
    const body = sentBody(t.fetchMock.mock.calls[0]!);
    expect(body.provider).toEqual({ data_collection: 'deny' });
    expect(body.response_format.type).toBe('json_schema');
    expect(body.response_format.json_schema).toMatchObject({ name: 'receipt', strict: true });
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[1].content[0]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/jpeg;base64,AQIDBA==' },
    });
    expect(body.messages[1].content[1].type).toBe('text');
  });
});

describe('isParsedReceipt', () => {
  it('accepts the schema shape and rejects partial or float-money data', () => {
    expect(isParsedReceipt(GOOD)).toBe(true);
    expect(isParsedReceipt({ ...GOOD, grandTotal: 10.5 })).toBe(false);
    expect(isParsedReceipt({ ...GOOD, items: [{ label: 'x' }] })).toBe(false);
    expect(isParsedReceipt(null)).toBe(false);
  });
});

describe('storagePath validation', () => {
  it('rejects a path traversal in storagePath', async () => {
    const t = setup();
    await expect(
      handleReceiptParse(t.request({ storagePath: 'g1/../other/x.jpg' }), t.deps),
    ).rejects.toMatchObject({ status: 400, code: 'BAD_PATH' });
  });

  it('rejects an empty segment in storagePath', async () => {
    const t = setup();
    await expect(
      handleReceiptParse(t.request({ storagePath: 'g1//x' }), t.deps),
    ).rejects.toMatchObject({ status: 400, code: 'BAD_PATH' });
  });

  it('rejects a dot segment in storagePath', async () => {
    const t = setup();
    await expect(
      handleReceiptParse(t.request({ storagePath: 'g1/./x' }), t.deps),
    ).rejects.toMatchObject({ status: 400, code: 'BAD_PATH' });
  });

  it('accepts a normal storagePath', async () => {
    const t = setup();
    const res = await handleReceiptParse(t.request({ storagePath: 'g1/r.jpg' }), t.deps);
    expect(res.status).toBe(200);
  });
});

describe('company image isolation', () => {
  it.each([
    { bucket: 'company-entry-images' },
    { companyEntryId: 'entry' },
    { attachmentId: 'image' },
  ])('rejects company selectors before parsing: %j', async (selectors) => {
    const t = setup();
    const res = await handleReceiptParse(t.request(selectors), t.deps);
    expect(res.status).toBe(400);
    expect(t.fetchMock).not.toHaveBeenCalled();
    expect(t.rpcLog).toHaveLength(0);
  });
});
