import type { CurrencyCode, PersonalBudget, PersonalTxn } from '@waves/core';
import type { Profile } from '@/lib/auth';

/** Identity and currency for Personal Home, preferring owner data already on device. */
export function personalHomeIdentity(
  profile: Pick<Profile, 'display_name' | 'default_currency'> | null,
  txns: readonly PersonalTxn[],
  budgets: readonly PersonalBudget[],
  fallbackCurrency: CurrencyCode,
  fallbackName: string,
): { name: string; currency: CurrencyCode } {
  return {
    name: profile?.display_name?.trim() || fallbackName,
    currency:
      profile?.default_currency || txns[0]?.currency || budgets[0]?.currency || fallbackCurrency,
  };
}
