import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  store: new Map<string, string>(),
  invoke: vi.fn(),
  token: vi.fn(),
}));

vi.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when-unlocked',
  getItemAsync: async (k: string) => h.store.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void h.store.set(k, v),
  deleteItemAsync: async (k: string) => void h.store.delete(k),
}));
vi.mock('@/lib/backend', () => ({ backend: { functions: { invoke: h.invoke } } }));
vi.mock('@/lib/appCheck', () => ({ limitedUseAppCheckToken: h.token }));

const { trustThisPhone, codeFor, authenticatorStartBody } = await import('@/lib/twoStep');
const { base32Encode, totpNow, totpSecondsLeft } = await import('@waves/core');

const SECRET = base32Encode(new Uint8Array(20).fill(7));
const KEY = 'waves.twostep.secret.me';
const failure = (code: string) => ({
  data: null,
  error: { context: { json: async () => ({ code }) } },
});
const wait = vi.fn(async () => undefined);

beforeEach(() => {
  h.store.clear();
  h.invoke.mockReset();
  h.token.mockReset().mockResolvedValue('tok');
  wait.mockClear();
});

describe('code and countdown', () => {
  it('makes the same code as core and counts 1..30', () => {
    const now = 1_700_000_000_000;
    expect(codeFor(SECRET, now)).toBe(totpNow(new Uint8Array(20).fill(7), now));
    expect(codeFor(null, now)).toBeNull();
    expect(totpSecondsLeft(now)).toBeGreaterThanOrEqual(1);
    expect(totpSecondsLeft(now)).toBeLessThanOrEqual(30);
  });
});

describe('authenticatorStartBody', () => {
  it("sends the phone's own current code, or nothing without a secret", async () => {
    const now = 1_700_000_000_000;
    expect(await authenticatorStartBody('me', now)).toEqual({ action: 'start' });
    h.store.set(KEY, SECRET);
    expect(await authenticatorStartBody('me', now)).toEqual({
      action: 'start',
      code: totpNow(new Uint8Array(20).fill(7), now),
    });
  });
});

describe('trustThisPhone', () => {
  it('stores a newly issued secret and sends the App Check header', async () => {
    h.invoke.mockResolvedValue({ data: { status: 'trusted', secret: SECRET }, error: null });
    expect(await trustThisPhone('me', 'dev')).toEqual({ status: 'trusted' });
    expect(h.store.get(KEY)).toBe(SECRET);
    const [name, args] = h.invoke.mock.calls[0];
    expect(name).toBe('two-step-trust');
    expect(args.headers['X-Firebase-AppCheck']).toBe('tok');
    expect(args.body).toEqual({ deviceId: 'dev', hasSecret: false });
  });

  it('sends the auto code when it holds a secret', async () => {
    h.store.set(KEY, SECRET);
    h.invoke.mockResolvedValue({ data: { status: 'trusted' }, error: null });
    await trustThisPhone('me', 'dev', { now: () => 1_700_000_000_000 });
    expect(h.invoke.mock.calls[0][1].body).toEqual({
      deviceId: 'dev',
      hasSecret: true,
      code: totpNow(new Uint8Array(20).fill(7), 1_700_000_000_000),
    });
  });

  it('reports pending', async () => {
    h.invoke.mockResolvedValue({ data: { status: 'pending' }, error: null });
    expect(await trustThisPhone('me', 'dev')).toEqual({ status: 'pending' });
  });

  it('deletes a revoked secret and retries once without it', async () => {
    h.store.set(KEY, SECRET);
    h.invoke
      .mockResolvedValueOnce({ data: { status: 'revoked' }, error: null })
      .mockResolvedValueOnce({ data: { status: 'pending' }, error: null });
    expect(await trustThisPhone('me', 'dev')).toEqual({ status: 'pending' });
    expect(h.store.has(KEY)).toBe(false);
    expect(h.invoke.mock.calls[1][1].body.hasSecret).toBe(false);
  });

  it('waits for the next step and retries an auto code once', async () => {
    h.store.set(KEY, SECRET);
    h.invoke
      .mockResolvedValueOnce(failure('BAD_CODE'))
      .mockResolvedValueOnce({ data: { status: 'trusted' }, error: null });
    expect(await trustThisPhone('me', 'dev', { wait })).toEqual({ status: 'trusted' });
    expect(wait).toHaveBeenCalledTimes(1);
  });

  it('says so when a typed code is wrong, without retrying', async () => {
    h.invoke.mockResolvedValue(failure('BAD_CODE'));
    expect(await trustThisPhone('me', 'dev', { code: '123456', wait })).toEqual({
      status: 'badCode',
    });
    expect(h.invoke).toHaveBeenCalledTimes(1);
  });

  it('maps server errors and never throws', async () => {
    h.invoke.mockResolvedValue(failure('APP_CHECK_FAILED'));
    expect(await trustThisPhone('me', 'dev')).toEqual({ status: 'update' });
    h.invoke.mockResolvedValue(failure('LOCKED'));
    expect(await trustThisPhone('me', 'dev')).toEqual({ status: 'locked' });
    h.invoke.mockRejectedValue(new Error('offline'));
    expect(await trustThisPhone('me', 'dev')).toEqual({ status: 'unavailable' });
    h.token.mockResolvedValue(null);
    expect(await trustThisPhone('me', 'dev')).toEqual({ status: 'unavailable' });
  });
});
