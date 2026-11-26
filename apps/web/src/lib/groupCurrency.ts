/**
 * The server refuses a currency change once a group has bills or settlements
 * (CURRENCY_LOCKED), so the form says so up front instead of failing on Save.
 */
export function isCurrencyLocked(ledger: {
  expenses: readonly unknown[];
  settlements: readonly unknown[];
}): boolean {
  return ledger.expenses.length > 0 || ledger.settlements.length > 0;
}

/** The same refusal arriving as an error (a group with rates set, or a stale form). */
export function isCurrencyLockedError(caught: unknown): boolean {
  const message = (caught as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message.includes('CURRENCY_LOCKED');
}
