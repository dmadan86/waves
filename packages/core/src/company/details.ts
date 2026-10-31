/**
 * Details card: optional contact + bank details for the company and for each vendor.
 * Details only, to be read, copied and shared as text. Nothing here starts or requests a payment.
 * The server is authoritative (and keeps bank + PAN away from employees); this validates, masks and formats.
 */

export const DETAIL_KEYS = [
  'bankName',
  'bankAccount',
  'ifsc',
  'upi',
  'pan',
  'address',
  'phone',
  'email',
  'gstin',
  'note',
] as const;
export type DetailKey = (typeof DETAIL_KEYS)[number];
/** Every field is optional; a missing one is null. */
export type DetailsValues = Readonly<Record<DetailKey, string | null>>;
export const BANK_KEYS = ['bankName', 'bankAccount', 'ifsc', 'upi'] as const;
/** Masked until the viewer taps the eye. */
export const MASKED_KEYS: readonly DetailKey[] = ['bankAccount', 'upi', 'pan'];
export const NOTE_MAX = 500;

export interface DetailsCard {
  readonly values: DetailsValues;
  readonly updatedAt: string | null;
  readonly updatedByName: string | null;
  readonly updatedBy: string | null;
  /** When any bank field last changed (null: never). */
  readonly bankChangedAt: string | null;
  readonly bankChangedBy: string | null;
  /** Queued on this phone, not yet saved. */
  readonly pending?: boolean;
}

export const emptyDetails = (): DetailsValues =>
  Object.fromEntries(DETAIL_KEYS.map((k) => [k, null])) as unknown as DetailsValues;

export const hasAnyDetail = (v: DetailsValues): boolean => DETAIL_KEYS.some((k) => !!v[k]);

const RULES: Readonly<Partial<Record<DetailKey, (v: string) => boolean>>> = {
  bankName: (v) => v.length <= 120,
  bankAccount: (v) => /^[0-9A-Za-z]{4,34}$/.test(v),
  ifsc: (v) => /^[A-Z]{4}0[A-Z0-9]{6}$/.test(v),
  upi: (v) => /^[^@\s]{1,100}@[^@\s]{1,100}$/.test(v),
  pan: (v) => /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v),
  address: (v) => v.length <= 300,
  phone: (v) => v.length <= 32 && /^[+0-9()\-.\s]{3,}$/.test(v),
  email: (v) => v.length <= 120 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v),
  gstin: (v) => /^[0-9A-Z]{15}$/.test(v),
  note: (v) => v.length <= NOTE_MAX,
};

/** Trim, blank to null, upper-case the code-like fields (the form calls this before it validates). */
export function cleanDetails(
  input: Partial<Record<DetailKey, string | null | undefined>>,
): DetailsValues {
  const out = { ...emptyDetails() } as Record<DetailKey, string | null>;
  for (const k of DETAIL_KEYS) {
    let v = (input[k] ?? '').trim();
    if (k === 'ifsc' || k === 'pan' || k === 'gstin') v = v.toUpperCase();
    out[k] = v === '' ? null : v;
  }
  return out;
}

/** Keys whose value does not pass, for the form to mark before anything is sent. */
export function invalidDetailKeys(values: DetailsValues): DetailKey[] {
  return DETAIL_KEYS.filter((k) => {
    const v = values[k];
    return v !== null && !(RULES[k]?.(v) ?? true);
  });
}

/** •••• plus the last four characters (a UPI ID shows its last four too); short values are fully hidden. */
export function maskValue(value: string): string {
  const tail = value.length > 4 ? value.slice(-4) : '';
  return `••••${tail}`;
}

/** Bank details as they stood: a viewer's "Noted" is remembered against this. */
export const bankNoticeKey = (cardId: string, bankChangedAt: string): string =>
  `${cardId}:${bankChangedAt}`;

/** The amber notice shows to anyone but the person who made the change, until they note it. */
export const showBankNotice = (
  card: Pick<DetailsCard, 'bankChangedAt' | 'bankChangedBy'>,
  myMemberId: string | null,
  noted: boolean,
): boolean => !!card.bankChangedAt && !noted && card.bankChangedBy !== myMemberId;

const LABELS: Readonly<Record<DetailKey, string>> = {
  bankName: 'Account name',
  bankAccount: 'Account number',
  ifsc: 'IFSC',
  upi: 'UPI ID',
  pan: 'PAN',
  address: 'Address',
  phone: 'Phone',
  email: 'Email',
  gstin: 'GSTIN',
  note: 'Note',
};
const ORDER: readonly DetailKey[] = [
  'bankName',
  'bankAccount',
  'ifsc',
  'upi',
  'address',
  'phone',
  'email',
  'gstin',
  'pan',
  'note',
];

/** Plain text for the OS share sheet: a title, then each filled field in full. */
export function detailsToShareText(
  title: string,
  values: DetailsValues,
  labels: Readonly<Partial<Record<DetailKey, string>>> = {},
): string {
  const lines = ORDER.filter((k) => values[k]).map(
    (k) => `${labels[k] ?? LABELS[k]}: ${values[k]}`,
  );
  return [title, ...lines].join('\n');
}

export interface CompanyDetailsSetPayload {
  readonly data: DetailsValues;
}
export interface CompanyVendorDetailsSetPayload {
  readonly vendorId: string;
  readonly data: DetailsValues;
}
