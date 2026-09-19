/**
 * Why the inbox could not be read, said in a way a person can act on.
 *
 * Lifted out of the disclosure screen, which had the only copy. The scan sheet
 * needed the same sentences and had none: every failure there — a permission
 * never granted, a revoked one, a phone that cannot do this at all — came out
 * as "Nothing new since last time.", which is a different claim entirely and
 * one somebody acts on by giving up.
 */

import { SmsReadFailure } from '@/lib/smsReader';
import type { UiStrings } from '@/i18n';

export function readFailureMessage(reason: SmsReadFailure, t: UiStrings): string {
  switch (reason) {
    case SmsReadFailure.Denied:
      return t.smsImport.permissionDenied;
    case SmsReadFailure.Blocked:
      return t.smsImport.permissionBlocked;
    case SmsReadFailure.Unsupported:
      return t.smsImport.readUnsupported;
    case SmsReadFailure.Unavailable:
      return t.smsImport.readUnavailable;
    case SmsReadFailure.Failed:
      return t.smsImport.readFailed;
  }
}

/**
 * Whether this failure is one the reader can still fix by being asked.
 *
 * `Denied` is the first run as often as it is a refusal: the scan path only
 * ever *checks* the permission, so a phone that was never asked reports exactly
 * the same thing as one that said no. Both are answered the same way — send
 * them to the disclosure screen, which is the only place allowed to ask.
 *
 * `Blocked` is "don't ask again", which no in-app screen can undo, so it is not
 * included: offering a button that cannot work is worse than the sentence.
 */
export function failureIsAskable(reason: SmsReadFailure | undefined): boolean {
  return reason === SmsReadFailure.Denied;
}
