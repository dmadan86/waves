import { describe, expect, it } from 'vitest';

import { base32Decode, totpAt, totpStep } from '../_shared/core.js';
import { deps, fakeDb, post, PROFILE, SESSION } from '../_shared/test/twoStepFakes.ts';
import { sealSecret } from '../_shared/twoStep.ts';
import { handleTwoStepAuthenticator } from './handler.ts';

const NOW = Date.now();

describe('two-step-authenticator', () => {
  it('needs a verified session', async () => {
    const res = await handleTwoStepAuthenticator(post({ action: 'start' }), deps({ db: fakeDb() }));
    expect(res.status).toBe(403);
  });

  it('starts with an otpauth link and activates on a matching code', async () => {
    const db = fakeDb();
    db.state.sessions.push({ session_id: SESSION, profile_id: PROFILE, kind: 'phone' });
    const d = deps({ db, now: () => NOW });
    const started = (await (
      await handleTwoStepAuthenticator(post({ action: 'start' }), d)
    ).json()) as {
      secret: string;
      uri: string;
    };
    expect(started.uri).toMatch(/^otpauth:\/\/totp\/Waves%3Aa%40b\.c\?secret=/);
    expect(db.state.secrets).toEqual([
      expect.objectContaining({ kind: 'authenticator', active: false }),
    ]);
    const wrong = await handleTwoStepAuthenticator(post({ action: 'confirm', code: '000000' }), d);
    expect([400]).toContain(wrong.status);
    const code = totpAt(base32Decode(started.secret)!, totpStep(NOW));
    const ok = await handleTwoStepAuthenticator(post({ action: 'confirm', code }), d);
    expect(ok.status).toBe(200);
    expect(db.state.secrets).toEqual([
      expect.objectContaining({ kind: 'authenticator', active: true }),
    ]);
  });

  describe('start with an existing factor', () => {
    const SECRET = new Uint8Array(20).fill(9);
    const setup = async () => {
      const db = fakeDb();
      db.state.sessions.push({ session_id: SESSION, profile_id: PROFILE, kind: 'phone' });
      const d = deps({ db, now: () => NOW });
      db.state.secrets.push({
        id: 'p1',
        profile_id: PROFILE,
        kind: 'phone',
        device_id: 'dev',
        secret_enc: await sealSecret(d.env, SECRET),
        active: true,
        last_step: 0,
        created_at: new Date(NOW).toISOString(),
      });
      return { db, d };
    };

    it('refuses without a code and with a wrong code (counting toward the lock)', async () => {
      const { db, d } = await setup();
      const none = await handleTwoStepAuthenticator(post({ action: 'start' }), d);
      expect(none.status).toBe(403);
      expect(((await none.json()) as { code: string }).code).toBe('CODE_REQUIRED');
      const wrong = await handleTwoStepAuthenticator(post({ action: 'start', code: '000000' }), d);
      expect(wrong.status).toBe(400);
      expect(db.state.failures).toBe(1);
      expect(db.state.secrets).toHaveLength(1);
    });

    it('starts on a current code from an active secret, once', async () => {
      const { db, d } = await setup();
      const code = totpAt(SECRET, totpStep(NOW));
      const ok = await handleTwoStepAuthenticator(post({ action: 'start', code }), d);
      expect(ok.status).toBe(200);
      expect(db.state.secrets.map((s) => s.kind + s.active)).toEqual([
        'phonetrue',
        'authenticatorfalse',
      ]);
      const replay = await handleTwoStepAuthenticator(post({ action: 'start', code }), d);
      expect(replay.status).toBe(400);
    });
  });
});
