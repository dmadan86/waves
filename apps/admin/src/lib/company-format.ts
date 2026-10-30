/** Format integer minor units without rounding bigint totals through Number. */
export function companyMoney(amount: number | string, currency: string): string {
  const formatter = new Intl.NumberFormat('en-IN', { style: 'currency', currency });
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  const units = BigInt(amount);
  const scale = 10n ** BigInt(digits);
  const absolute = units < 0n ? -units : units;
  // Use the locale's currency placement and grouping, replacing only the fraction.
  const parts = formatter.formatToParts(absolute / scale);
  const fraction = (absolute % scale).toString().padStart(digits, '0');
  return `${units < 0n ? '-' : ''}${parts.map((part) => part.type === 'fraction' ? fraction : part.value).join('')}`;
}

export function companyWhen(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
}
