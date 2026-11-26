import { describe, expect, it } from 'vitest';

import {
  isAmountWithinLimit,
  MAX_AMOUNT_MINOR,
  parseMinorInput,
  reconcileAmountEcho,
} from '../src/money/index.js';

describe('amount limit and echo reconciliation', () => {
  it('limits a field to MAX_AMOUNT_MINOR', () => {
    expect(isAmountWithinLimit(MAX_AMOUNT_MINOR)).toBe(true);
    expect(isAmountWithinLimit(MAX_AMOUNT_MINOR + 1n)).toBe(false);
    expect(isAmountWithinLimit(parseMinorInput('99999999999999', 'INR'))).toBe(false);
    expect(isAmountWithinLimit(parseMinorInput('1250.50', 'INR'))).toBe(true);
  });

  it('a late echo of an earlier keystroke is not news', () => {
    // sent 9, 99, 999; the parent hands back 9 first
    expect(reconcileAmountEcho([900n, 9900n, 99900n], 900n)).toEqual({
      echo: true,
      pending: [9900n, 99900n],
    });
    expect(reconcileAmountEcho([9900n, 99900n], 99900n)).toEqual({ echo: true, pending: [] });
    // a scan or draft restore: not something the field sent
    expect(reconcileAmountEcho([900n], 12345n)).toEqual({ echo: false, pending: [] });
  });
});
