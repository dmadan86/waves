'use client';

/** Add a bill (or, for a vendor's own login, submit one for confirmation). */
import { useRef, useState } from 'react';
import { MutationKind, parseMajor, type CurrencyCode } from '@waves/core';

import { useStrings } from '@/i18n-context';
import { friendlyError } from '@/lib/errors';
import { useAction } from '@/lib/company/useVendors';
import { useSync } from '@/lib/sync';
import { todayIso, validIsoDate, vendorEntryCreatePayload } from '@/lib/company/vendors';
import { Field, PhotoPicker, uploadLinePhotos } from './parts';

export function amountMinor(text: string, currency: string): bigint {
  try {
    return parseMajor(text, currency as CurrencyCode).minor;
  } catch {
    return 0n;
  }
}

export function LineForm({
  groupId,
  vendorId,
  currency,
  submitted = false,
  onClose,
}: {
  groupId: string;
  vendorId: string;
  currency: string;
  submitted?: boolean;
  onClose: () => void;
}) {
  const { t } = useStrings();
  const s = t.company.vendors;
  const { mutate, refresh } = useSync();
  const action = useAction();
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayIso());
  const [dueOn, setDueOn] = useState('');
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  // One id per form, so a double click or a retry is the same request to the server.
  const entryId = useRef(crypto.randomUUID()).current;
  const minor = amountMinor(amount, currency);
  const valid = minor > 0n && validIsoDate(date) && (!dueOn || validIsoDate(dueOn));
  const [photoError, setPhotoError] = useState<string | null>(null);

  const submit = () =>
    void action.run(
      async () => {
        await mutate(
          MutationKind.CompanyVendorEntryCreate,
          groupId,
          vendorEntryCreatePayload({
            entryId,
            vendorId,
            kind: 'bill',
            amountMinor: minor,
            occurredOn: date,
            note,
            dueOn,
          }),
        );
        if (files.length) {
          const failed = await uploadLinePhotos(groupId, entryId, files, refresh, s.uploadFailed);
          if (failed) {
            setPhotoError(failed);
            return;
          }
        }
        onClose();
      },
      (e) => friendlyError(e, 'web.vendors.bill.add', { fallback: s.failed }),
    );

  return (
    <div className="panel">
      <h2>{s.addBill}</h2>
      {submitted ? <p className="sub">{s.billHint}</p> : null}
      <Field
        label={s.amount}
        value={amount}
        onChange={setAmount}
        inputMode="decimal"
        maxLength={16}
      />
      <Field label={`${s.date} (${s.dateHint})`} value={date} onChange={setDate} maxLength={10} />
      {!validIsoDate(date) ? <p className="error">{s.invalidDate}</p> : null}
      <Field
        label={`${s.dueDate} (${s.dateHint})`}
        value={dueOn}
        onChange={setDueOn}
        maxLength={10}
      />
      <Field label={s.note} value={note} onChange={setNote} maxLength={500} />
      <PhotoPicker files={files} setFiles={setFiles} />
      {(action.error ?? photoError) ? <p className="error">{action.error ?? photoError}</p> : null}
      <div className="row-field">
        <button
          type="button"
          className="btn brand"
          disabled={!valid || action.busy}
          onClick={submit}
        >
          {s.addBill}
        </button>
        <button type="button" className="btn soft" onClick={onClose}>
          {s.close}
        </button>
      </div>
    </div>
  );
}
