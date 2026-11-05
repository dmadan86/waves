'use client';

/** One vendor's ledger: balance, actions, pending bills, activity / orders / bills. */
import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';

import {
  buildVendorStatement,
  lastVendorPayment,
  MutationKind,
  orderLabel,
  orderTotal,
  pendingVendorBills,
  receiptLabel,
  sortVendorLines,
  vendorOverdue,
} from '@waves/core';

import { CompanyFrame } from '@/components/CompanyFrame';
import { useStrings } from '@/i18n-context';
import { fill } from '@/i18n';
import { friendlyError } from '@/lib/errors';
import { bankNotedKey, shouldShowBankNotice } from '@/lib/company/details';
import { createVendorInviteLink, useAction, useVendorsData } from '@/lib/company/useVendors';
import {
  todayIso,
  vendorEntryReviewPayload,
  vendorRemovePayload,
  vendorSetMutation,
  whatsappUrl,
} from '@/lib/company/vendors';
import { printHtml, renderStatementHtml } from '@/lib/company/vendorPrint';
import { BankNotice, useNoted } from '../../details/_components/DetailsCard';
import { LineForm } from '../_components/LineForm';
import { CategoriesField } from '../_components/CategoriesField';
import {
  BackLink,
  Field,
  labelsOf,
  OrderStatusChip,
  Page,
  Pill,
  VendorPhotos,
  useVendorFormat,
} from '../_components/parts';

export default function VendorLedgerPage() {
  const { groupId, vendorId } = useParams<{ groupId: string; vendorId: string }>();
  return (
    <CompanyFrame groupId={groupId}>
      <Inner groupId={groupId} vendorId={vendorId} />
    </CompanyFrame>
  );
}

type Tab = 'tx' | 'orders' | 'bills';

function Inner({ groupId, vendorId }: { groupId: string; vendorId: string }) {
  const { t } = useStrings();
  const s = t.company.vendors;
  const router = useRouter();
  const d = useVendorsData(groupId);
  const f = useVendorFormat(d.vendors.currency);
  const action = useAction();
  const [tab, setTab] = useState<Tab>('tx');
  const [form, setForm] = useState(false);
  const [rename, setRename] = useState<{
    name: string;
    phone: string;
    categories: string[];
  } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const vendor = d.vendors.vendors.find((v) => v.id === vendorId);
  const card = d.vendorCard(vendorId);
  const noted = useNoted(bankNotedKey(card));
  const fail = (e: unknown) => friendlyError(e, 'web.vendors.ledger', { fallback: s.failed });

  const back = <BackLink href={`/c/${groupId}/vendors`}>{s.title}</BackLink>;
  if (!vendor)
    return (
      <Page title={s.vendorTitle}>
        {back}
        <p className="faint">{s.notFound}</p>
      </Page>
    );

  const lines = d.vendors.lines.filter((l) => l.vendorId === vendorId);
  const pending = sortVendorLines(pendingVendorBills(lines));
  const balance = d.vendors.balances.get(vendorId) ?? 0n;
  const orders = d.orders.filter((o) => o.vendorId === vendorId);
  const overdue = vendorOverdue(lines, todayIso());
  const last = lastVendorPayment(lines);
  const wa = whatsappUrl(vendor.phone);
  const rows = sortVendorLines(tab === 'bills' ? lines.filter((l) => l.kind === 'bill') : lines);

  const statement = () => {
    const st = buildVendorStatement(lines);
    printHtml(renderStatementHtml(vendor.name, d.access.name, st.rows, st.balance, labelsOf(s), f));
  };
  const invite = () =>
    void action.run(
      async () => {
        const link = await createVendorInviteLink(vendor.id);
        await navigator.clipboard.writeText(link);
        setNote(s.inviteCopied);
      },
      (e) => friendlyError(e, 'vendor.invite', { fallback: s.inviteFailed }),
    );
  const remove = () => {
    if (!window.confirm(s.deleteConfirm)) return;
    void action
      .run(
        () => d.mutate(MutationKind.CompanyVendorRemove, groupId, vendorRemovePayload(vendor.id)),
        fail,
      )
      .then((ok) => ok && router.replace(`/c/${groupId}/vendors`));
  };
  const saveRename = () => {
    if (!rename?.name.trim()) return;
    const m = vendorSetMutation({ vendorId: vendor.id, ...rename });
    void action
      .run(() => d.mutate(m.kind, groupId, m.payload), fail)
      .then((ok) => ok && setRename(null));
  };
  const review = (line: (typeof pending)[number], to: 'approved' | 'rejected') =>
    void action.run(
      () =>
        d.mutate(
          MutationKind.CompanyVendorEntryReview,
          groupId,
          vendorEntryReviewPayload({ line, to }),
        ),
      fail,
    );

  return (
    <Page title={vendor.name}>
      {back}
      <div className="panel">
        <p className="faint">
          {[vendor.categories.join(' · '), vendor.phone].filter(Boolean).join(' · ')}
        </p>
        {vendor.phone ? (
          <p>
            <a className="btn soft" href={`tel:${vendor.phone}`}>
              {s.call}
            </a>{' '}
            {wa ? (
              <a className="btn soft" href={wa} target="_blank" rel="noreferrer">
                {s.whatsapp}
              </a>
            ) : null}
          </p>
        ) : null}
        <p>
          {overdue > 0n ? (
            <Pill tone="bad">{`${s.statusOverdue} ${f.money(overdue)}`}</Pill>
          ) : balance > 0n ? (
            <Pill>{s.statusToPay}</Pill>
          ) : balance < 0n ? (
            <Pill tone="warn">{s.advance}</Pill>
          ) : (
            <Pill tone="good">{s.settled}</Pill>
          )}
        </p>
        <p style={{ fontSize: 28, fontWeight: 800 }}>
          {f.money(balance < 0n ? -balance : balance)}
        </p>
        {last ? (
          <p className="faint">
            {s.lastPaymentLabel}: {f.money(last.amount)} · {f.date(last.occurredOn)}
            {last.method ? ` · ${f.methods[last.method]}` : ''}
          </p>
        ) : null}
        <p>
          <button type="button" className="btn soft" onClick={statement}>
            {s.statement}
          </button>{' '}
          <Link className="btn soft" href={`/c/${groupId}/details?vendorId=${vendorId}`}>
            {t.company.vendors.details.vendorDetails}
          </Link>
        </p>
        {note ? <p className="faint">{note}</p> : null}
      </div>
      {d.canManage ? (
        <p>
          <Link className="btn soft" href={`/c/${groupId}/vendors/${vendorId}/orders/new`}>
            {s.newOrder}
          </Link>{' '}
          <Link className="btn brand" href={`/c/${groupId}/vendors/${vendorId}/pay`}>
            {s.recordPayment}
          </Link>{' '}
          <button type="button" className="btn soft" onClick={() => setForm(true)}>
            {s.addBill}
          </button>{' '}
          {!vendor.memberId ? (
            <button type="button" className="btn soft" disabled={action.busy} onClick={invite}>
              {s.invite}
            </button>
          ) : null}{' '}
          <button
            type="button"
            className="btn soft"
            onClick={() =>
              setRename({
                name: vendor.name,
                phone: vendor.phone ?? '',
                categories: [...vendor.categories],
              })
            }
          >
            {s.rename}
          </button>{' '}
          <button type="button" className="btn soft" disabled={action.busy} onClick={remove}>
            {s.delete}
          </button>
        </p>
      ) : null}
      {action.error ? <p className="error">{action.error}</p> : null}
      {rename ? (
        <div className="panel">
          <h2>{s.rename}</h2>
          <Field
            label={s.name}
            value={rename.name}
            onChange={(name) => setRename({ ...rename, name })}
          />
          <Field
            label={s.phone}
            value={rename.phone}
            onChange={(phone) => setRename({ ...rename, phone })}
          />
          <CategoriesField
            value={rename.categories}
            onChange={(categories) => setRename({ ...rename, categories })}
            used={d.vendors.vendors.flatMap((v) => v.categories)}
          />
          <button
            type="button"
            className="btn brand"
            disabled={!rename.name.trim() || action.busy}
            onClick={saveRename}
          >
            {s.save}
          </button>{' '}
          <button type="button" className="btn soft" onClick={() => setRename(null)}>
            {s.close}
          </button>
        </div>
      ) : null}
      {form && d.canManage ? (
        <LineForm
          groupId={groupId}
          vendorId={vendor.id}
          currency={d.vendors.currency}
          onClose={() => setForm(false)}
        />
      ) : null}
      {shouldShowBankNotice(card, noted.noted) && card.card?.bankChangedAt ? (
        <BankNotice at={card.card.bankChangedAt} onNoted={noted.markNoted} />
      ) : null}
      {d.canManage && pending.length ? (
        <div className="panel">
          <h2>{s.pendingBills}</h2>
          {pending.map((line) => (
            <div key={line.id} className="item">
              <p>
                <Link href={`/c/${groupId}/vendors/${vendorId}/entry/${line.id}`}>{s.bill}</Link>{' '}
                {f.money(line.amount)}
              </p>
              <p className="faint">{[line.occurredOn, line.note].filter(Boolean).join(' · ')}</p>
              <VendorPhotos groupId={groupId} entryId={line.id} canAdd canRemove={() => true} />
              <button
                type="button"
                className="btn brand"
                disabled={action.busy}
                onClick={() => review(line, 'approved')}
              >
                {s.confirm}
              </button>{' '}
              <button
                type="button"
                className="btn soft"
                disabled={action.busy}
                onClick={() => review(line, 'rejected')}
              >
                {s.reject}
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="row-field">
        {(
          [
            ['tx', s.activityTab],
            ['orders', `${s.ordersTab} (${orders.length})`],
            ['bills', `${s.billsTab} (${lines.filter((l) => l.kind === 'bill').length})`],
          ] as [Tab, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={tab === value ? 'btn brand' : 'btn soft'}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'orders' ? (
        <div className="list">
          {orders.length === 0 ? <p className="faint">{s.noOrders}</p> : null}
          {orders.map((o) => (
            <Link
              key={o.id}
              className="item"
              href={`/c/${groupId}/vendors/${vendorId}/orders/${o.id}`}
            >
              <span className="grow">
                <span className="title">{orderLabel(o.orderNo) || s.newOrder}</span>
                <span className="meta">{fill(s.itemsCount, { n: String(o.items.length) })}</span>
              </span>
              <span className="title">{f.money(orderTotal(o.items))}</span>
              <OrderStatusChip order={o} />
            </Link>
          ))}
        </div>
      ) : (
        <div className="list">
          {rows.length === 0 ? <p className="faint">{s.historyEmpty}</p> : null}
          {rows.map((line) => {
            const status =
              line.pending || line.status === 'pending'
                ? s.pending
                : line.status === 'rejected'
                  ? s.rejected
                  : tab === 'bills'
                    ? s.confirmed
                    : null;
            return (
              <Link
                key={line.id}
                className="item"
                href={
                  line.kind === 'payment'
                    ? `/c/${groupId}/vendors/${vendorId}/receipt/${line.id}`
                    : `/c/${groupId}/vendors/${vendorId}/entry/${line.id}`
                }
              >
                <span className="grow">
                  <span className="title">
                    {line.kind === 'payment' && line.receiptNo
                      ? `${s.payment} ${receiptLabel(line.receiptNo)}`
                      : s[line.kind]}
                  </span>
                  <span className="meta">
                    {[f.date(line.occurredOn), line.method ? f.methods[line.method] : line.note]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  {status ? (
                    <Pill tone={line.status === 'rejected' ? 'bad' : undefined}>{status}</Pill>
                  ) : null}
                </span>
                <span className="title">{`${line.kind === 'bill' ? '+' : '−'}${f.money(line.amount)}`}</span>
              </Link>
            );
          })}
        </div>
      )}
    </Page>
  );
}
