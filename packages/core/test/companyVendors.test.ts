import { describe, expect, it } from 'vitest';
import {
  emptyMirror,
  materialiseVendors,
  pendingVendorBills,
  poolBalance,
  reconcile,
  sortVendorLines,
  SyncTable,
  vendorBalance,
  type QueuedMutation,
  type SyncChange,
  type VendorLine,
} from '../src';

let seq = 0;
const row = (table: SyncTable, r: Record<string, unknown>): SyncChange => ({
  table,
  groupId: 'g',
  seq: ++seq,
  row: { group_id: 'g', deleted_at: null, ...r },
});
const mirrorWith = (changes: SyncChange[]) => reconcile(emptyMirror(), changes).state;
const queued = (kind: string, payload: Record<string, unknown>, n: number): QueuedMutation =>
  ({
    clientMutationId: `m${n}`,
    kind,
    groupId: 'g',
    clientCreatedAt: '2026-11-11T00:00:00Z',
    payload,
    seq: n,
    attempts: 0,
    nextAttemptAt: 0,
  }) as unknown as QueuedMutation;
const line = (over: Partial<VendorLine>): VendorLine => ({
  id: String(++seq),
  vendorId: 'v',
  kind: 'bill',
  amount: 100n,
  occurredOn: '2026-11-10',
  note: null,
  status: 'approved',
  createdBy: 'm',
  fundingManagerId: null,
  receivedAt: null,
  reviewNote: null,
  version: 1,
  createdAt: '',
  deleted: false,
  ...over,
});

describe('vendor balance', () => {
  it('bills add, advances and payments subtract, in plain bigint', () => {
    expect(vendorBalance([])).toBe(0n);
    expect(
      vendorBalance([
        line({ amount: 1500000n }),
        line({ kind: 'payment', amount: 300000n }),
        line({ kind: 'advance', amount: 100000n }),
      ]),
    ).toBe(1100000n);
  });
  it('overpaying leaves the vendor holding an advance (negative)', () => {
    expect(vendorBalance([line({ amount: 100n }), line({ kind: 'advance', amount: 400n })])).toBe(
      -300n,
    );
  });
  it('pending, rejected and deleted lines never count; receipt does not change the balance', () => {
    const lines = [
      line({ amount: 100n }),
      line({ amount: 900n, status: 'pending' }),
      line({ amount: 700n, status: 'rejected' }),
      line({ amount: 500n, deleted: true }),
      line({ kind: 'payment', amount: 40n, receivedAt: '2026-11-11' }),
    ];
    expect(vendorBalance(lines)).toBe(60n);
    expect(pendingVendorBills(lines).map((l) => l.amount)).toEqual([900n]);
  });
  it('lists newest first', () => {
    const a = line({ occurredOn: '2026-11-01' });
    const b = line({ occurredOn: '2026-11-09' });
    expect(sortVendorLines([a, b])).toEqual([b, a]);
  });
});

describe('manager pool and vendors', () => {
  it('only confirmed payments the manager recorded come out of their pool', () => {
    const lines = [
      line({ kind: 'payment', amount: 400n, fundingManagerId: 'mgr' }),
      line({ kind: 'advance', amount: 100n, fundingManagerId: 'mgr' }),
      line({ kind: 'payment', amount: 50n, fundingManagerId: 'other' }),
      line({ kind: 'bill', amount: 999n }),
      line({ kind: 'payment', amount: 7n, fundingManagerId: 'mgr', deleted: true }),
    ];
    const p = poolBalance([], 'mgr', lines);
    expect(p.vendorPaid).toBe(500n);
    expect(p.balance).toBe(-500n);
    expect(poolBalance([], 'mgr').vendorPaid).toBe(0n);
  });
});

describe('materialiseVendors', () => {
  const state = mirrorWith([
    row(SyncTable.CompanyVendors, {
      id: 'v',
      name: 'Ravi Traders',
      added_by: 'o',
      member_id: null,
      version: 1,
    }),
    row(SyncTable.CompanyVendorEntries, {
      id: 'e1',
      vendor_id: 'v',
      kind: 'bill',
      amount: '1200',
      occurred_on: '2026-11-10',
      status: 'approved',
      created_by: 'o',
      version: 1,
      created_at: '2026-11-10T00:00:00Z',
    }),
  ]);
  const opts = { groupId: 'g', myMemberId: 'o', isVendor: false };
  it('reads pulled rows', () => {
    const out = materialiseVendors(state, [], opts);
    expect(out.vendors.map((v) => v.name)).toEqual(['Ravi Traders']);
    expect(vendorBalance(out.lines)).toBe(1200n);
  });
  it('a queued payment reads as saved at once and a queued add shows the vendor', () => {
    const q = [
      queued(
        'company_vendor.set',
        { vendorId: 'n', name: 'New Co', phone: null, category: null },
        1,
      ),
      queued(
        'company_vendor_entry.create',
        {
          entryId: 'p',
          vendorId: 'v',
          kind: 'payment',
          amountMinor: '200',
          occurredOn: '2026-11-11',
          note: null,
        },
        2,
      ),
    ];
    const out = materialiseVendors(state, q, opts);
    expect(out.vendors.map((v) => v.name).sort()).toEqual(['New Co', 'Ravi Traders']);
    expect(vendorBalance(out.lines)).toBe(1000n);
  });
  it("a vendor's own queued bill is pending and does not count; a review confirms it", () => {
    const create = queued(
      'company_vendor_entry.create',
      {
        entryId: 'b',
        vendorId: 'v',
        kind: 'bill',
        amountMinor: '50',
        occurredOn: '2026-11-11',
        note: null,
      },
      1,
    );
    const mine = materialiseVendors(state, [create], { ...opts, isVendor: true });
    expect(vendorBalance(mine.lines)).toBe(1200n);
    expect(pendingVendorBills(mine.lines)).toHaveLength(1);
    const review = queued(
      'company_vendor_entry.review',
      { entryId: 'b', to: 'approved', note: null, expectedVersion: 1 },
      2,
    );
    expect(
      vendorBalance(materialiseVendors(state, [create, review], { ...opts, isVendor: true }).lines),
    ).toBe(1250n);
  });
  it('a queued void or remove hides the line or vendor; a rejected mutation changes nothing', () => {
    const voided = queued('company_vendor_entry.void', { entryId: 'e1', reason: null }, 1);
    expect(materialiseVendors(state, [voided], opts).lines).toHaveLength(0);
    const removed = queued('company_vendor.remove', { vendorId: 'v' }, 1);
    expect(materialiseVendors(state, [removed], opts).vendors).toHaveLength(0);
    const refused = {
      ...voided,
      rejection: { code: 'X', message: 'x' },
    } as unknown as QueuedMutation;
    expect(materialiseVendors(state, [refused], opts).lines).toHaveLength(1);
  });
});
