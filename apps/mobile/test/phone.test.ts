/**
 * A friend's local number is read in the caller's region — the account's
 * country first, the phone's second — and with no region at all it is refused
 * rather than guessed.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IdentityError } from '@waves/core';

import { isPhoneCountryError, normaliseContactPhone, regionDialCode } from '../src/lib/phone';

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
