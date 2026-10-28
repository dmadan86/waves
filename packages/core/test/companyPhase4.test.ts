import { describe, expect, it } from 'vitest';
import {
  buildReimbursementPreview,
  buildWageRun,
  companyCapabilities,
  companyEntryFromRow,
  outstandingAdvance,
  poolBalance,
  projectSpend,
  validPoolReason,
  wageLine,
  wageRunTotals,
  companyStatement,
  dashboardStats,
  type CompanyEntry,
  type CompanyEntryRow,
} from '../src';

let n = 0;
const e = (
  row: Partial<CompanyEntryRow> & { entry_kind: string; amount: string | number },
): CompanyEntry =>
  companyEntryFromRow({
    id: `e${++n}`,
    group_id: 'g',
    member_id: 'emp',
    currency: 'INR',
    occurred_on: '2026-11-01',
    status: 'approved',
    created_at: `2026-11-01T00:00:${String(n).padStart(2, '0')}Z`,
    ...row,
  });

describe('wageLine', () => {
  it('gross = days x rate + claims, recovery capped so net >= 0, remainder carried', () => {
    const l = wageLine({
      calcMode: 'days_rate',
      days: '6',
      rateMinor: 10000n,
      claimsMinor: 5000n,
      outstandingAdvanceMinor: 100000n,
    })!;
    expect(l.gross).toBe(65000n);
    expect(l.recovery).toBe(65000n);
    expect(l.net).toBe(0n);
    expect(l.carry).toBe(35000n);
  });
  it('partial recovery leaves a net', () => {
    const l = wageLine({
      calcMode: 'fixed_weekly',
      fixedMinor: 60000n,
      claimsMinor: 0n,
      outstandingAdvanceMinor: 25000n,
    })!;
    expect([l.gross, l.recovery, l.net, l.carry]).toEqual([60000n, 25000n, 35000n, 0n]);
  });
  it('rounds half up once and rejects bad days', () => {
    expect(
      wageLine({
        calcMode: 'days_rate',
        days: '0.5',
        rateMinor: 101n,
        claimsMinor: 0n,
        outstandingAdvanceMinor: 0n,
      })!.base,
    ).toBe(51n);
    expect(
      wageLine({
        calcMode: 'days_rate',
        days: 'x',
        rateMinor: 1n,
        claimsMinor: 0n,
        outstandingAdvanceMinor: 0n,
      }),
    ).toBeNull();
  });
});

describe('advance recovery carries across runs', () => {
  it('600 base against a 1000 advance: recover 600, then 400', () => {
    const adv = e({ entry_kind: 'advance', amount: 1000 });
    const terms = new Map([['emp', { calcMode: 'fixed_weekly' as const, fixedMinor: 600n }]]);
    const r1 = buildWageRun([adv], terms, '2026-11-07')[0]!;
    expect([r1.recovery, r1.net, r1.carry]).toEqual([600n, 0n, 400n]);
    const pay1 = e({
      entry_kind: 'wage_payment',
      amount: 0,
      gross_minor: 600,
      claims_minor: 0,
      recovery_minor: 600,
      occurred_on: '2026-11-07',
    });
    expect(outstandingAdvance([adv, pay1], 'emp', '2026-11-14')).toBe(400n);
    const r2 = buildWageRun([adv, pay1], terms, '2026-11-14')[0]!;
    expect([r2.recovery, r2.net, r2.carry]).toEqual([400n, 200n, 0n]);
    expect(wageRunTotals([r1, r2])).toEqual({ gross: 1200n, recovery: 1000n, net: 200n });
  });
  it('folds approved bata into gross and lists it', () => {
    const bata = e({ entry_kind: 'allowance', amount: 300 });
    const r = buildWageRun(
      [bata],
      new Map([['emp', { calcMode: 'fixed_weekly' as const, fixedMinor: 700n }]]),
      '2026-11-07',
    )[0]!;
    expect([r.gross, r.net, r.claimIds.length]).toEqual([1000n, 1000n, 1]);
  });
});

describe('pool', () => {
  const entries = [
    e({ member_id: 'mgr', entry_kind: 'allocation', amount: 100000 }),
    e({ entry_kind: 'advance', amount: 20000, funding_manager_id: 'mgr' }),
    e({
      entry_kind: 'wage_payment',
      amount: 30000,
      gross_minor: 40000,
      recovery_minor: 10000,
      funding_manager_id: 'mgr',
    }),
    e({ member_id: 'mgr', entry_kind: 'expense', amount: 5000 }),
    e({ member_id: 'mgr', entry_kind: 'expense', amount: 7000, status: 'submitted' }),
    e({ member_id: 'mgr', entry_kind: 'pool_return', amount: 10000 }),
    e({ member_id: 'mgr', entry_kind: 'pool_adjustment', amount: -1000 }),
    e({
      entry_kind: 'reimbursement',
      amount: 2000,
      direction: 'employee_to_company',
      funding_manager_id: 'mgr',
    }),
  ];
  it('allocated - given out - own spend, carrying over, with returns and adjustments', () => {
    const p = poolBalance(entries, 'mgr');
    expect(p.balance).toBe(100000n - 1000n - 10000n - 20000n - 30000n - 5000n + 2000n);
  });
  it('another manager has an empty pool', () =>
    expect(poolBalance(entries, 'other').balance).toBe(0n));
  it('reasons', () => {
    expect(validPoolReason('  ')).toBe(false);
    expect(validPoolReason('cash back')).toBe(true);
    expect(validPoolReason('x'.repeat(501))).toBe(false);
  });
});

it('wage payment moves the balance by -claims + recovery and shows gross/deductions/net', () => {
  const adv = e({ entry_kind: 'advance', amount: 1000 });
  const bata = e({ entry_kind: 'allowance', amount: 300, reimbursement_id: 'p' });
  const pay = e({
    id: 'p',
    entry_kind: 'wage_payment',
    amount: 600,
    gross_minor: 1000,
    claims_minor: 300,
    recovery_minor: 400,
  });
  const s = companyStatement([adv, bata, pay], {
    memberId: 'emp',
    from: '2026-11-01',
    to: '2026-11-30',
  });
  // owed: +300 bata -1000 advance, then paying the claim -300 and taking 400 back
  expect(s.closing).toBe(300n - 1000n - 300n + 400n);
  expect([s.totals.wageGross, s.totals.wageRecovery, s.totals.wageNet]).toEqual([
    1000n,
    400n,
    600n,
  ]);
});

it('capabilities hide what a role cannot do', () => {
  expect(companyCapabilities('employee').payWages).toBe(false);
  expect(companyCapabilities('manager').promote).toBe(false);
  expect(companyCapabilities('owner').allocate).toBe(true);
});

it('project spend counts expense, bata and wage base but not advances or claims twice', () => {
  const m = projectSpend([
    e({ entry_kind: 'expense', amount: 100, project_id: 'p1' }),
    e({ entry_kind: 'advance', amount: 999, project_id: 'p1' }),
    e({
      entry_kind: 'wage_payment',
      amount: 500,
      gross_minor: 800,
      claims_minor: 300,
      project_id: 'p1',
    }),
  ]);
  expect(m.get('p1')).toBe(100n + 500n);
});

it('bulk reimbursement does not credit an advance already recovered through wages', () => {
  const adv = e({ entry_kind: 'advance', amount: 1000 });
  const claim = e({ entry_kind: 'expense', amount: 500 });
  const pay = e({
    entry_kind: 'wage_payment',
    amount: 0,
    gross_minor: 600,
    claims_minor: 0,
    recovery_minor: 600,
    period_end: '2026-11-07',
  });
  const p = buildReimbursementPreview([adv, claim, pay], {
    memberId: 'emp',
    ids: [claim.id],
    through: '2026-11-30',
  });
  expect(p.creditsMinor).toBe(1000n - 600n);
  expect(p.payoutMinor).toBe(100n);
});

it('dashboard stats: owed, paid this month vs last, advances outstanding', () => {
  const entries = [
    e({ entry_kind: 'expense', amount: 500 }),
    e({ entry_kind: 'advance', amount: 200 }),
    e({
      entry_kind: 'wage_payment',
      amount: 300,
      gross_minor: 300,
      claims_minor: 0,
      recovery_minor: 0,
      occurred_on: '2026-11-03',
    }),
    e({
      entry_kind: 'reimbursement',
      amount: 100,
      direction: 'company_to_employee',
      occurred_on: '2026-10-20',
    }),
  ];
  const s = dashboardStats(entries, ['emp'], '2026-11-10');
  expect(s.paidThisMonth).toBe(300n);
  expect(s.paidLastMonth).toBe(100n);
  expect(s.paidChangePct).toBe(200);
  expect(s.owes).toBe(500n - 200n - 100n);
  expect([s.advancesOutstanding, s.advanceHolders, s.pendingPayments]).toEqual([200n, 1, 1]);
});
