import { describe, expect, it } from 'vitest';
import {
  clientInquiryStats,
  emptyMirror,
  inquiryAmount,
  inquiryLabel,
  inquiryStatus,
  materialiseClients,
  reconcile,
  sortInquiries,
  SyncTable,
  type CompanyInquiry,
  type InquiryDoc,
  type QueuedMutation,
  type SyncChange,
} from '../src';

const inq = (over: Partial<CompanyInquiry> = {}): CompanyInquiry => ({
  id: 'i1',
  clientId: 'c1',
  number: 1,
  title: 'Racks',
  details: null,
  expectedValueMinor: 100n,
  inquiryDate: '2026-11-01',
  rejectedAt: null,
  rejectReason: null,
  createdBy: 'm',
  createdAt: '2026-11-01T00:00:00Z',
  ...over,
});
const doc = (over: Partial<InquiryDoc> = {}): InquiryDoc => ({
  id: 'd1',
  docType: 'estimate',
  status: 'draft',
  docDate: '2026-11-02',
  number: 1,
  totalMinor: 500n,
  paidMinor: 0n,
  convertedTo: null,
  inquiryId: 'i1',
  clientId: 'c1',
  deleted: false,
  ...over,
});

describe('inquiry status is derived from linked documents', () => {
  it('is open with no document', () => {
    expect(inquiryStatus(inq(), [])).toBe('open');
    expect(inquiryStatus(inq(), [doc({ inquiryId: 'other' })])).toBe('open');
  });
  it('is quoted with a draft or sent estimate, but not a declined or removed one', () => {
    expect(inquiryStatus(inq(), [doc()])).toBe('quoted');
    expect(inquiryStatus(inq(), [doc({ status: 'sent' })])).toBe('quoted');
    expect(inquiryStatus(inq(), [doc({ status: 'declined' })])).toBe('open');
    expect(inquiryStatus(inq(), [doc({ deleted: true })])).toBe('open');
  });
  it('is won with an accepted or converted estimate, or any linked bill', () => {
    expect(inquiryStatus(inq(), [doc({ status: 'accepted' })])).toBe('won');
    expect(inquiryStatus(inq(), [doc({ convertedTo: 'b1' })])).toBe('won');
    expect(inquiryStatus(inq(), [doc({ docType: 'bill', status: 'unpaid' })])).toBe('won');
    expect(inquiryStatus(inq(), [doc({ docType: 'bill', deleted: true })])).toBe('open');
  });
  it('is rejected whenever it was rejected, whatever the documents say', () => {
    expect(
      inquiryStatus(inq({ rejectedAt: '2026-11-03T00:00:00Z' }), [doc({ status: 'accepted' })]),
    ).toBe('rejected');
  });
});

describe('amount, label, order and stats', () => {
  it('shows the bill, else the live estimate, else the expected value', () => {
    expect(inquiryAmount(inq(), [])).toBe(100n);
    expect(inquiryAmount(inq({ expectedValueMinor: null }), [])).toBeNull();
    expect(inquiryAmount(inq(), [doc()])).toBe(500n);
    expect(inquiryAmount(inq(), [doc({ status: 'declined' })])).toBe(100n);
    expect(
      inquiryAmount(inq(), [
        doc({ id: 'old', docDate: '2026-11-01', totalMinor: 1n }),
        doc({ id: 'new', docDate: '2026-11-05', totalMinor: 2n }),
      ]),
    ).toBe(2n);
    expect(inquiryAmount(inq(), [doc(), doc({ id: 'b', docType: 'bill', totalMinor: 900n })])).toBe(
      900n,
    );
  });
  it('labels INQ-004 and a pending one without a number', () => {
    expect(inquiryLabel(4)).toBe('INQ-004');
    expect(inquiryLabel(1234)).toBe('INQ-1234');
    expect(inquiryLabel(0)).toBe('INQ-—');
  });
  it('lists the newest first by date then number', () => {
    const a = inq({ id: 'a', number: 1, inquiryDate: '2026-10-20' });
    const b = inq({ id: 'b', number: 3, inquiryDate: '2026-10-28' });
    const c = inq({ id: 'c', number: 4, inquiryDate: '2026-10-28' });
    expect(sortInquiries([a, b, c]).map((x) => x.id)).toEqual(['c', 'b', 'a']);
  });
  it('counts inquiries, won, rejected and the money received on bills', () => {
    const list = [
      inq({ id: 'a' }),
      inq({ id: 'b' }),
      inq({ id: 'c', rejectedAt: '2026-11-03' }),
      inq({ id: 'd' }),
    ];
    const docs = [
      doc({ id: 'x', inquiryId: 'a', status: 'accepted' }),
      doc({ id: 'y', inquiryId: 'b', docType: 'bill', paidMinor: 300n }),
      doc({ id: 'z', inquiryId: 'd', docType: 'bill', paidMinor: 45n, deleted: true }),
    ];
    expect(clientInquiryStats(list, docs)).toEqual({
      total: 4,
      won: 2,
      rejected: 1,
      paidMinor: 300n,
    });
  });
});

describe('materialise inquiries and assignees', () => {
  let seq = 0;
  const row = (table: SyncTable, r: Record<string, unknown>): SyncChange => ({
    table,
    groupId: 'g',
    seq: ++seq,
    row: { group_id: 'g', deleted_at: null, ...r },
  });
  const q = (kind: string, payload: Record<string, unknown>, n: number): QueuedMutation =>
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
  const state = reconcile(emptyMirror(), [
    row(SyncTable.CompanyClients, {
      id: 'c1',
      name: 'Goa Traders',
      source: 'call',
      stage: 'inquiry',
      owner_member_id: 'm1',
      created_by: 'm1',
    }),
    row(SyncTable.CompanyInquiries, {
      id: 'i1',
      client_id: 'c1',
      number: 4,
      title: 'Shelves',
      expected_value_minor: '7500000',
      inquiry_date: '2026-11-01',
      created_by: 'm1',
    }),
    row(SyncTable.CompanyInquiries, {
      id: 'gone',
      client_id: 'c1',
      number: 5,
      title: 'x',
      deleted_at: 'y',
    }),
    row(SyncTable.CompanyClientAssignees, { id: 'a1', client_id: 'c1', member_id: 'm1' }),
    row(SyncTable.CompanyClientAssignees, { id: 'a2', client_id: 'c1', member_id: 'm2' }),
    row(SyncTable.CompanyClientAssignees, {
      id: 'a3',
      client_id: 'c1',
      member_id: 'm3',
      deleted_at: 'y',
    }),
  ]).state;

  it('reads rows, skipping tombstones', () => {
    const r = materialiseClients(state, [], { groupId: 'g' });
    expect(r.inquiries).toHaveLength(1);
    expect(r.inquiries[0]).toMatchObject({
      number: 4,
      expectedValueMinor: 7500000n,
      inquiryDate: '2026-11-01',
    });
    expect(r.assignees.map((a) => a.memberId).sort()).toEqual(['m1', 'm2']);
  });

  it('applies queued add, edit, reject, reopen and remove', () => {
    const set = (id: string, title: string, n: number) =>
      q(
        'company_inquiry.set',
        {
          inquiryId: id,
          clientId: 'c1',
          title,
          details: null,
          expectedValueMinor: null,
          inquiryDate: '2026-11-11',
        },
        n,
      );
    const added = materialiseClients(state, [set('i2', 'New', 1)], { groupId: 'g' });
    expect(added.inquiries.find((i) => i.id === 'i2')).toMatchObject({ number: 0, pending: true });
    const edited = materialiseClients(state, [set('i1', 'Shelves 2', 1)], { groupId: 'g' });
    expect(edited.inquiries[0]).toMatchObject({ title: 'Shelves 2', number: 4 });
    const rejected = materialiseClients(
      state,
      [q('company_inquiry.reject', { inquiryId: 'i1', rejected: true, reason: 'Price' }, 1)],
      { groupId: 'g' },
    );
    expect(rejected.inquiries[0]).toMatchObject({ rejectReason: 'Price' });
    expect(rejected.inquiries[0]!.rejectedAt).not.toBeNull();
    const reopened = materialiseClients(
      state,
      [
        q('company_inquiry.reject', { inquiryId: 'i1', rejected: true, reason: 'Price' }, 1),
        q('company_inquiry.reject', { inquiryId: 'i1', rejected: false, reason: null }, 2),
      ],
      { groupId: 'g' },
    );
    expect(reopened.inquiries[0]).toMatchObject({ rejectedAt: null, rejectReason: null });
    const removed = materialiseClients(
      state,
      [q('company_inquiry.remove', { inquiryId: 'i1' }, 1)],
      {
        groupId: 'g',
      },
    );
    expect(removed.inquiries).toEqual([]);
  });

  it('a queued reassignment replaces the set and keeps or promotes the owner; removing a client drops its inquiries', () => {
    const keep = materialiseClients(
      state,
      [q('company_client.assign', { clientId: 'c1', memberIds: ['m1', 'm4'] }, 1)],
      { groupId: 'g' },
    );
    expect(keep.assignees.map((a) => a.memberId).sort()).toEqual(['m1', 'm4']);
    expect(keep.clients[0]!.ownerMemberId).toBe('m1');
    const promote = materialiseClients(
      state,
      [q('company_client.assign', { clientId: 'c1', memberIds: ['m4', 'm2'] }, 1)],
      { groupId: 'g' },
    );
    expect(promote.clients[0]!.ownerMemberId).toBe('m4');
    const gone = materialiseClients(state, [q('company_client.remove', { clientId: 'c1' }, 1)], {
      groupId: 'g',
    });
    expect(gone.inquiries).toEqual([]);
    expect(gone.assignees).toEqual([]);
  });
});
