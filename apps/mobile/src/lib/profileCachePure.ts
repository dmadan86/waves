import type { Profile } from '@/lib/auth';

/** The non-sensitive profile fields kept on device for an offline first screen. */
export type CachedProfile = Pick<
  Profile,
  'id' | 'display_name' | 'default_currency' | 'locale' | 'country_code'
>;

export function toProfileCache(p: Profile): CachedProfile {
  const { id, display_name, default_currency, locale, country_code } = p;
  return { id, display_name, default_currency, locale, country_code };
}

/** A whole Profile from the cache: address, UPI and payment details are never stored. */
export function profileFromCache(c: CachedProfile): Profile {
  return {
    ...c,
    avatar_url: null,
    default_vpa: null,
    payment_rail: null,
    payment_handle: null,
    address: null,
  };
}
