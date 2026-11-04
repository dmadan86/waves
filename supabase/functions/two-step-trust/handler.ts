/**
 * two-step-trust (phone only): makes this phone's session a verified one for company two-step login.
 *
 * Every call first proves the genuine app via a limited-use App Check token (consumed, so never replayed). Then:
 *   - a session already marked stays trusted (a phone that lost its secret gets a new one);
 *   - a code (from this phone's stored secret, the old phone or an authenticator) marks the session;
 *   - a person with no phone or authenticator yet is trusted on first use and gets a phone secret;
 *   - an owner/manager approval of this exact session and device trusts it;
 *   - otherwise this is a new phone for someone who already has a factor: it waits (`pending`), sees no company data.
 */

import { errorResponse, HttpError, json } from '../_shared/auth.ts';
import {
  attemptCode,
  callerSession,
  codeRefusal,
  loadSecrets,
  matchCode,
  newSecret,
  readCode,
  requireAppCheck,
  sealSecret,
  sessionMarked,
  type TwoStepDeps,
} from '../_shared/twoStep.ts';

interface TrustBody {
  deviceId?: unknown;
  hasSecret?: unknown;
  code?: unknown;
  platform?: unknown;
}

export async function handleTwoStepTrust(request: Request, deps: TwoStepDeps): Promise<Response> {
  try {
    if (request.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Use POST');
    const body = (await request.json().catch(() => ({}))) as TrustBody;
    const deviceId = typeof body.deviceId === 'string' ? body.deviceId.trim() : '';
    if (deviceId.length < 1 || deviceId.length > 200) {
      throw new HttpError(400, 'VALIDATION_FAILED', 'deviceId is required');
    }
    const hasSecret = body.hasSecret === true;
    const code = body.code === undefined || body.code === null ? null : readCode(body.code);
    const platform = typeof body.platform === 'string' ? body.platform.slice(0, 20) : null;

    const { profileId, sessionId } = await callerSession(deps, request);
    const service = deps.asService();
    await deps.rateLimit(service, request, profileId);
    await requireAppCheck(deps, request);

    const secrets = await loadSecrets(service, profileId);
    const active = secrets.filter((row) => row.active);
    const myPhone = active.some((row) => row.kind === 'phone' && row.device_id === deviceId);

    /** A new phone secret, only on the database's say-so (see waves_two_step_trust_phone). */
    const issue = async (
      mode: 'first' | 'code' | 'approved',
      match: { secretId: string | null; step: number | null } = { secretId: null, step: null },
    ) => {
      const secret = newSecret();
      const { data, error } = await service.rpc('waves_two_step_trust_phone', {
        p_profile: profileId,
        p_session: sessionId,
        p_device: deviceId,
        p_secret_enc: await sealSecret(deps.env, secret.bytes),
        p_mode: mode,
        p_secret_id: match.secretId,
        p_step: match.step,
      });
      if (error) throw new HttpError(500, 'INTERNAL', error.message);
      const result = data as { ok: boolean; reason?: string };
      return { secret: result.ok ? secret.base32 : null, reason: result.reason };
    };

    // A phone that already holds this person's phone secret stays trusted on a marked session. A session mark is never
    // enough to *issue* a phone secret: that would let a stolen session take the phone factor over.
    if (hasSecret && myPhone && (await sessionMarked(service, profileId, sessionId)) && !code) {
      return json({ status: 'trusted' });
    }

    if (code) {
      // A phone whose secret was replaced or reset cannot pass with it: tell it to start over instead of counting a miss.
      if (hasSecret && !myPhone) return json({ status: 'revoked' });
      if (hasSecret) {
        // This phone's own code: marks the session, issues nothing.
        const outcome = await attemptCode(deps, service, {
          profileId,
          sessionId,
          kind: 'phone',
          deviceId,
          code,
          candidates: active,
        });
        if (outcome !== 'ok') throw codeRefusal(outcome);
        return json({ status: 'trusted' });
      }
      // A code from the old phone or an authenticator, consumed in the same transaction that moves the phone factor.
      const issued = await issue('code', await matchCode(deps, code, active));
      if (!issued.secret) throw codeRefusal(issued.reason === 'LOCKED' ? 'LOCKED' : 'BAD_CODE');
      return json({ status: 'trusted', secret: issued.secret });
    }
    if (hasSecret && !myPhone) return json({ status: 'revoked' });

    if (active.length === 0) {
      const first = await issue('first');
      if (first.secret) return json({ status: 'trusted', secret: first.secret });
    }

    const approved = await issue('approved');
    if (approved.secret) return json({ status: 'trusted', secret: approved.secret });

    const { error } = await service.rpc('waves_two_step_request_device', {
      p_profile: profileId,
      p_session: sessionId,
      p_device: deviceId,
      p_platform: platform,
    });
    if (error) throw new HttpError(500, 'INTERNAL', error.message);
    return json({ status: 'pending' });
  } catch (error) {
    return errorResponse(error, { fn: 'two-step-trust' });
  }
}
