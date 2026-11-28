import { describe, expect, it } from 'vitest';

import { profileCompletion } from '@/lib/profileCompletion';

const full = {
  display_name: 'Madan',
  avatar_url: 'a/b.jpg',
  country_code: 'IN',
  payment_handle: 'm@upi',
};

describe('profileCompletion', () => {
  it('is 100 with everything set', () => {
    expect(profileCompletion(full, { email_confirmed_at: 'x' })).toEqual({
      percent: 100,
      missing: [],
    });
  });
  it('is 0 for no profile', () => {
    expect(profileCompletion(null).percent).toBe(0);
    expect(profileCompletion(null).missing).toHaveLength(5);
  });
  it('treats the Guest placeholder and blanks as missing', () => {
    const r = profileCompletion(
      { ...full, display_name: 'Guest', avatar_url: '  ' },
      { phone_confirmed_at: 'x' },
    );
    expect(r).toEqual({ percent: 60, missing: ['name', 'photo'] });
  });
  it('accepts the legacy default_vpa as a payment handle', () => {
    const r = profileCompletion(
      { ...full, payment_handle: null, default_vpa: 'a@b' },
      { email_confirmed_at: 'x' },
    );
    expect(r.percent).toBe(100);
  });
  it('needs a verified contact', () => {
    expect(profileCompletion(full, {}).missing).toEqual(['contact']);
  });
});
