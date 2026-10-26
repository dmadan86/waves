import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '../_shared/auth.ts';
import { HttpError } from '../_shared/auth.ts';
import { handlePotPay } from './handler.ts';

const code = 'a'.repeat(32);
function fixture() {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
  const enforceRateLimit = vi.fn().mockResolvedValue(undefined);
  const service = { rpc } as unknown as SupabaseClient;
  const deps = { asService: () => service, enforceRateLimit };
  const send = (body: unknown) =>
    handlePotPay(
      new Request('https://edge/pot-pay', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
      deps,
    );
  return { rpc, enforceRateLimit, service, deps, send };
}
describe('public pot-pay', () => {
  it('limits before looking up and returns only payment fields with CORS', async () => {
    const { send, rpc, enforceRateLimit, service } = fixture();
    const info = {
      potName: 'Lunch',
      groupName: 'Friends',
      perHeadMinor: '100',
      currency: 'INR',
      payeeName: 'Tara',
      payeeVpa: 'tara@bank',
    };
    rpc.mockResolvedValue({ data: { ...info, id: 'secret', members: ['secret'] }, error: null });
    const response = await send({ action: 'lookup', code });
    expect(await response.json()).toEqual(info);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(enforceRateLimit).toHaveBeenCalledWith(service, expect.any(Request), 'pot-pay');
    expect(enforceRateLimit.mock.invocationCallOrder[0]).toBeLessThan(
      rpc.mock.invocationCallOrder[0]!,
    );
    expect(rpc).toHaveBeenCalledWith('pot_pay_lookup', { code });
  });
  it('returns null for unknown links and only a boolean for reports', async () => {
    const { send, rpc } = fixture();
    expect(await (await send({ action: 'lookup', code })).json()).toBeNull();
    rpc.mockResolvedValue({ data: true, error: null });
    expect(
      await (await send({ action: 'report', code, payerName: ' Ravi ', utr: '' })).json(),
    ).toBe(true);
    expect(rpc).toHaveBeenLastCalledWith('pot_pay_self_report', {
      code,
      payer_name: 'Ravi',
      utr: null,
    });
    rpc.mockResolvedValue({ data: false, error: null });
    expect(await (await send({ action: 'report', code, payerName: 'Unknown' })).json()).toBe(false);
  });
  it.each([
    null,
    [],
    {},
    { action: 'lookup', code: 42 },
    { action: 'delete', code },
    { action: 'report', code, payerName: '' },
    { action: 'report', code, payerName: 'Ravi', utr: 42 },
    { action: 'report', code, payerName: 'Ravi', utr: 'invalid' },
  ])('rejects invalid input %j before any RPC', async (body) => {
    const { send, rpc } = fixture();
    expect((await send(body)).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('rejects malformed JSON, large bodies and unsupported methods', async () => {
    const { deps, rpc } = fixture();
    for (const [body, status] of [
      ['{', 400],
      ['x'.repeat(2049), 413],
    ] as const) {
      expect(
        (await handlePotPay(new Request('https://edge', { method: 'POST', body }), deps)).status,
      ).toBe(status);
    }
    expect((await handlePotPay(new Request('https://edge'), deps)).status).toBe(405);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('preserves rate-limit refusals and never calls the payment RPC', async () => {
    const { send, rpc, enforceRateLimit } = fixture();
    enforceRateLimit.mockRejectedValue(
      new HttpError(429, 'RATE_LIMITED', 'Wait', { 'Retry-After': '60' }),
    );
    const response = await send({ action: 'lookup', code });
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('60');
    expect(rpc).not.toHaveBeenCalled();
  });
});
