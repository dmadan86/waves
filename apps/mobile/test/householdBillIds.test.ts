import { describe, expect, it } from 'vitest';

import { hexToUuid, occurrenceSeed } from '@/lib/householdBills';

describe('bill occurrence ids', () => {
  it('regroups md5 hex like the server md5(...)::uuid', () => {
    expect(hexToUuid('0123456789abcdef0123456789abcdef')).toBe(
      '01234567-89ab-cdef-0123-456789abcdef',
    );
  });
  it('seeds exactly what waves_recurring_derived_id hashes', () => {
    expect(occurrenceSeed('expense', 'r1', '2026-12-01')).toBe(
      'waves.recurring.expense:r1:2026-12-01',
    );
  });
});
