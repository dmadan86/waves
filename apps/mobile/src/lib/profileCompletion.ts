/** How complete the signed-in person's profile is, from fields the app already stores. */

export type ProfileItem = 'name' | 'photo' | 'contact' | 'country' | 'payment';

export interface ProfileCompletionInput {
  display_name?: string | null;
  avatar_url?: string | null;
  country_code?: string | null;
  payment_handle?: string | null;
  /** Pre-rail UPI field; still counts as a payment handle. */
  default_vpa?: string | null;
}

export interface ProfileCompletionAuth {
  email_confirmed_at?: string | null;
  phone_confirmed_at?: string | null;
}

const filled = (v?: string | null) => Boolean(v && v.trim());

/** Five equal items; 'Guest' is the placeholder the signup trigger writes, not a name. */
export function profileCompletion(
  profile: ProfileCompletionInput | null | undefined,
  user?: ProfileCompletionAuth | null,
): { percent: number; missing: ProfileItem[] } {
  const done: Record<ProfileItem, boolean> = {
    name: filled(profile?.display_name) && profile?.display_name?.trim() !== 'Guest',
    photo: filled(profile?.avatar_url),
    contact: Boolean(user?.email_confirmed_at || user?.phone_confirmed_at),
    country: filled(profile?.country_code),
    payment: filled(profile?.payment_handle) || filled(profile?.default_vpa),
  };
  const items = Object.keys(done) as ProfileItem[];
  const missing = items.filter((i) => !done[i]);
  return { percent: Math.round(((items.length - missing.length) / items.length) * 100), missing };
}
