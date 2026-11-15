import { describe, expect, it } from 'vitest';

import { companyCountsLine } from '../src/lib/companyCounts';

const forms = {
  employees: { one: '{n} employee', other: '{n} employees' },
  managers: { one: '{n} manager', other: '{n} managers' },
  owners: { one: '{n} owner', other: '{n} owners' },
};

describe('companyCountsLine', () => {
  it('joins every non-zero part', () => {
    expect(companyCountsLine('en', { employees: 6, managers: 2, owners: 1 }, forms)).toBe(
      '6 employees · 2 managers · 1 owner',
    );
  });
  it('omits zero parts', () => {
    expect(companyCountsLine('en', { employees: 0, managers: 0, owners: 1 }, forms)).toBe(
      '1 owner',
    );
  });
});
