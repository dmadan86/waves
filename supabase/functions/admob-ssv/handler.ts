/**
 * admob-ssv — AdMob telling Waves that someone watched a rewarded ad to the end.
 *
 * The only way a rewarded ad turns into extra voice commands or scans: the phone
 * never grants anything. AdMob calls this URL (server-side verification) with a
 * GET signed by Google; the signature is checked first, against Google's
 * published keys (verify.ts). Then the ad unit must be one of ours, the
 * `user_id` (the Waves profile id the app set on the ad) and `custom_data`
 * ('voice', 'scan', or a credit source, set by the app) are read from the signed query, and
 * `waves_ads_grant` — service role only — checks eligibility and the daily cap
 * and records one `ad_rewards` row, idempotent on AdMob's `transaction_id`.
 *
 * `verify_jwt = false` in config.toml: the caller is Google, which has no
 * Supabase session. A bad signature answers 403 and touches nothing. A good one
 * always answers 200 once understood — including "capped", "ineligible" and
 * "duplicate" — so AdMob stops retrying something that will never change; only a
 * failure to read the keys or to write answers 5xx, which AdMob retries.
 *
 * Secret: ADMOB_AD_UNIT_IDS, comma-separated rewarded ad unit ids that may
 * reward (the numeric id, or the full `ca-app-pub-…/id`). Unset, every callback
 * is refused (503): an unconfigured endpoint rewards nothing.
 */

import { HttpError, json } from '../_shared/auth.ts';
import { splitSignedQuery, verifyCallback, VerifierKeys } from './verify.ts';

/**
 * How old a callback's `timestamp` (ms, signed by Google) may be. AdMob calls
 * within seconds of the ad ending; an hour covers its retries. Anything older is
 * a callback somebody held back to replay on a day the account is eligible.
 */
export const MAX_CALLBACK_AGE_MS = 60 * 60 * 1000;
/** Clock skew tolerated for a timestamp in the future. */
export const MAX_CALLBACK_SKEW_MS = 5 * 60 * 1000;

export interface Deps {
  env: (name: string) => string | undefined;
  keys: VerifierKeys;
  service: {
    rpc: (
      name: string,
      args: Record<string, unknown>,
    ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  };
  /** The clock (tests). */
  now?: () => number;
}

/**
 * The reward fields, read from the SIGNED part of the query only (everything
 * before `&signature=`). A field that appears twice is refused: the verifier
 * cannot tell which copy Google meant, so neither is trusted.
 */
export function signedParams(rawQuery: string): ReadonlyMap<string, string> | null {
  return splitSignedQuery(rawQuery)?.fields ?? null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The id after the last slash, so `ca-app-pub-1/222` and `222` are the same unit. */
export function unitId(value: string): string {
  const v = value.trim();
  return v.slice(v.lastIndexOf('/') + 1);
}

export function allowedUnits(env: (name: string) => string | undefined): Set<string> {
  return new Set(
    (env('ADMOB_AD_UNIT_IDS') ?? '')
      .split(',')
      .map(unitId)
      .filter((v) => v.length > 0),
  );
}

export async function handleAdmobSsv(request: Request, deps: Deps): Promise<Response> {
  if (request.method !== 'GET') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Use GET');

  const url = new URL(request.url);
  const rawQuery = url.search.startsWith('?') ? url.search.slice(1) : url.search;
  // AdMob's "verify URL" check in the console, and a browser opening the link:
  // nothing to verify, nothing to do.
  if (rawQuery === '') return json({ ok: true });

  const units = allowedUnits(deps.env);
  if (units.size === 0) throw new HttpError(503, 'MISCONFIGURED', 'ADMOB_AD_UNIT_IDS is not set');

  let params: ReadonlyMap<string, string> | null;
  try {
    params = await verifyCallback(rawQuery, deps.keys);
  } catch (error) {
    // Could not read Google's keys: AdMob retries a 5xx.
    console.error('admob-ssv keys unavailable', error instanceof Error ? error.message : 'error');
    throw new HttpError(503, 'KEYS_UNAVAILABLE', 'Verifier keys unavailable');
  }
  if (!params) throw new HttpError(403, 'BAD_SIGNATURE', 'Signature does not verify');

  const ignored = (reason: string): Response => {
    console.log(JSON.stringify({ fn: 'admob-ssv', outcome: 'ignored', reason }));
    return json({ ok: true, outcome: 'ignored', reason });
  };

  // Freshness: the signed timestamp must be recent. A genuine callback kept for
  // a day the account is Free and under its cap would otherwise still verify.
  const timestamp = Number(params.get('timestamp') ?? '');
  const now = (deps.now ?? Date.now)();
  if (
    !Number.isFinite(timestamp) ||
    timestamp < now - MAX_CALLBACK_AGE_MS ||
    timestamp > now + MAX_CALLBACK_SKEW_MS
  ) {
    return ignored('timestamp');
  }

  const adUnit = unitId(params.get('ad_unit') ?? '');
  if (!units.has(adUnit)) return ignored('ad_unit');
  const userId = params.get('user_id') ?? '';
  if (!UUID.test(userId)) return ignored('user_id');
  const kind = params.get('custom_data') ?? '';
  if (!/^(voice|scan|credit(?::(voluntary|voice|offer|gate))?)$/.test(kind)) {
    return ignored('custom_data');
  }
  const transactionId = (params.get('transaction_id') ?? '').trim();
  if (!transactionId || transactionId.length > 200) return ignored('transaction_id');

  const { data, error } = await deps.service.rpc('waves_ads_grant', {
    p_profile: userId.toLowerCase(),
    p_kind: kind,
    p_transaction_id: transactionId,
    p_ad_unit: adUnit,
  });
  if (error) {
    console.error('admob-ssv grant failed', error.message);
    throw new HttpError(500, 'INTERNAL', 'Could not record the reward');
  }
  const result = (data ?? {}) as { outcome?: string; reason?: string };
  // Metadata only: no profile id, no transaction id.
  console.log(
    JSON.stringify({
      fn: 'admob-ssv',
      outcome: result.outcome ?? 'unknown',
      reason: result.reason,
      kind,
    }),
  );
  return json({ ok: true, outcome: result.outcome ?? 'unknown' });
}
