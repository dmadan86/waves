/**
 * RFC 4180 quoting. Every field is quoted rather than only the ones that need
 * it — a country code is two letters today and the day one of these fields
 * carries a comma is not the day to find out this function was optimistic.
 */
export function cell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  const text =
    typeof value === 'string' && /^[=+\-@\t\r]/.test(value) ? `'${value}` : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}
