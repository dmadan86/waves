import { describe, expect, it, vi } from 'vitest';

import { base32Decode, totpAt, totpStep } from '../_shared/core.js';
import { HttpError } from '../_shared/auth.ts';
import { deps, fakeDb, PROFILE, post, bearer } from '../_shared/test/twoStepFakes.ts';
import { sealSecret } from '../_shared/twoStep.ts';
import { handleTwoStepVerify } from './handler.ts';

const SECRET = base32Decode('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP')!;
const NOW = 1_800_000_000_000;

async function withPhone() {
  const db = fakeDb();
  const env = (name: string) => deps({ db }).env(name);
  db.state.secrets.push({
    id: 'phone-1',
    profile_id: PROFILE,
    kind: 'phone',
    device_id: 'd1',
    secret_enc: await sealSecret(env, SECRET),
    active: true,
    last_step: 0,
    created_at: new Date(NOW).toISOString(),
  });
  return db;
}

const codeAt = (offsetSteps: number) => totpAt(SECRET, totpStep(NOW) + offsetSteps);

describe('two-step-verify', () => {
  it('marks this web session for a current code', async () => {
    const db = await withPhone();
    const res = await handleTwoStepVerify(post({ code: codeAt(0) }), deps({ db, now: () => NOW }));
    expect(res.status).toBe(200);
    expect(db.state.sessions).toEqual([expect.objectContaining({ kind: 'web' })]);
  });

  it('accepts one step either side and nothing further', async () => {
    for (const [offset, status] of [
      [-1, 200],
      [1, 200],
      [-2, 400],
      [2, 400],
    ] as const) {
      const db = await withPhone();
      const res = await handleTwoStepVerify(
        post({ code: codeAt(offset) }),
        deps({ db, now: () => NOW }),
      );
      expect(res.status, `offset ${offset}`).toBe(status);
    }
  });

  it('refuses a replayed code', async () => {
    const db = await withPhone();
    const d = deps({ db, now: () => NOW });
    expect((await handleTwoStepVerify(post({ code: codeAt(0) }), d)).status).toBe(200);
    const again = await handleTwoStepVerify(post({ code: codeAt(0) }), d);
    expect(again.status).toBe(400);
    expect(await again.json()).toMatchObject({ code: 'BAD_CODE' });
    // An older step after a newer one is a replay too.
    expect((await handleTwoStepVerify(post({ code: codeAt(-1) }), d)).status).toBe(400);
  });

  it('locks after ten misses and refuses even a right code while locked', async () => {
    const db = await withPhone();
    const d = deps({ db, now: () => NOW });
    const wrong = codeAt(0) === '000000' ? '111111' : '000000';
    for (let i = 0; i < 9; i += 1)
      expect((await handleTwoStepVerify(post({ code: wrong }), d)).status).toBe(400);
    expect((await handleTwoStepVerify(post({ code: wrong }), d)).status).toBe(423);
    const right = await handleTwoStepVerify(post({ code: codeAt(0) }), d);
    expect(right.status).toBe(423);
    expect(db.state.sessions).toHaveLength(0);
  });

  it('stops at the rate limit before touching any code, and fails closed', async () => {
    const db = await withPhone();
    const limited = await handleTwoStepVerify(
      post({ code: codeAt(0) }),
      deps({
        db,
        now: () => NOW,
        rateLimit: vi.fn().mockRejectedValue(new HttpError(429, 'RATE_LIMITED', 'slow')),
      }),
    );
    expect(limited.status).toBe(429);
    const down = await handleTwoStepVerify(
      post({ code: codeAt(0) }),
      deps({
        db,
        now: () => NOW,
        rateLimit: vi.fn().mockRejectedValue(new HttpError(503, 'RATE_LIMIT_UNAVAILABLE', 'later')),
      }),
    );
    expect(down.status).toBe(503);
    expect(db.state.rpcCalls).toHaveLength(0);
  });

  it('sends every concurrent attempt to the database, which lets only one through', async () => {
    const db = await withPhone();
    const d = deps({ db, now: () => NOW });
    const results = await Promise.all(
      [1, 2, 3].map(() => handleTwoStepVerify(post({ code: codeAt(0) }), d)),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 400, 400]);
    expect(db.state.rpcCalls.filter((c) => c.name === 'waves_two_step_attempt')).toHaveLength(3);
  });

  it('fails closed without a session id, and says when there is no factor yet', async () => {
    const db = await withPhone();
    const noSession = new Request('https://x', {
      method: 'POST',
      headers: { authorization: bearer({ sub: PROFILE }) },
      body: JSON.stringify({ code: codeAt(0) }),
    });
    expect((await handleTwoStepVerify(noSession, deps({ db, now: () => NOW }))).status).toBe(401);
    const malformed = new Request('https://x', {
      method: 'POST',
      headers: { authorization: bearer({ sub: PROFILE, session_id: 'not-a-uuid' }) },
      body: JSON.stringify({ code: codeAt(0) }),
    });
    expect((await handleTwoStepVerify(malformed, deps({ db, now: () => NOW }))).status).toBe(401);
    const empty = fakeDb();
    const res = await handleTwoStepVerify(
      post({ code: codeAt(0) }),
      deps({ db: empty, now: () => NOW }),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'NO_FACTOR' });
  });

  it('refuses a secret sealed under another key', async () => {
    const db = await withPhone();
    const other = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));
    const res = await handleTwoStepVerify(
      post({ code: codeAt(0) }),
      deps({ db, now: () => NOW, env: (n) => ({ TWO_STEP_KEY: other })[n] }),
    );
    expect(res.status).toBe(400);
  });
});
