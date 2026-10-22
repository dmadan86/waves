/**
 * WAV-02 / WAV-03 / M3, the edge half: receipt-parse read the month's count,
 * compared, called the model, then recorded (a parallel burst overshot; a
 * quota read error admitted the scan at a fallback 20); a bad `source` or a
 * cross-group receipt id failed the recorder AFTER the model answered, so the
 * scan was never counted; `rawText` had no size limit.
 *
 * Now one atomic reservation (waves_receipt_scan_reserve) precedes the model,
 * fails closed, the record step cannot un-count it, and the inputs the
 * recorder would refuse are refused first.
 */

import { describe, expect, it, vi } from 'vitest';

import { handleReceiptParse, MAX_RAW_TEXT_CHARS, type Deps } from '../../receipt-parse/handler.ts';

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

interface Options {
  reserve?: { allowed: boolean; used: number; limit: number } | 'error' | 'garbage';
  record?: 'error';
  ownerOf?: Record<string, string>;
}

function setup(options: Options = {}) {
  const calls: string[] = [];
  const service = {
    rpc: vi.fn(async (name: string) => {
      calls.push(name);
      if (name === 'waves_receipt_scan_reserve') {
        if (options.reserve === 'error') return { data: null, error: { message: 'db down' } };
        if (options.reserve === 'garbage') return { data: { nope: true }, error: null };
        return { data: options.reserve ?? { allowed: true, used: 1, limit: 20 }, error: null };
      }
      if (name === 'waves_record_receipt') {
        return options.record === 'error'
          ? { data: null, error: { message: 'RECEIPT_GROUP_MISMATCH' } }
          : { data: 'receipt-1', error: null };
      }
      return { data: null, error: null };
    }),
    from: vi.fn(() => {
      const q: Record<string, unknown> = {};
      let id = '';
      q.select = () => q;
      q.eq = (_col: string, value: string) => {
        id = value;
        return q;
      };
      q.maybeSingle = async () => ({
        data: options.ownerOf?.[id] ? { group_id: options.ownerOf[id] } : null,
        error: null,
      });
      return q;
    }),
  };
  const caller = {
    auth: { getUser: async () => ({ data: { user: { id: 'p1' } }, error: null }) },
    rpc: vi.fn(async (name: string) => {
      if (name === 'waves_my_member_id') return { data: 'm1', error: null };
      if (name === 'waves_receipt_scan_quota') return { data: { used: 1, limit: 20 }, error: null };
      if (name === 'waves_can_add_receipt') return { data: true, error: null };
      return { data: null, error: null };
    }),
  };
  const fetchMock = vi.fn(async () => {
    calls.push('model');
    return Response.json({
      choices: [{ message: { content: JSON.stringify(GOOD) } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });
  });
  const deps = {
    env: (n: string) => ({ OPENROUTER_API_KEY: 'key' })[n],
    caller,
    service,
    fetch: fetchMock,
    rateLimit: async () => undefined,
    readImage: async () => new Uint8Array([1, 2, 3]),
    promptVersion: 'test',
  } as unknown as Deps;
  const request = (body: Record<string, unknown> = {}) =>
    new Request('https://x/receipt-parse', {
      method: 'POST',
      body: JSON.stringify({ groupId: 'g1', storagePath: 'g1/r.jpg', ...body }),
    });
  return { deps, calls, fetchMock, request, service };
}

const refusal = async (p: Promise<Response>) => {
  try {
    await p;
  } catch (e) {
    return e as { status: number; code: string };
  }
  throw new Error('expected a refusal');
};

describe('WAV-02 the reservation comes first and fails closed', () => {
  it('reserves before the model, and records with p_reserved so it is not counted twice', async () => {
    const t = setup();
    const body = await (await handleReceiptParse(t.request(), t.deps)).json();
    expect(t.calls.indexOf('waves_receipt_scan_reserve')).toBeLessThan(t.calls.indexOf('model'));
    expect(body.quota).toEqual({ used: 1, limit: 20 });
    const recorded = t.service.rpc.mock.calls.find(([n]) => n === 'waves_record_receipt')![1];
    expect(recorded).toMatchObject({ p_reserved: true, p_cached: false });
  });

  it('a refused reservation is 429 and the model is never called', async () => {
    const t = setup({ reserve: { allowed: false, used: 20, limit: 20 } });
    expect(await refusal(handleReceiptParse(t.request(), t.deps))).toMatchObject({
      status: 429,
      code: 'SCAN_QUOTA_REACHED',
    });
    expect(t.fetchMock).not.toHaveBeenCalled();
  });

  it('a reservation the database cannot answer is 503, never a free scan', async () => {
    for (const reserve of ['error', 'garbage'] as const) {
      const t = setup({ reserve });
      expect(await refusal(handleReceiptParse(t.request(), t.deps))).toMatchObject({ status: 503 });
      expect(t.fetchMock).not.toHaveBeenCalled();
    }
  });

  it('a record step that fails after the model does not give the scan back', async () => {
    const t = setup({ record: 'error' });
    expect(await refusal(handleReceiptParse(t.request(), t.deps))).toMatchObject({ status: 500 });
    expect(t.calls).not.toContain('waves_ai_usage_refund');
    expect(t.calls.filter((c) => c === 'waves_receipt_scan_reserve')).toHaveLength(1);
  });
});

describe('WAV-03 / M3 inputs the recorder would refuse are refused before any spend', () => {
  it('a bad source is 400, before membership, reservation or model', async () => {
    const t = setup();
    expect(
      await refusal(handleReceiptParse(t.request({ rawText: 'tea 20', source: 'evil' }), t.deps)),
    ).toMatchObject({ status: 400, code: 'BAD_SOURCE' });
    expect(t.calls).toEqual([]);
  });

  it('a receipt id that lives in another group is 403 before the model', async () => {
    const id = '6f1c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f';
    const t = setup({ ownerOf: { [id]: 'g-other' } });
    expect(await refusal(handleReceiptParse(t.request({ receiptId: id }), t.deps))).toMatchObject({
      status: 403,
    });
    expect(t.fetchMock).not.toHaveBeenCalled();
    expect(t.calls).not.toContain('waves_receipt_scan_reserve');
    const ok = setup({ ownerOf: { [id]: 'g1' } });
    expect((await handleReceiptParse(ok.request({ receiptId: id }), ok.deps)).status).toBe(200);
  });

  it('a receipt id that is not a uuid is 400', async () => {
    const t = setup();
    expect(
      await refusal(handleReceiptParse(t.request({ receiptId: 'nope' }), t.deps)),
    ).toMatchObject({
      status: 400,
      code: 'BAD_RECEIPT_ID',
    });
  });

  it('pasted text over the limit is 413 before anything, under it is a scan', async () => {
    const t = setup();
    expect(
      await refusal(
        handleReceiptParse(
          t.request({ storagePath: undefined, rawText: 'x'.repeat(MAX_RAW_TEXT_CHARS + 1) }),
          t.deps,
        ),
      ),
    ).toMatchObject({ status: 413, code: 'TEXT_TOO_LONG' });
    expect(t.calls).toEqual([]);
    const ok = setup();
    expect(
      (
        await handleReceiptParse(
          ok.request({ storagePath: undefined, rawText: 'x'.repeat(MAX_RAW_TEXT_CHARS) }),
          ok.deps,
        )
      ).status,
    ).toBe(200);
  });
});
