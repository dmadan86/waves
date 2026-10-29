import { describe, expect, it } from 'vitest';
import {
  emptyMirror,
  materialiseCompanyEntries,
  purgeCompanyInvisible,
  reconcile,
  SyncTable,
  type QueuedMutation,
  type SyncChange,
} from '../src';

let seq = 0;
const row = (table: SyncTable, r: Record<string, unknown>): SyncChange => ({
  table,
  groupId: 'g',
  seq: ++seq,
  row: { group_id: 'g', deleted_at: null, ...r },
});
const queued = (payload: Record<string, unknown>): QueuedMutation =>
  ({
    clientMutationId: 'm1',
    kind: 'company_entry.create',
    groupId: 'g',
    clientCreatedAt: '2026-11-12T00:00:00Z',
    payload,
    seq: 1,
    attempts: 0,
    nextAttemptAt: 0,
  }) as unknown as QueuedMutation;

describe('company-paid entries on the phone', () => {
  it("a manager's purge keeps their own company-paid entry (no employee) and its photo", () => {
    const state = reconcile(emptyMirror(), [
      row(SyncTable.CompanyEntries, {
        id: 'paid',
        member_id: null,
        paid_by_company: true,
        created_by: 'me',
      }),
      row(SyncTable.CompanyEntries, { id: 'gone', member_id: 'moved' }),
      row(SyncTable.CompanyEntryAttachments, { id: 'a1', entry_id: 'paid' }),
    ]).state;
    const { state: next } = purgeCompanyInvisible(state, { g: ['me', 'mine'] });
    expect(Object.keys(next.tables[SyncTable.CompanyEntries])).toEqual(['paid']);
    expect(Object.keys(next.tables[SyncTable.CompanyEntryAttachments])).toEqual(['a1']);
  });
  it('a queued company-paid entry reads as approved, employee-less and pool-funded for a manager', () => {
    const payload = {
      entryId: 'e1',
      memberId: null,
      entryKind: 'expense',
      data: { paidByCompany: true, amount: '500', category: 'materials', occurredOn: '2026-11-12' },
    };
    const entries = (extra: { myIsManager?: boolean }) =>
      materialiseCompanyEntries(emptyMirror(), [queued(payload)], {
        groupId: 'g',
        currency: 'INR',
        myMemberId: 'me',
        approvalsEnabled: true,
        ...extra,
      });
    expect(entries({ myIsManager: true })[0]).toMatchObject({
      member_id: null,
      paid_by_company: true,
      status: 'approved',
      funding_manager_id: 'me',
      created_by: 'me',
    });
    expect(entries({})[0]?.funding_manager_id).toBeNull();
  });
});
