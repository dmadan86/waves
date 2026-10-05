/**
 * The Event "Vendors" tab (docs/event-organizer.md): advances grouped by
 * vendor, balances, overdue / due-soon / paid-off, totals and filters.
 */

import { describe, expect, it } from 'vitest';

import type { ExpenseVersionRow } from '@/data/types';
import { editStateFromVersion, expenseWritePayload, withBalanceCleared } from '@/lib/expenseEdit';
import {
  groupVendors,
  showSubEventLine,
  vendorDisplayName,
  vendorKey,
  vendorSubEventIds,
  vendorSummary,
  VendorStatus,
  type VendorCandidate,
} from '@/lib/eventVendors';

const TODAY = '2027-02-10';

const adv = (overrides: Partial<VendorCandidate> = {}): VendorCandidate => ({
  expenseId: 'e1',
  description: 'DJ Rohan',
  currency: 'inr',
  amountMinor: 500000n,
  isDeposit: true,
  balanceDueMinor: 1500000n,
  balanceDueDate: '2027-03-01',
  subEventId: 'sangeet',
  payerMemberId: 'm-a',
  expenseDate: '2027-01-05',
  ...overrides,
});

describe('vendorKey', () => {
  it('folds case and whitespace', () => {
    expect(vendorKey('  DJ   Rohan ')).toBe(vendorKey('dj rohan'));
  });
});

describe('groupVendors', () => {
  it('only counts deposits and merges same vendor across case/spacing', () => {
    const groups = groupVendors(
      [
        adv({ expenseId: 'a', description: 'DJ Rohan' }),
        adv({ expenseId: 'b', description: ' dj  rohan ', amountMinor: 100000n }),
        adv({ expenseId: 'c', description: 'DJ Rohan', isDeposit: false }),
        adv({ expenseId: 'd', description: 'Caterer' }),
      ],
      TODAY,
    );
    expect(groups).toHaveLength(2);
    const dj = groups.find((g) => g.key === 'dj rohan')!;
    expect(dj.entries.map((e) => e.expenseId).sort()).toEqual(['a', 'b']);
    expect(dj.totals).toEqual([
      { currency: 'INR', advancesMinor: 600000n, balanceMinor: 3000000n },
    ]);
  });

  it('keeps a deposit saved with a blank description instead of dropping it', () => {
    const groups = groupVendors(
      [
        adv({ expenseId: 'blank', description: '   ', amountMinor: 1000000n }),
        adv({ expenseId: 'blank2', description: '' }),
      ],
      TODAY,
    );
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.name === '')).toBe(true);
    expect(vendorSummary([adv({ description: '' })], TODAY).totals).toHaveLength(1);
  });

  it('names a blank deposit by its sub-event, then category, then nothing, and groups by that name', () => {
    const groups = groupVendors(
      [
        adv({ expenseId: '1', description: '', fallbackName: '📍 Venue & decor' }),
        adv({ expenseId: '2', description: ' ', fallbackName: '📍 Venue  & decor' }),
        adv({ expenseId: '3', description: '', fallbackName: 'Food' }),
        adv({ expenseId: '4', description: 'Royal Caterers', fallbackName: '📍 Venue & decor' }),
        adv({ expenseId: '5', description: '', fallbackName: null }),
      ],
      TODAY,
    );
    const byName = Object.fromEntries(groups.map((g) => [g.name, g.entries.length]));
    expect(byName).toEqual({
      '📍 Venue & decor': 2,
      Food: 1,
      'Royal Caterers': 1,
      '': 1,
    });
  });

  it('does not repeat the sub-event line when the title already is the sub-event', () => {
    expect(showSubEventLine('🎈 Venue & decor', '🎈 Venue & decor')).toBe(false);
    expect(showSubEventLine(' 🎈 venue  & decor', '🎈 Venue & decor')).toBe(false);
    expect(showSubEventLine('Royal Caterers', '🎈 Venue & decor')).toBe(true);
    expect(showSubEventLine('Royal Caterers', '')).toBe(false);
  });

  it('vendorDisplayName prefers the typed name', () => {
    expect(vendorDisplayName('  DJ  Rohan ', 'Sangeet')).toBe('DJ Rohan');
    expect(vendorDisplayName('', 'Sangeet')).toBe('Sangeet');
    expect(vendorDisplayName('', null)).toBe('');
  });

  it('flags overdue, due soon and paid off', () => {
    const [overdue, soon, later, paid] = [
      adv({ expenseId: 'o', balanceDueDate: '2027-02-09' }),
      adv({ expenseId: 's', balanceDueDate: '2027-02-17' }),
      adv({ expenseId: 'l', balanceDueDate: '2027-02-18' }),
      adv({ expenseId: 'p', balanceDueMinor: 0n, balanceDueDate: null }),
    ];
    const entries = groupVendors(
      [overdue!, soon!, later!, paid!].map((c, i) => ({ ...c, description: `V${i}` })),
      TODAY,
    ).flatMap((g) => g.entries);
    const byId = Object.fromEntries(entries.map((e) => [e.expenseId, e]));
    expect(byId.o!.status).toBe(VendorStatus.Overdue);
    expect(byId.s!.status).toBe(VendorStatus.Due);
    expect(byId.s!.dueSoon).toBe(true);
    expect(byId.l!.dueSoon).toBe(false);
    expect(byId.p!.status).toBe(VendorStatus.PaidOff);
    expect(byId.p!.balanceMinor).toBe(0n);
  });

  it('treats a deposit with a null balance as paid off and a date-less balance as never overdue', () => {
    const groups = groupVendors(
      [
        adv({ expenseId: 'n', description: 'A', balanceDueMinor: null }),
        adv({ expenseId: 'u', description: 'B', balanceDueDate: null }),
      ],
      TODAY,
    );
    expect(groups.find((g) => g.name === 'A')!.status).toBe(VendorStatus.PaidOff);
    expect(groups.find((g) => g.name === 'B')!.status).toBe(VendorStatus.Due);
  });

  it('orders overdue vendors first, then owing, then paid off', () => {
    const names = groupVendors(
      [
        adv({ expenseId: '1', description: 'Zed', balanceDueMinor: 0n }),
        adv({ expenseId: '2', description: 'Mid' }),
        adv({ expenseId: '3', description: 'Late', balanceDueDate: '2027-01-01' }),
      ],
      TODAY,
    ).map((g) => g.name);
    expect(names).toEqual(['Late', 'Mid', 'Zed']);
  });

  it('filters by status and sub-event', () => {
    const rows = [
      adv({ expenseId: '1', description: 'A', balanceDueDate: '2027-01-01' }),
      adv({ expenseId: '2', description: 'B' }),
      adv({ expenseId: '3', description: 'C', balanceDueMinor: 0n, subEventId: 'haldi' }),
    ];
    const ids = (f: 'all' | 'due' | 'overdue' | 'paidOff', se: string | null = null) =>
      groupVendors(rows, TODAY, f, se).flatMap((g) => g.entries.map((e) => e.expenseId));
    expect(ids('all')).toHaveLength(3);
    expect(ids('due').sort()).toEqual(['1', '2']);
    expect(ids('overdue')).toEqual(['1']);
    expect(ids('paidOff')).toEqual(['3']);
    expect(ids('all', 'haldi')).toEqual(['3']);
    expect(ids('overdue', 'haldi')).toEqual([]);
  });

  it('keeps currencies apart in totals', () => {
    const [g] = groupVendors(
      [adv({ expenseId: '1' }), adv({ expenseId: '2', currency: 'usd', amountMinor: 100n })],
      TODAY,
    );
    expect(g!.totals.map((t) => t.currency)).toEqual(['INR', 'USD']);
  });
});

describe('vendorSummary', () => {
  it('totals advances and balances and counts overdue across vendors', () => {
    const summary = vendorSummary(
      [
        adv({ expenseId: '1', description: 'A', balanceDueDate: '2027-01-01' }),
        adv({ expenseId: '2', description: 'B', balanceDueMinor: 0n }),
        adv({ expenseId: '3', description: 'C', isDeposit: false }),
      ],
      TODAY,
    );
    expect(summary.totals).toEqual([
      { currency: 'INR', advancesMinor: 1000000n, balanceMinor: 1500000n },
    ]);
    expect(summary).toMatchObject({ overdueCount: 1, dueCount: 0, paidOffCount: 1 });
  });
});

describe('vendorSubEventIds', () => {
  it('lists distinct sub-events of advances only', () => {
    expect(
      vendorSubEventIds([
        adv({ subEventId: 'sangeet' }),
        adv({ subEventId: 'sangeet' }),
        adv({ subEventId: 'haldi' }),
        adv({ subEventId: 'wedding', isDeposit: false }),
        adv({ subEventId: null }),
      ]),
    ).toEqual(['sangeet', 'haldi']);
  });
});

describe('withBalanceCleared (Pay balance)', () => {
  const version: ExpenseVersionRow = {
    id: 'v-1',
    version_no: 1,
    description: 'DJ Rohan',
    category: null,
    category_meta: null,
    expense_date: '2027-01-05',
    currency: 'INR',
    amount: '500000',
    split_type: 'equal',
    split_params: { kind: 'equal' },
    author_member_id: 'm-a',
    notes: null,
    payment_method: 'cash',
    receipt_share_url: null,
    location: null,
    fx: null,
    created_at: '2027-01-05T00:00:00Z',
    payers: [{ member_id: 'm-a', amount: '500000' }],
    shares: [
      { member_id: 'm-a', amount: '250000' },
      { member_id: 'm-b', amount: '250000' },
    ],
    sub_event_id: 'sangeet',
    is_deposit: true,
    balance_due_minor: '1500000',
    balance_due_date: '2027-03-01',
  } as ExpenseVersionRow;

  it('writes zero balance and no date while keeping the advance, sub-event and payers', () => {
    const state = withBalanceCleared(editStateFromVersion(version, 'm-a'));
    const payload = expenseWritePayload({ expenseId: 'e1', state, editing: version });
    expect(payload).toMatchObject({
      amount: '500000',
      isDeposit: true,
      balanceDueMinor: '0',
      balanceDueDate: null,
      subEventId: 'sangeet',
      baseVersionNo: 1,
    });
  });

  it('shows as paid off in the vendors view', () => {
    const state = withBalanceCleared(editStateFromVersion(version, 'm-a'));
    const [g] = groupVendors(
      [
        adv({
          description: state.description,
          amountMinor: state.amount,
          balanceDueMinor: state.balanceDueMinor,
          balanceDueDate: state.balanceDueDate,
        }),
      ],
      TODAY,
    );
    expect(g!.status).toBe(VendorStatus.PaidOff);
  });
});
