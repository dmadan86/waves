import { describe, expect, it } from 'vitest';
import {
  emptyMirror,
  materialiseVendorOrders,
  orderActions,
  orderLineTotal,
  orderTotal,
  qtyThousandths,
  reconcile,
  SyncTable,
  type QueuedMutation,
} from '../src';

describe('order totals', () => {
  it('parses quantities in thousandths and refuses bad ones', () => {
    expect(qtyThousandths('10.5')).toBe(10500n);
    expect(qtyThousandths('0.001')).toBe(1n);
    for (const bad of ['0', '0.000', '1.2345', '-1', '', '1e3', '.5'])
      expect(qtyThousandths(bad)).toBeNull();
  });
  it('rounds each line half up in minor units', () => {
    expect(orderLineTotal('10.5', 40000n)).toBe(420000n);
    expect(orderLineTotal('0.5', 1n)).toBe(1n); // 0.5 -> up
    expect(orderLineTotal('0.499', 1n)).toBe(0n);
    expect(orderLineTotal('1.005', 100n)).toBe(101n); // 100.5 -> 101
    expect(orderLineTotal('3', 0n)).toBe(0n);
  });
  it('sums the rounded lines, not the rounded sum', () => {
    const items = [
      { qty: '0.5', unitPrice: 1n },
      { qty: '0.5', unitPrice: 1n },
    ];
    expect(orderTotal(items)).toBe(2n);
  });
  it('allows only the transitions the server allows', () => {
    expect(orderActions('vendor', 'sent')).toEqual(['accepted', 'rejected']);
    expect(orderActions('vendor', 'accepted')).toEqual(['delivered']);
    expect(orderActions('company', 'accepted')).toEqual(['cancelled']);
    expect(orderActions('company', 'delivered')).toEqual([]);
    expect(orderActions('vendor', 'cancelled')).toEqual([]);
  });
});

describe('order mirror', () => {
  const state = reconcile(emptyMirror(), [
    {
      table: SyncTable.CompanyVendorOrders,
      groupId: 'g',
      seq: 1,
      row: {
        id: 'o1',
        group_id: 'g',
        vendor_id: 'v',
        order_no: 4,
        status: 'sent',
        created_by: 'm',
        version: 1,
        created_at: 't',
        deleted_at: null,
      },
    },
    {
      table: SyncTable.CompanyVendorOrderItems,
      groupId: 'g',
      seq: 2,
      row: {
        id: 'i1',
        group_id: 'g',
        order_id: 'o1',
        name: 'Cement',
        qty: '10.500',
        unit: 'bags',
        unit_price: '40000',
        position: 0,
        deleted_at: null,
      },
    },
  ]).state;
  const q = (kind: string, payload: Record<string, unknown>): QueuedMutation =>
    ({
      clientMutationId: 'x',
      kind,
      groupId: 'g',
      clientCreatedAt: '2026-11-18T00:00:00Z',
      payload,
      seq: 1,
    }) as unknown as QueuedMutation;
  it('shows pending status changes, only valid ones', () => {
    const opts = { groupId: 'g', myMemberId: 'vm', isVendor: true };
    const [o] = materialiseVendorOrders(
      state,
      [q('company_vendor_order.status', { orderId: 'o1', to: 'accepted' })],
      opts,
    );
    expect(o).toMatchObject({ status: 'accepted', pending: true, orderNo: 4 });
    const [same] = materialiseVendorOrders(
      state,
      [q('company_vendor_order.status', { orderId: 'o1', to: 'cancelled' })],
      opts,
    );
    expect(same!.status).toBe('sent');
  });
  it('shows a queued new order as pending with its total items', () => {
    const [o] = materialiseVendorOrders(
      emptyMirror(),
      [
        q('company_vendor_order.set', {
          orderId: 'n',
          vendorId: 'v',
          expectedOn: null,
          note: null,
          items: [{ name: 'Sand', qty: '2', unit: 'other', unitPrice: '1500' }],
        }),
      ],
      { groupId: 'g', myMemberId: 'm', isVendor: false },
    );
    expect(o).toMatchObject({ id: 'n', status: 'sent', pending: true, orderNo: null });
    expect(orderTotal(o!.items)).toBe(3000n);
  });
});
