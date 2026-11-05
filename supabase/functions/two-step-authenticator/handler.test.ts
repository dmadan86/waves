import { describe, expect, it } from 'vitest';

import { base32Decode, totpAt, totpStep } from '../_shared/core.js';
import { deps, fakeDb, post, PROFILE, SESSION } from '../_shared/test/twoStepFakes.ts';
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
});
