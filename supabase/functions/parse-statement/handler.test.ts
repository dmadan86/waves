/**
 * The whole parse-statement flow with stubbed Supabase and model: gating order,
 * the file-level quota with continuation tokens, refunds, input validation,
 * redaction as a second line of defence and the shape of what comes back.
 */

import { describe, expect, it, vi } from 'vitest';

import { HttpError } from '../_shared/auth.ts';
import {
  CHUNK_FEATURE,
  DEFAULT_MODELS,
  FEATURE,
  handleParseStatement,
  MONTHLY_REQUEST_LIMIT,
  SYSTEM_PROMPT,
  type Deps,
} from './handler.ts';

const ME = 'profile-me';
const NOW = 1_760_000_000_000;

const JPEG = (() => {
  const bytes = new Uint8Array(64);
  bytes.set([0xff, 0xd8, 0xff, 0xe0]);
  return btoa(String.fromCharCode(...bytes));
})();

const goodRow = {
  date: '2026-10-01',
  dateText: '01/10/26',
  description: 'UPI-SWIGGY-SWIGGY@ICICI-627412345678-ORDER',
  amount: '45000',
  direction: 'debit',
  ref: '627412345678',
  balance: '4955000',
  confidence: 0.95,
  isTotalOrSummary: false,
};

function modelReply(extraction?: unknown, over: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      choices: [
        {
          finish_reason: 'stop',
          message: {
            content: JSON.stringify(
              extraction ?? { currency: 'INR', openingBalance: '5000000', rows: [goodRow] },
            ),
          },
        },
      ],
      usage: { prompt_tokens: 1800, completion_tokens: 300 },
      ...over,
    }),
  );
}

function makeDeps(
  over: {
    enabled?: unknown;
    gateError?: boolean;
    quota?: Record<string, unknown> | null;
    chunkAllowed?: boolean;
    fetchImpl?: (url: string, init: RequestInit) => Response | Promise<Response>;
    env?: Record<string, string>;
    rateLimit?: () => Promise<void>;
    signedIn?: boolean;
  } = {},
) {
  const rpc = vi.fn(async (name: string) => {
    if (name === 'waves_statement_import_enabled') {
      return over.gateError
        ? { data: null, error: { message: 'boom' } }
        : { data: over.enabled ?? true, error: null };
    }
    if (name === 'waves_statement_import_quota') {
      return {
        data:
          over.quota === undefined
            ? { used: 4, limit: 30, tier: 'pro', allowed: true }
            : over.quota,
        error: null,
      };
    }
    if (name === 'waves_ai_usage_reserve') {
      return {
        data: { used: 1, limit: MONTHLY_REQUEST_LIMIT, allowed: over.chunkAllowed ?? true },
        error: null,
      };
    }
    return { data: 0, error: null };
  });
  const fetchMock = vi.fn(over.fetchImpl ?? (async () => modelReply()));
  const rateLimit = vi.fn(over.rateLimit ?? (async () => undefined));
  const deps: Deps = {
    env: (n) =>
      ({ OPENROUTER_API_KEY: 'key', SUPABASE_SERVICE_ROLE_KEY: 'service-secret', ...over.env })[n],
    caller: {
      auth: {
        getUser: async () =>
          over.signedIn === false
            ? { data: { user: null }, error: { message: 'no' } }
            : { data: { user: { id: ME } }, error: null },
      },
    } as unknown as Deps['caller'],
    service: { rpc } as unknown as Deps['service'],
    fetch: fetchMock as unknown as typeof fetch,
    now: () => NOW,
    rateLimit,
  };
  return { deps, rpc, fetchMock, rateLimit };
}

function req(body: unknown, init: RequestInit = {}): Request {
  return new Request('https://x.test/parse-statement', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    ...init,
  });
}

const goodBody = (over: Record<string, unknown> = {}) => ({
  importId: 'import-0001-abcd',
  pages: [
    {
      kind: 'text',
      page: 1,
      text: 'Date Narration Withdrawal Deposit Balance\n01/10/26 UPI-X 450.00 49,550.00',
    },
  ],
  hints: {
    currency: 'INR',
    today: '2026-10-12',
    locale: 'en-IN',
    country: 'IN',
    bank: 'HDFC Bank',
  },
  ...over,
});

async function refusal(promise: Promise<Response>): Promise<HttpError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(HttpError);
    return error as HttpError;
  }
  throw new Error('expected a refusal');
}

const rpcNames = (rpc: ReturnType<typeof makeDeps>['rpc']) => rpc.mock.calls.map((c) => c[0]);

describe('success', () => {
  it('returns validated rows, the quota, a continuation, and calls the model as the plan says', async () => {
    const { deps, rpc, fetchMock } = makeDeps();
    const res = await handleParseStatement(req(goodBody()), deps);
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]).toMatchObject({
      amount: '45000',
      direction: 'debit',
      ref: '627412345678',
      balance: '4955000',
      date: '2026-10-01',
    });
    expect(out.currency).toBe('INR');
    expect(out.openingBalance).toBe('5000000');
    expect(out.balance).toEqual({ checked: 1, failed: 0 });
    expect(out.quota).toEqual({ used: 4, limit: 30 });
    expect(out.model).toBe(DEFAULT_MODELS[0]);
    expect(out.continuation).toMatch(/^\d+\.[0-9a-f]{64}$/);

    expect(rpcNames(rpc)).toEqual([
      'waves_statement_import_enabled',
      'waves_statement_import_quota',
      'waves_ai_usage_reserve',
    ]);
    expect(rpc.mock.calls[1]![1]).toEqual({ p_profile: ME, p_pro_limit: 30 });
    expect(rpc.mock.calls[2]![1]).toEqual({
      p_profile: ME,
      p_feature: CHUNK_FEATURE,
      p_limit: MONTHLY_REQUEST_LIMIT,
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    const sent = JSON.parse((init as RequestInit).body as string);
    expect(sent.model).toBe(DEFAULT_MODELS[0]);
    expect(sent.provider).toEqual({ data_collection: 'deny' });
    expect(sent.response_format.json_schema).toMatchObject({ name: 'statement', strict: true });
    expect(sent.messages[0]).toEqual({ role: 'system', content: SYSTEM_PROMPT });
    const userText = (sent.messages[1].content as { text: string }[]).map((p) => p.text).join('\n');
    expect(userText).toContain('<page number="1">');
    expect(userText).toContain('"today":"2026-10-12"');
    expect(userText).toContain('HDFC Bank');
  });

  it('uses the same model chain as the screenshot import, and the override when set', async () => {
    const a = makeDeps({ env: { IMPORT_VISION_MODEL: 'vendor/a' } });
    await handleParseStatement(req(goodBody()), a.deps);
    expect(JSON.parse((a.fetchMock.mock.calls[0]![1] as RequestInit).body as string).model).toBe(
      'vendor/a',
    );
    const b = makeDeps({
      env: { STATEMENT_IMPORT_MODEL: 'vendor/s', IMPORT_VISION_MODEL: 'vendor/a' },
    });
    await handleParseStatement(req(goodBody()), b.deps);
    expect(JSON.parse((b.fetchMock.mock.calls[0]![1] as RequestInit).body as string).model).toBe(
      'vendor/s',
    );
  });

  it('flags a row the statement’s own balance disproves, so it starts unticked', async () => {
    const bad = { ...goodRow, balance: '1' };
    const { deps } = makeDeps({
      fetchImpl: async () =>
        modelReply({ currency: 'INR', openingBalance: '5000000', rows: [bad] }),
    });
    const out = await (await handleParseStatement(req(goodBody()), deps)).json();
    expect(out.rows[0].warnings).toContain('balance_mismatch');
    expect(out.balance).toEqual({ checked: 1, failed: 1 });
  });

  it('sends image pages to the model as images', async () => {
    const { deps, fetchMock } = makeDeps();
    const body = goodBody({
      pages: [{ kind: 'image', page: 2, base64: JPEG, mimeType: 'image/jpeg' }],
    });
    expect((await handleParseStatement(req(body), deps)).status).toBe(200);
    const sent = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(sent.messages[1].content.some((p: { type: string }) => p.type === 'image_url')).toBe(
      true,
    );
  });

  it('masks account numbers again on the server, in case the app forgot', async () => {
    const { deps, fetchMock } = makeDeps();
    const body = goodBody({
      pages: [
        {
          kind: 'text',
          page: 1,
          text: '01/10/26 NEFT TO A/C No. 50100123456789 RENT 5,000.00 9,000.00\n02/10/26 UPI-X-9876543210@ybl-627412345678 1.00 8.00',
        },
      ],
    });
    await handleParseStatement(req(body), deps);
    const sentText = (fetchMock.mock.calls[0]![1] as RequestInit).body as string;
    expect(sentText).not.toContain('50100123456789');
    expect(sentText).not.toContain('9876543210');
    expect(sentText).toContain('XXXXXXXXXX6789');
    expect(sentText).toContain('627412345678');
  });

  it('logs metadata only: no description, no amount, no text', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { deps } = makeDeps();
    await handleParseStatement(req(goodBody()), deps);
    const line = String(info.mock.calls[0]![0]);
    info.mockRestore();
    expect(JSON.parse(line)).toMatchObject({ fn: 'parse-statement', rows: 1, pages: 1 });
    expect(line).not.toMatch(/SWIGGY|45000|UPI/);
  });
});

describe('one file is one use', () => {
  async function firstContinuation() {
    const first = makeDeps();
    const out = await (await handleParseStatement(req(goodBody()), first.deps)).json();
    return out.continuation as string;
  }

  it('a follow-up request with the file’s continuation does not reserve the file again', async () => {
    const continuation = await firstContinuation();
    const { deps, rpc } = makeDeps();
    const out = await (await handleParseStatement(req(goodBody({ continuation })), deps)).json();
    expect(rpcNames(rpc)).toEqual(['waves_statement_import_enabled', 'waves_ai_usage_reserve']);
    expect(out.quota).toBeNull();
    expect(out.continuation).toBe(continuation);
  });

  it('refuses a continuation for another import, another person, a forged one and an expired one', async () => {
    const continuation = await firstContinuation();
    const { deps } = makeDeps();
    for (const bad of [
      { importId: 'another-import-id', continuation },
      { continuation: continuation.replace(/.$/, (c) => (c === '0' ? '1' : '0')) },
      { continuation: `${NOW - 1}.${continuation.split('.')[1]}` },
      { continuation: 'garbage' },
    ]) {
      const error = await refusal(handleParseStatement(req(goodBody(bad)), deps));
      expect(error.status).toBe(403);
      expect(error.code).toBe('INVALID_CONTINUATION');
    }
    const other = makeDeps({ env: { STATEMENT_IMPORT_SIGNING_KEY: 'a-different-key' } });
    expect(
      (await refusal(handleParseStatement(req(goodBody({ continuation })), other.deps))).status,
    ).toBe(403);
  });

  it('counts every request on the request counter, and refuses when it is spent', async () => {
    const continuation = await firstContinuation();
    const { deps, fetchMock } = makeDeps({ chunkAllowed: false });
    const error = await refusal(handleParseStatement(req(goodBody({ continuation })), deps));
    expect(error.status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refunds both meters when the model fails on a file’s first request', async () => {
    const { deps, rpc } = makeDeps({ fetchImpl: async () => new Response('x', { status: 500 }) });
    const error = await refusal(handleParseStatement(req(goodBody()), deps));
    expect(error.status).toBe(502);
    const refunds = rpc.mock.calls.filter((c) => c[0] === 'waves_ai_usage_refund').map((c) => c[1]);
    expect(refunds).toEqual([
      { p_profile: ME, p_feature: FEATURE },
      { p_profile: ME, p_feature: CHUNK_FEATURE },
    ]);
  });

  it('refunds only the request counter when a follow-up request fails', async () => {
    const continuation = await firstContinuation();
    const { deps, rpc } = makeDeps({ fetchImpl: async () => new Response('x', { status: 500 }) });
    await refusal(handleParseStatement(req(goodBody({ continuation })), deps));
    const refunds = rpc.mock.calls.filter((c) => c[0] === 'waves_ai_usage_refund').map((c) => c[1]);
    expect(refunds).toEqual([{ p_profile: ME, p_feature: CHUNK_FEATURE }]);
  });
});

describe('gating order', () => {
  it('405 for anything but POST, 503 when unconfigured', async () => {
    const { deps } = makeDeps();
    expect(
      (await refusal(handleParseStatement(new Request('https://x.test/', { method: 'GET' }), deps)))
        .status,
    ).toBe(405);
    const bare = makeDeps({ env: { OPENROUTER_API_KEY: '' } });
    expect((await refusal(handleParseStatement(req(goodBody()), bare.deps))).status).toBe(503);
  });

  it('401 when not signed in, before anything is spent', async () => {
    const { deps, rpc } = makeDeps({ signedIn: false });
    expect((await refusal(handleParseStatement(req(goodBody()), deps))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('402 for someone who is not on Pro, before rate limit, quota or model', async () => {
    const { deps, rpc, rateLimit, fetchMock } = makeDeps({ enabled: false });
    const error = await refusal(handleParseStatement(req(goodBody()), deps));
    expect(error.status).toBe(402);
    expect(error.code).toBe('STATEMENT_IMPORT_PAID');
    expect(rpcNames(rpc)).toEqual(['waves_statement_import_enabled']);
    expect(rateLimit).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('503 when the gate itself errors (never a free pass)', async () => {
    const { deps } = makeDeps({ gateError: true });
    expect((await refusal(handleParseStatement(req(goodBody()), deps))).status).toBe(503);
  });

  it('429 from the rate limiter, before the quota is touched', async () => {
    const { deps, rpc } = makeDeps({
      rateLimit: async () => {
        throw new HttpError(429, 'RATE_LIMITED', 'Slow down');
      },
    });
    expect((await refusal(handleParseStatement(req(goodBody()), deps))).status).toBe(429);
    expect(rpcNames(rpc)).toEqual(['waves_statement_import_enabled']);
  });

  it('429 with the numbers when the month’s files are used up, and no model call', async () => {
    const { deps, fetchMock } = makeDeps({
      quota: { used: 30, limit: 30, tier: 'pro', allowed: false },
    });
    const res = await handleParseStatement(req(goodBody()), deps);
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({
      code: 'STATEMENT_QUOTA_REACHED',
      used: 30,
      limit: 30,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('input validation costs nothing', () => {
  it.each([
    ['no importId', goodBody({ importId: '' }), 400],
    ['no pages', goodBody({ pages: [] }), 400],
    [
      'too many pages',
      goodBody({
        pages: Array.from({ length: 6 }, (_, i) => ({ kind: 'text', page: i + 1, text: 'x' })),
      }),
      400,
    ],
    ['a page with no text', goodBody({ pages: [{ kind: 'text', page: 1, text: '  ' }] }), 400],
    ['a bad page number', goodBody({ pages: [{ kind: 'text', page: 0, text: 'x' }] }), 400],
    ['an unknown kind', goodBody({ pages: [{ kind: 'pdf', page: 1 }] }), 400],
    [
      'an unsupported image',
      goodBody({ pages: [{ kind: 'image', page: 1, base64: JPEG, mimeType: 'image/gif' }] }),
      415,
    ],
    [
      'an image whose bytes lie',
      goodBody({ pages: [{ kind: 'image', page: 1, base64: JPEG, mimeType: 'image/png' }] }),
      400,
    ],
    [
      'too much text',
      goodBody({ pages: [{ kind: 'text', page: 1, text: 'x'.repeat(60_001) }] }),
      413,
    ],
  ])('%s -> %i', async (_name, body, status) => {
    const { deps, rpc, fetchMock } = makeDeps();
    const error = await refusal(handleParseStatement(req(body), deps));
    expect(error.status).toBe(status);
    expect(rpcNames(rpc)).toEqual(['waves_statement_import_enabled']);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('400 for a body that is not JSON, 413 for one that is too large', async () => {
    const { deps } = makeDeps();
    expect((await refusal(handleParseStatement(req('nope'), deps))).status).toBe(400);
    expect(
      (
        await refusal(
          handleParseStatement(
            req(goodBody(), { headers: { 'content-length': String(13 * 1024 * 1024) } }),
            deps,
          ),
        )
      ).status,
    ).toBe(413);
  });
});

describe('the model', () => {
  it('tries the next model when the first fails, and stops at the first valid reading', async () => {
    let calls = 0;
    const { deps, fetchMock } = makeDeps({
      fetchImpl: async () => (calls++ === 0 ? new Response('x', { status: 500 }) : modelReply()),
    });
    const out = await (await handleParseStatement(req(goodBody()), deps)).json();
    expect(out.model).toBe(DEFAULT_MODELS[1]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries without the effort knob on a 400', async () => {
    let calls = 0;
    const { deps, fetchMock } = makeDeps({
      fetchImpl: async () => (calls++ === 0 ? new Response('x', { status: 400 }) : modelReply()),
    });
    await handleParseStatement(req(goodBody()), deps);
    expect(
      JSON.parse((fetchMock.mock.calls[1]![1] as RequestInit).body as string).reasoning,
    ).toBeUndefined();
  });

  it('422 on a refusal and on a cut-off, with a refund', async () => {
    const refused = makeDeps({
      fetchImpl: async () =>
        new Response(
          JSON.stringify({ choices: [{ finish_reason: 'stop', message: { refusal: 'no' } }] }),
        ),
    });
    expect((await refusal(handleParseStatement(req(goodBody()), refused.deps))).status).toBe(422);
    const cut = makeDeps({
      fetchImpl: async () =>
        new Response(
          JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '{' } }] }),
        ),
    });
    const error = await refusal(handleParseStatement(req(goodBody()), cut.deps));
    expect(error.code).toBe('TOO_MANY_ROWS_IN_PAGES');
    expect(cut.rpc.mock.calls.some((c) => c[0] === 'waves_ai_usage_refund')).toBe(true);
  });

  it('502 when no model returns something usable', async () => {
    const { deps } = makeDeps({ fetchImpl: async () => modelReply({ nope: true }) });
    expect((await refusal(handleParseStatement(req(goodBody()), deps))).status).toBe(502);
  });

  it('drops rows the validator rejects and reports the count', async () => {
    const { deps } = makeDeps({
      fetchImpl: async () =>
        modelReply({
          currency: 'INR',
          openingBalance: null,
          rows: [
            goodRow,
            { ...goodRow, amount: '12.5' },
            { ...goodRow, description: 'Closing balance', isTotalOrSummary: true },
          ],
        }),
    });
    const out = await (await handleParseStatement(req(goodBody()), deps)).json();
    expect(out.rows).toHaveLength(1);
    expect(out.warnings).toEqual([
      { code: 'rows_dropped_invalid', count: 1 },
      { code: 'summary_rows_dropped', count: 1 },
    ]);
  });
});
