import { beforeEach, describe, expect, it, vi } from 'vitest';

import { base32Decode, totpAt, totpStep } from '../_shared/core.js';
import {
  APP_ID,
  appCheckClaims,
  deps,
  fakeDb,
  KEY_B64,
  post,
  PROFILE,
  PROJECT_NUMBER,
  rsaKey,
  SESSION,
} from '../_shared/test/twoStepFakes.ts';
import { forgetAppCheckKeys, sealSecret } from '../_shared/twoStep.ts';
import { handleTwoStepTrust } from './handler.ts';

const NOW = 1_800_000_000_000;
const NOW_S = NOW / 1000;

let signer: Awaited<ReturnType<typeof rsaKey>>;
let serviceKey: Awaited<ReturnType<typeof rsaKey>>;
beforeEach(async () => {
  forgetAppCheckKeys();
  signer ??= await rsaKey('appcheck');
  serviceKey ??= await rsaKey('svc');
});

/** Google: the JWKS, the OAuth token endpoint and the consume endpoint (which remembers what it has seen). */
function google(options: { consumed?: Set<string>; consumeStatus?: number } = {}) {
  const consumed = options.consumed ?? new Set<string>();
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/v1/jwks')) return Response.json({ keys: [signer.jwk] });
    if (url === 'https://oauth2.googleapis.com/token')
      return Response.json({ access_token: 'ya29' });
    if (url.includes(':verifyAppCheckToken')) {
      if (options.consumeStatus) return new Response('no', { status: options.consumeStatus });
      const token = JSON.parse(String(init?.body)).app_check_token as string;
      const already = consumed.has(token);
      consumed.add(token);
      return Response.json({ alreadyConsumed: already });
    }
    return new Response('?', { status: 404 });
  }) as unknown as typeof fetch;
}

async function env() {
  const vars: Record<string, string> = {
    TWO_STEP_KEY: KEY_B64,
    FIREBASE_PROJECT_NUMBER: PROJECT_NUMBER,
    FIREBASE_PROJECT_ID: 'waves-app',
    FIREBASE_APP_IDS: `${APP_ID}, 1:123456789:ios:def`,
    FIREBASE_SERVICE_ACCOUNT: JSON.stringify({
      client_email: 'svc@x.iam',
      private_key: await serviceKey.privatePem(),
    }),
  };
  return (name: string) => vars[name];
}

async function run(
  db: ReturnType<typeof fakeDb>,
  body: Record<string, unknown>,
  token: string | null,
  fetchImpl = google(),
) {
  const headers: Record<string, string> = token ? { 'x-firebase-appcheck': token } : {};
  const res = await handleTwoStepTrust(
    post({ deviceId: 'phone-A', hasSecret: false, ...body }, headers),
    deps({ db, env: await env(), fetchImpl, now: () => NOW }),
  );
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

describe('two-step-trust: App Check', () => {
  it('trusts a first phone with a valid token and hands it a secret', async () => {
    const db = fakeDb();
    const { status, json } = await run(db, {}, await signer.sign(appCheckClaims(NOW_S)));
    expect(status).toBe(200);
    expect(json).toMatchObject({ status: 'trusted' });
    expect(base32Decode(json.secret as string)).toHaveLength(20);
    expect(db.state.sessions).toEqual([
      expect.objectContaining({ session_id: SESSION, kind: 'phone' }),
    ]);
    // Stored sealed, never in clear.
    expect(db.state.secrets[0]!.secret_enc).not.toContain(json.secret as string);
  });

  const bad: [string, () => Promise<string | null>][] = [
    ['no token', async () => null],
    [
      'a bad signature',
      async () => {
        const token = await signer.sign(appCheckClaims(NOW_S));
        const at = token.lastIndexOf('.') + 10;
        return token.slice(0, at) + (token[at] === 'A' ? 'B' : 'A') + token.slice(at + 1);
      },
    ],
    [
      'another signing key',
      async () => await serviceKey.sign(appCheckClaims(NOW_S), { kid: 'appcheck' }),
    ],
    [
      'a wrong issuer',
      async () =>
        signer.sign(appCheckClaims(NOW_S, { iss: 'https://firebaseappcheck.googleapis.com/999' })),
    ],
    ['a wrong audience', async () => signer.sign(appCheckClaims(NOW_S, { aud: ['projects/999'] }))],
    [
      'another app',
      async () => signer.sign(appCheckClaims(NOW_S, { sub: '1:123456789:android:evil' })),
    ],
    ['an expired token', async () => signer.sign(appCheckClaims(NOW_S, { exp: NOW_S - 120 }))],
    ['alg none', async () => await signer.sign(appCheckClaims(NOW_S), { alg: 'none' })],
  ];
  it.each(bad)('refuses %s and trusts nothing', async (_label, make) => {
    const db = fakeDb();
    const { status, json } = await run(db, {}, await make());
    expect(status).toBe(401);
    expect(json).toMatchObject({ code: 'APP_CHECK_FAILED' });
    expect(db.state.sessions).toHaveLength(0);
    expect(db.state.secrets).toHaveLength(0);
  });

  it('refuses a replayed (already consumed) token', async () => {
    const consumed = new Set<string>();
    const token = await signer.sign(appCheckClaims(NOW_S));
    expect((await run(fakeDb(), {}, token, google({ consumed }))).status).toBe(200);
    const db = fakeDb();
    const replay = await run(db, {}, token, google({ consumed }));
    expect(replay.status).toBe(401);
    expect(db.state.sessions).toHaveLength(0);
  });

  it('fails closed when Firebase cannot consume the token', async () => {
    const db = fakeDb();
    const res = await run(
      db,
      {},
      await signer.sign(appCheckClaims(NOW_S)),
      google({ consumeStatus: 503 }),
    );
    expect(res.status).toBe(503);
    expect(db.state.sessions).toHaveLength(0);
  });

  it('fails closed when the project is not configured', async () => {
    const db = fakeDb();
    const res = await handleTwoStepTrust(
      post(
        { deviceId: 'phone-A', hasSecret: false },
        { 'x-firebase-appcheck': await signer.sign(appCheckClaims(NOW_S)) },
      ),
      deps({ db, env: (n) => ({ TWO_STEP_KEY: KEY_B64 })[n], fetchImpl: google(), now: () => NOW }),
    );
    expect(res.status).toBe(500);
    expect(db.state.sessions).toHaveLength(0);
  });
});

describe('two-step-trust: a new phone (decision 3)', () => {
  async function withOldPhone() {
    const db = fakeDb();
    const secret = base32Decode('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP')!;
    db.state.secrets.push({
      id: 'old',
      profile_id: PROFILE,
      kind: 'phone',
      device_id: 'phone-OLD',
      secret_enc: await sealSecret(await env(), secret),
      active: true,
      last_step: 0,
      created_at: new Date(NOW).toISOString(),
    });
    return { db, code: totpAt(secret, totpStep(NOW)) };
  }

  it('waits for a code or an approval when the person already has a phone', async () => {
    const { db } = await withOldPhone();
    const res = await run(db, {}, await signer.sign(appCheckClaims(NOW_S)));
    expect(res.json).toEqual({ status: 'pending' });
    expect(db.state.sessions).toHaveLength(0);
    expect(db.state.requests).toHaveLength(1);
  });

  it('is trusted with a code from the old phone, and becomes the phone', async () => {
    const { db, code } = await withOldPhone();
    const res = await run(db, { code }, await signer.sign(appCheckClaims(NOW_S)));
    expect(res.json).toMatchObject({ status: 'trusted', secret: expect.any(String) });
    expect(db.state.secrets.filter((s) => s.kind === 'phone').map((s) => s.device_id)).toEqual([
      'phone-A',
    ]);
  });

  it('is trusted once an owner approved this session and device', async () => {
    const { db } = await withOldPhone();
    db.state.requests.push({ session: SESSION, device: 'phone-A', status: 'approved' });
    const res = await run(db, {}, await signer.sign(appCheckClaims(NOW_S)));
    expect(res.json).toMatchObject({ status: 'trusted', secret: expect.any(String) });
  });

  it('tells a phone whose secret was replaced to start over', async () => {
    const { db, code } = await withOldPhone();
    const res = await run(db, { hasSecret: true, code }, await signer.sign(appCheckClaims(NOW_S)));
    expect(res.json).toEqual({ status: 'revoked' });
  });
});
