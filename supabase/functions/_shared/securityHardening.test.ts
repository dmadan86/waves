import { describe, expect, it, vi } from 'vitest';

import { assertSessionLive, validReceiptShareUrl } from './auth.ts';
import { enforceRateLimit, subjectFor } from './rateLimit.ts';
import { SyncSession } from '../sync/index.ts';

const failingService = {
  rpc: async () => ({ data: null, error: { message: 'db down' } }),
} as never;
const req = (headers: Record<string, string> = {}) => new Request('https://x/f', { headers });

describe('security hardening', () => {
  it("does not return another profile's stored mutation result", async () => {
    const query = {
      select: () => query,
      eq: () => query,
      maybeSingle: async () => ({ data: { result: { secret: 1 }, profile_id: 'someone-else' } }),
    };
    const session = new SyncSession({} as never, { from: () => query } as never, 'me');
    const dispatch = vi.spyOn(session as never as { dispatch: () => unknown }, 'dispatch');
    const out = await session.apply({
      clientMutationId: 'm1',
      kind: 'group.update',
      groupId: 'g',
      payload: {},
    } as never);
    expect(out).toMatchObject({ status: 'rejected', code: 'MUTATION_ID_CONFLICT' });
    expect(JSON.stringify(out)).not.toContain('secret');
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('limiter DB error: 503 for voice-agent, allowed for sync', async () => {
    await expect(enforceRateLimit(failingService, req(), 'voice-agent', 'p')).rejects.toMatchObject(
      {
        status: 503,
        code: 'RATE_LIMIT_UNAVAILABLE',
      },
    );
    await expect(enforceRateLimit(failingService, req(), 'sync', 'p')).resolves.toBeUndefined();
  });

  it('ignores a forged leading x-forwarded-for entry', () => {
    const r = req({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9' });
    expect(subjectFor(r)).toBe('ip:203.0.113.9');
  });

  it('accepts only null or https receiptShareUrl', () => {
    expect(validReceiptShareUrl(null)).toBeNull();
    expect(validReceiptShareUrl('https://a.example/r')).toBe('https://a.example/r');
    for (const bad of [
      'javascript:alert(1)',
      'intent://x',
      'file:///etc/passwd',
      'http://a.example',
      'nope',
      5,
      'https://a.example/' + 'x'.repeat(2100),
    ]) {
      expect(() => validReceiptShareUrl(bad)).toThrowError(
        expect.objectContaining({ code: 'VALIDATION_FAILED' }),
      );
    }
  });

  it('refuses a revoked device session, allows live or unknown', async () => {
    const jwt = (claims: object) => `h.${btoa(JSON.stringify(claims))}.s`;
    const svc = (data: unknown, error: unknown = null) =>
      ({ rpc: async () => ({ data, error }) }) as never;
    const r = (c: object) => req({ authorization: `Bearer ${jwt(c)}` });
    await expect(assertSessionLive(svc(false), r({ session_id: 's' }))).rejects.toMatchObject({
      status: 401,
      code: 'SESSION_REVOKED',
    });
    await expect(assertSessionLive(svc(true), r({ session_id: 's' }))).resolves.toBeUndefined();
    await expect(
      assertSessionLive(svc(null, { message: 'x' }), r({ session_id: 's' })),
    ).resolves.toBeUndefined();
    await expect(assertSessionLive(svc(false), r({}))).resolves.toBeUndefined();
  });
});
