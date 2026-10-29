import { describe, expect, it } from 'vitest';
import {
  emptyMirror,
  evenSplit,
  materialiseMembers,
  materialiseProjectMembers,
  materialiseWageSplits,
  needsSecondOwner,
  projectSpend,
  purgeCompanyInvisible,
  reconcile,
  companyEntryFromRow,
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

describe('evenSplit', () => {
  it('shares whole minor units and the first sites take the remainder', () => {
    expect(evenSplit(1000n, 3)).toEqual([334n, 333n, 333n]);
    expect(evenSplit(1000n, 3).reduce((a, b) => a + b, 0n)).toBe(1000n);
    expect(evenSplit(0n, 2)).toEqual([0n, 0n]);
    expect(evenSplit(5n, 0)).toEqual([]);
  });
});

describe('needsSecondOwner', () => {
  const base = {
    enabled: true,
    approvalsEnabled: true,
    thresholdMinor: 500n,
    ownerCount: 2,
    creatorIsOwner: false,
    amount: 100n,
  };
  it('flags large or owner-raised claims only when two owners and approvals exist', () => {
    expect(needsSecondOwner(base)).toBe(false);
    expect(needsSecondOwner({ ...base, amount: 500n })).toBe(true);
    expect(needsSecondOwner({ ...base, creatorIsOwner: true })).toBe(true);
    expect(needsSecondOwner({ ...base, thresholdMinor: null, amount: 9999n })).toBe(false);
    expect(needsSecondOwner({ ...base, amount: 500n, ownerCount: 1 })).toBe(false);
    expect(needsSecondOwner({ ...base, amount: 500n, approvalsEnabled: false })).toBe(false);
    expect(needsSecondOwner({ ...base, amount: 500n, enabled: false })).toBe(false);
  });
});

describe('projectSpend with split wages', () => {
  it('counts each site part instead of the payment site, once', () => {
    const wage = companyEntryFromRow({
      id: 'w1',
      group_id: 'g',
      member_id: 'emp',
      entry_kind: 'wage_payment',
      amount: 600,
      gross_minor: 1000,
      claims_minor: 0,
      currency: 'INR',
      occurred_on: '2026-11-01',
      status: 'approved',
      created_at: '2026-11-01T00:00:00Z',
      project_id: 'legacy',
    });
    const split = new Map([
      [
        'w1',
        [
          { projectId: 'a', amountMinor: 700n },
          { projectId: 'b', amountMinor: 300n },
        ],
      ],
    ]);
    const spend = projectSpend([wage], split);
    expect(spend.get('a')).toBe(700n);
    expect(spend.get('b')).toBe(300n);
    expect(spend.has('legacy')).toBe(false);
    expect(projectSpend([wage]).get('legacy')).toBe(1000n);
  });
});

describe('offline overlays for people', () => {
  it('a queued reports-to change moves the employee at once', () => {
    const state = mirrorWith([
      row(SyncTable.GroupMembers, { id: 'e1', role: 'member', manager_id: null, left_at: null }),
    ]);
    const members = materialiseMembers(
      state,
      [queued('company_member.assign', { memberId: 'e1', managerId: 'm1', reason: '' }, 1)],
      { groupId: 'g' },
    );
    expect(members.find((m) => m.id === 'e1')?.manager_id).toBe('m1');
    const rejected = {
      ...queued('company_member.assign', { memberId: 'e1', managerId: 'm1' }, 2),
      rejection: { code: 'x', message: 'y' },
    } as unknown as QueuedMutation;
    expect(
      materialiseMembers(state, [rejected], { groupId: 'g' }).find((m) => m.id === 'e1')
        ?.manager_id,
    ).toBeNull();
  });

  it('queued site sets replace the pulled ones, and an empty set clears them', () => {
    const state = mirrorWith([
      row(SyncTable.CompanyProjectMembers, { id: 'x1', member_id: 'e1', project_id: 'a' }),
      row(SyncTable.CompanyProjectMembers, { id: 'x2', member_id: 'e1', project_id: 'b' }),
    ]);
    expect(materialiseProjectMembers(state, [], { groupId: 'g' }).get('e1')).toEqual(['a', 'b']);
    const set = queued('company_member.projects_set', { memberId: 'e1', projectIds: ['c'] }, 1);
    expect(materialiseProjectMembers(state, [set], { groupId: 'g' }).get('e1')).toEqual(['c']);
    const clear = queued('company_member.projects_set', { memberId: 'e1', projectIds: [] }, 2);
    expect(materialiseProjectMembers(state, [set, clear], { groupId: 'g' }).has('e1')).toBe(false);
  });

  it('wage splits come from pulled rows and from a queued wage run', () => {
    const state = mirrorWith([
      row(SyncTable.CompanyWageSplits, {
        id: 's1',
        entry_id: 'p1',
        project_id: 'a',
        amount_minor: '400',
      }),
    ]);
    const run = queued(
      'company_wage.pay',
      {
        runId: 'r',
        lines: [{ paymentEntryId: 'p2', splits: [{ projectId: 'b', amountMinor: '250' }] }],
      },
      1,
    );
    const out = materialiseWageSplits(state, [run], { groupId: 'g' });
    expect(out.get('p1')).toEqual([{ projectId: 'a', amountMinor: 400n }]);
    expect(out.get('p2')).toEqual([{ projectId: 'b', amountMinor: 250n }]);
  });
});

describe('purgeCompanyInvisible (employee moved to another manager)', () => {
  const state = mirrorWith([
    row(SyncTable.GroupMembers, { id: 'mine', role: 'member' }),
    row(SyncTable.GroupMembers, { id: 'moved', role: 'member' }),
    row(SyncTable.CompanyEntries, { id: 'e1', member_id: 'mine' }),
    row(SyncTable.CompanyEntries, { id: 'e2', member_id: 'moved' }),
    row(SyncTable.CompanyEntryAttachments, { id: 'a1', entry_id: 'e1' }),
    row(SyncTable.CompanyEntryAttachments, { id: 'a2', entry_id: 'e2' }),
    row(SyncTable.CompanyWageSplits, { id: 's2', entry_id: 'e2', project_id: 'p' }),
    row(SyncTable.CompanyProjectMembers, { id: 'pm', member_id: 'moved', project_id: 'p' }),
    {
      ...row(SyncTable.CompanyEntries, { id: 'other', member_id: 'moved', group_id: 'h' }),
      groupId: 'h',
    },
  ]);

  it("drops the moved employee's entries, photos, split wages, sites and member row", () => {
    const { state: next, removed } = purgeCompanyInvisible(state, { g: ['mine'] });
    expect(Object.keys(next.tables[SyncTable.CompanyEntries]).sort()).toEqual(['e1', 'other']);
    expect(Object.keys(next.tables[SyncTable.CompanyEntryAttachments])).toEqual(['a1']);
    expect(Object.keys(next.tables[SyncTable.CompanyWageSplits])).toEqual([]);
    expect(Object.keys(next.tables[SyncTable.CompanyProjectMembers])).toEqual([]);
    expect(Object.keys(next.tables[SyncTable.GroupMembers])).toEqual(['mine']);
    expect(removed).toHaveLength(5);
  });

  it('changes nothing when everyone is still visible, and ignores an empty list', () => {
    expect(purgeCompanyInvisible(state, { g: ['mine', 'moved'] }).state).toBe(state);
    expect(purgeCompanyInvisible(state, { g: [] }).state).toBe(state);
    expect(purgeCompanyInvisible(state, {}).state).toBe(state);
  });
});
