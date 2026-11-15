import { describe, expect, it } from 'vitest';

import { paymentRowKind, paymentsHero } from '../src/lib/paymentRows';

describe('paymentRowKind', () => {
  it('keeps title, subtitle and sign consistent', () => {
    expect(paymentRowKind({ kind: 'reimbursement', direction: 'employee_to_company' })).toEqual({
      title: 'cashReturnedBy',
      sub: 'returned',
      incoming: true,
    });
    expect(paymentRowKind({ kind: 'advance', direction: 'company_to_employee' })).toEqual({
      title: 'advanceTo',
      sub: 'advancesLabel',
      incoming: false,
    });
    expect(paymentRowKind({ kind: 'wage_payment', direction: 'company_to_employee' }).title).toBe(
      'wagesTo',
    );
    expect(paymentRowKind({ kind: 'reimbursement', direction: 'company_to_employee' })).toEqual({
      title: 'paymentTo',
      sub: 'paidOut',
      incoming: false,
    });
  });
});

describe('paymentsHero', () => {
  it('adds vendor dues to pending and is zero with no entries', () => {
    expect(paymentsHero([], ['a'], '2026-11-10', 500n)).toEqual({ paid: 0n, pending: 500n });
  });
});
