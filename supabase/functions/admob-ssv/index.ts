/**
 * admob-ssv — see handler.ts. This file only wires the real dependencies.
 *
 * Secrets: ADMOB_AD_UNIT_IDS (comma-separated rewarded ad unit ids allowed to
 * reward). Google's verifier keys are fetched from gstatic and cached.
 */

import { asService, errorResponse, serveWithCors } from '../_shared/auth.ts';
import { handleAdmobSsv } from './handler.ts';
import { VerifierKeys } from './verify.ts';

// One per warm instance: the key list is read once and kept.
const keys = new VerifierKeys(fetch);

serveWithCors(async (request) => {
  try {
    return await handleAdmobSsv(request, {
      env: (name) => Deno.env.get(name),
      keys,
      service: asService(),
    });
  } catch (error) {
    return errorResponse(error, { fn: 'admob-ssv' });
  }
});
