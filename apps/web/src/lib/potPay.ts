import type { PotPayInfo } from '@waves/api-client';
import { buildPaymentUri, normalisePotUtr, toMajorString, type CurrencyCode } from '@waves/core';

export function potPayUri(info: PotPayInfo, code: string): string | null {
  return (
    buildPaymentUri(
      {
        railId: 'upi',
        handle: info.payeeVpa ?? '',
        payeeName: info.payeeName,
        amount: BigInt(info.perHeadMinor),
        currency: info.currency as CurrencyCode,
        note: `WV-${code}`,
      },
      (minor, currency) => toMajorString({ minor, currency }),
    )?.uri ?? null
  );
}

/** Empty is optional; a supplied reference must match the core bank patterns. */
export function potReportInput(payerName: string, utr: string) {
  const name = payerName.trim();
  if (!name || name.length > 100) return { error: 'badName' } as const;
  const reference = utr.trim() ? normalisePotUtr(utr) : '';
  if (reference === null) return { error: 'badUtr' } as const;
  return { name, reference: reference || null } as const;
}
