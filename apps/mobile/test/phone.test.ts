/**
 * A friend's local number is read in the caller's region — the account's
 * country first, the phone's second — and with no region at all it is refused
 * rather than guessed.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IdentityError } from '@waves/core';

import {
  isPhoneCountryError,
  normaliseContactPhone,
  regionDialCode,
  toE164,
} from '../src/lib/phone';

const device = vi.hoisted(() => ({ country: 'IN' as string | null }));

vi.mock('@/i18n', () => ({ deviceCountry: () => device.country }));

beforeEach(() => {
  device.country = 'IN';
});

describe('regionDialCode', () => {
  it('prefers the account country over the device region', () => {
    expect(regionDialCode('AE')).toBe('+971');
  });

  it('falls back to the device region', () => {
    expect(regionDialCode(null)).toBe('+91');
    expect(regionDialCode()).toBe('+91');
  });

  it('is null when neither names a region', () => {
    device.country = null;
    expect(regionDialCode(null)).toBeNull();
  });
});

describe('normaliseContactPhone', () => {
  it('keeps an empty phone empty', () => {
    expect(normaliseContactPhone(null)).toBeNull();
    expect(normaliseContactPhone(undefined)).toBeNull();
    expect(normaliseContactPhone('   ')).toBeNull();
  });

  it('reads a bare national number in the resolved region, dropping the trunk zero', () => {
    expect(normaliseContactPhone('098765 43210')).toBe('+919876543210');
  });

  it('keeps a number that carries its own country code as typed', () => {
    expect(normaliseContactPhone('+44 7700 900123', 'AE')).toBe('+447700900123');
  });

  /**
   * The exact shape of the bug this guards: a 10-digit Indian mobile, no
   * trunk zero, saved bare in the address book the way most contact cards
   * actually write one down. On a device whose region reads IN, this must
   * come back `+91…`, never `+1…` — the symptom was a contact picker that
   * quietly dialled every bare number into the US.
   */
  it('reads a 10-digit Indian mobile in the device region, with no trunk zero to drop', () => {
    device.country = 'IN';
    expect(normaliseContactPhone('9894068745')).toBe('+919894068745');
    expect(normaliseContactPhone('98940 68745')).toBe('+919894068745');
  });

  it('reads a bare national number in the device region for the other markets this app ships in', () => {
    device.country = 'GB';
    expect(normaliseContactPhone('07700 900123')).toBe('+447700900123');

    device.country = 'AU';
    expect(normaliseContactPhone('0412 345 678')).toBe('+61412345678');

    device.country = 'AE';
    expect(normaliseContactPhone('050 123 4567')).toBe('+971501234567');
  });

  /**
   * The account's own country wins over the device's, which is the whole
   * point of asking for both: a device whose Region setting is wrong — set to
   * the US by a setup flow that never asked, say — must not silently relabel
   * a correctly-recognised Indian account's contacts as American.
   */
  it('trusts the account country over a device region that disagrees with it', () => {
    device.country = 'US';
    expect(normaliseContactPhone('9894068745', 'IN')).toBe('+919894068745');
  });

  it('refuses a bare number when there is no region to read it in', () => {
    device.country = null;
    let caught: unknown;
    try {
      normaliseContactPhone('9876543210');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(IdentityError);
    expect(isPhoneCountryError(caught)).toBe(true);
  });
});

describe('isPhoneCountryError', () => {
  it('recognises the two phone refusals as thrown errors', () => {
    expect(isPhoneCountryError(new IdentityError('PHONE_NEEDS_COUNTRY_CODE', 'x'))).toBe(true);
    expect(isPhoneCountryError(new IdentityError('PHONE_NOT_VALID', 'x'))).toBe(true);
    expect(isPhoneCountryError(new IdentityError('EMAIL_NOT_VALID', 'x'))).toBe(false);
  });

  it('recognises them folded into a server refusal, by code or by message', () => {
    expect(isPhoneCountryError({ code: 'PHONE_NOT_VALID' })).toBe(true);
    expect(isPhoneCountryError({ message: 'P0001: PHONE_NEEDS_COUNTRY_CODE' })).toBe(true);
  });

  it('says no to anything else, including nothing at all', () => {
    expect(isPhoneCountryError({ code: 42, message: 'boom' })).toBe(false);
    expect(isPhoneCountryError(null)).toBe(false);
    expect(isPhoneCountryError(new Error('network'))).toBe(false);
  });
});

describe('toE164', () => {
  it('joins the dial code and the digits, dropping spaces and punctuation', () => {
    expect(toE164('+91', '98765 43210')).toBe('+919876543210');
    expect(toE164('+91', '(98765) 43-210')).toBe('+919876543210');
  });
  it('drops a national trunk zero', () => {
    expect(toE164('+91', '098765 43210')).toBe('+919876543210');
  });
  it('keeps a country code the person typed instead of doubling it', () => {
    expect(toE164('+91', '+44 7700 900123')).toBe('+447700900123');
  });
});
