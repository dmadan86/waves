import { describe, expect, it } from 'vitest';

import { loanScope } from '../src/lib/personalLoanScope';

const txns = [{ loanId: 'a' }, { loanId: 'b' }, { loanId: null }];

describe('loanScope', () => {
  it('keeps one loan', () => {
    expect(loanScope(txns, { loanId: 'a', excludeLoans: false })).toEqual([{ loanId: 'a' }]);
  });
  it('drops all repayments', () => {
    expect(loanScope(txns, { loanId: null, excludeLoans: true })).toEqual([{ loanId: null }]);
  });
  it('passes everything through', () => {
    expect(loanScope(txns, { loanId: null, excludeLoans: false })).toHaveLength(3);
  });
});
