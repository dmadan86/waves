import { describe, expect, it } from 'vitest';
import { exportCreditsLabel } from '../src/lib/exportCreditsLabel';
import type { CreditsStatus } from '../src/lib/adCreditsPure';

const status: CreditsStatus = {
  credits: 13,
  walletCap: 30,
  perAd: 6,
  costs: { voice: 1, scan: 3, export: 6, group: 6 },
  canWatch: true,
  reason: null,
  nextAt: null,
};
const template = '⚡ Uses {cost} credits · you have {balance}';

describe('exportCreditsLabel', () => {
  it('uses the export price and wallet balance, including insufficient funds', () => {
    expect(exportCreditsLabel(false, status, template)).toBe('⚡ Uses 6 credits · you have 13');
    expect(
      exportCreditsLabel(
        false,
        { ...status, credits: 0, costs: { ...status.costs, export: 9 } },
        template,
      ),
    ).toBe('⚡ Uses 9 credits · you have 0');
  });
  it('hides the line for Pro and unknown credit status', () => {
    expect(exportCreditsLabel(true, status, template)).toBeNull();
    expect(exportCreditsLabel(false, null, template)).toBeNull();
    expect(exportCreditsLabel(false, undefined, template)).toBeNull();
  });
});
