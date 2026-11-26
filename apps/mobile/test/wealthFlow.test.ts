import { describe, expect, it } from 'vitest';

import {
  INVESTMENT_WIZARD_STEPS,
  rentalWizardSteps,
  wizardFooterPadding,
  wizardProgress,
} from '@/lib/wealthFlow';

describe('wizard controls stay clear and progress stays stable', () => {
  it('keeps Skip above tab bar and safe area', () => {
    expect(wizardFooterPadding(96, 16)).toBe(112);
    expect(wizardFooterPadding(0, 16)).toBe(16);
  });
  it('keeps investment progress at the maximum branch count', () => {
    expect(INVESTMENT_WIZARD_STEPS).toBe(8);
    expect(wizardProgress(2, INVESTMENT_WIZARD_STEPS)).toEqual({ index: 2, total: 8 });
    expect(wizardProgress(50, INVESTMENT_WIZARD_STEPS)).toEqual({ index: 7, total: 8 });
  });
  it('keeps rental progress at a fixed total and clamps the last step', () => {
    expect(rentalWizardSteps(6)).toBe(9);
    expect(wizardProgress(3, rentalWizardSteps(6))).toEqual({ index: 3, total: 9 });
    expect(wizardProgress(20, rentalWizardSteps(6))).toEqual({ index: 8, total: 9 });
  });
});
