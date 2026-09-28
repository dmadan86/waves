/**
 * Coverage for contact-unlink — taking a phone or email off your own account.
 *
 * The rules themselves (seven days, never the last way in, the relink cooldown)
 * are enforced in Postgres and covered in `packages/db/test/contactUnlink.test.ts`.
 * What this function adds, and what is pinned here:
 *
 *   * the account is the caller's, from their session, never the body;
 *   * the body is a closed set — `phone` or `email`, nothing else;
 *   * each answer from the database becomes exactly the response the app was
 *     written against, and anything unexpected is a plain 500, never a success.
 */

import { describe, expect, it, vi } from 'vitest';

import { handleContactUnlink, type ContactUnlinkDeps } from './handler.ts';

function request(body: unknown = { channel: 'phone' }, method = 'POST'): Request {
  return new Request('https://edge.test/contact-unlink', {
    method,
    body: method === 'GET' ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function deps(
  overrides: {
    callerId?: string | null;
    unlink?: { data?: unknown; error?: { message: string } | null };
    rateAllowed?: boolean;
  } = {},
): ContactUnlinkDeps & { rpc: ReturnType<typeof vi.fn> } {
  const rpc = vi.fn((name: string) => {
    if (name === 'waves_rate_limit') {
      return Promise.resolve({
        data: {
          allowed: overrides.rateAllowed ?? true,
          retryAfter: 120,
          limit: 10,
          remaining: 0,
        },
        error: null,
      });
    }
    if (name === 'waves_unlink_contact') {
      return Promise.resolve({
        data: overrides.unlink?.data ?? { unlinked: true },
        error: overrides.unlink?.error ?? null,
      });
    }
    return Promise.resolve({ data: null, error: null });
  });
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service: () => ({ rpc }) as any,
    callerId: () =>
      Promise.resolve(overrides.callerId === undefined ? 'user-1' : overrides.callerId),
    rpc,
  };
}

function unlinkCalls(d: { rpc: ReturnType<typeof vi.fn> }) {
  return d.rpc.mock.calls.filter((call) => call[0] === 'waves_unlink_contact');
}

describe('unlinking', () => {
  it('unlinks the channel asked for, from the caller’s own account', async () => {
    const d = deps();
    const response = await handleContactUnlink(request({ channel: 'email' }), d);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ unlinked: true });
    expect(unlinkCalls(d)).toEqual([
      ['waves_unlink_contact', { p_user: 'user-1', p_channel: 'email' }],
    ]);
  });

  it('never takes the account from the body', async () => {
    const d = deps({ callerId: 'user-1' });
    await handleContactUnlink(request({ channel: 'phone', userId: 'someone-else' }), d);

    expect(unlinkCalls(d)[0]![1]).toEqual({ p_user: 'user-1', p_channel: 'phone' });
  });
});

describe('who may ask', () => {
  it('refuses somebody not signed in, before anything else', async () => {
    const d = deps({ callerId: null });
    const response = await handleContactUnlink(request(), d);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      code: 'NOT_AUTHENTICATED',
      message: 'Sign in first',
    });
    expect(d.rpc).not.toHaveBeenCalled();
  });

  it('answers only POST', async () => {
    const d = deps();
    const response = await handleContactUnlink(request(undefined, 'GET'), d);
    expect(response.status).toBe(405);
    expect(d.rpc).not.toHaveBeenCalled();
  });

  it('slows down a caller going too fast', async () => {
    const d = deps({ rateAllowed: false });
    const response = await handleContactUnlink(request(), d);

    expect(response.status).toBe(429);
    expect((await response.json()).code).toBe('RATE_LIMITED');
    expect(response.headers.get('Retry-After')).toBe('120');
    expect(unlinkCalls(d)).toEqual([]);
  });
});

describe('a bad body', () => {
  it.each([
    ['no channel', {}],
    ['an unknown channel', { channel: 'google' }],
    ['a near miss', { channel: 'Phone' }],
    ['a channel that is not a string', { channel: 1 }],
    ['null', null],
    ['not JSON', 'channel=phone'],
    ['nothing at all', ''],
  ])('is a 400 for %s', async (_label, body) => {
    const d = deps();
    const response = await handleContactUnlink(request(body), d);

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.code).toBe('BAD_REQUEST');
    expect(typeof json.message).toBe('string');
    expect(unlinkCalls(d)).toEqual([]);
  });
});

describe('the refusals', () => {
  it('says so when nothing is linked on that channel', async () => {
    const d = deps({ unlink: { data: { refused: 'NOT_LINKED' } } });
    const response = await handleContactUnlink(request(), d);

    expect(response.status).toBe(409);
    const json = await response.json();
    expect(json.code).toBe('NOT_LINKED');
    expect(json.message).toMatch(/number/);
  });

  it('gives the moment it unlocks when linked less than a week ago', async () => {
    const d = deps({
      unlink: { data: { refused: 'TOO_SOON', unlock_at: '2026-10-05T09:30:00.123456+00:00' } },
    });
    const response = await handleContactUnlink(request({ channel: 'email' }), d);

    expect(response.status).toBe(409);
    const json = await response.json();
    expect(json.code).toBe('TOO_SOON');
    expect(json.unlockAt).toBe('2026-10-05T09:30:00.123Z');
    expect(json.message).toMatch(/7 days/);
  });

  it('refuses to take away the last way in', async () => {
    const d = deps({ unlink: { data: { refused: 'LAST_SIGN_IN' } } });
    const response = await handleContactUnlink(request(), d);

    expect(response.status).toBe(409);
    const json = await response.json();
    expect(json.code).toBe('LAST_SIGN_IN');
    expect(json.message).toMatch(/only way/);
  });
});

describe('a failure', () => {
  it('is a plain 500 when the database errors', async () => {
    const d = deps({ unlink: { error: { message: 'connection reset' } } });
    const response = await handleContactUnlink(request(), d);

    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json.code).toBe('FAILED');
    // The detail stays in the log.
    expect(json.message).not.toMatch(/connection reset/);
  });

  it('is a 500, never a success, for an answer it does not recognise', async () => {
    for (const data of [{}, { refused: 'SOMETHING_NEW' }, { refused: 'TOO_SOON' }, 'yes']) {
      const d = deps({ unlink: { data } });
      const response = await handleContactUnlink(request(), d);
      expect(response.status).toBe(500);
      expect((await response.json()).code).toBe('FAILED');
    }
  });

  it('is a 500 when the database call throws', async () => {
    const d = deps();
    d.rpc.mockImplementation((name: string) =>
      name === 'waves_unlink_contact'
        ? Promise.reject(new Error('socket hang up'))
        : Promise.resolve({ data: { allowed: true }, error: null }),
    );
    const response = await handleContactUnlink(request(), d);
    expect(response.status).toBe(500);
    expect((await response.json()).code).toBe('FAILED');
  });
});
