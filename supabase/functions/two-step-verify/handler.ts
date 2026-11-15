/**
 * two-step-verify (web, or a phone without App Check): a 6-digit code from the person's phone or authenticator marks
 * this session as verified. Rate limited (fail closed), ±1 step, no reuse, 10 misses lock (15 min, doubling per 10 more).
 */

import { errorResponse, HttpError, json } from '../_shared/auth.ts';
import {
  attemptCode,
  callerSession,
  codeRefusal,
  loadSecrets,
  readCode,
  type TwoStepDeps,
} from '../_shared/twoStep.ts';

export async function handleTwoStepVerify(request: Request, deps: TwoStepDeps): Promise<Response> {
  try {
    if (request.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Use POST');
    const body = (await request.json().catch(() => ({}))) as { code?: unknown };
    const code = readCode(body.code);
    const { profileId, sessionId } = await callerSession(deps, request);
    const service = deps.asService();
    await deps.rateLimit(service, request, profileId);
    const active = (await loadSecrets(service, profileId)).filter((row) => row.active);
    if (active.length === 0) {
      throw new HttpError(
        409,
        'NO_FACTOR',
        'Open Waves on your phone first to set up two-step login',
      );
    }
    const outcome = await attemptCode(deps, service, {
      profileId,
      sessionId,
      kind: 'web',
      deviceId: null,
      code,
      candidates: active,
    });
    if (outcome !== 'ok') throw codeRefusal(outcome);
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error, { fn: 'two-step-verify' });
  }
}
