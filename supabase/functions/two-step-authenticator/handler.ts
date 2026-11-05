/**
 * two-step-authenticator: add Google Authenticator (or any TOTP app) as a backup, from an already verified session.
 * `start` (with a current code when a factor already exists) mints a pending secret and returns it with its otpauth:// link; `confirm` activates it once a code from the
 * app matches (the same atomic attempt, so misses count toward the lock).
 */

import { otpauthUri } from '../_shared/core.js';
import { errorResponse, HttpError, json } from '../_shared/auth.ts';
import {
  attemptCode,
  callerSession,
  codeRefusal,
  loadSecrets,
  newSecret,
  readCode,
  sealSecret,
  sessionMarked,
  type TwoStepDeps,
} from '../_shared/twoStep.ts';

const PENDING_MS = 15 * 60 * 1000;

export async function handleTwoStepAuthenticator(
  request: Request,
  deps: TwoStepDeps,
): Promise<Response> {
  try {
    if (request.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Use POST');
    const body = (await request.json().catch(() => ({}))) as { action?: unknown; code?: unknown };
    if (body.action !== 'start' && body.action !== 'confirm') {
      throw new HttpError(400, 'VALIDATION_FAILED', 'action must be start or confirm');
    }
    const { profileId, sessionId, email } = await callerSession(deps, request);
    const service = deps.asService();
    await deps.rateLimit(service, request, profileId);
    if (!(await sessionMarked(service, profileId, sessionId))) {
      throw new HttpError(403, 'TWO_STEP_REQUIRED', 'Verify two-step on this device first');
    }

    if (body.action === 'start') {
      // A marked session alone must not swap the person's factors: with any active secret, prove a current code first.
      const active = (await loadSecrets(service, profileId)).filter((row) => row.active);
      if (active.length > 0) {
        if (body.code === undefined || body.code === null || body.code === '') {
          throw new HttpError(
            403,
            'CODE_REQUIRED',
            'Enter the code from your Waves app or authenticator',
          );
        }
        const proof = await attemptCode(deps, service, {
          profileId,
          sessionId,
          kind: 'phone',
          deviceId: null,
          code: readCode(body.code),
          candidates: active,
        });
        if (proof !== 'ok') throw codeRefusal(proof);
      }
      const del = await service
        .from('two_step_secrets')
        .delete()
        .eq('profile_id', profileId)
        .eq('kind', 'authenticator')
        .eq('active', false);
      if (del.error) throw new HttpError(500, 'INTERNAL', del.error.message);
      const secret = newSecret();
      const ins = await service.from('two_step_secrets').insert({
        profile_id: profileId,
        kind: 'authenticator',
        secret_enc: await sealSecret(deps.env, secret.bytes),
        active: false,
      });
      if (ins.error) throw new HttpError(500, 'INTERNAL', ins.error.message);
      return json({ secret: secret.base32, uri: otpauthUri(secret.base32, email ?? 'Waves') });
    }

    const code = readCode(body.code);
    const pending = (await loadSecrets(service, profileId)).filter(
      (row) =>
        row.kind === 'authenticator' &&
        !row.active &&
        deps.now() - new Date(row.created_at).getTime() < PENDING_MS,
    );
    if (pending.length === 0)
      throw new HttpError(404, 'NO_PENDING', 'Start again to get a new key');
    const outcome = await attemptCode(deps, service, {
      profileId,
      sessionId,
      kind: 'phone',
      deviceId: null,
      code,
      candidates: pending,
      activate: true,
    });
    if (outcome !== 'ok') throw codeRefusal(outcome);
    const { error } = await service.rpc('waves_two_step_notify', {
      p_profile: profileId,
      p_kind: 'two_step_authenticator',
      p_title: 'Authenticator app added',
      p_body: 'It can now give you two-step codes if you lose your phone.',
      p_dedupe: `two_step_auth:${profileId}:${Math.floor(deps.now() / 1000)}`,
    });
    if (error) console.warn('two-step notify failed:', error.message);
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error, { fn: 'two-step-authenticator' });
  }
}
