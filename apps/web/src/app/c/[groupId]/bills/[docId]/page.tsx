'use client';

import { Suspense, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { QRCodeCanvas, QRCodeSVG } from 'qrcode.react';

import {
  billDueMinor,
  billUpiLink,
  computeDocTotals,
  docNumberLabel,
  formatMinorInput,
  formatQty,
  lineAmount,
  materialiseClients,
  materialiseCompanyCard,
  MutationKind,
  parseMinorInput,
  validatePayment,
  type CurrencyCode,
} from '@waves/core';

import { CompanyPage, useCompanyText } from '@/components/CompanyPage';
import { fill } from '@/i18n';
import { closingStamp, docTimeline } from '@/lib/company/docTimeline';
import { renderCompanyDocHtml, type CompanyDocPdfOptions } from '@/lib/company/docPdf';
import {
  docConvertPayload,
  docPaymentPayload,
  docStatusPayload,
  docVoidPayload,
  estimateActions,
  type EstimateStatus,
} from '@/lib/company/documents';
import { printHtml } from '@/lib/company/print';
import { useCompanyDocs } from '@/lib/company/useCompanyDocs';
import { memberName, todayIso, useCompanyView } from '@/lib/company/view';
import { NO_QUEUE, useSync } from '@/lib/sync';

export default function CompanyBillPage() {
  return (
    <Suspense fallback={null}>
      <BillPage />
    </Suspense>
  );
}

function BillPage() {
  const { groupId, docId } = useParams<{ groupId: string; docId: string }>();
  const router = useRouter();
  const view = useCompanyDocs(groupId);
  const company = useCompanyView(groupId);
  const { mirror, mutate } = useSync();
  const { t, locale, fmt, err } = useCompanyText(view.currency);
  const c = t.company.docs;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Set by the bill form when the first payment did not come back as saved.
  const search = useSearchParams();
  const unsureText = search.get('payment') === 'failed' ? (search.get('amount') ?? '') : '';
  const unsure = /^\d+$/.test(unsureText) ? BigInt(unsureText) : null;
  const [recording, setRecording] = useState(false);
  const [amountText, setAmountText] = useState('');
  const [paidOn, setPaidOn] = useState(todayIso());
  const [allEvents, setAllEvents] = useState(false);
  const [copied, setCopied] = useState(false);
  const qrRef = useRef<HTMLCanvasElement>(null);
  const currency = view.currency as CurrencyCode;
  const base = `/c/${groupId}/bills`;

  const doc = view.docs.find((d) => d.id === docId && !d.deleted);
  const vpa = useMemo(
    () =>
      materialiseCompanyCard(mirror, NO_QUEUE, {
        groupId,
        myMemberId: company.me?.id ?? null,
        canSeeBank: true,
      })?.values?.upi ?? null,
    [mirror, groupId, company.me?.id],
  );

  if (!view.ready)
    return (
      <CompanyPage groupId={groupId} title={c.title} back={base}>
        <p className="faint">{c.loading}</p>
      </CompanyPage>
    );
  if (!view.canUse || !doc)
    return (
      <CompanyPage groupId={groupId} title={c.title} back={base}>
        <p className="muted">{view.canUse ? c.notFound : c.noAccess}</p>
      </CompanyPage>
    );

  const due = billDueMinor(doc.totalMinor, doc.paidMinor);
  const editable = !doc.convertedTo;
  const readOnly = view.suspended;
  const linked = doc.convertedTo ?? doc.convertedFrom;
  const canPay = doc.docType === 'bill' && due > 0n;
  const upiLink =
    vpa && doc.docType === 'bill'
      ? billUpiLink({
          vpa,
          payeeName: view.companyName,
          totalMinor: doc.totalMinor,
          paidMinor: doc.paidMinor,
          currency: view.currency,
          number: doc.number,
        })
      : null;
  const nameOf = (id: string | null | undefined) =>
    id
      ? memberName(
          company.members.find((m) => m.id === id),
          '',
        )
      : '';
  const day = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(locale);
  const stamp = (at: string, dayOnly?: boolean) =>
    dayOnly ? day(at) : new Date(at).toLocaleString(locale);
  const closed = closingStamp(doc);
  const events = docTimeline(doc);
  const shownEvents = allEvents ? events : events.slice(0, 3);

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (caught) {
      setError(err(caught, 'docs.action'));
    } finally {
      setBusy(false);
    }
  };

  const setStatus = (s: EstimateStatus) =>
    run(async () => {
      await mutate(MutationKind.CompanyDocStatus, groupId, { ...docStatusPayload(doc.id, s) });
      // Sending a quote moves an inquiry-stage client to "quoted", like the phone.
      const client = materialiseClients(mirror, NO_QUEUE, { groupId }).clients.find(
        (x) => x.id === doc.clientId,
      );
      if (
        s === 'sent' &&
        client?.stage === 'inquiry' &&
        (view.isOwner || client.ownerMemberId === company.me?.id)
      )
        await mutate(MutationKind.CompanyClientSet, groupId, {
          clientId: client.id,
          name: client.name,
          phone: client.phone,
          need: client.need,
          source: client.source,
          expectedValueMinor: client.expectedValueMinor?.toString() ?? null,
          address: client.address,
          ownerMemberId: client.ownerMemberId,
          stage: 'quoted',
          lostReason: null,
        });
    });

  const convert = () =>
    run(async () => {
      const billId = crypto.randomUUID();
      await mutate(MutationKind.CompanyDocConvert, groupId, {
        ...docConvertPayload(doc.id, billId),
      });
      router.replace(`${base}/${billId}`);
    });

  const remove = () =>
    run(async () => {
      if (!window.confirm(`${c.deleteTitle}\n${c.deleteBody}`)) return;
      await mutate(MutationKind.CompanyDocVoid, groupId, { ...docVoidPayload(doc.id) });
      router.replace(base);
    });

  const record = () =>
    run(async () => {
      let amount = 0n;
      try {
        amount = parseMinorInput(amountText, currency);
      } catch {
        // validatePayment reports a non-positive amount
      }
      const code = validatePayment(doc.totalMinor, doc.paidMinor, amount);
      if (code) return setError(c[`${code}Error` as keyof typeof c] as string);
      await mutate(MutationKind.CompanyDocPayment, groupId, {
        ...docPaymentPayload(doc.id, crypto.randomUUID(), amount, paidOn),
      });
      setRecording(false);
      setAmountText('');
      if (unsure !== null) router.replace(`${base}/${doc.id}`);
    });

  const print = () => {
    const options: CompanyDocPdfOptions = {
      companyName: view.companyName,
      logoUrl: null,
      labels: c,
      formatMoney: fmt,
      formatDate: day,
    };
    const png = upiLink && vpa ? qrRef.current?.toDataURL('image/png') : null;
    printHtml(
      renderCompanyDocHtml(
        doc,
        png && vpa
          ? {
              ...options,
              upi: { id: vpa, qrDataUrl: png, scanLabel: fill(c.upiScan, { amount: fmt(due) }) },
            }
          : options,
      ),
    );
  };

  return (
    <CompanyPage
      groupId={groupId}
      title={`${c[doc.docType]} ${docNumberLabel(doc.docType, doc.number)}`}
      back={base}
    >
      <section className="panel">
        <h2>{doc.customerName}</h2>
        {doc.customerPhone ? <a href={`tel:${doc.customerPhone}`}>{doc.customerPhone}</a> : null}
        <p className="muted">{day(doc.docDate)}</p>
        <p>
          <b>{doc.number === null ? c.syncing : c[doc.status]}</b>
        </p>
        {doc.createdAt ? (
          <p className="faint">
            {c.createdBy}: {nameOf(doc.createdBy)} · {stamp(doc.createdAt)}
          </p>
        ) : null}
        {closed ? (
          <p className="faint">
            {c[closed.kind]}: {nameOf(closed.by)} · {stamp(closed.at)}
          </p>
        ) : null}
      </section>

      <section className="panel">
        <h2>{fill(c.itemsCount, { n: doc.items.length })}</h2>
        {doc.items.map((i, n) => (
          <div key={n} className="row">
            <span>
              <b>{i.description}</b>
              <br />
              <span className="faint">{`${formatQty(i.qtyMilli)} × ${fmt(i.rateMinor)}`}</span>
            </span>
            <span className="row-right">{fmt(lineAmount(i))}</span>
          </div>
        ))}
        <div className="row">
          <span>{c.subtotal}</span>
          <span className="row-right">
            {fmt(computeDocTotals(doc.items, doc.discountMinor).subtotalMinor)}
          </span>
        </div>
        <div className="row">
          <span>{c.discount}</span>
          <span className="row-right">{fmt(doc.discountMinor)}</span>
        </div>
        <div className="row">
          <b>{c.total}</b>
          <b className="row-right">{fmt(doc.totalMinor)}</b>
        </div>
        {doc.docType === 'bill' ? (
          <>
            <div className="row">
              <span>{c.payments}</span>
              <span className="row-right">{fmt(doc.paidMinor)}</span>
            </div>
            <div className="row">
              <span>{c.amountLeft}</span>
              <span className="row-right">{fmt(due)}</span>
            </div>
          </>
        ) : null}
      </section>

      {doc.notes ? (
        <section className="panel">
          <p style={{ whiteSpace: 'pre-wrap' }}>{doc.notes}</p>
        </section>
      ) : null}

      {!readOnly ? (
        <section className="panel">
          <h2>{c.nextAction}</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {estimateActions(doc).map((s) => (
              <button
                key={s}
                type="button"
                className="btn soft"
                disabled={busy}
                onClick={() => void setStatus(s)}
              >
                {s === 'sent' ? c.markSent : c[s]}
              </button>
            ))}
            {doc.docType === 'estimate' && !doc.convertedTo ? (
              <button
                type="button"
                className="btn soft"
                disabled={busy}
                onClick={() => void convert()}
              >
                {c.convert}
              </button>
            ) : null}
            {canPay ? (
              <button
                type="button"
                className="btn brand"
                disabled={busy}
                onClick={() => {
                  setError('');
                  setAmountText(formatMinorInput(unsure ?? due, currency));
                  setRecording(true);
                }}
              >
                {c.recordPayment}
              </button>
            ) : null}
            {linked ? (
              <Link className="btn soft" href={`${base}/${linked}`}>
                {doc.convertedTo ? c.linkedBill : c.linkedEstimate}
              </Link>
            ) : null}
          </div>
          {recording ? (
            <div style={{ marginTop: 12 }}>
              <label className="field">
                <span className="field-label">{c.amountField}</span>
                <input
                  value={amountText}
                  onChange={(e) => setAmountText(e.target.value)}
                  inputMode="decimal"
                />
              </label>
              <label className="field">
                <span className="field-label">{c.paymentDate}</span>
                <input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
              </label>
              <button
                type="button"
                className="btn brand"
                disabled={busy}
                onClick={() => void record()}
              >
                {c.recordPayment}
              </button>{' '}
              <button type="button" className="btn soft" onClick={() => setRecording(false)}>
                {c.cancel}
              </button>
            </div>
          ) : null}
        </section>
      ) : (
        <p className="muted">{c.readOnly}</p>
      )}

      {upiLink && vpa && due > 0n ? (
        <section className="panel">
          <h2>{c.upiTitle}</h2>
          <QRCodeSVG value={upiLink} size={160} />
          <div style={{ display: 'none' }}>
            <QRCodeCanvas ref={qrRef} value={upiLink} size={280} />
          </div>
          <p>{fill(c.upiScan, { amount: fmt(due) })}</p>
          <p className="faint">{vpa}</p>
          <button
            type="button"
            className="btn soft"
            onClick={() => {
              void navigator.clipboard.writeText(upiLink).then(() => setCopied(true));
            }}
          >
            {copied ? c.upiCopied : c.upiCopy}
          </button>
        </section>
      ) : canPay && view.isOwner && view.currency === 'INR' ? (
        <p className="faint">{c.upiNeed}</p>
      ) : null}

      {unsure !== null ? (
        <p className="error" role="alert">
          {fill(c.paymentNotRecorded, { amount: fmt(unsure) })}
        </p>
      ) : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button type="button" className="btn soft" onClick={print}>
          {c.print}
        </button>
        {!readOnly ? (
          <Link className="btn soft" href={`${base}/new?copyFrom=${doc.id}`}>
            {c.duplicate}
          </Link>
        ) : null}
        {!readOnly && editable ? (
          <Link className="btn soft" href={`${base}/${doc.id}/edit`}>
            {c.edit}
          </Link>
        ) : null}
        {!readOnly && doc.paidMinor === 0n && !doc.convertedTo ? (
          <button type="button" className="btn soft" disabled={busy} onClick={() => void remove()}>
            {c.delete}
          </button>
        ) : null}
      </div>

      <section className="panel">
        <h2>{c.activity}</h2>
        {shownEvents.map((e, n) => (
          <div key={n} className="row">
            <span>
              {e.kind === 'payment' ? c.paymentEvt : c[e.kind]}
              {e.by ? ` · ${nameOf(e.by)}` : ''}
              <br />
              <span className="faint">{stamp(e.at, e.dayOnly)}</span>
            </span>
            {e.amountMinor !== undefined ? (
              <span className="row-right">{fmt(e.amountMinor)}</span>
            ) : null}
          </div>
        ))}
        {events.length > 3 ? (
          <button type="button" className="btn soft" onClick={() => setAllEvents(!allEvents)}>
            {allEvents ? c.showLess : c.viewAll}
          </button>
        ) : null}
      </section>
    </CompanyPage>
  );
}
