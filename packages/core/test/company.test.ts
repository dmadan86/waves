import { describe, expect, it } from 'vitest';

import {
  MutationKind,
  SyncTable,
  allowanceAmount,
  companyEntryFromRow,
  companyStatement,
  companySummary,
  emptyMirror,
  formatCompanyStatement,
  materialiseCompanyEntries,
  materialiseCompanyEntryAttachments,
  reconcile,
  type CompanyEntry,
  type CompanyEntryRow,
  type QueuedMutation,
} from '../src';

const G = 'g1';
let n = 0;
function entry(
  over: Partial<CompanyEntryRow> & { entry_kind: string; amount: string },
): CompanyEntry {
  n += 1;
  return companyEntryFromRow({
    id: `e${n}`,
    group_id: G,
    member_id: 'ravi',
    currency: 'INR',
    occurred_on: '2026-10-05',
    created_at: `2026-10-05T10:00:0${n % 10}Z`,
    ...over,
  });
}

describe('allowanceAmount', () => {
  it('multiplies days by the rate, rounding half up once', () => {
    expect(allowanceAmount('2.5', 40000n)).toBe(100000n);
    expect(allowanceAmount('3', 25050n)).toBe(75150n);
    expect(allowanceAmount('0.25', 10001n)).toBe(2500n); // 2500.25 -> 2500
    expect(allowanceAmount('0.5', 10001n)).toBe(5001n); // 5000.5 -> 5001
  });
  it('refuses bad day counts', () => {
    expect(allowanceAmount('0', 100n)).toBeNull();
    expect(allowanceAmount('1.234', 100n)).toBeNull();
    expect(allowanceAmount('abc', 100n)).toBeNull();
    expect(allowanceAmount('-1', 100n)).toBeNull();
  });
});

describe('companyStatement', () => {
  const entries = [
    entry({ entry_kind: 'advance', amount: '500000', occurred_on: '2026-09-28' }),
    entry({ entry_kind: 'expense', amount: '120000', category: 'fuel', occurred_on: '2026-10-02' }),
    entry({ entry_kind: 'expense', amount: '30000', category: 'food', occurred_on: '2026-10-03' }),
    entry({
      entry_kind: 'allowance',
      amount: '100000',
      calc_mode: 'days_rate',
      days: '2.5',
      rate_minor: '40000',
      occurred_on: '2026-10-04',
    }),
    entry({ entry_kind: 'wages', amount: '700000', occurred_on: '2026-10-05' }),
    entry({ entry_kind: 'reimbursement', amount: '50000', occurred_on: '2026-10-06' }),
    entry({
      entry_kind: 'expense',
      amount: '99900',
      category: 'fuel',
      status: 'submitted',
      occurred_on: '2026-10-07',
    }),
    entry({
      entry_kind: 'expense',
      amount: '77700',
      deleted_at: '2026-10-08T00:00:00Z',
      occurred_on: '2026-10-07',
    }),
    entry({
      entry_kind: 'expense',
      amount: '1',
      member_id: 'someone-else',
      occurred_on: '2026-10-02',
    }),
  ];

  it('nets expenses and bata against advances and payouts; wages do not move it', () => {
    const s = companyStatement(entries, { memberId: 'ravi', from: '2026-10-01', to: '2026-10-31' });
    expect(s.opening).toBe(-500000n); // advance given before the range
    expect(s.totals.expenses).toBe(150000n);
    expect(s.totals.allowance).toBe(100000n);
    expect(s.totals.allowanceDays).toBe(250n);
    expect(s.totals.wages).toBe(700000n);
    expect(s.totals.paidOut).toBe(50000n);
    expect(s.totals.byCategory).toEqual({ fuel: 120000n, food: 30000n });
    // -500000 + 120000 + 30000 + 100000 - 50000
    expect(s.closing).toBe(-300000n);
    expect(s.side).toBe('employee_owes');
    expect(s.rows.map((r) => r.running)).toEqual([
      -380000n,
      -350000n,
      -250000n,
      -250000n,
      -300000n,
    ]);
  });

  it('lists submitted claims apart and ignores voided and other people', () => {
    const s = companyStatement(entries, { memberId: 'ravi', from: '2026-10-01', to: '2026-10-31' });
    expect(s.pending.map((e) => e.amount)).toEqual([99900n]);
    expect(s.rows).toHaveLength(5);
  });

  it('counts cash returned by the employee as company-side credit', () => {
    const s = companyStatement(
      [
        entry({ entry_kind: 'advance', amount: '10000' }),
        entry({ entry_kind: 'reimbursement', amount: '10000', direction: 'employee_to_company' }),
      ],
      { memberId: 'ravi', from: '2026-10-01', to: '2026-10-31' },
    );
    expect(s.closing).toBe(0n);
    expect(s.side).toBe('settled');
    expect(s.totals.returned).toBe(10000n);
  });

  it('shares as text', () => {
    const s = companyStatement(entries, { memberId: 'ravi', from: '2026-10-01', to: '2026-10-31' });
    const text = formatCompanyStatement(s, {
      company: 'Acme',
      employee: 'Ravi',
      money: (m) => m.toString(),
    });
    expect(text).toContain('Acme - statement for Ravi');
    expect(text).toContain('Ravi owes the company: 300000');
    expect(text).not.toContain('99900');
  });
});

describe('companySummary', () => {
  it('reports gross amounts each way and per-employee statements', () => {
    const rows = [
      entry({ entry_kind: 'expense', amount: '1000', member_id: 'a' }),
      entry({ entry_kind: 'advance', amount: '4000', member_id: 'b' }),
    ];
    const s = companySummary(rows, { from: '2026-10-01', to: '2026-10-31' });
    expect(s.rows.map((r) => r.memberId).sort()).toEqual(['a', 'b']);
    expect(s.companyOwes).toBe(1000n);
    expect(s.employeesOwe).toBe(4000n);
    expect(s.totals.advances).toBe(4000n);
  });
});

describe('materialiseCompanyEntries', () => {
  const create = (
    seq: number,
    payload: Record<string, unknown>,
    kind = MutationKind.CompanyEntryCreate,
  ): QueuedMutation =>
    ({
      seq,
      clientMutationId: `m${seq}`,
      kind,
      groupId: G,
      payload,
      clientCreatedAt: '2026-10-10T08:00:00Z',
    }) as unknown as QueuedMutation;

  it('shows a queued bata at once with the server rule, then lets a pulled row win', () => {
    const queue = [
      create(1, {
        entryId: 'x1',
        memberId: 'ravi',
        entryKind: 'allowance',
        data: { days: '2.5', rateMinor: '40000', occurredOn: '2026-10-09' },
      }),
    ];
    const rows = materialiseCompanyEntries(emptyMirror(), queue, { groupId: G, currency: 'INR' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ amount: '100000', calc_mode: 'days_rate', pending: true });

    const { state } = reconcile(emptyMirror(), [
      {
        table: SyncTable.CompanyEntries,
        groupId: G,
        seq: 5,
        row: {
          id: 'x1',
          group_id: G,
          member_id: 'ravi',
          entry_kind: 'allowance',
          amount: '100000',
          currency: 'INR',
          occurred_on: '2026-10-09',
          status: 'approved',
          calc_mode: 'days_rate',
        },
      },
    ]);
    const after = materialiseCompanyEntries(state, queue, { groupId: G, currency: 'INR' });
    expect(after).toHaveLength(1);
    expect(after[0]?.pending).toBeUndefined();
  });

  it('ignores refused mutations', () => {
    const refused = {
      ...create(1, {
        entryId: 'r1',
        memberId: 'ravi',
        entryKind: 'expense',
        data: { amount: '5' },
      }),
      rejection: { code: 'VALIDATION_FAILED', message: 'no' },
    } as unknown as QueuedMutation;
    expect(
      materialiseCompanyEntries(emptyMirror(), [refused], { groupId: G, currency: 'INR' }),
    ).toHaveLength(0);
  });

  it('applies queued edits and voids', () => {
    const { state } = reconcile(emptyMirror(), [
      {
        table: SyncTable.CompanyEntries,
        groupId: G,
        seq: 1,
        row: {
          id: 'x2',
          group_id: G,
          member_id: 'ravi',
          entry_kind: 'expense',
          amount: '500',
          currency: 'INR',
          occurred_on: '2026-10-09',
          status: 'approved',
        },
      },
    ]);
    const edited = materialiseCompanyEntries(
      state,
      [create(1, { entryId: 'x2', patch: { amount: '900' } }, MutationKind.CompanyEntryUpdate)],
      { groupId: G, currency: 'INR' },
    );
    expect(edited[0]?.amount).toBe('900');
    const voided = materialiseCompanyEntries(
      state,
      [create(1, { entryId: 'x2' }, MutationKind.CompanyEntryVoid)],
      { groupId: G, currency: 'INR' },
    );
    expect(voided[0]?.deleted_at).toBeTruthy();
    expect(companyEntryFromRow(voided[0] as never).deleted).toBe(true);
  });
});

describe('approvals', () => {
  const range = { memberId: 'ravi', from: '2026-10-01', to: '2026-10-31' };
  const mk = (status: string, kind: string, amount: string) =>
    entry({ entry_kind: kind, amount, status, category: kind === 'expense' ? 'fuel' : undefined });

  it('counts only approved entries toward net due and lists the rest apart', () => {
    const all = [
      mk('approved', 'expense', '100000'),
      mk('submitted', 'expense', '40000'),
      mk('rejected', 'expense', '70000'),
      mk('approved', 'advance', '30000'),
      mk('submitted', 'advance', '999900'),
    ];
    const s = companyStatement(all, range);
    expect(s.closing).toBe(70000n);
    expect(s.pending.map((e) => e.status).sort()).toEqual(['rejected', 'submitted', 'submitted']);
  });

  it('approving a submitted entry moves it into the balance; a rejection never does', () => {
    const submitted = mk('submitted', 'expense', '25000');
    expect(companyStatement([submitted], range).closing).toBe(0n);
    const approved = { ...submitted, status: 'approved' as const };
    expect(companyStatement([approved], range).closing).toBe(25000n);
    const rejected = { ...submitted, status: 'rejected' as const, reviewNote: 'no bill' };
    expect(companyStatement([rejected], range).closing).toBe(0n);
    expect(companyStatement([rejected], range).pending[0]?.reviewNote).toBe('no bill');
  });

  it('the summary ignores unapproved entries too', () => {
    const sum = companySummary(
      [mk('submitted', 'expense', '50000'), mk('approved', 'expense', '10000')],
      {
        from: range.from,
        to: range.to,
      },
    );
    expect(sum.companyOwes).toBe(10000n);
  });

  const queued = (seq: number, kind: string, payload: Record<string, unknown>): QueuedMutation =>
    ({
      seq,
      clientMutationId: `a${seq}`,
      kind,
      groupId: G,
      payload,
      clientCreatedAt: '2026-10-10T08:00:00Z',
    }) as unknown as QueuedMutation;

  it('a queued entry reads as submitted when the company needs approval, approved otherwise', () => {
    const queue = [
      queued(1, MutationKind.CompanyEntryCreate, {
        entryId: 'q1',
        memberId: 'ravi',
        entryKind: 'expense',
        data: { amount: '5000', category: 'fuel' },
      }),
    ];
    const on = materialiseCompanyEntries(emptyMirror(), queue, {
      groupId: G,
      currency: 'INR',
      approvalsEnabled: true,
    });
    const off = materialiseCompanyEntries(emptyMirror(), queue, { groupId: G, currency: 'INR' });
    expect(on[0]?.status).toBe('submitted');
    expect(off[0]?.status).toBe('approved');
  });

  it('shows a queued rejection with its note', () => {
    const { state } = reconcile(emptyMirror(), [
      {
        table: SyncTable.CompanyEntries,
        groupId: G,
        seq: 1,
        row: {
          id: 's1',
          group_id: G,
          member_id: 'ravi',
          entry_kind: 'expense',
          amount: '100',
          currency: 'INR',
          occurred_on: '2026-10-09',
          status: 'submitted',
        },
      },
    ]);
    const rows = materialiseCompanyEntries(
      state,
      [
        queued(2, MutationKind.CompanyEntryTransition, {
          entryId: 's1',
          to: 'rejected',
          note: 'dup',
        }),
      ],
      { groupId: G, currency: 'INR' },
    );
    expect(rows[0]).toMatchObject({ status: 'rejected', review_note: 'dup' });
  });
});

describe('company entry attachments', () => {
  it('lists the live photos of one entry, oldest first, and no tombstones', () => {
    const row = (id: string, entry_id: string, created_at: string, deleted_at: string | null) => ({
      table: SyncTable.CompanyEntryAttachments,
      groupId: G,
      seq: 1,
      row: {
        id,
        entry_id,
        group_id: G,
        storage_path: `${entry_id}/${id}/k.jpg`,
        uploader_member_id: 'ravi',
        created_at,
        deleted_at,
      },
    });
    const { state } = reconcile(emptyMirror(), [
      row('b', 'e1', '2026-10-02T00:00:00Z', null),
      row('a', 'e1', '2026-10-01T00:00:00Z', null),
      row('c', 'e1', '2026-10-03T00:00:00Z', '2026-10-04T00:00:00Z'),
      row('d', 'e2', '2026-10-01T00:00:00Z', null),
    ]);
    expect(materialiseCompanyEntryAttachments(state, { entryId: 'e1' }).map((r) => r.id)).toEqual([
      'a',
      'b',
    ]);
  });
});
