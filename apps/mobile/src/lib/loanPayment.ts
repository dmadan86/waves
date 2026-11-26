import { guessCategory, type PersonalLoan } from '@waves/core';

import { dateTimeFormat } from '@/lib/dateTimeFormat';

/**
 * What "Record payment" prefills: the saved EMI (when above zero) and a category guessed from
 * the loan's name and note ("SBI home loan" → home), else Other — never a blanket "home".
 */
export function loanPaymentDefaults(
  loan: Pick<PersonalLoan, 'carried'> & Partial<Pick<PersonalLoan, 'counterpart' | 'note'>>,
): { amount?: string; category: string } {
  const raw = loan.carried?.emiAmount;
  let amount: string | undefined;
  try {
    if (raw != null && BigInt(raw as bigint | number | string) > 0n) amount = String(raw);
  } catch {
    amount = undefined;
  }
  const category = guessCategory(`${loan.counterpart ?? ''} ${loan.note ?? ''}`.trim()) ?? 'other';
  return { ...(amount === undefined ? {} : { amount }), category };
}

/** Format a ledger calendar day for the loan payment history. */
export function formatLoanPaymentDate(day: string, locale: string): string {
  try {
    return dateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${day}T00:00:00Z`));
  } catch {
    return day;
  }
}
