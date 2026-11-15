/** Find clients already in the company while a new inquiry is typed, so the same customer is not added twice. */

export interface MatchableClient {
  readonly id: string;
  readonly name: string;
  readonly phone: string | null;
}

/** Digits only, without a leading 0 or the +91 country code, so "+91 98765 43210" and "09876543210" agree. */
export function normalizePhone(raw: string | null | undefined): string {
  let d = (raw ?? '').replace(/\D/g, '');
  if (d.length > 10 && d.startsWith('91')) d = d.slice(2);
  return d.replace(/^0+/, '');
}

const MIN_DIGITS = 6;
const MIN_NAME = 3;
const MAX_MATCHES = 3;

/** Phone matches (typed digits equal or end the stored number) come before name matches; at most three. */
export function matchClients<T extends MatchableClient>(
  clients: readonly T[],
  query: { name: string; phone: string },
): T[] {
  const digits = normalizePhone(query.phone);
  const byPhone =
    digits.length >= MIN_DIGITS
      ? clients.filter((c) => {
          const stored = normalizePhone(c.phone);
          return stored !== '' && stored.endsWith(digits);
        })
      : [];
  const needle = query.name.trim().toLowerCase();
  const byName =
    needle.length >= MIN_NAME
      ? clients.filter((c) => !byPhone.includes(c) && c.name.toLowerCase().includes(needle))
      : [];
  return [...byPhone, ...byName].slice(0, MAX_MATCHES);
}

export interface ClientHistory {
  readonly inquiries: number;
  readonly estimates: number;
  readonly bills: number;
  readonly complaints: number;
  /** The newest inquiry, estimate or bill. */
  readonly last: {
    readonly kind: 'inquiry' | 'estimate' | 'bill';
    readonly day: string;
    readonly amountMinor: bigint | null;
  } | null;
}

export function clientHistory(
  inquiries: readonly { inquiryDate: string; expectedValueMinor: bigint | null }[],
  docs: readonly {
    docType: 'estimate' | 'bill';
    docDate: string;
    totalMinor: bigint;
    deleted?: boolean;
  }[],
  complaints: number,
): ClientHistory {
  const live = docs.filter((d) => !d.deleted);
  const items: NonNullable<ClientHistory['last']>[] = [
    ...inquiries.map((i) => ({
      kind: 'inquiry' as const,
      day: i.inquiryDate,
      amountMinor: i.expectedValueMinor,
    })),
    ...live.map((d) => ({ kind: d.docType, day: d.docDate, amountMinor: d.totalMinor })),
  ];
  items.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
  return {
    inquiries: inquiries.length,
    estimates: live.filter((d) => d.docType === 'estimate').length,
    bills: live.filter((d) => d.docType === 'bill').length,
    complaints,
    last: items[0] ?? null,
  };
}
