'use client';

/** Hooks over the vendor ports: the viewer's vendors, orders and cards from the sync mirror, and the photo RPCs. */
import { useCallback, useMemo, useState } from 'react';

import { useCompanyView } from '@/lib/company/view';
import { deriveCompanyCard, deriveVendorCard } from '@/lib/company/details';
import { accessOf } from '@/lib/company/vendorAccess';
import { deriveOrders } from '@/lib/company/vendorOrders';
import { deriveVendors } from '@/lib/company/vendors';
import { useSync } from '@/lib/sync';
import { putImage, StorageCapError } from '@/lib/upload';
import { supabase } from '@/lib/waves';

export function useVendorsData(groupId: string) {
  const { mirror, mutate, refresh } = useSync();
  const company = useCompanyView(groupId);
  const { me, isOwner, isManager, isVendor, currency, name, suspended } = company;
  const access = useMemo(
    () => accessOf({ me, isOwner, isManager, isVendor, currency, name, suspended }),
    [me, isOwner, isManager, isVendor, currency, name, suspended],
  );
  const vendors = useMemo(() => deriveVendors(mirror, groupId, access), [mirror, groupId, access]);
  const orders = useMemo(
    () => deriveOrders(mirror, groupId, access, vendors.vendors),
    [mirror, groupId, access, vendors.vendors],
  );
  const companyCard = useMemo(
    () => deriveCompanyCard(mirror, groupId, access),
    [mirror, groupId, access],
  );
  const vendorCard = useCallback(
    (vendorId: string) =>
      deriveVendorCard(
        mirror,
        groupId,
        vendorId,
        access,
        vendors.vendors.some((v) => v.id === vendorId),
      ),
    [mirror, groupId, access, vendors.vendors],
  );
  return {
    mirror,
    mutate,
    refresh,
    company,
    access,
    vendors,
    orders,
    companyCard,
    vendorCard,
    /** Suspended companies are read-only: no add, confirm or remove. */
    canManage: vendors.canManage && !suspended,
    ready: company.ready,
  };
}

/** Run one write: tracks busy and the error text. Resolves true when it landed. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (work: () => Promise<unknown>, onError: (e: unknown) => string) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      return true;
    } catch (caught) {
      setError(onError(caught));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, run, setError };
}

/** Most photos on a vendor line; the server enforces the same limit. */
export const MAX_VENDOR_PHOTOS = 10;

/** A single-use link (30 days) that makes whoever opens it this vendor's own login. Needs a connection. */
export async function createVendorInviteLink(vendorId: string): Promise<string> {
  const { data, error } = await supabase.rpc('waves_company_vendor_invite', {
    p_vendor_id: vendorId,
  });
  if (error) throw new Error(error.message);
  return `${window.location.origin}/join#${data as string}`;
}

/** Upload one picked photo and attach it to a vendor line already on the server. A failed attach frees the bytes. */
export async function attachVendorPhoto(
  groupId: string,
  entryId: string,
  file: File,
): Promise<void> {
  const attachmentId = crypto.randomUUID();
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const path = `${entryId}/${attachmentId}/${crypto.randomUUID()}.${ext}`;
  await putImage({
    bucket: 'company-entry-images',
    path,
    body: file,
    contentType: file.type || 'image/jpeg',
    groupId,
    subjectId: entryId,
  });
  const { error } = await supabase.rpc('waves_attach_company_vendor_entry_image', {
    p_entry_id: entryId,
    p_storage_path: path,
    p_attachment_id: attachmentId,
    p_preview: null,
  });
  if (error) {
    await supabase.functions
      .invoke('r2-sign', {
        body: { action: 'delete', bucket: 'company-entry-images', path, subjectId: entryId },
      })
      .catch(() => undefined);
    throw new Error(error.message);
  }
}

export async function removeVendorPhoto(photoId: string): Promise<void> {
  const { error } = await supabase.rpc('waves_remove_company_vendor_entry_image', {
    p_attachment_id: photoId,
  });
  if (error) throw new Error(error.message);
}

export { StorageCapError };
