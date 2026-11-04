'use client';

/** What a vendor's own login sees: their balance, add a bill, their details, orders and history. */
import { useState } from 'react';
import Link from 'next/link';

import {
  MutationKind,
  receiptLabel,
  sortVendorLines,
  orderLabel,
  orderTotal,
  type VendorLine,
} from '@waves/core';

import { useStrings } from '@/i18n-context';
import { fill } from '@/i18n';
import { friendlyError } from '@/lib/errors';
import { shouldShowBankNotice, bankNotedKey } from '@/lib/company/details';
import { useAction, useVendorsData } from '@/lib/company/useVendors';
import { vendorEntryReceivedPayload, vendorEntryVoidPayload } from '@/lib/company/vendors';
import { BankNotice, useNoted } from '../../details/_components/DetailsCard';
import { LineForm } from './LineForm';
import { OrderStatusChip, Page, Pill, VendorPhotos, useVendorFormat } from './parts';

export function VendorHome({ groupId }: { groupId: string }) {
  const { t } = useStrings();
  const s = t.company.vendors;
  const d = useVendorsData(groupId);
  const f = useVendorFormat(d.vendors.currency);
  const action = useAction();
  const [adding, setAdding] = useState(false);
  const vendor = d.vendors.vendors.find((v) => v.memberId === d.vendors.myMemberId);
  const balance = vendor ? (d.vendors.balances.get(vendor.id) ?? 0n) : 0n;
  const noted = useNoted(bankNotedKey(d.companyCard));
  const lines = vendor
    ? sortVendorLines(d.vendors.lines.filter((l) => l.vendorId === vendor.id))
    : [];
  const fail = (e: unknown) => friendlyError(e, 'web.vendors.home', { fallback: s.failed });

  const status = (line: VendorLine) =>
    line.pending || line.status === 'pending'
      ? s.pending
      : line.status === 'rejected'
        ? s.rejected
        : line.kind !== 'bill'
          ? line.receivedAt
            ? s.received
            : s.recorded
          : s.confirmed;

  return (
    <Page title={vendor?.name ?? s.title}>
      {vendor ? (
        <>
          <div className="panel">
            <p>
              {fill(balance > 0n ? s.companyOwes : balance < 0n ? s.yourAdvance : s.allSettled, {
                amount: f.money(balance < 0n ? -balance : balance),
              })}
            </p>
            {!adding ? (
              <button type="button" className="btn brand" onClick={() => setAdding(true)}>
                {s.addBill}
              </button>
            ) : null}
          </div>
          {adding ? (
            <LineForm
              groupId={groupId}
              vendorId={vendor.id}
              currency={d.vendors.currency}
              submitted
              onClose={() => setAdding(false)}
            />
          ) : null}
          {shouldShowBankNotice(d.companyCard, noted.noted) && d.companyCard.card?.bankChangedAt ? (
            <BankNotice at={d.companyCard.card.bankChangedAt} onNoted={noted.markNoted} />
          ) : null}
          <div className="panel">
            <p>
              <Link href={`/c/${groupId}/details`}>{t.company.vendors.details.title}</Link>
            </p>
            <p>
              <Link href={`/c/${groupId}/details?vendorId=${vendor.id}&mine=1`}>
                {t.company.vendors.details.myDetails}
              </Link>
            </p>
          </div>
          <div className="panel">
            <h2>{s.ordersTab}</h2>
            {d.orders.length === 0 ? <p className="faint">{s.noOrders}</p> : null}
            {d.orders.map((o) => (
              <p key={o.id}>
                <Link href={`/c/${groupId}/vendors/${o.vendorId}/orders/${o.id}`}>
                  {orderLabel(o.orderNo) || s.newOrder} ·{' '}
                  {fill(s.itemsCount, { n: String(o.items.length) })} ·{' '}
                  {f.money(orderTotal(o.items))}
                </Link>{' '}
                <OrderStatusChip order={o} />
              </p>
            ))}
          </div>
          <div className="panel">
            <h2>{s.history}</h2>
            {lines.length === 0 ? <p className="faint">{s.historyEmpty}</p> : null}
            {lines.map((line) => {
              const ownPendingBill =
                line.kind === 'bill' &&
                line.status === 'pending' &&
                line.createdBy === d.vendors.myMemberId;
              return (
                <div key={line.id} className="item">
                  <p>
                    <Link
                      href={
                        line.kind === 'payment'
                          ? `/c/${groupId}/vendors/${vendor.id}/receipt/${line.id}`
                          : `/c/${groupId}/vendors/${vendor.id}/entry/${line.id}`
                      }
                    >
                      {line.kind === 'payment' && line.receiptNo
                        ? `${s.payment} ${receiptLabel(line.receiptNo)}`
                        : s[line.kind]}
                    </Link>{' '}
                    {line.kind === 'bill' ? '+' : '−'}
                    {f.money(line.amount)}{' '}
                    <Pill tone={line.status === 'rejected' ? 'bad' : undefined}>
                      {status(line)}
                    </Pill>
                  </p>
                  <p className="faint">
                    {[
                      f.date(line.occurredOn),
                      line.method ? f.methods[line.method] : null,
                      line.dueOn ? fill(s.dueOn, { date: line.dueOn }) : null,
                      line.note,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  <VendorPhotos
                    groupId={groupId}
                    entryId={line.id}
                    canAdd={ownPendingBill}
                    canRemove={(uploader) => ownPendingBill && uploader === d.vendors.myMemberId}
                  />
                  {!line.receivedAt && line.kind !== 'bill' && line.status === 'approved' ? (
                    <button
                      type="button"
                      className="btn soft"
                      disabled={action.busy}
                      onClick={() =>
                        void action.run(
                          () =>
                            d.mutate(
                              MutationKind.CompanyVendorEntryReceived,
                              groupId,
                              vendorEntryReceivedPayload({ entryId: line.id, received: true }),
                            ),
                          fail,
                        )
                      }
                    >
                      {s.markReceived}
                    </button>
                  ) : null}
                  {ownPendingBill && !d.company.suspended ? (
                    <button
                      type="button"
                      className="btn soft"
                      disabled={action.busy}
                      onClick={() => {
                        if (!window.confirm(s.withdrawConfirm)) return;
                        void action.run(
                          () =>
                            d.mutate(
                              MutationKind.CompanyVendorEntryVoid,
                              groupId,
                              vendorEntryVoidPayload({ entryId: line.id }),
                            ),
                          fail,
                        );
                      }}
                    >
                      {s.withdraw}
                    </button>
                  ) : null}
                </div>
              );
            })}
            {action.error ? <p className="error">{action.error}</p> : null}
          </div>
        </>
      ) : (
        <p className="faint">{s.notFound}</p>
      )}
    </Page>
  );
}
