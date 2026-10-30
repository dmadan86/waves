import { describe, expect, it } from 'vitest';
import {
  companyEntryFromRow,
  entryDelta,
  poolBalance,
  projectSpend,
  dashboardStats,
  companySummary,
  companyGstTotal,
} from '../src';

const paid = companyEntryFromRow({
  id: 'paid',
  group_id: 'g',
  member_id: null,
  paid_by_company: true,
  entry_kind: 'expense',
  category: 'materials',
  amount: '11800',
  currency: 'INR',
  occurred_on: '2026-10-05',
  status: 'approved',
  project_id: 'site',
  funding_manager_id: 'manager',
  gst_amount_minor: '1800',
});
const range = { from: '2026-10-01', to: '2026-10-31' };

describe('company paid directly', () => {
  it('has no employee debt and consumes the funding manager pool once', () => {
    expect(paid.memberId).toBe('');
    expect(paid.paidByCompany).toBe(true);
    expect(entryDelta(paid)).toBe(0n);
    const pool = poolBalance([paid], 'manager');
    expect(pool.companySpend).toBe(11800n);
    expect(pool.balance).toBe(-11800n);
    expect(pool.ownSpend).toBe(0n);
    expect(poolBalance([paid], 'other').companySpend).toBe(0n);
  });
  it('counts site spend, dashboard company spend and GST without creating an employee statement', () => {
    expect(projectSpend([paid], new Map()).get('site')).toBe(11800n);
    const stats = dashboardStats([paid], ['manager'], '2026-10-30');
    expect(stats.companySpentThisMonth).toBe(11800n);
    expect(stats.owes).toBe(0n);
    expect(stats.pendingPayments).toBe(0);
    const summary = companySummary([paid], range);
    expect(summary.rows).toEqual([]);
    expect(summary.companyOwes).toBe(0n);
    expect(summary.employeesOwe).toBe(0n);
    expect(companyGstTotal([paid], range)).toBe(1800n);
  });
  it('ignores deleted and out of period company spend', () => {
    const deleted = { ...paid, deleted: true };
    expect(poolBalance([deleted], 'manager').companySpend).toBe(0n);
    expect(projectSpend([deleted], new Map()).get('site') ?? 0n).toBe(0n);
    expect(dashboardStats([deleted], [], '2026-10-30').companySpentThisMonth).toBe(0n);
    expect(dashboardStats([paid], [], '2026-11-01').companySpentThisMonth).toBe(0n);
    expect(companyGstTotal([deleted], range)).toBe(0n);
  });
});
