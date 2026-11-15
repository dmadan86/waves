'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';

import {
  MutationKind,
  orderActions,
  orderLabel,
  orderLineTotal,
  orderTotal,
  type VendorOrderStatus,
} from '@waves/core';

import { CompanyFrame } from '@/components/CompanyFrame';
import { useStrings } from '@/i18n-context';
import { fill } from '@/i18n';
import { friendlyError } from '@/lib/errors';
import { useAction, useVendorsData } from '@/lib/company/useVendors';
import { orderStatusPayload, trimQty } from '@/lib/company/vendorOrders';
import { printHtml, renderOrderHtml } from '@/lib/company/vendorPrint';
import {
  BackLink,
  labelsOf,
  OrderStatusChip,
  Page,
  useVendorFormat,
} from '../../../_components/parts';

export default function OrderDetailPage() {
  const { groupId, vendorId, orderId } = useParams<{
    groupId: string;
    vendorId: string;
    orderId: string;
  }>();
  return (
    <CompanyFrame groupId={groupId}>
      <Inner groupId={groupId} vendorId={vendorId} orderId={orderId} />
    </CompanyFrame>
  );
}

function Inner({
  groupId,
  vendorId,
  orderId,
}: {
  groupId: string;
  vendorId: string;
  orderId: string;
}) {
  const { t, locale } = useStrings();
  const s = t.company.vendors;
  const d = useVendorsData(groupId);
  const f = useVendorFormat(d.vendors.currency);
  const action = useAction();
  const back = `/c/${groupId}/vendors/${vendorId}`;
  const order = d.orders.find((o) => o.id === orderId);
  const vendor = order ? d.vendors.vendors.find((v) => v.id === order.vendorId) : undefined;
  if (!order)
    return (
      <Page title={s.orderTitle}>
        <BackLink href={back}>{s.vendorTitle}</BackLink>
        <p className="faint">{s.notFound}</p>
      </Page>
    );
  const side = d.vendors.isVendor ? 'vendor' : 'company';
  const actions = d.company.suspended || order.pending ? [] : orderActions(side, order.status);
  const canEdit = side === 'company' && d.canManage && order.status === 'sent' && !order.pending;
  const run = (to: VendorOrderStatus) =>
    void action.run(
      () =>
        d.mutate(
          MutationKind.CompanyVendorOrderStatus,
          groupId,
          orderStatusPayload({ orderId: order.id, to }),
        ),
      (e) => friendlyError(e, 'web.vendors.order.status', { fallback: s.failed }),
    );
  return (
    <Page title={`${s.purchaseOrder} ${orderLabel(order.orderNo)}`.trim()}>
      <BackLink href={back}>{vendor?.name ?? s.vendorTitle}</BackLink>
      <div className="panel">
        <p>
          <strong>{vendor?.name ?? ''}</strong> <OrderStatusChip order={order} />
        </p>
        {order.expectedOn ? (
          <p className="faint">{fill(s.expectedOn, { date: f.date(order.expectedOn) })}</p>
        ) : null}
        {order.note ? <p>{order.note}</p> : null}
      </div>
      <div className="panel">
        <h2>{s.orderItems}</h2>
        {order.items.map((i) => (
          <p key={i.position}>
            {i.name}{' '}
            <span className="faint">{`${trimQty(i.qty)} ${f.units[i.unit]} × ${f.money(i.unitPrice)}`}</span>{' '}
            <strong>{f.money(orderLineTotal(i.qty, i.unitPrice))}</strong>
          </p>
        ))}
        <p>
          {s.orderTotal}: <strong>{f.money(orderTotal(order.items))}</strong>
        </p>
        <p className="faint">{s.orderNotBill}</p>
      </div>
      <div className="panel">
        <h2>{s.orderTimeline}</h2>
        {order.events.map((e, index) => (
          <p
            key={index}
            className="faint"
          >{`${f.orderStatus[e.status]} · ${new Date(e.at).toLocaleDateString(locale)}`}</p>
        ))}
      </div>
      {action.error ? <p className="error">{action.error}</p> : null}
      <p>
        {actions.includes('accepted') ? (
          <button
            type="button"
            className="btn brand"
            disabled={action.busy}
            onClick={() => run('accepted')}
          >
            {s.accept}
          </button>
        ) : null}{' '}
        {actions.includes('rejected') ? (
          <button
            type="button"
            className="btn soft"
            disabled={action.busy}
            onClick={() => run('rejected')}
          >
            {s.reject}
          </button>
        ) : null}{' '}
        {actions.includes('delivered') ? (
          <button
            type="button"
            className="btn brand"
            disabled={action.busy}
            onClick={() => run('delivered')}
          >
            {s.markDelivered}
          </button>
        ) : null}{' '}
        {canEdit ? (
          <Link className="btn soft" href={`${back}/orders/new?orderId=${order.id}`}>
            {s.editOrder}
          </Link>
        ) : null}{' '}
        {actions.includes('cancelled') ? (
          <button
            type="button"
            className="btn soft"
            disabled={action.busy}
            onClick={() => window.confirm(s.cancelOrderConfirm) && run('cancelled')}
          >
            {s.cancelOrder}
          </button>
        ) : null}{' '}
        <button
          type="button"
          className="btn soft"
          onClick={() =>
            printHtml(
              renderOrderHtml(order, vendor?.name ?? '', d.access.name, labelsOf(s), f.units, f),
            )
          }
        >
          {s.orderPdf}
        </button>
      </p>
    </Page>
  );
}
