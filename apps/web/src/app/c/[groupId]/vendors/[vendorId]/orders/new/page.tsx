'use client';

/** New material order, or edit one that is still sent (`?orderId=`). */
import { Suspense, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';

import {
  MutationKind,
  money as coreMoney,
  orderLineTotal,
  orderTotal,
  qtyThousandths,
  toMajorString,
  VENDOR_ORDER_UNITS,
  type CurrencyCode,
  type VendorOrderUnit,
} from '@waves/core';

import { CompanyFrame } from '@/components/CompanyFrame';
import { useStrings } from '@/i18n-context';
import { fill } from '@/i18n';
import { friendlyError } from '@/lib/errors';
import { useAction, useVendorsData } from '@/lib/company/useVendors';
import { orderSetPayload, trimQty } from '@/lib/company/vendorOrders';
import { validIsoDate } from '@/lib/company/vendors';
import { amountMinor } from '../../../_components/LineForm';
import { BackLink, Field, Page, useVendorFormat } from '../../../_components/parts';

interface Row {
  key: string;
  name: string;
  qty: string;
  unit: VendorOrderUnit;
  price: string;
}
const blank = (): Row => ({
  key: crypto.randomUUID(),
  name: '',
  qty: '1',
  unit: 'pieces',
  price: '',
});

export default function NewOrderPage() {
  const { groupId, vendorId } = useParams<{ groupId: string; vendorId: string }>();
  return (
    <CompanyFrame groupId={groupId}>
      <Suspense fallback={null}>
        <Inner groupId={groupId} vendorId={vendorId} />
      </Suspense>
    </CompanyFrame>
  );
}

function Inner({ groupId, vendorId }: { groupId: string; vendorId: string }) {
  const { t } = useStrings();
  const s = t.company.vendors;
  const router = useRouter();
  const orderId = useSearchParams().get('orderId');
  const d = useVendorsData(groupId);
  const f = useVendorFormat(d.vendors.currency);
  const action = useAction();
  const existing = orderId ? d.orders.find((o) => o.id === orderId) : undefined;
  const currency = d.vendors.currency;
  const [rows, setRows] = useState<Row[]>(() =>
    existing
      ? existing.items.map((i) => ({
          key: crypto.randomUUID(),
          name: i.name,
          qty: trimQty(i.qty),
          unit: i.unit,
          price: toMajorString(coreMoney(i.unitPrice, currency as CurrencyCode)),
        }))
      : [blank()],
  );
  const [expectedOn, setExpectedOn] = useState(existing?.expectedOn ?? '');
  const [note, setNote] = useState(existing?.note ?? '');
  // One id per form: a double click or a retry is the same request to the server.
  const newId = useRef(crypto.randomUUID()).current;
  const [done, setDone] = useState(false);
  const vendor = d.vendors.vendors.find((v) => v.id === vendorId);
  const back = `/c/${groupId}/vendors/${vendorId}`;
  const patch = (key: string, p: Partial<Row>) =>
    setRows((r) => r.map((x) => (x.key === key ? { ...x, ...p } : x)));
  const items = rows.map((r) => ({
    name: r.name,
    qty: r.qty,
    unit: r.unit,
    unitPrice: amountMinor(r.price, currency),
  }));
  const valid =
    !!vendor &&
    rows.every((r) => r.name.trim() && qtyThousandths(r.qty) !== null) &&
    (!expectedOn || validIsoDate(expectedOn)) &&
    d.canManage;

  const submit = () => {
    if (!valid || action.busy || done) return;
    const id = existing?.id ?? newId;
    void action
      .run(
        () =>
          d.mutate(
            MutationKind.CompanyVendorOrderSet,
            groupId,
            orderSetPayload({ orderId: id, vendorId, expectedOn, note, items }),
          ),
        (e) => friendlyError(e, 'web.vendors.order.set', { fallback: s.failed }),
      )
      .then((ok) => {
        if (ok) {
          setDone(true);
          router.replace(`${back}/orders/${id}`);
        }
      });
  };

  return (
    <Page title={existing ? s.editOrder : s.orderTitle}>
      <BackLink href={back}>{vendor?.name ?? s.vendorTitle}</BackLink>
      <div className="panel">
        <span className="field-label">{s.vendorLabel}</span>{' '}
        <strong>{vendor?.name ?? s.notFound}</strong>
      </div>
      {rows.map((r) => (
        <div key={r.key} className="panel">
          <Field label={s.itemName} value={r.name} onChange={(name) => patch(r.key, { name })} />
          <Field
            label={s.itemQty}
            value={r.qty}
            onChange={(qty) => patch(r.key, { qty: qty.replace(',', '.') })}
            inputMode="decimal"
            maxLength={13}
          />
          <Field
            label={s.itemPrice}
            value={r.price}
            onChange={(price) => patch(r.key, { price })}
            inputMode="decimal"
            maxLength={16}
          />
          <label className="field">
            <span className="field-label">{s.itemUnit}</span>
            <select
              value={r.unit}
              onChange={(e) => patch(r.key, { unit: e.target.value as VendorOrderUnit })}
            >
              {VENDOR_ORDER_UNITS.map((u) => (
                <option key={u} value={u}>
                  {f.units[u]}
                </option>
              ))}
            </select>
          </label>
          <p>
            {`${r.qty || '0'} × ${f.money(amountMinor(r.price, currency))} = `}
            <strong>{f.money(orderLineTotal(r.qty, amountMinor(r.price, currency)))}</strong>
          </p>
          {rows.length > 1 ? (
            <button
              type="button"
              className="btn soft"
              onClick={() => setRows((x) => x.filter((y) => y.key !== r.key))}
            >
              {s.removeItem}
            </button>
          ) : null}
        </div>
      ))}
      {rows.length < 50 ? (
        <button type="button" className="btn soft" onClick={() => setRows((r) => [...r, blank()])}>
          {s.addItem}
        </button>
      ) : null}
      <div className="panel">
        <Field
          label={`${s.expectedDelivery} (${s.dateHint})`}
          value={expectedOn}
          onChange={setExpectedOn}
          maxLength={10}
        />
        <Field label={s.note} value={note} onChange={setNote} maxLength={500} />
      </div>
      <div className="panel">
        <p>
          {fill(s.orderTotalItems, { n: String(rows.length) })}{' '}
          <strong>{f.money(orderTotal(items))}</strong>
        </p>
        <p className="faint">{s.orderNotBill}</p>
      </div>
      {action.error ? <p className="error">{action.error}</p> : null}
      <button
        type="button"
        className="btn brand"
        disabled={!valid || action.busy || done}
        onClick={submit}
      >
        {existing ? s.save : s.sendOrder}
      </button>
    </Page>
  );
}
