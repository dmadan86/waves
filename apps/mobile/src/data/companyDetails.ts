/**
 * Details card: contact + bank details for the company and for each vendor.
 * Bank + PAN of the company card never reach an employee: the server keeps them in a table employees cannot read,
 * so this phone's mirror simply does not hold them. Details only: nothing here starts a payment.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMutation } from '@tanstack/react-query';

import {
  MutationKind,
  bankNoticeKey,
  materialiseCompanyCard,
  materialiseVendorCard,
  showBankNotice,
  type DetailsCard,
  type DetailsValues,
} from '@waves/core';

import { useCompanyEntries, useCompanySuspended } from '@/data/companyEntries';
import { useCompanyVendors } from '@/data/companyVendors';
import { useSync } from '@/sync';

export interface CardView {
  readonly card: DetailsCard | null;
  /** May this viewer edit it right now (not while the company is suspended). */
  readonly canEdit: boolean;
  readonly myMemberId: string | null;
  /** Stable id for the "Noted" memory of this card. */
  readonly cardId: string;
}

export function useCompanyCard(groupId: string): CardView {
  const { mirror, queue } = useSync();
  const view = useCompanyEntries(groupId);
  const suspended = useCompanySuspended(groupId);
  const myId = view.me?.id ?? null;
  const card = useMemo(
    () => materialiseCompanyCard(mirror, queue, { groupId, myMemberId: myId }),
    [mirror, queue, groupId, myId],
  );
  return {
    card,
    canEdit: view.isOwner && !suspended,
    myMemberId: myId,
    cardId: `company:${groupId}`,
  };
}

export function useVendorCard(groupId: string, vendorId: string): CardView {
  const { mirror, queue } = useSync();
  const vendors = useCompanyVendors(groupId);
  const suspended = useCompanySuspended(groupId);
  const myId = vendors.myMemberId;
  const card = useMemo(
    () => materialiseVendorCard(mirror, queue, { groupId, vendorId, myMemberId: myId }),
    [mirror, queue, groupId, vendorId, myId],
  );
  // The list is already narrowed to the vendors this viewer may see (owner: all, manager: theirs, vendor: itself).
  const visible = vendors.vendors.some((v) => v.id === vendorId);
  return { card, canEdit: visible && !suspended, myMemberId: myId, cardId: `vendor:${vendorId}` };
}

export function useSetCompanyCard(groupId: string) {
  const { mutate } = useSync();
  return useMutation({
    mutationFn: (data: DetailsValues) => mutate(MutationKind.CompanyDetailsSet, groupId, { data }),
  });
}

export function useSetVendorCard(groupId: string, vendorId: string) {
  const { mutate } = useSync();
  return useMutation({
    mutationFn: (data: DetailsValues) =>
      mutate(MutationKind.CompanyVendorDetailsSet, groupId, { vendorId, data }),
  });
}

/**
 * The amber "bank details changed" notice for one card. "Noted" is remembered on this device only,
 * keyed by card + the change time, so a later change shows it again. Nothing is synced.
 */
export function useBankNotice(view: CardView): { show: boolean; markNoted: () => void } {
  const at = view.card?.bankChangedAt ?? null;
  const key = at ? `waves.bankNoted.${bankNoticeKey(view.cardId, at)}` : null;
  // Hidden until this device's answer for this exact change has loaded.
  const [seen, setSeen] = useState<{ key: string; noted: boolean } | null>(null);
  useEffect(() => {
    if (!key) return;
    let live = true;
    AsyncStorage.getItem(key)
      .then((v) => live && setSeen({ key, noted: v === '1' }))
      .catch(() => live && setSeen({ key, noted: false }));
    return () => {
      live = false;
    };
  }, [key]);
  const noted = seen?.key === key ? seen.noted : true;
  const markNoted = useCallback(() => {
    if (key) setSeen({ key, noted: true });
    if (key) AsyncStorage.setItem(key, '1').catch(() => undefined);
  }, [key]);
  return { show: !!view.card && showBankNotice(view.card, view.myMemberId, noted), markNoted };
}
