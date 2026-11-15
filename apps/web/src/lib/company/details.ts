/** Company + vendor details cards (port of companyDetails.ts). Pure; "Noted" is kept in localStorage by the hook. */
import {
  bankNoticeKey,
  materialiseCompanyCard,
  materialiseVendorCard,
  MutationKind,
  showBankNotice,
  type DetailsCard,
  type DetailsValues,
  type MirrorState,
} from '@waves/core';

import type { CompanyAccess } from '@/lib/company/vendorAccess';

export interface CardView {
  readonly card: DetailsCard | null;
  readonly canEdit: boolean;
  readonly myMemberId: string | null;
  /** Stable id for the "Noted" memory of this card. */
  readonly cardId: string;
}

/** Bank + PAN of the company card never reach an employee: the server keeps them out of the mirror. */
export function deriveCompanyCard(
  mirror: MirrorState,
  groupId: string,
  access: CompanyAccess,
): CardView {
  return {
    card: materialiseCompanyCard(mirror, [], {
      groupId,
      myMemberId: access.memberId,
      canSeeBank: access.isOwner || access.isManager || access.isVendor,
    }),
    canEdit: access.isOwner && !access.suspended,
    myMemberId: access.memberId,
    cardId: `company:${groupId}`,
  };
}

export function deriveVendorCard(
  mirror: MirrorState,
  groupId: string,
  vendorId: string,
  access: CompanyAccess,
  /** The vendor is one this viewer may see (already narrowed by role). */
  visible: boolean,
): CardView {
  const card = materialiseVendorCard(mirror, [], {
    groupId,
    vendorId,
    myMemberId: access.memberId,
  });
  // A stale cached card must not show once RLS no longer lets this viewer read it.
  return {
    card: visible ? card : null,
    canEdit: visible && !access.suspended,
    myMemberId: access.memberId,
    cardId: `vendor:${vendorId}`,
  };
}

export const companyDetailsMutation = (data: DetailsValues) => ({
  kind: MutationKind.CompanyDetailsSet,
  payload: { data } as Record<string, unknown>,
});
export const vendorDetailsMutation = (vendorId: string, data: DetailsValues) => ({
  kind: MutationKind.CompanyVendorDetailsSet,
  payload: { vendorId, data } as Record<string, unknown>,
});

/** localStorage key remembering "Noted" for this card at this change time; null when there is no bank change. */
export const bankNotedKey = (view: CardView): string | null =>
  view.card?.bankChangedAt
    ? `waves.bankNoted.${bankNoticeKey(view.cardId, view.card.bankChangedAt)}`
    : null;

export const shouldShowBankNotice = (view: CardView, noted: boolean): boolean =>
  !!view.card && showBankNotice(view.card, view.myMemberId, noted);
