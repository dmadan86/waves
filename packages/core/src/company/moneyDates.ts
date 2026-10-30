import { billDueMinor, outstandingAdvance, wagePaidInPeriod, type CompanyEntry } from './index';

export type MoneyDateKind = 'wage' | 'vendor_bill' | 'customer_bill' | 'recurring' | 'advance';

export interface MoneyDate {
  readonly id: string;
  readonly day: string;
  readonly kind: MoneyDateKind;
  readonly title: string;
  readonly amountMinor: bigint | null;
  readonly currency: string;
  readonly memberId: string | null;
  readonly overdue: boolean;
  readonly route: string | null;
}

export interface MoneyDateInput {
  readonly currency: string;
  readonly entries?: readonly CompanyEntry[];
  readonly people?: readonly {
    readonly id: string;
    readonly name: string;
    readonly currency?: string;
  }[];
  readonly vendors?: readonly {
    readonly id: string;
    readonly name: string;
    readonly memberId: string | null;
  }[];
  readonly vendorLines?: readonly {
    readonly id: string;
    readonly vendorId: string;
    readonly kind: 'bill' | 'advance' | 'payment';
    readonly amount: bigint;
    readonly occurredOn: string;
    readonly status: string;
    readonly deleted: boolean;
  }[];
  readonly documents?: readonly {
    readonly id: string;
    readonly docType: 'estimate' | 'bill';
    readonly customerName: string;
    readonly number: number | null;
    readonly docDate: string;
    readonly totalMinor: bigint;
    readonly paidMinor: bigint;
    readonly currency: string;
    readonly deleted: boolean;
  }[];
  readonly wagePeriod?: { readonly start: string; readonly end: string };
}

const plusDays = (day: string, days: number): string => {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

/** Derive visible, unpaid company money dates; date window is overdue plus the next 90 days. */
export function deriveMoneyDates(input: MoneyDateInput, today: string): MoneyDate[] {
  const endWindow = plusDays(today, 90);
  const out: MoneyDate[] = [];
  const add = (date: Omit<MoneyDate, 'overdue'>): void => {
    if (date.day <= endWindow) out.push({ ...date, overdue: date.day < today });
  };

  const period = input.wagePeriod ?? { start: plusDays(today, -6), end: today };
  // One wage row per period (not one per person): the first unpaid name plus a count.
  const unpaid = (input.people ?? []).filter(
    (p) => !wagePaidInPeriod(input.entries ?? [], p.id, period.start, period.end),
  );
  if (unpaid.length > 0)
    add({
      id: `wage:${period.end}`,
      day: period.end,
      kind: 'wage',
      title: unpaid.length === 1 ? unpaid[0]!.name : `${unpaid[0]!.name} +${unpaid.length - 1}`,
      amountMinor: null,
      currency: input.currency,
      memberId: unpaid.length === 1 ? unpaid[0]!.id : null,
      route: 'company-wages',
    });

  // One row per vendor with a balance we still owe: payments are not matched to bills, so show the
  // balance against the oldest approved bill (never several bills each at a stale full amount).
  const vendorById = new Map((input.vendors ?? []).map((v) => [v.id, v]));
  const owed = new Map<string, { balance: bigint; oldest: string }>();
  for (const line of input.vendorLines ?? []) {
    if (line.deleted || line.status !== 'approved') continue;
    const cur = owed.get(line.vendorId) ?? { balance: 0n, oldest: '' };
    if (line.kind === 'bill') {
      cur.balance += line.amount;
      if (!cur.oldest || line.occurredOn < cur.oldest) cur.oldest = line.occurredOn;
    } else cur.balance -= line.amount;
    owed.set(line.vendorId, cur);
  }
  for (const [vendorId, { balance, oldest }] of owed) {
    const vendor = vendorById.get(vendorId);
    if (!vendor || balance <= 0n || !oldest) continue;
    add({
      id: `vendor_bill:${vendorId}`,
      day: oldest,
      kind: 'vendor_bill',
      title: vendor.name,
      amountMinor: balance,
      currency: input.currency,
      memberId: vendor.memberId,
      route: `company-vendors/${vendor.id}`,
    });
  }

  for (const doc of input.documents ?? []) {
    if (doc.deleted || doc.docType !== 'bill' || doc.paidMinor >= doc.totalMinor) continue;
    add({
      id: `customer_bill:${doc.id}`,
      day: doc.docDate,
      kind: 'customer_bill',
      title: doc.number == null ? doc.customerName : `BILL-${String(doc.number).padStart(4, '0')}`,
      amountMinor: billDueMinor(doc.totalMinor, doc.paidMinor),
      currency: doc.currency,
      memberId: null,
      route: `company-documents/${doc.id}`,
    });
  }

  // One row per person with an advance still outstanding, dated by their latest advance.
  const latest = new Map<string, CompanyEntry>();
  for (const e of input.entries ?? []) {
    if (e.kind !== 'advance' || e.deleted || e.status !== 'approved' || e.reimbursementId !== null)
      continue;
    const was = latest.get(e.memberId);
    if (!was || e.occurredOn > was.occurredOn) latest.set(e.memberId, e);
  }
  for (const [memberId, e] of latest) {
    const outstanding = outstandingAdvance(input.entries ?? [], memberId, today);
    if (outstanding <= 0n) continue;
    const person = input.people?.find((p) => p.id === memberId);
    add({
      id: `advance:${memberId}`,
      day: e.occurredOn,
      kind: 'advance',
      title: person?.name ?? memberId,
      amountMinor: outstanding,
      currency: e.currency,
      memberId,
      route: null,
    });
  }
  return out.sort((a, b) => a.day.localeCompare(b.day) || a.id.localeCompare(b.id));
}
