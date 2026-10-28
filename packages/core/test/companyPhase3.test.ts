import { describe, expect, it } from 'vitest';

import {
  buildReimbursementPreview,
  companyEntryFromRow,
  companyGstTotal,
  companyStatement,
  emptyMirror,
  evaluateCompanyPolicies,
  findDuplicateEntry,
  gstFromInclusive,
  materialiseCompanyEntries,
  mileageAmount,
  normaliseDecimalInput,
  resolveMileageRate,
  validateGstin,
  type CompanyEntry,
  type CompanyEntryRow,
  type CompanyPolicies,
  type QueuedMutation,
} from '../src';

let n = 0;
function entry(
  over: Partial<CompanyEntryRow> & { entry_kind: string; amount: string },
): CompanyEntry {
  n += 1;
  return companyEntryFromRow({
    id: `e${n}`,
    group_id: 'g1',
    member_id: 'ravi',
    currency: 'INR',
    occurred_on: '2026-10-05',
    created_at: `2026-10-05T10:00:0${n % 10}Z`,
    status: 'approved',
    ...over,
  });
}

describe('validateGstin', () => {
  it('accepts a real-format GSTIN with the right check character', () => {
    expect(validateGstin('27AAPFU0939F1ZV')).toBe(true);
    expect(validateGstin(' 27aapfu0939f1zv ')).toBe(true);
  });
  it('rejects a wrong checksum, shape, length and state', () => {
    expect(validateGstin('27AAPFU0939F1ZW')).toBe(false);
    expect(validateGstin('27AAPFU0939F1XV')).toBe(false);
    expect(validateGstin('27AAPFU0939F1Z')).toBe(false);
    expect(validateGstin('00AAPFU0939F1ZV')).toBe(false);
    expect(validateGstin('')).toBe(false);
  });
});

describe('mileage', () => {
  it('multiplies km by the rate, rounding half up once', () => {
    expect(mileageAmount('12.5', 800n)).toBe(10000n);
    expect(mileageAmount('0.05', 1010n)).toBe(51n); // 50.5 -> 51
    expect(mileageAmount('0.01', 1049n)).toBe(10n); // 10.49 -> 10
    expect(mileageAmount('10', 0n)).toBe(0n);
  });
  it('refuses bad distances', () => {
    expect(mileageAmount('0', 100n)).toBeNull();
    expect(mileageAmount('1.234', 100n)).toBeNull();
    expect(mileageAmount('-3', 100n)).toBeNull();
  });
  it('resolves entry, then employee, then company rate (zero is a rate)', () => {
    expect(resolveMileageRate(5n, '7', '9')).toBe(5n);
    expect(resolveMileageRate(null, '7', '9')).toBe(7n);
    expect(resolveMileageRate(null, null, '9')).toBe(9n);
    expect(resolveMileageRate(null, null, null)).toBeNull();
    expect(resolveMileageRate(0n, '7', '9')).toBe(0n);
  });
});

describe('normaliseDecimalInput', () => {
  it('reads localised digits and a decimal comma', () => {
    expect(normaliseDecimalInput('12,5')).toBe('12.5');
    expect(normaliseDecimalInput('١٢.٥')).toBe('12.5');
    expect(normaliseDecimalInput('१२.५')).toBe('12.5');
    expect(normaliseDecimalInput('௧௨')).toBe('12');
    expect(normaliseDecimalInput('1a2')).toBe('12');
  });
  it('accepts six-digit kilometres like the server', () => {
    expect(mileageAmount('999999.99', 100n)).toBe(99999999n);
  });
});

describe('GST', () => {
  it('extracts GST from an inclusive total, half up', () => {
    expect(gstFromInclusive(11800n, 1800)).toBe(1800n);
    expect(gstFromInclusive(10500n, 500)).toBe(500n);
    expect(gstFromInclusive(100n, 1800)).toBe(15n); // 15.25
  });
  it('totals GST on counted expenses only', () => {
    const a = entry({ entry_kind: 'expense', amount: '11800', gst_amount_minor: '1800' });
    const b = entry({
      entry_kind: 'expense',
      amount: '500',
      gst_amount_minor: '90',
      status: 'submitted',
    });
    const c = entry({
      entry_kind: 'expense',
      amount: '500',
      gst_amount_minor: '90',
      status: 'reimbursed',
    });
    expect(companyGstTotal([a, b, c], { from: '2026-10-01', to: '2026-10-31' })).toBe(1890n);
    expect(
      companyStatement([a, b, c], { memberId: 'ravi', from: '2026-10-01', to: '2026-10-31' }).totals
        .gst,
    ).toBe(1890n);
  });
});

describe('policies', () => {
  const policies: CompanyPolicies = {
    version: 1,
    rules: [
      { id: 'r', type: 'receipt_above', limitMinor: '100000', effect: 'warn' },
      {
        id: 'f',
        type: 'period_limit',
        target: 'fuel',
        period: 'month',
        limitMinor: '500000',
        effect: 'warn',
      },
      {
        id: 'b',
        type: 'period_limit',
        target: 'allowance',
        period: 'day',
        limitMinor: '50000',
        effect: 'block',
      },
    ],
  };
  const subject = (amount: bigint, extra = {}) => ({
    memberId: 'ravi',
    kind: 'expense' as const,
    category: 'fuel',
    amount,
    occurredOn: '2026-10-10',
    ...extra,
  });
  it('flags a receipt only strictly above the limit and without one', () => {
    expect(evaluateCompanyPolicies(subject(100000n), [], policies, { hasReceipt: false })).toEqual(
      [],
    );
    expect(evaluateCompanyPolicies(subject(100001n), [], policies, { hasReceipt: true })).toEqual(
      [],
    );
    expect(
      evaluateCompanyPolicies(subject(100001n), [], policies, { hasReceipt: false })[0]?.code,
    ).toBe('RECEIPT');
  });
  it('sums the month per employee, skips rejected, voided and itself', () => {
    const prior = entry({ entry_kind: 'expense', amount: '450000', category: 'fuel' });
    const other = entry({
      entry_kind: 'expense',
      amount: '450000',
      category: 'fuel',
      member_id: 'sita',
    });
    const rejected = entry({
      entry_kind: 'expense',
      amount: '450000',
      category: 'fuel',
      status: 'rejected',
    });
    expect(
      evaluateCompanyPolicies(subject(50000n), [prior, other, rejected], policies, {
        hasReceipt: true,
      }),
    ).toEqual([]);
    const flags = evaluateCompanyPolicies(subject(50001n), [prior, other, rejected], policies, {
      hasReceipt: true,
    });
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ ruleId: 'f', effect: 'warn', actualMinor: 500001n });
    expect(
      evaluateCompanyPolicies(subject(60000n, { id: prior.id }), [prior], policies, {
        hasReceipt: true,
      }),
    ).toEqual([]);
  });
  it('applies a blocking bata day limit', () => {
    const flags = evaluateCompanyPolicies(
      {
        memberId: 'ravi',
        kind: 'allowance',
        category: null,
        amount: 50001n,
        occurredOn: '2026-10-10',
      },
      [],
      policies,
      { hasReceipt: false },
    );
    expect(flags[0]).toMatchObject({ ruleId: 'b', effect: 'block' });
  });
  it('finds a likely duplicate', () => {
    const prior = entry({
      entry_kind: 'expense',
      amount: '1000',
      category: 'fuel',
      occurred_on: '2026-10-10',
    });
    expect(findDuplicateEntry(subject(1000n), [prior])?.id).toBe(prior.id);
    expect(findDuplicateEntry(subject(1001n), [prior])).toBeNull();
  });
});

describe('bulk reimbursement', () => {
  const claimA = entry({
    entry_kind: 'expense',
    amount: '120000',
    category: 'fuel',
    occurred_on: '2026-10-02',
  });
  const claimB = entry({ entry_kind: 'allowance', amount: '40000', occurred_on: '2026-10-04' });
  const late = entry({
    entry_kind: 'expense',
    amount: '9000',
    category: 'food',
    occurred_on: '2026-10-20',
  });
  const advance = entry({ entry_kind: 'advance', amount: '50000', occurred_on: '2026-10-01' });
  const paid = entry({
    entry_kind: 'expense',
    amount: '7000',
    status: 'reimbursed',
    reimbursement_id: 'x',
  });
  const all = [claimA, claimB, late, advance, paid];

  it('nets advances into "all due through"', () => {
    const p = buildReimbursementPreview(all, { memberId: 'ravi', through: '2026-10-10' });
    expect(p.claims.map((c) => c.id)).toEqual([claimA.id, claimB.id]);
    expect(p.adjustments.map((c) => c.id)).toEqual([advance.id]);
    expect([p.claimsMinor, p.creditsMinor, p.payoutMinor]).toEqual([160000n, 50000n, 110000n]);
  });
  it('does not net an earlier bulk payment into the next one', () => {
    const payment = entry({
      entry_kind: 'reimbursement',
      amount: '100000',
      direction: 'company_to_employee',
      reimbursement_details: { requestHash: 'x' },
      occurred_on: '2026-09-01',
    });
    const p = buildReimbursementPreview([claimA, payment], {
      memberId: 'ravi',
      through: '2026-10-10',
    });
    expect(p.adjustments).toEqual([]);
    expect(p.payoutMinor).toBe(120000n);
  });
  it('keeps the chosen cutoff for credits even if the latest claim is earlier', () => {
    const p = buildReimbursementPreview(all, {
      memberId: 'ravi',
      ids: [claimA.id],
      through: '2026-10-10',
    });
    expect(p.cutoff).toBe('2026-10-10');
    expect(p.payoutMinor).toBe(120000n - 50000n);
  });
  it('uses the latest selected date as cutoff for a hand-picked list', () => {
    const p = buildReimbursementPreview(all, { memberId: 'ravi', ids: [late.id] });
    expect(p.cutoff).toBe('2026-10-20');
    expect(p.payoutMinor).toBe(9000n - 50000n);
  });
  it('leaves the balance unchanged by status alone, and zero after payout', () => {
    const p = buildReimbursementPreview(all, { memberId: 'ravi', through: '2026-10-10' });
    const reimb = entry({
      entry_kind: 'reimbursement',
      amount: p.payoutMinor.toString(),
      direction: 'company_to_employee',
    });
    const before = companyStatement([claimA, claimB, advance], {
      memberId: 'ravi',
      from: '2026-01-01',
      to: '2026-12-31',
    }).closing;
    const marked = [
      { ...claimA, status: 'reimbursed' as const, reimbursementId: reimb.id },
      { ...claimB, status: 'reimbursed' as const, reimbursementId: reimb.id },
      { ...advance, reimbursementId: reimb.id },
      reimb,
    ];
    const after = companyStatement(marked, {
      memberId: 'ravi',
      from: '2026-01-01',
      to: '2026-12-31',
    }).closing;
    expect(before).toBe(110000n);
    expect(after).toBe(0n);
  });
  it('overlays a queued reimbursement offline, once', () => {
    const state = emptyMirror();
    const queue = [
      {
        seq: 1,
        kind: 'company.reimburse',
        groupId: 'g1',
        clientCreatedAt: '2026-10-11T00:00:00Z',
        payload: {
          reimbursementId: 'r1',
          memberId: 'ravi',
          claims: [{ entryId: 'c1', expectedVersion: 1 }],
          adjustments: [],
          cutoff: '2026-10-10',
          paidOn: '2026-10-11',
          expectedAmountMinor: '100',
          note: null,
        },
      } as unknown as QueuedMutation,
    ];
    const rows = materialiseCompanyEntries(state, queue, { groupId: 'g1', currency: 'INR' });
    expect(rows.map((r) => r.id)).toEqual(['r1']); // unknown claim ignored, payment shown
    expect(rows[0]?.entry_kind).toBe('reimbursement');
  });
});
