/**
 * A scan that could not read must not report that it found nothing.
 *
 * The defect this pins, seen on a real phone: the scan sheet looked only at how
 * many rows were added, so a permission that had never been granted produced
 * `added: 0` and the sheet said **"Nothing new since last time."** — on a screen
 * that still read "Nothing read yet". Scan became a button that always claimed
 * success and never did anything, and the only honest signal, the failure
 * reason, was thrown away twice: once by the gate, which returned no reason at
 * all, and again by the sheet, which never looked.
 */

import { describe, expect, it } from 'vitest';

import { failureIsAskable, readFailureMessage } from '../src/lib/smsFailureMessage';
import { SmsReadFailure } from '../src/lib/smsReader';

const ALL = [
  SmsReadFailure.Denied,
  SmsReadFailure.Blocked,
  SmsReadFailure.Unsupported,
  SmsReadFailure.Unavailable,
  SmsReadFailure.Failed,
] as const;

/** Only the strings this module actually reaches for. */
const t = {
  smsImport: {
    permissionDenied: 'denied',
    permissionBlocked: 'blocked',
    readUnsupported: 'unsupported',
    readUnavailable: 'unavailable',
    readFailed: 'failed',
  },
} as unknown as Parameters<typeof readFailureMessage>[1];

describe('why a read failed', () => {
  it('has a sentence for every reason', () => {
    // A reason added later with no sentence would fall out of the switch as
    // undefined and render as a blank line where an explanation should be.
    for (const reason of ALL) {
      expect(readFailureMessage(reason, t)).toBeTruthy();
    }
  });

  it('tells the reasons apart rather than collapsing them', () => {
    // "Waves cannot read messages on this phone" and "you have not allowed it
    // yet" are acted on completely differently.
    const said = ALL.map((reason) => readFailureMessage(reason, t));
    expect(new Set(said).size).toBe(ALL.length);
  });
});

describe('which failures are worth offering a way out of', () => {
  it('offers one for a permission that was never granted', () => {
    // The scan path only checks the permission, never asks, so "denied" is the
    // first run as often as it is a refusal. Both are answered by sending the
    // reader to the disclosure screen.
    expect(failureIsAskable(SmsReadFailure.Denied)).toBe(true);
  });

  it('offers none for the ones no in-app screen can undo', () => {
    // "Don't ask again" cannot be reversed from inside the app, and an iPhone
    // will never read messages however often it is asked. A button that cannot
    // work is worse than the sentence alone.
    expect(failureIsAskable(SmsReadFailure.Blocked)).toBe(false);
    expect(failureIsAskable(SmsReadFailure.Unsupported)).toBe(false);
    expect(failureIsAskable(SmsReadFailure.Unavailable)).toBe(false);
    expect(failureIsAskable(SmsReadFailure.Failed)).toBe(false);
  });

  it('offers none when there is no reason at all', () => {
    // A successful scan, and the shape the gate used to return.
    expect(failureIsAskable(undefined)).toBe(false);
  });
});
