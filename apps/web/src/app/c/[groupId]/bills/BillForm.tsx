'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import {
  computeDocTotals,
  docNumberLabel,
  formatMinorInput,
  formatQty,
  materialiseClients,
  MutationKind,
  parseMinorInput,
  parseQtyMilli,
  validateDoc,
  type CurrencyCode,
} from '@waves/core';

import { CompanyPage, useCompanyText } from '@/components/CompanyPage';
import { decideBillPayment, type BillPayChoice } from '@/lib/company/billPayment';
import { percentToMinor } from '@/lib/company/discount';
import {
  docPaymentPayload,
  docSavePayload,
  docStatusPayload,
  type DocFormValues,
  type EstimateStatus,
} from '@/lib/company/documents';
import { renderCompanyDocHtml } from '@/lib/company/docPdf';
import { printHtml } from '@/lib/company/print';
import { useCompanyDocs } from '@/lib/company/useCompanyDocs';
import { NO_QUEUE, useSync } from '@/lib/sync';
import { todayIso } from '@/lib/company/view';

interface Line {
  key: number;
  description: string;
  qty: string;
  rate: string;
}

/** New (type), edit (docId) or duplicate (copyFrom) an estimate or bill. */
export function BillForm({
  groupId,
  docId,
  copyFrom,
  type,
  clientId,
  inquiryId,
}: {
  groupId: string;
  docId?: string;
  copyFrom?: string;
  type?: string | null;
  clientId?: string | null;
  inquiryId?: string | null;
}) {
  const view = useCompanyDocs(groupId);
  const { t } = useCompanyText(view.currency);
  const c = t.company.docs;
  const doc = view.docs.find((d) => d.id === docId && !d.deleted);
  const copy = view.docs.find((d) => d.id === copyFrom && !d.deleted);
  const back = `/c/${groupId}/bills`;

  if (!view.ready)
    return (
      <CompanyPage groupId={groupId} title={c.title} back={back}>
        <p className="faint">{c.loading}</p>
      </CompanyPage>
    );
  if (!view.canUse || view.suspended || (docId && !doc) || (copyFrom && !copy) || doc?.convertedTo)
    return (
      <CompanyPage groupId={groupId} title={c.title} back={back}>
        <p className="muted">
          {!view.canUse ? c.noAccess : view.suspended ? c.readOnly : c.notFound}
        </p>
      </CompanyPage>
    );
  return (
    <Form
      key={doc?.id ?? 'new'}
      groupId={groupId}
      doc={doc}
      seed={doc ?? copy}
      type={type}
      clientId={clientId}
      inquiryId={inquiryId}
    />
  );
}

function Form({
  groupId,
  doc,
  seed,
  type,
  clientId,
  inquiryId,
}: {
  groupId: string;
  doc?: ReturnType<typeof useCompanyDocs>['docs'][number];
  seed?: ReturnType<typeof useCompanyDocs>['docs'][number];
  type?: string | null;
  clientId?: string | null;
  inquiryId?: string | null;
}) {
  const router = useRouter();
  const view = useCompanyDocs(groupId);
  const { mirror, mutate } = useSync();
  const { t, locale, fmt, err } = useCompanyText(view.currency);
  const c = t.company.docs;
  const currency = view.currency as CurrencyCode;
  const clients = useMemo(
    () => materialiseClients(mirror, NO_QUEUE, { groupId }).clients,
    [mirror, groupId],
  );
  const client = clients.find((x) => x.id === clientId);

  const [docType, setDocType] = useState<'bill' | 'estimate'>(
    seed?.docType ?? (type === 'bill' ? 'bill' : 'estimate'),
  );
  const [linkedClient, setLinkedClient] = useState<string>(client?.id ?? seed?.clientId ?? '');
  const [name, setName] = useState(seed?.customerName ?? client?.name ?? '');
  const [phone, setPhone] = useState(seed?.customerPhone ?? client?.phone ?? '');
  const [date, setDate] = useState(doc?.docDate ?? todayIso());
  const [notes, setNotes] = useState(seed?.notes ?? '');
  const [status, setStatus] = useState<EstimateStatus>((doc?.status as EstimateStatus) ?? 'draft');
  const [pctMode, setPctMode] = useState(false);
  const [pct, setPct] = useState('');
  const [discountText, setDiscountText] = useState(
    seed ? formatMinorInput(seed.discountMinor, currency) : '',
  );
  const [lines, setLines] = useState<Line[]>(
    seed?.items.length
      ? seed.items.map((i, key) => ({
          key,
          description: i.description,
          qty: formatQty(i.qtyMilli),
          rate: formatMinorInput(i.rateMinor, currency),
        }))
      : [{ key: 0, description: '', qty: '1', rate: '' }],
  );
  const [payChoice, setPayChoice] = useState<BillPayChoice>('unpaid');
  const [partText, setPartText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const safeMinor = (text: string): bigint => {
    try {
      return text.trim() ? parseMinorInput(text, currency) : 0n;
    } catch {
      return 0n;
    }
  };
  // A typo in an amount must stop the save, not quietly become zero.
  const unreadable = (text: string): boolean => {
    try {
      return text.trim() !== '' && parseMinorInput(text, currency) < 0n;
    } catch {
      return true;
    }
  };
  const parsed = lines.map((l) => ({
    description: l.description,
    qtyMilli: parseQtyMilli(l.qty) ?? 0n,
    rateMinor: safeMinor(l.rate),
  }));
  const subtotal = computeDocTotals(parsed, 0n).subtotalMinor;
  const discount = pctMode ? percentToMinor(subtotal, pct) : safeMinor(discountText);
  const totals = computeDocTotals(parsed, discount);

  const patch = (key: number, p: Partial<Line>) =>
    setLines(lines.map((l) => (l.key === key ? { ...l, ...p } : l)));

  const values = (): DocFormValues => ({
    docType,
    customerName: name,
    customerPhone: phone,
    docDate: date,
    items: parsed,
    discountMinor: discount,
    notes,
    // A link is only set on a new document; an edit keeps the saved one.
    ...(doc || !linkedClient ? {} : { clientId: linkedClient }),
    ...(doc || !inquiryId || linkedClient !== clientId ? {} : { inquiryId }),
  });

  const submit = async () => {
    if (busy) return;
    const v = values();
    if (lines.some((l) => unreadable(l.rate))) return setError(c.itemError);
    if (!pctMode && unreadable(discountText)) return setError(c.discountError);
    const code = validateDoc(v, doc?.paidMinor ?? 0n);
    if (code) return setError(c[`${code}Error` as keyof typeof c] as string);
    const owed =
      !doc && docType === 'bill'
        ? decideBillPayment(payChoice, totals.totalMinor, safeMinor(partText))
        : null;
    if (typeof owed === 'string') return setError(c[`${owed}Error` as keyof typeof c] as string);
    setError('');
    setBusy(true);
    try {
      const id = doc?.id ?? crypto.randomUUID();
      await mutate(MutationKind.CompanyDocSave, groupId, { ...docSavePayload(id, v) });
      if (doc && docType === 'estimate' && status !== doc.status)
        await mutate(MutationKind.CompanyDocStatus, groupId, { ...docStatusPayload(id, status) });
      if (owed !== null)
        await mutate(MutationKind.CompanyDocPayment, groupId, {
          ...docPaymentPayload(id, crypto.randomUUID(), owed, todayIso()),
        }).catch(() => undefined);
      router.replace(`/c/${groupId}/bills/${id}`);
    } catch (caught) {
      setError(err(caught, 'docs.save'));
      setBusy(false);
    }
  };

  const preview = () => {
    if (!doc) return;
    printHtml(
      renderCompanyDocHtml(
        {
          ...doc,
          customerName: name.trim(),
          customerPhone: phone.trim() || null,
          docDate: date,
          items: parsed.map((i, n) => ({ ...i, amountMinor: totals.lines[n]! })),
          discountMinor: discount,
          totalMinor: totals.totalMinor,
          notes: notes.trim() || null,
        },
        {
          companyName: view.companyName,
          logoUrl: null,
          labels: c,
          formatMoney: fmt,
          formatDate: (d) => new Date(`${d}T00:00:00`).toLocaleDateString(locale),
        },
      ),
    );
  };

  const title = doc
    ? `${docType === 'bill' ? c.editBill : c.editEstimate} ${docNumberLabel(doc.docType, doc.number)}`
    : docType === 'bill'
      ? c.newBill
      : c.newEstimate;

  return (
    <CompanyPage
      groupId={groupId}
      title={title}
      back={doc ? `/c/${groupId}/bills/${doc.id}` : `/c/${groupId}/bills`}
    >
      <section className="panel">
        {!doc ? (
          <div role="group" aria-label={c.typeLabel} style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className={docType === 'bill' ? 'btn brand' : 'btn soft'}
              onClick={() => setDocType('bill')}
            >
              {c.bill}
            </button>
            <button
              type="button"
              className={docType === 'estimate' ? 'btn brand' : 'btn soft'}
              onClick={() => setDocType('estimate')}
            >
              {c.estimate}
            </button>
          </div>
        ) : null}
        {!doc && clients.length > 0 ? (
          <label className="field">
            <span className="field-label">{c.pickClient}</span>
            <select
              value={linkedClient}
              onChange={(e) => {
                const picked = clients.find((x) => x.id === e.target.value);
                setLinkedClient(e.target.value);
                if (picked) {
                  setName(picked.name);
                  setPhone(picked.phone ?? '');
                }
              }}
            >
              <option value="">{c.noClient}</option>
              {clients.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="field">
          <span className="field-label">{c.customer}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        </label>
        <label className="field">
          <span className="field-label">{c.phone}</span>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="tel"
            maxLength={32}
          />
        </label>
        <label className="field">
          <span className="field-label">{c.billDate}</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        {doc && docType === 'estimate' ? (
          <label className="field">
            <span className="field-label">{c.status}</span>
            <select value={status} onChange={(e) => setStatus(e.target.value as EstimateStatus)}>
              {(['draft', 'sent', 'accepted', 'declined'] as const).map((s) => (
                <option key={s} value={s}>
                  {c[s]}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </section>

      <section className="panel">
        {lines.map((l, index) => (
          <div key={l.key} style={{ display: 'grid', gap: 6, marginBottom: 12 }}>
            <input
              value={l.description}
              onChange={(e) => patch(l.key, { description: e.target.value })}
              placeholder={c.description}
              aria-label={`${c.description} ${index + 1}`}
              maxLength={200}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={l.qty}
                onChange={(e) => patch(l.key, { qty: e.target.value })}
                placeholder={c.qty}
                aria-label={c.qty}
                inputMode="decimal"
              />
              <input
                value={l.rate}
                onChange={(e) => patch(l.key, { rate: e.target.value })}
                placeholder={c.rate}
                aria-label={c.rate}
                inputMode="decimal"
              />
              <span className="row-right">{fmt(totals.lines[index] ?? 0n)}</span>
              {lines.length > 1 ? (
                <button
                  type="button"
                  className="btn soft"
                  onClick={() => setLines(lines.filter((x) => x.key !== l.key))}
                >
                  {c.removeItem}
                </button>
              ) : null}
            </div>
          </div>
        ))}
        <button
          type="button"
          className="btn soft"
          onClick={() =>
            setLines([
              ...lines,
              {
                key: Math.max(...lines.map((l) => l.key)) + 1,
                description: '',
                qty: '1',
                rate: '',
              },
            ])
          }
        >
          {c.addItem}
        </button>
      </section>

      <section className="panel">
        <label className="field">
          <span className="field-label">{pctMode ? c.percentOff : c.discount}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            {pctMode ? (
              <input
                value={pct}
                onChange={(e) => setPct(e.target.value)}
                inputMode="decimal"
                placeholder="%"
              />
            ) : (
              <input
                value={discountText}
                onChange={(e) => setDiscountText(e.target.value)}
                inputMode="decimal"
                placeholder="0"
              />
            )}
            <button type="button" className="btn soft" onClick={() => setPctMode(!pctMode)}>
              {pctMode ? c.amountField : c.percent}
            </button>
          </div>
        </label>
        <label className="field">
          <span className="field-label">{c.notesOptional}</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={1000}
            rows={3}
          />
        </label>
        <p>
          {c.subtotal}: {fmt(subtotal)}
        </p>
        <p>
          {c.discount}: {fmt(discount)}
        </p>
        <p>
          <b>
            {c.total}: {fmt(totals.totalMinor)}
          </b>
        </p>
      </section>

      {!doc && docType === 'bill' ? (
        <section className="panel">
          <span className="field-label">{c.paymentStatus}</span>
          <div role="group" aria-label={c.paymentStatus} style={{ display: 'flex', gap: 8 }}>
            {(
              [
                ['unpaid', c.unpaid],
                ['part', c.part_paid],
                ['paid', c.paid],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                aria-pressed={payChoice === k}
                className={payChoice === k ? 'btn brand' : 'btn soft'}
                onClick={() => setPayChoice(k)}
              >
                {label}
              </button>
            ))}
          </div>
          {payChoice === 'part' ? (
            <label className="field">
              <span className="field-label">{c.partAmount}</span>
              <input
                value={partText}
                onChange={(e) => setPartText(e.target.value)}
                inputMode="decimal"
              />
            </label>
          ) : null}
        </section>
      ) : null}

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="btn brand" disabled={busy} onClick={() => void submit()}>
          {busy ? c.saving : doc ? c.saveChanges : c.save}
        </button>
        {doc ? (
          <button type="button" className="btn soft" onClick={preview}>
            {c.preview}
          </button>
        ) : null}
      </div>
    </CompanyPage>
  );
}
