/**
 * The whole import-screenshot flow with stubbed Supabase and Anthropic: gating
 * order, quota reserve/refund, input validation, model handling and the shape
 * of what comes back.
 */

import { describe, expect, it, vi } from 'vitest';

import { HttpError } from '../_shared/auth.ts';
import {
  DEFAULT_MODELS,
  handleImportScreenshot,
  MAX_IMAGE_BYTES,
  sniffImage,
  SYSTEM_PROMPT,
  type Deps,
} from './handler.ts';

const ME = 'profile-me';

/** A few real header bytes padded out; only the head is ever inspected. */
function b64(head: number[], total = 64): string {
  const bytes = new Uint8Array(total);
  bytes.set(head);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
const JPEG = b64([0xff, 0xd8, 0xff, 0xe0]);
const PNG = b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP = b64([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

const goodRow = {
  date: '2026-10-11',
  dateText: 'Yesterday',
  description: 'Dinner at Toit',
  amountMinor: 120000,
  currency: null,
  direction: 'spent',
  paidBy: 'Asha',
  splitAmong: [],
  perPerson: [],
  category: 'food',
  confidence: 0.9,
  isTotalOrSummary: false,
};

function modelReply(over: Record<string, unknown> = {}, extraction?: unknown): Response {
  return new Response(
    JSON.stringify({
      model: 'anthropic/claude-haiku-5.5',
      choices: [
        {
          finish_reason: 'stop',
          message: {
            content: JSON.stringify(
              extraction ?? { imageKind: 'expense_list', currency: 'INR', rows: [goodRow] },
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
    member?: string | null;
    fetchImpl?: (url: string, init: RequestInit) => Response | Promise<Response>;
    env?: Record<string, string>;
    rateLimit?: () => Promise<void>;
  } = {},
) {
  const rpc = vi.fn(async (name: string) => {
    if (name === 'waves_screenshot_import_enabled') {
      return over.gateError
        ? { data: null, error: { message: 'boom' } }
        : { data: over.enabled ?? true, error: null };
    }
    if (name === 'waves_screenshot_import_quota') {
      return {
        data:
          over.quota === undefined
            ? { used: 4, limit: 100, tier: 'pro', allowed: true }
            : over.quota,
        error: null,
      };
    }
    return { data: 0, error: null };
  });
  const fetchMock = vi.fn(over.fetchImpl ?? (async () => modelReply()));
  const rateLimit = vi.fn(over.rateLimit ?? (async () => undefined));
  const deps: Deps = {
    env: (n) => ({ OPENROUTER_API_KEY: 'key', ...over.env })[n],
    caller: {
      auth: { getUser: async () => ({ data: { user: { id: ME } }, error: null }) },
      rpc: async () => ({
        data: over.member === undefined ? 'member-1' : over.member,
        error: null,
      }),
    } as unknown as Deps['caller'],
    service: { rpc } as unknown as Deps['service'],
    fetch: fetchMock as unknown as typeof fetch,
    now: () => 1_760_000_000_000,
    rateLimit,
  };
  return { deps, rpc, fetchMock, rateLimit };
}

function req(body: unknown, init: RequestInit = {}): Request {
  return new Request('https://x.test/import-screenshot', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    ...init,
  });
}

const goodBody = (over: Record<string, unknown> = {}) => ({
  groupId: 'g1',
  images: [{ base64: JPEG, mimeType: 'image/jpeg' }],
  hints: {
    currency: 'INR',
    members: ['Asha Rao', 'Madan'],
    today: '2026-10-12',
    locale: 'en-IN',
    country: 'IN',
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
  it('returns validated rows, quota and model, and calls OpenRouter as the plan says', async () => {
    const { deps, rpc, fetchMock } = makeDeps();
    const res = await handleImportScreenshot(req(goodBody()), deps);
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.imageKind).toBe('expense_list');
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]).toMatchObject({ description: 'Dinner at Toit', paidBy: 'Asha' });
    expect(out.suggestedMembers).toEqual({ Asha: 'Asha Rao' });
    expect(out.quota).toEqual({ used: 4, limit: 100 });
    expect(out.model).toBe(DEFAULT_MODELS[0]);
    expect(out.warnings).toEqual([]);

    expect(rpcNames(rpc)).toEqual([
      'waves_screenshot_import_enabled',
      'waves_screenshot_import_quota',
    ]);
    expect(rpc.mock.calls[1]![1]).toEqual({
      p_profile: ME,
      p_pro_limit: 100,
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer key');
    const sent = JSON.parse((init as RequestInit).body as string);
    expect(sent.model).toBe(DEFAULT_MODELS[0]);
    expect(sent.max_tokens).toBe(16000);
    expect(sent.provider).toEqual({ data_collection: 'deny' });
    expect(sent.reasoning).toEqual({ effort: 'low' });
    expect(sent.response_format.type).toBe('json_schema');
    expect(sent.response_format.json_schema).toMatchObject({ name: 'screenshot', strict: true });
    expect(sent.messages[0]).toEqual({ role: 'system', content: SYSTEM_PROMPT });
    expect(sent.messages[1].content[0]).toEqual({
      type: 'image_url',
      image_url: { url: `data:image/jpeg;base64,${JPEG}` },
    });
    const hintText = sent.messages[1].content[1].text as string;
    expect(hintText).toContain('"today":"2026-10-12"');
    expect(hintText).toContain('"Asha Rao"');
    expect(hintText).toContain('"locale":"en-IN"');
    expect(hintText).toContain('"country":"IN"');
    expect(hintText).toContain('"defaultCurrency":"INR"');
  });

  const sentOf = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string);

  it('uses IMPORT_VISION_MODEL (comma-separated) when set, and the defaults when empty', async () => {
    const a = makeDeps({ env: { IMPORT_VISION_MODEL: ' vendor/a , ,vendor/b ' } });
    a.fetchMock.mockResolvedValueOnce(new Response('{}', { status: 500 }));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await handleImportScreenshot(req(goodBody()), a.deps);
    expect(sentOf(a.fetchMock.mock.calls[0]!).model).toBe('vendor/a');
    expect(sentOf(a.fetchMock.mock.calls[1]!).model).toBe('vendor/b');
    const b = makeDeps({ env: { IMPORT_VISION_MODEL: '' } });
    await handleImportScreenshot(req(goodBody()), b.deps);
    expect(sentOf(b.fetchMock.mock.calls[0]!).model).toBe(DEFAULT_MODELS[0]);
  });

  it('falls back to the next model, keeps one reservation, and names who answered', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { deps, rpc, fetchMock } = makeDeps();
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 500 }));
    const out = await (await handleImportScreenshot(req(goodBody()), deps)).json();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(out.model).toBe(DEFAULT_MODELS[1]);
    expect(rpcNames(rpc)).not.toContain('waves_ai_usage_refund');
  });

  it('falls back when a model returns an unreadable reading', async () => {
    const { deps, fetchMock } = makeDeps();
    fetchMock.mockResolvedValueOnce(modelReply({}, { nothing: true }));
    const res = await handleImportScreenshot(req(goodBody()), deps);
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a model once without reasoning on a 400', async () => {
    const { deps, fetchMock } = makeDeps();
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 400 }));
    await handleImportScreenshot(req(goodBody()), deps);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentOf(fetchMock.mock.calls[1]!).reasoning).toBeUndefined();
    expect(sentOf(fetchMock.mock.calls[1]!).model).toBe(DEFAULT_MODELS[0]);
  });

  it('accepts PNG and WebP and drops summary rows with a warning', async () => {
    for (const [data, mimeType] of [
      [PNG, 'image/png'],
      [WEBP, 'image/webp'],
    ] as const) {
      const { deps } = makeDeps({
        fetchImpl: () =>
          modelReply(
            {},
            {
              imageKind: 'bank_or_upi_history',
              currency: 'INR',
              rows: [goodRow, { ...goodRow, description: 'Balance', isTotalOrSummary: true }],
            },
          ),
      });
      const res = await handleImportScreenshot(
        req(goodBody({ images: [{ base64: data, mimeType }] })),
        deps,
      );
      const out = await res.json();
      expect(out.rows).toHaveLength(1);
      expect(out.warnings).toEqual([{ code: 'summary_rows_dropped', count: 1 }]);
    }
  });

  it('never logs the image or what was read from it', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { deps } = makeDeps();
    await handleImportScreenshot(req(goodBody()), deps);
    const logged = JSON.stringify(info.mock.calls) + JSON.stringify(err.mock.calls);
    expect(logged).not.toContain(JPEG);
    expect(logged).not.toContain('Dinner at Toit');
    expect(logged).not.toContain('Asha');
    expect(info.mock.calls[0]![0]).toContain('"inputTokens":1800');
    info.mockRestore();
    err.mockRestore();
  });
});

describe('gating order', () => {
  it('refuses a non-POST', async () => {
    const { deps } = makeDeps();
    const e = await refusal(
      handleImportScreenshot(req('', { method: 'GET', body: undefined }), deps),
    );
    expect(e.status).toBe(405);
  });

  it('503s when the Anthropic key is missing, before touching anything', async () => {
    const { deps, rpc } = makeDeps();
    const e = await refusal(
      handleImportScreenshot(req(goodBody()), { ...deps, env: () => undefined }),
    );
    expect([e.status, e.code]).toEqual([503, 'IMPORT_SCAN_UNAVAILABLE']);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('403s a non-member before the gate, the limiter, the quota or the model', async () => {
    const { deps, rpc, rateLimit, fetchMock } = makeDeps({ member: null });
    const e = await refusal(handleImportScreenshot(req(goodBody()), deps));
    expect([e.status, e.code]).toEqual([403, 'NOT_A_MEMBER']);
    expect(rpc).not.toHaveBeenCalled();
    expect(rateLimit).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('402s when the gate says no, before the limiter, the quota or the model', async () => {
    const { deps, rpc, rateLimit, fetchMock } = makeDeps({ enabled: false });
    const e = await refusal(handleImportScreenshot(req(goodBody()), deps));
    expect([e.status, e.code]).toEqual([402, 'SCREENSHOT_IMPORT_PAID']);
    expect(rpcNames(rpc)).toEqual(['waves_screenshot_import_enabled']);
    expect(rateLimit).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('treats a gate error as unavailable, not as paid or unpaid', async () => {
    const { deps } = makeDeps({ gateError: true });
    const e = await refusal(handleImportScreenshot(req(goodBody()), deps));
    expect([e.status, e.code]).toEqual([503, 'IMPORT_SCAN_UNAVAILABLE']);
  });

  it('passes the limiter its profile and stops before the quota when it refuses', async () => {
    const { deps, rpc, rateLimit, fetchMock } = makeDeps({
      rateLimit: async () => {
        throw new HttpError(429, 'RATE_LIMITED', 'slow down');
      },
    });
    const e = await refusal(handleImportScreenshot(req(goodBody()), deps));
    expect(e.status).toBe(429);
    expect(rateLimit).toHaveBeenCalledWith(ME);
    expect(rpcNames(rpc)).toEqual(['waves_screenshot_import_enabled']);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('429s with used and limit when the quota is spent, and never calls the model', async () => {
    const { deps, rpc, fetchMock } = makeDeps({
      quota: { used: 100, limit: 100, tier: 'pro', allowed: false },
    });
    const res = await handleImportScreenshot(req(goodBody()), deps);
    expect(res.status).toBe(429);
    const out = await res.json();
    expect(out).toMatchObject({ code: 'SCREENSHOT_QUOTA_REACHED', used: 100, limit: 100 });
    expect(fetchMock).not.toHaveBeenCalled();
    // A refused reservation reserved nothing, so there is nothing to give back.
    expect(rpcNames(rpc)).not.toContain('waves_ai_usage_refund');
  });
});

describe('input validation costs nothing', () => {
  async function rejected(body: unknown, status: number, code: string, init?: RequestInit) {
    const { deps, rpc, fetchMock } = makeDeps();
    const e = await refusal(handleImportScreenshot(req(body, init), deps));
    expect([e.status, e.code]).toEqual([status, code]);
    expect(rpcNames(rpc)).not.toContain('waves_screenshot_import_quota');
    expect(fetchMock).not.toHaveBeenCalled();
  }

  it('wants a JSON object with a groupId', async () => {
    await rejected('not json', 400, 'INVALID_REQUEST');
    await rejected([], 400, 'INVALID_REQUEST');
    await rejected({ images: [] }, 400, 'INVALID_REQUEST');
  });

  it('wants exactly one image', async () => {
    await rejected(goodBody({ images: [] }), 400, 'NO_IMAGE');
    await rejected(goodBody({ images: undefined }), 400, 'NO_IMAGE');
    await rejected(
      goodBody({
        images: [
          { base64: JPEG, mimeType: 'image/jpeg' },
          { base64: JPEG, mimeType: 'image/jpeg' },
        ],
      }),
      400,
      'TOO_MANY_IMAGES',
    );
  });

  it('wants a supported mime type', async () => {
    await rejected(
      goodBody({ images: [{ base64: JPEG, mimeType: 'image/gif' }] }),
      415,
      'UNSUPPORTED_IMAGE_TYPE',
    );
    await rejected(goodBody({ images: [{ base64: JPEG }] }), 415, 'UNSUPPORTED_IMAGE_TYPE');
  });

  it('checks the magic bytes against the label', async () => {
    await rejected(
      goodBody({ images: [{ base64: PNG, mimeType: 'image/jpeg' }] }),
      400,
      'INVALID_IMAGE',
    );
    await rejected(
      goodBody({ images: [{ base64: b64([1, 2, 3, 4]), mimeType: 'image/jpeg' }] }),
      400,
      'INVALID_IMAGE',
    );
  });

  it('rejects text that is not base64', async () => {
    await rejected(
      goodBody({ images: [{ base64: 'data:image/jpeg;base64,/9j/4AAQ', mimeType: 'image/jpeg' }] }),
      400,
      'INVALID_IMAGE',
    );
  });

  it('caps the decoded image at 3.75 MB', async () => {
    const big = b64([0xff, 0xd8, 0xff], Math.ceil(MAX_IMAGE_BYTES) + 3);
    await rejected(
      goodBody({ images: [{ base64: big, mimeType: 'image/jpeg' }] }),
      413,
      'IMAGE_TOO_LARGE',
    );
  });

  it('caps the whole body at 6 MB, declared or actual', async () => {
    await rejected(goodBody(), 413, 'BODY_TOO_LARGE', {
      headers: { 'content-length': String(7 * 1024 * 1024) },
    });
    await rejected(goodBody({ pad: 'x'.repeat(6 * 1024 * 1024) }), 413, 'BODY_TOO_LARGE');
  });
});

describe('model failures give the reservation back', () => {
  async function failed(
    fetchImpl: () => Response | Promise<Response>,
    status: number,
    code: string,
  ) {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { deps, rpc } = makeDeps({ fetchImpl });
    const e = await refusal(handleImportScreenshot(req(goodBody()), deps));
    expect([e.status, e.code]).toEqual([status, code]);
    const refunds = rpc.mock.calls.filter((c) => c[0] === 'waves_ai_usage_refund');
    expect(refunds).toHaveLength(1);
    expect(refunds[0]![1]).toEqual({ p_profile: ME, p_feature: 'screenshot_import' });
  }

  it('on a provider 5xx from every model', async () => {
    await failed(() => new Response('{"error":{}}', { status: 529 }), 502, 'IMPORT_SCAN_FAILED');
  });

  it('on a network error or timeout', async () => {
    await failed(
      () => {
        throw new Error('network down');
      },
      502,
      'IMPORT_SCAN_FAILED',
    );
  });

  it('on a refusal', async () => {
    await failed(
      () =>
        modelReply({
          choices: [{ finish_reason: 'stop', message: { content: null, refusal: 'no' } }],
        }),
      422,
      'IMPORT_SCAN_REFUSED',
    );
  });

  it('on a cut-off reply, with the too-many-rows code', async () => {
    await failed(
      () => modelReply({ choices: [{ finish_reason: 'length', message: { content: '{' } }] }),
      422,
      'TOO_MANY_ROWS_IN_IMAGE',
    );
  });

  it('on an empty, unparseable or malformed reply', async () => {
    await failed(() => modelReply({ choices: [] }), 502, 'IMPORT_SCAN_FAILED');
    await failed(
      () => modelReply({ choices: [{ finish_reason: 'stop', message: { content: '{nope' } }] }),
      502,
      'IMPORT_SCAN_FAILED',
    );
    await failed(() => modelReply({}, { nothing: true }), 502, 'IMPORT_SCAN_FAILED');
  });

  it('is 503 without OPENROUTER_API_KEY, before any allowance is touched', async () => {
    const { deps, rpc, fetchMock } = makeDeps({ env: { OPENROUTER_API_KEY: '' } });
    const e = await refusal(handleImportScreenshot(req(goodBody()), deps));
    expect([e.status, e.code]).toEqual([503, 'IMPORT_SCAN_UNAVAILABLE']);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('does not refund a success', async () => {
    const { deps, rpc } = makeDeps();
    await handleImportScreenshot(req(goodBody()), deps);
    expect(rpcNames(rpc)).not.toContain('waves_ai_usage_refund');
  });
});

describe('sniffImage', () => {
  it('recognises the three formats and nothing else', () => {
    expect(sniffImage(JPEG)).toBe('image/jpeg');
    expect(sniffImage(PNG)).toBe('image/png');
    expect(sniffImage(WEBP)).toBe('image/webp');
    expect(sniffImage(b64([0x47, 0x49, 0x46, 0x38]))).toBeNull();
    expect(sniffImage('!!!!')).toBeNull();
  });
});
