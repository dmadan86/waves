'use client';

/** Small pieces the vendor screens share: formatting, labels, status chip, photos, back link. */
import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Trash2 } from 'lucide-react';

import { materialiseCompanyEntryAttachments, type VendorOrder } from '@waves/core';

import { useStrings } from '@/i18n-context';
import { friendlyError } from '@/lib/errors';
import {
  attachVendorPhoto,
  MAX_VENDOR_PHOTOS,
  removeVendorPhoto,
  StorageCapError,
  useAction,
} from '@/lib/company/useVendors';
import { useSync } from '@/lib/sync';
import { money } from '@/lib/money';
import { waves } from '@/lib/waves';

/** The flat string labels of company.vendors (the print renderers take a plain map). */
export const labelsOf = (s: object): Record<string, string> =>
  Object.fromEntries(Object.entries(s).filter(([, v]) => typeof v === 'string')) as Record<
    string,
    string
  >;

export function useVendorFormat(currency: string) {
  const { locale, t } = useStrings();
  const s = t.company.vendors;
  return {
    s,
    money: (minor: bigint) => money(minor, currency, locale),
    date: (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(locale),
    methods: { upi: s.mUpi, bank: s.mBank, cash: s.mCash, other: s.mOther } as Record<
      string,
      string
    >,
    units: {
      bags: s.unitBags,
      pieces: s.unitPieces,
      kg: s.unitKg,
      litres: s.unitLitres,
      metres: s.unitMetres,
      other: s.unitOther,
    } as Record<string, string>,
    orderStatus: {
      sent: s.ordSent,
      accepted: s.ordAccepted,
      rejected: s.ordRejected,
      delivered: s.ordDelivered,
      cancelled: s.ordCancelled,
    } as Record<string, string>,
  };
}

export function Pill({ children, tone }: { children: ReactNode; tone?: 'good' | 'bad' | 'warn' }) {
  const color =
    tone === 'good'
      ? '#17703C'
      : tone === 'bad'
        ? '#C0262D'
        : tone === 'warn'
          ? '#A85F00'
          : undefined;
  return (
    <span className="chip" style={color ? { color } : undefined}>
      {children}
    </span>
  );
}

export function OrderStatusChip({ order }: { order: Pick<VendorOrder, 'status' | 'pending'> }) {
  const { t } = useStrings();
  const f = useVendorFormat('INR');
  if (order.pending) return <Pill>{t.company.vendors.pending}</Pill>;
  const tone =
    order.status === 'delivered'
      ? 'good'
      : order.status === 'rejected' || order.status === 'cancelled'
        ? 'bad'
        : order.status === 'sent'
          ? 'warn'
          : undefined;
  return <Pill tone={tone}>{f.orderStatus[order.status]}</Pill>;
}

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <p>
      <Link href={href}>{children}</Link>
    </p>
  );
}

export function Page({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="app-body">
      <div className="app-main">
        <div className="page-head">
          <h1>{title}</h1>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({
  label,
  value,
  onChange,
  maxLength = 120,
  type = 'text',
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  maxLength?: number;
  type?: string;
  inputMode?: 'decimal' | 'numeric' | 'tel' | 'email';
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input
        type={type}
        inputMode={inputMode}
        value={value}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

/** Files picked in a form, uploaded after the line exists. */
export function PhotoPicker({
  files,
  setFiles,
}: {
  files: File[];
  setFiles: (next: File[]) => void;
}) {
  const { t } = useStrings();
  const s = t.company.vendors;
  return (
    <div className="field">
      <span className="field-label">{s.photos}</span>
      {files.map((file, i) => (
        <div key={i} className="row-field">
          <span className="grow">{file.name}</span>
          <button
            type="button"
            className="btn soft"
            aria-label={s.removePhoto}
            onClick={() => setFiles(files.filter((_, j) => j !== i))}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      {files.length < MAX_VENDOR_PHOTOS ? (
        <input
          type="file"
          accept="image/*"
          multiple
          aria-label={s.choosePhoto}
          onChange={(e) => {
            setFiles([...files, ...Array.from(e.target.files ?? [])].slice(0, MAX_VENDOR_PHOTOS));
            e.target.value = '';
          }}
        />
      ) : null}
    </div>
  );
}

/** Attach picked files to a saved line; stops at the storage cap. Returns an error text, or null. */
export async function uploadLinePhotos(
  groupId: string,
  lineId: string,
  files: File[],
  refresh: () => Promise<void>,
  failed: string,
): Promise<string | null> {
  let error: string | null = null;
  for (const file of files) {
    try {
      await attachVendorPhoto(groupId, lineId, file);
    } catch (caught) {
      error = friendlyError(caught, 'web.vendors.photo.add', { fallback: failed });
      if (caught instanceof StorageCapError) break;
    }
  }
  await refresh().catch(() => undefined);
  return error;
}

/** The photos on one vendor line, with add/remove. Each URL is signed by r2-sign, which re-checks the caller. */
export function VendorPhotos({
  groupId,
  entryId,
  canAdd,
  canRemove,
}: {
  groupId: string;
  entryId: string;
  canAdd: boolean;
  canRemove: (uploaderMemberId: string) => boolean;
}) {
  const { t } = useStrings();
  const s = t.company.vendors;
  const { mirror, refresh } = useSync();
  const photos = materialiseCompanyEntryAttachments(mirror, { entryId });
  const [urls, setUrls] = useState<Record<string, string | null>>({});
  const action = useAction();
  const wanted = photos.map((p) => p.storage_path).join('|');

  useEffect(() => {
    let active = true;
    for (const path of wanted ? wanted.split('|') : []) {
      void waves.restrictedImageUrl('company-entry-images', entryId, path).then((url) => {
        if (active) setUrls((prev) => ({ ...prev, [path]: url }));
      });
    }
    return () => {
      active = false;
    };
  }, [entryId, wanted]);

  if (photos.length === 0 && !canAdd) return null;
  return (
    <div>
      {photos.map((photo) => {
        const url = urls[photo.storage_path] ?? photo.preview ?? null;
        return (
          <span key={photo.id} style={{ display: 'inline-block', marginInlineEnd: 8 }}>
            {url ? (
              <a href={url} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={s.photos}
                  width={64}
                  height={64}
                  style={{ objectFit: 'cover' }}
                />
              </a>
            ) : (
              <span className="faint">{s.photos}</span>
            )}
            {canRemove(photo.uploader_member_id) ? (
              <button
                type="button"
                className="btn soft"
                aria-label={s.removePhoto}
                disabled={action.busy}
                onClick={() =>
                  void action.run(
                    async () => {
                      await removeVendorPhoto(photo.id);
                      await refresh();
                    },
                    (e) =>
                      friendlyError(e, 'web.vendors.photo.remove', { fallback: s.uploadFailed }),
                  )
                }
              >
                <Trash2 size={14} />
              </button>
            ) : null}
          </span>
        );
      })}
      {canAdd && photos.length < MAX_VENDOR_PHOTOS ? (
        <input
          type="file"
          accept="image/*"
          aria-label={s.choosePhoto}
          disabled={action.busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            void action.run(
              async () => {
                await attachVendorPhoto(groupId, entryId, file);
                await refresh();
              },
              (caught) =>
                friendlyError(caught, 'web.vendors.photo.add', { fallback: s.uploadFailed }),
            );
          }}
        />
      ) : null}
      {action.error ? <p className="error">{action.error}</p> : null}
    </div>
  );
}
