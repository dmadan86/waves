'use client';

/** Record a payment (or an advance) against a vendor. It records; it never sends money. */
import { useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

import {
  MutationKind,
  money as coreMoney,
  paymentOutcome,
  toMajorString,
  vendorOverdue,
  type CurrencyCode,
  type VendorPayMethod,
} from '@waves/core';

import { CompanyFrame } from '@/components/CompanyFrame';
import { useStrings } from '@/i18n-context';
import { fill } from '@/i18n';
import { friendlyError } from '@/lib/errors';
import { useAction, useVendorsData } from '@/lib/company/useVendors';
import { todayIso, validIsoDate, vendorEntryCreatePayload } from '@/lib/company/vendors';
import { amountMinor } from '../../_components/LineForm';
import {
  BackLink,
  Field,
  Page,
  PhotoPicker,
  Pill,
  uploadLinePhotos,
  useVendorFormat,
} from '../../_components/parts';

export default function RecordPaymentPage() {
  const { groupId, vendorId } = useParams<{ groupId: string; vendorId: string }>();
  return (
    <CompanyFrame groupId={groupId}>
      <Inner groupId={groupId} vendorId={vendorId} />
    </CompanyFrame>
  );
}

function Inner({ groupId, vendorId }: { groupId: string; vendorId: string }) {
  const { t } = useStrings();
  const s = t.company.vendors;
  const router = useRouter();
  const d = useVendorsData(groupId);
  const f = useVendorFormat(d.vendors.currency);
  const action = useAction();
  const [amount, setAmount] = useState('');
  const [kind, setKind] = useState<'payment' | 'advance'>('payment');
  const [method, setMethod] = useState<VendorPayMethod>('upi');
  const [date, setDate] = useState(todayIso());
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  // One id per form, so a double click or a retry is the same request to the server.
  const entryId = useRef(crypto.randomUUID()).current;
  const back = `/c/${groupId}/vendors/${vendorId}`;
  const vendor = d.vendors.vendors.find((v) => v.id === vendorId);
  const lines = d.vendors.lines.filter((l) => l.vendorId === vendorId);
  const balance = d.vendors.balances.get(vendorId) ?? 0n;
  const overdue = vendorOverdue(lines, todayIso());
  const minor = amountMinor(amount, d.vendors.currency);
  const out = paymentOutcome(balance, minor);
  const valid = minor > 0n && validIsoDate(date) && !!vendor && d.canManage;
  const [done, setDone] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const submit = () => {
    if (!valid || action.busy || done) return;
    let photoFailed = false;
    void action
      .run(
        async () => {
          await d.mutate(
            MutationKind.CompanyVendorEntryCreate,
            groupId,
            vendorEntryCreatePayload({
              entryId,
              vendorId,
              kind,
              amountMinor: minor,
              occurredOn: date,
              note,
              method: kind === 'payment' ? method : null,
              reference: kind === 'payment' ? reference : null,
            }),
          );
          setDone(true);
          // The payment is saved; if a photo fails, stay here so the error is seen (`done` locks the form).
          if (files.length) {
            const failed = await uploadLinePhotos(
              groupId,
              entryId,
              files,
              d.refresh,
              s.uploadFailed,
            );
            if (failed) {
              setPhotoError(failed);
              photoFailed = true;
            }
          }
        },
        (e) => friendlyError(e, 'web.vendors.pay', { fallback: s.failed }),
      )
      .then(
        (ok) =>
          ok &&
          !photoFailed &&
          router.replace(kind === 'payment' ? `${back}/receipt/${entryId}` : back),
      );
  };

  return (
    <Page title={s.recordPayment}>
      <BackLink href={back}>{vendor?.name ?? s.vendorTitle}</BackLink>
      {!d.canManage ? <p className="faint">{t.company.common.suspended}</p> : null}
      <div className="panel">
        <p>
          <strong>{vendor?.name ?? s.notFound}</strong>
        </p>
        <p className="faint">{`${s.currentOutstanding}: ${f.money(balance < 0n ? -balance : balance)}`}</p>
        <div className="row-field">
          {(['payment', 'advance'] as const).map((k) => (
            <button
              key={k}
              type="button"
              className={kind === k ? 'btn brand' : 'btn soft'}
              onClick={() => setKind(k)}
            >
              {s[k]}
            </button>
          ))}
        </div>
        <Field
          label={s.amountLabel}
          value={amount}
          onChange={setAmount}
          inputMode="decimal"
          maxLength={16}
        />
        <p>
          {balance > 0n ? (
            <button
              type="button"
              className="btn soft"
              onClick={() => setAmount(minorToText(balance, d.vendors.currency))}
            >
              {fill(s.quickFull, { amount: f.money(balance) })}
            </button>
          ) : null}{' '}
          {overdue > 0n ? (
            <button
              type="button"
              className="btn soft"
              onClick={() => setAmount(minorToText(overdue, d.vendors.currency))}
            >
              {fill(s.quickOverdue, { amount: f.money(overdue) })}
            </button>
          ) : null}
        </p>
        {minor > 0n ? (
          <p>
            <strong>
              {fill(s.stillToPay, { amount: f.money(out.remaining > 0n ? out.remaining : 0n) })}
            </strong>{' '}
            {out.advance > 0n ? (
              <Pill tone="warn">{fill(s.keptAsAdvance, { amount: f.money(out.advance) })}</Pill>
            ) : null}
          </p>
        ) : null}
      </div>
      <div className="panel">
        {kind === 'payment' ? (
          <div className="field">
            <span className="field-label">{s.paidBy}</span>
            <div className="row-field">
              {(['upi', 'bank', 'cash', 'other'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={method === m ? 'btn brand' : 'btn soft'}
                  onClick={() => setMethod(m)}
                >
                  {f.methods[m]}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <Field label={`${s.date} (${s.dateHint})`} value={date} onChange={setDate} maxLength={10} />
        {kind === 'payment' ? (
          <Field label={s.reference} value={reference} onChange={setReference} maxLength={64} />
        ) : null}
        <Field label={s.note} value={note} onChange={setNote} maxLength={500} />
        <PhotoPicker files={files} setFiles={setFiles} />
      </div>
      <p className="faint">{s.recordsNote}</p>
      {(action.error ?? photoError) ? <p className="error">{action.error ?? photoError}</p> : null}
      <button
        type="button"
        className="btn brand"
        disabled={!valid || action.busy || done}
        onClick={submit}
      >
        {s.recordPayment}
      </button>
    </Page>
  );
}

/** Minor units as the plain major-unit text the amount field takes ("1250.50"). */
function minorToText(minor: bigint, currency: string): string {
  return toMajorString(coreMoney(minor, currency as CurrencyCode));
}
