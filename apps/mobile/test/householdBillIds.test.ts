import { describe, expect, it, vi } from 'vitest';

import { createReplanner, hexToUuid, occurrenceSeed } from '@/lib/householdBills';

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

describe('createReplanner', () => {
  it('debounces a burst and never overlaps runs', async () => {
    vi.useFakeTimers();
    let active = 0;
    let peak = 0;
    let calls = 0;
    const request = createReplanner(async () => {
      calls += 1;
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 500));
      active -= 1;
    }, 100);
    request();
    request();
    request();
    await vi.advanceTimersByTimeAsync(100);
    expect(calls).toBe(1);
    request(); // lands while the first run is going
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toBe(2);
    expect(peak).toBe(1);
    vi.useRealTimers();
  });
});
