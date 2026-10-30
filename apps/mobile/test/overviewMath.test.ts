import { describe, expect, it } from 'vitest';

import {
  attendanceSegments,
  compactMoney,
  dayKind,
  dueText,
  pct,
  sortUpcoming,
  urgentItems,
} from '../src/lib/overviewMath';

describe('overview math', () => {
  it('rounds percentages and shows nothing for zero employees', () => {
    expect(pct(4, 6)).toBe(67);
    expect(pct(1, 6)).toBe(17);
    expect(pct(0, 0)).toBeNull();
    expect(pct(7, 6)).toBe(100);
  });
  it('groups the Indian way and shortens crores', () => {
    const cr = '{n} Cr';
    expect(compactMoney(1250000n, 'INR', 'en-IN', cr)).toBe('₹12,500');
    expect(compactMoney(12500000n, 'INR', 'en-IN', cr)).toBe('₹1,25,000');
    expect(compactMoney(1234n, 'INR', 'en-IN', cr)).toBe('₹12.34');
    expect(compactMoney(1250000000n, 'INR', 'en-IN', cr)).toBe('₹1.25 Cr');
    expect(compactMoney(1000000000n, 'INR', 'en-IN', cr)).toBe('₹1 Cr');
    expect(compactMoney(0n, 'INR', 'en-IN', cr)).toBe('₹0');
  });
  it('labels days', () => {
    expect(dayKind('2026-10-30', '2026-10-30')).toBe('today');
    expect(dayKind('2026-10-29', '2026-10-30')).toBe('yesterday');
    expect(dayKind('2026-09-30', '2026-10-01')).toBe('yesterday');
    expect(dayKind('2026-10-20', '2026-10-30')).toBe('other');
  });
  it('never invents a due date', () => {
    expect(dueText(null, '2026-10-30')).toEqual({ kind: 'owedNow' });
    expect(dueText('2026-10-29', '2026-10-30')).toEqual({ kind: 'overdue' });
    expect(dueText('2026-10-31', '2026-10-30')).toEqual({ kind: 'tomorrow' });
    expect(dueText('2026-11-04', '2026-10-30')).toEqual({ kind: 'in', n: 5 });
  });
  it('sorts owed-now by amount before dated bills', () => {
    const r = (key: string, amountMinor: bigint, date: string | null) => ({
      key,
      kind: 'salary' as const,
      memberId: null,
      title: key,
      amountMinor,
      date,
    });
    const out = sortUpcoming([r('bill', 9n, '2026-11-01'), r('a', 5n, null), r('b', 8n, null)], 3);
    expect(out.map((x) => x.key)).toEqual(['b', 'a', 'bill']);
  });
  it('lists only non-zero urgent reasons', () => {
    const none = { absent: 0, paymentsPending: 0, blockedTasks: 0, approvals: 0, vendorBills: 0 };
    expect(urgentItems(none)).toEqual([]);
    expect(urgentItems({ ...none, absent: 1, vendorBills: 2 })).toEqual([
      { key: 'absent', n: 1 },
      { key: 'vendorBills', n: 2 },
    ]);
  });
  it('builds attendance bar segments in order and drops zeros', () => {
    expect(attendanceSegments({ present: 4, absent: 1, unmarked: 1 })).toEqual([
      { key: 'present', n: 4 },
      { key: 'unmarked', n: 1 },
      { key: 'absent', n: 1 },
    ]);
    expect(attendanceSegments({ present: 0, absent: 0, unmarked: 3 })).toEqual([
      { key: 'unmarked', n: 3 },
    ]);
    expect(attendanceSegments({ present: 0, absent: 0, unmarked: 0 })).toEqual([]);
  });
});
