/** Bottom space needed to keep wizard actions clear of the tab bar. */
export const wizardFooterPadding = (tabBarClearance: number, spacing: number): number =>
  tabBarClearance + spacing;

/** The maximum possible number of investment questions, including insurance branches. */
export const INVESTMENT_WIZARD_STEPS = 8;

/** Rental flow has three property questions followed by the fixed tenant interview. */
export const rentalWizardSteps = (tenantSteps: number): number => 3 + tenantSteps;

/** A displayed step is always within the stable flow total. */
export const wizardProgress = (at: number, total: number): { index: number; total: number } => ({
  index: Math.min(Math.max(0, at), Math.max(0, total - 1)),
  total,
});
