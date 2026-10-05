/**
 * What the phone sign-in screen says when something fails, in order of how
 * specific it can be: the server's own refusal (localized where a key exists,
 * its message otherwise), then what Firebase refused, then the generic line.
 */

import { PhoneSignInUnavailable, PhoneVerifyError, phoneErrorKind } from '@/lib/phoneAuth';
import type { PhoneErrorKind } from '@/lib/phoneAuth';

export interface PhoneSignInStrings {
  phoneErrors: Record<PhoneErrorKind | 'unavailable', string>;
  phoneServerErrors: {
    tooMany: string;
    alreadyUsed: string;
    notVerified: string;
    unavailable: string;
    misconfigured: string;
    phoneTaken: string;
  };
}

const SERVER_KEYS: Record<string, keyof PhoneSignInStrings['phoneServerErrors']> = {
  TOO_MANY: 'tooMany',
  ALREADY_USED: 'alreadyUsed',
  NOT_VERIFIED: 'notVerified',
  UNAVAILABLE: 'unavailable',
  MISCONFIGURED: 'misconfigured',
  PHONE_TAKEN: 'phoneTaken',
};

/** The sentence to show, or null when nothing here can name the failure. */
export function phoneSignInMessage(caught: unknown, s: PhoneSignInStrings): string | null {
  if (caught instanceof PhoneVerifyError) {
    const key = SERVER_KEYS[caught.serverCode];
    return key ? s.phoneServerErrors[key] : caught.message || null;
  }
  if (caught instanceof PhoneSignInUnavailable) return s.phoneErrors.unavailable;
  const kind = phoneErrorKind(caught);
  return kind ? s.phoneErrors[kind] : null;
}
