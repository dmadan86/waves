import { describe, expect, it } from 'vitest';
import {
  emptyMirror,
  MutationKind,
  SyncTable,
  type MirrorState,
  type VendorOrder,
} from '@waves/core';

import type { CompanyAccess } from '@/lib/company/vendorAccess';
import {
  companyDetailsMutation,
  vendorDetailsMutation,
  deriveCompanyCard,
} from '@/lib/company/details';
import { orderSetPayload, orderStatusPayload, trimQty } from '@/lib/company/vendorOrders';
import { esc, renderOrderHtml } from '@/lib/company/vendorPrint';
import {
  deriveVendors,
  parseVendorShare,
  validIsoDate,
  vendorEntryCreatePayload,
  vendorEntryReviewPayload,
  vendorSetMutation,
  whatsappUrl,
} from '@/lib/company/vendors';

function mirrorWith(rows: Partial<Record<SyncTable, Record<string, unknown>[]>>): MirrorState {
  const m = emptyMirror();
  const tables = { ...m.tables } as Record<string, Record<string, unknown>>;
  for (const [table, list] of Object.entries(rows))
    tables[table] = Object.fromEntries((list ?? []).map((r) => [r.id as string, r]));
  return { ...m, tables: tables as unknown as MirrorState['tables'] };
}

const G = 'g1';
const mirror = mirrorWith({
  [SyncTable.Groups]: [{ id: G, name: 'Acme', default_currency: 'INR' }],
  [SyncTable.GroupMembers]: [
    { id: 'm-owner', group_id: G, profile_id: 'p1', role: 'admin', left_at: null },
    { id: 'm-mgr', group_id: G, profile_id: 'p2', role: 'manager', left_at: null },
  ],
  [SyncTable.CompanyVendors]: [
    { id: 'v1', group_id: G, name: 'Zed', added_by: 'm-owner', member_id: null, version: 1 },
    { id: 'v2', group_id: G, name: 'Alpha', added_by: 'm-mgr', member_id: null, version: 1 },
  ],
  [SyncTable.CompanyVendorEntries]: [
    {
      id: 'e1',
      group_id: G,
      vendor_id: 'v1',
      kind: 'bill',
      amount: '1000',
      occurred_on: '2026-01-01',
      status: 'approved',
      created_by: 'm-owner',
      version: 1,
    },
    {
      id: 'e2',
      group_id: G,
      vendor_id: 'v1',
      kind: 'payment',
      amount: '400',
      occurred_on: '2026-01-02',
      status: 'approved',
      created_by: 'm-owner',
      version: 1,
    },
  ],
});

const access = (over: Partial<CompanyAccess>): CompanyAccess => ({
  memberId: null,
  isOwner: false,
  isManager: false,
  isVendor: false,
  currency: 'INR',
  name: 'Acme',
  suspended: false,
  ...over,
});
const ownerA = access({ memberId: 'm-owner', isOwner: true });
const mgrA = access({ memberId: 'm-mgr', isManager: true });

describe('vendor view', () => {
  it('owner sees all vendors sorted, manager only their own', () => {
    const owner = deriveVendors(mirror, G, ownerA);
    expect(owner.vendors.map((v) => v.name)).toEqual(['Alpha', 'Zed']);
    expect(owner.balances.get('v1')).toBe(600n);
    const mgr = deriveVendors(mirror, G, mgrA);
    expect(mgr.vendors.map((v) => v.id)).toEqual(['v2']);
    expect(mgr.lines).toEqual([]);
  });
  it('a stranger sees nothing and no bank details', () => {
    const a = access({});
    expect(deriveVendors(mirror, G, a).vendors).toEqual([]);
    expect(deriveCompanyCard(mirror, G, a).canEdit).toBe(false);
  });
});

describe('payloads match mobile', () => {
  it('vendor set trims and nulls blanks', () => {
    expect(vendorSetMutation({ vendorId: 'v', name: ' A ', phone: ' ', category: 'x ' })).toEqual({
      kind: MutationKind.CompanyVendorSet,
      payload: { vendorId: 'v', name: 'A', phone: null, category: 'x' },
    });
  });
  it('entry create stringifies the amount', () => {
    expect(
      vendorEntryCreatePayload({
        entryId: 'e',
        vendorId: 'v',
        kind: 'bill',
        amountMinor: 1250n,
        occurredOn: '2026-02-03',
        note: ' hi ',
      }),
    ).toEqual({
      entryId: 'e',
      vendorId: 'v',
      kind: 'bill',
      amountMinor: '1250',
      occurredOn: '2026-02-03',
      note: 'hi',
      dueOn: null,
      method: null,
      reference: null,
    });
  });
  it('review carries the expected version', () => {
    expect(vendorEntryReviewPayload({ line: { id: 'e', version: 3 }, to: 'approved' })).toEqual({
      entryId: 'e',
      to: 'approved',
      note: null,
      expectedVersion: 3,
    });
  });
  it('orders and details', () => {
    expect(
      orderSetPayload({
        orderId: 'o',
        vendorId: 'v',
        items: [{ name: ' Sand ', qty: '2.5 ', unit: 'bags', unitPrice: 99n }],
      }),
    ).toEqual({
      orderId: 'o',
      vendorId: 'v',
      expectedOn: null,
      note: null,
      items: [{ name: 'Sand', qty: '2.5', unit: 'bags', unitPrice: '99' }],
    });
    expect(orderStatusPayload({ orderId: 'o', to: 'accepted' })).toEqual({
      orderId: 'o',
      to: 'accepted',
    });
    expect(companyDetailsMutation({} as never).kind).toBe(MutationKind.CompanyDetailsSet);
    expect(vendorDetailsMutation('v', {} as never).payload).toMatchObject({ vendorId: 'v' });
    expect(trimQty('2.500')).toBe('2.5');
    expect(trimQty('10')).toBe('10');
  });
});

describe('helpers', () => {
  it('parses vendor shares', () => {
    expect(parseVendorShare('+91 98765-43210')).toEqual({ phone: '+919876543210' });
    expect(parseVendorShare('upi://pay?pa=9876543210@ybl&pn=Ravi+Stores')).toEqual({
      name: 'Ravi Stores',
      phone: '9876543210',
    });
    expect(parseVendorShare('hello')).toBeNull();
    expect(parseVendorShare('')).toBeNull();
  });
  it('validates dates and builds whatsapp links', () => {
    expect(validIsoDate('2026-02-30')).toBe(false);
    expect(validIsoDate('2026-02-28')).toBe(true);
    expect(whatsappUrl('+91 98765', 'a b')).toBe('https://wa.me/9198765?text=a%20b');
    expect(whatsappUrl(null)).toBeNull();
  });
  it('escapes printable html', () => {
    expect(esc('<b>"x"&')).toBe('&lt;b&gt;&quot;x&quot;&amp;');
    const order = {
      orderNo: 1,
      items: [{ position: 0, name: '<i>', qty: '1', unit: 'pieces', unitPrice: 100n }],
      expectedOn: null,
      note: null,
    } as unknown as VendorOrder;
    const html = renderOrderHtml(
      order,
      'V',
      'C',
      {
        purchaseOrder: 'PO',
        companyLabel: 'Co',
        vendorLabel: 'Ven',
        itemName: 'I',
        itemQty: 'Q',
        amountLabel: 'A',
        expectedOn: '{date}',
        orderTotal: 'T',
      },
      { pieces: 'pcs' },
      { money: (m) => String(m), date: (d) => d },
    );
    expect(html).toContain('&lt;i&gt;');
    expect(html).not.toContain('<i>');
  });
});
