import { describe, expect, it } from 'vitest';

import { withoutCoMemberEmail } from '../src/lib/personPrivacy';
import type { PersonProfileRow } from '../src/data/api';

const row = (is_you: boolean): PersonProfileRow => ({
  person_key: 'k',
  display_name: 'Pal',
  avatar_url: null,
  is_ghost: false,
  is_you,
  shared_groups: 1,
  email: 'pal@example.com',
  phone: '+911234567890',
  payment_rail: null,
  payment_handle: null,
  country_code: null,
  contact_withheld: false,
});

describe('person page email', () => {
  it('hides a co-member email but keeps their shared phone', () => {
    const shown = withoutCoMemberEmail(row(false));
    expect(shown.email).toBeNull();
    expect(shown.phone).toBe('+911234567890');
  });
  it('shows you your own email', () => {
    expect(withoutCoMemberEmail(row(true)).email).toBe('pal@example.com');
  });
});
