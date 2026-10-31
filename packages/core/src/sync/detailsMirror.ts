import {
  DETAIL_KEYS,
  emptyDetails,
  type DetailsCard,
  type DetailsValues,
} from '../company/details';
import type { CompanyDetailsSetPayload, CompanyVendorDetailsSetPayload } from '../company/details';
import { rowsFor, type MirrorState } from './mirror';
import { SyncTable } from './protocol';
import type { QueuedMutation } from './queue';

type Row = Record<string, unknown>;
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
// Server column -> card key.
const COLS: Readonly<Record<(typeof DETAIL_KEYS)[number], string>> = {
  bankName: 'bank_name',
  bankAccount: 'bank_account',
  ifsc: 'ifsc',
  upi: 'upi',
  pan: 'pan',
  address: 'address',
  phone: 'phone',
  email: 'email',
  gstin: 'gstin',
  note: 'note',
};

function fold(rows: Row[]): DetailsCard | null {
  const live = rows.filter((r) => r.deleted_at == null);
  if (live.length === 0) return null;
  const values = { ...emptyDetails() } as Record<keyof typeof COLS, string | null>;
  let card: DetailsCard = {
    values,
    updatedAt: null,
    updatedBy: null,
    updatedByName: null,
    bankChangedAt: null,
    bankChangedBy: null,
  };
  for (const r of live) {
    for (const k of DETAIL_KEYS) if (COLS[k] in r) values[k] = str(r[COLS[k]]) ?? values[k];
    card = {
      ...card,
      updatedAt: str(r.updated_at) ?? card.updatedAt,
      updatedBy: str(r.updated_by) ?? card.updatedBy,
      updatedByName: str(r.updated_by_name) ?? card.updatedByName,
      bankChangedAt: str(r.bank_changed_at) ?? card.bankChangedAt,
      bankChangedBy: str(r.bank_changed_by) ?? card.bankChangedBy,
    };
  }
  return card;
}

/** The company card: the public row plus (owner, manager, vendor only) the secure row. */
export function materialiseCompanyCard(
  state: MirrorState,
  queue: readonly QueuedMutation[],
  options: {
    readonly groupId: string;
    readonly myMemberId: string | null;
    readonly myName?: string;
    /** Owner, manager or vendor. Anyone else never shows bank + PAN, even if a stale row is cached. */
    readonly canSeeBank: boolean;
  },
): DetailsCard | null {
  let card = fold([
    ...(rowsFor(state, SyncTable.CompanyDetails, options.groupId) as unknown as Row[]),
    ...(options.canSeeBank
      ? (rowsFor(state, SyncTable.CompanyDetailsSecure, options.groupId) as unknown as Row[])
      : []),
  ]);
  for (const m of [...queue].sort((a, b) => a.seq - b.seq))
    if (m.groupId === options.groupId && !m.rejection && m.kind === 'company_details.set')
      card = overlay(card, (m.payload as unknown as CompanyDetailsSetPayload).data, m, options);
  return card;
}

/** One vendor's card. */
export function materialiseVendorCard(
  state: MirrorState,
  queue: readonly QueuedMutation[],
  options: {
    readonly groupId: string;
    readonly vendorId: string;
    readonly myMemberId: string | null;
    readonly myName?: string;
  },
): DetailsCard | null {
  let card = fold(
    (rowsFor(state, SyncTable.CompanyVendorDetails, options.groupId) as unknown as Row[]).filter(
      (r) => r.vendor_id === options.vendorId,
    ),
  );
  for (const m of [...queue].sort((a, b) => a.seq - b.seq))
    if (m.groupId === options.groupId && !m.rejection && m.kind === 'company_vendor_details.set') {
      const p = m.payload as unknown as CompanyVendorDetailsSetPayload;
      if (p.vendorId === options.vendorId) card = overlay(card, p.data, m, options);
    }
  return card;
}

function overlay(
  old: DetailsCard | null,
  data: DetailsValues,
  m: QueuedMutation,
  o: { readonly myMemberId: string | null; readonly myName?: string },
): DetailsCard {
  return {
    values: data,
    updatedAt: m.clientCreatedAt,
    updatedBy: o.myMemberId,
    updatedByName: o.myName ?? old?.updatedByName ?? null,
    // The server stamps a bank change; until then keep what the viewer last saw.
    bankChangedAt: old?.bankChangedAt ?? null,
    bankChangedBy: old?.bankChangedBy ?? null,
    pending: true,
  };
}
