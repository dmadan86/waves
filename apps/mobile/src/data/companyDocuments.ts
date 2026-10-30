/**
 * Company estimates and bills, read local-first and written through the offline queue.
 * Who sees what is the server's job (owners all, a manager only their own, others none);
 * `canUse` only hides the entry points. Waves records only: nothing here moves money.
 */
import { useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';

import {
  MutationKind,
  materialiseCompanyDocs,
  unpaidBills,
  unpaidBillsTotal,
  type CompanyDocSavePayload,
  type CompanyDocType,
  type DocItemInput,
  type MirrorCompanyDoc,
} from '@waves/core';

import { useCompanyEntries } from '@/data/companyEntries';
import { useSync } from '@/sync';

export interface CompanyDocsView {
  /** Newest first; includes this phone's queued changes. */
  readonly docs: readonly MirrorCompanyDoc[];
  /** Owner or manager: the only roles that see Estimates & bills. */
  readonly canUse: boolean;
  readonly currency: string;
  readonly companyName: string;
  readonly ready: boolean;
}

export function useCompanyDocs(groupId: string): CompanyDocsView {
  const { mirror, queue } = useSync();
  const view = useCompanyEntries(groupId);
  const meId = view.me?.id ?? '';
  const canUse = view.isAdmin;
  const docs = useMemo(
    () =>
      canUse && meId
        ? materialiseCompanyDocs(mirror, queue, {
            groupId,
            currency: view.currency,
            viewerMemberId: meId,
          })
        : [],
    [mirror, queue, groupId, canUse, meId, view.currency],
  );
  return { docs, canUse, currency: view.currency, companyName: view.name, ready: view.ready };
}

/** Bills not fully paid, for the Pending screen: the count, the amount still due and the list. */
export function useUnpaidBills(groupId: string) {
  const { docs } = useCompanyDocs(groupId);
  return useMemo(() => {
    const list = unpaidBills(docs);
    return { count: list.length, dueMinor: unpaidBillsTotal(docs), bills: list };
  }, [docs]);
}

export interface DocFormValues {
  readonly docType: CompanyDocType;
  readonly customerName: string;
  readonly customerPhone: string;
  readonly docDate: string;
  readonly items: readonly DocItemInput[];
  readonly discountMinor: bigint;
  readonly notes: string;
}

export function docSavePayload(docId: string, v: DocFormValues): CompanyDocSavePayload {
  return {
    docId,
    data: {
      docType: v.docType,
      customerName: v.customerName.trim(),
      customerPhone: v.customerPhone.trim() || null,
      docDate: v.docDate,
      items: v.items.map((i) => ({
        description: i.description.trim(),
        qtyMilli: i.qtyMilli.toString(),
        rateMinor: i.rateMinor.toString(),
      })),
      discountMinor: v.discountMinor.toString(),
      notes: v.notes.trim() || null,
    },
  };
}

/** Create (no id) or edit (id) a document. Validate with `validateDoc` first; the server re-checks. */
export function useSaveCompanyDoc(groupId: string) {
  const { mutate } = useSync();
  return useMutation({
    mutationFn: async (input: { docId?: string; values: DocFormValues }) => {
      const docId = input.docId ?? randomUUID();
      await mutate(MutationKind.CompanyDocSave, groupId, {
        ...docSavePayload(docId, input.values),
      });
      return docId;
    },
  });
}

export function useSetEstimateStatus(groupId: string) {
  const { mutate } = useSync();
  return useMutation({
    mutationFn: (input: { docId: string; status: 'draft' | 'sent' | 'accepted' | 'declined' }) =>
      mutate(MutationKind.CompanyDocStatus, groupId, { ...input }),
  });
}

/** Copies an estimate into a new bill; resolves to the bill's id. */
export function useConvertToBill(groupId: string) {
  const { mutate } = useSync();
  return useMutation({
    mutationFn: async (input: { docId: string }) => {
      const billId = randomUUID();
      await mutate(MutationKind.CompanyDocConvert, groupId, { docId: input.docId, billId });
      return billId;
    },
  });
}

/** "Record payment": a payment received against a bill. Check `validatePayment` first. */
export function useRecordDocPayment(groupId: string) {
  const { mutate } = useSync();
  return useMutation({
    mutationFn: (input: { docId: string; amountMinor: bigint; paidOn: string }) =>
      mutate(MutationKind.CompanyDocPayment, groupId, {
        docId: input.docId,
        paymentId: randomUUID(),
        amountMinor: input.amountMinor.toString(),
        paidOn: input.paidOn,
      }),
  });
}

export function useVoidCompanyDoc(groupId: string) {
  const { mutate } = useSync();
  return useMutation({
    mutationFn: (input: { docId: string }) =>
      mutate(MutationKind.CompanyDocVoid, groupId, { ...input }),
  });
}
