/** A company's image-storage meter (owners and managers only; the server refuses everyone else). */

export interface CompanyStorageUsage {
  readonly usedBytes: number;
  readonly quotaBytes: number;
}

export function parseStorageUsage(data: unknown): CompanyStorageUsage {
  const row = (Array.isArray(data) ? data[0] : data) as
    | {
        used_bytes?: number | string;
        reserved_bytes?: number | string;
        quota_bytes?: number | string;
      }
    | null
    | undefined;
  return {
    usedBytes: Number(row?.used_bytes ?? 0) + Number(row?.reserved_bytes ?? 0),
    quotaBytes: Number(row?.quota_bytes ?? 0),
  };
}

export function storagePercent(u: CompanyStorageUsage): number {
  const fraction = u.quotaBytes > 0 ? u.usedBytes / u.quotaBytes : 1;
  return Math.min(100, Math.round(fraction * 100));
}

export function formatBytes(bytes: number, locale: string): string {
  const number = (value: number, digits: number): string =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value);
  if (bytes > 0 && bytes < 1024 * 1024) return `${number(bytes / 1024, 0)} KB`;
  const mb = bytes / (1024 * 1024);
  return `${number(mb, mb < 10 ? 1 : 0)} MB`;
}
