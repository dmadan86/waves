/**
 * The currency a new expense starts on: the account's own when signed in, the
 * account country's when the stored currency is blank, and the phone's region
 * before there is a profile at all.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useDefaultCurrency } from '../src/lib/currency';

const state = vi.hoisted(() => ({ profile: null as unknown }));

vi.mock('@/lib/auth', () => ({ useAuth: () => ({ profile: state.profile }) }));
vi.mock('@/i18n', () => ({ deviceDefaultCurrency: () => 'GBP' }));

beforeEach(() => {
  state.profile = null;
});

describe('useDefaultCurrency', () => {
  it('uses the phone region before there is a profile', () => {
    expect(useDefaultCurrency()).toBe('GBP');
  });

  it('uses the account currency when signed in', () => {
    state.profile = { default_currency: 'AED', country_code: 'AE' };
    expect(useDefaultCurrency()).toBe('AED');
  });

  it('derives it from the account country when the stored currency is blank', () => {
    state.profile = { default_currency: '', country_code: 'IN' };
    expect(useDefaultCurrency()).toBe('INR');
  });

  it('falls back to the phone region when neither names a currency', () => {
    state.profile = { default_currency: '', country_code: null };
    expect(useDefaultCurrency()).toBe('GBP');
  });
});
