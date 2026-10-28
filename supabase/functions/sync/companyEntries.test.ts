import { describe, expect, it, vi } from 'vitest';

import { SyncSession } from './index.ts';

const OWNER = 'owner-profile-id';
const GROUP_ID = '99999999-8888-7777-6666-555555555555';
const MEMBER_ID = '11111111-2222-3333-4444-555555555555';

function caller() {
  const rpc = vi.fn((name: string) =>
    Promise.resolve({ data: name === 'waves_my_member_id' ? MEMBER_ID : {}, error: null }),
  );
  const from = vi.fn(() => {
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.eq = () => builder;
    builder.maybeSingle = () => Promise.resolve({ data: null, error: null });
    return builder;
  });
  return { client: { rpc, from } as never, rpc };
}

function service() {
  const insert = vi.fn(() => Promise.resolve({ error: null }));
  const from = vi.fn(() => {
    const builder: Record<string, unknown> = { insert };
    builder.select = () => builder;
    builder.eq = () => builder;
    builder.maybeSingle = () => Promise.resolve({ data: null, error: null });
    return builder;
  });
  return { client: { from } as never };
}

function mutation(kind: string, payload: Record<string, unknown>) {
  return {
    clientMutationId: kind,
    kind,
    groupId: GROUP_ID,
    seq: 1,
    clientCreatedAt: '2026-10-19T04:00:00.000Z',
    payload,
  } as never;
}

const ENTRY = '00000000-0000-4000-8000-0000000000aa';
const data = { amount: '100', occurredOn: '2026-11-04' };
const cases = [
  ['company_entry.create', { entryId: ENTRY, memberId: MEMBER_ID, entryKind: 'expense', data }, 'waves_company_entry_create', { p_group_id: GROUP_ID, p_entry_id: ENTRY, p_member_id: MEMBER_ID, p_entry_kind: 'expense', p_data: data }],
  ['company_entry.update', { entryId: ENTRY, patch: { note: 'Taxi' } }, 'waves_company_entry_update', { p_entry_id: ENTRY, p_patch: { note: 'Taxi' } }],
  ['company_entry.void', { entryId: ENTRY, reason: 'Correction' }, 'waves_company_entry_void', { p_entry_id: ENTRY, p_reason: 'Correction' }],
  ['company_entry.transition', { entryId: ENTRY, to: 'approved' }, 'waves_company_entry_transition', { p_entry_id: ENTRY, p_to: 'approved' }],
  ['company_member.rate_set', { memberId: MEMBER_ID, dailyRateMinor: '40000' }, 'waves_company_member_rate_set', { p_group_id: GROUP_ID, p_member_id: MEMBER_ID, p_daily_rate_minor: '40000' }],
  ['company_member.rate_set', { memberId: MEMBER_ID, dailyRateMinor: null }, 'waves_company_member_rate_set', { p_group_id: GROUP_ID, p_member_id: MEMBER_ID, p_daily_rate_minor: null }],
] as const;
describe('company sync mutations', () => {
  it.each(cases)('dispatches %s as caller', async (kind, payload, rpc, args) => {
    const scoped = caller();
    const session = new SyncSession(scoped.client, service().client, OWNER);
    expect(await session.apply(mutation(kind, payload))).toMatchObject({ status: 'applied' });
    expect(scoped.rpc).toHaveBeenCalledWith(rpc, args);
  });
  it.each([
    ['company_entry.create', { memberId: MEMBER_ID, entryKind: 'expense', data }],
    ['company_entry.create', { entryId: ENTRY, memberId: MEMBER_ID, entryKind: 'expense', data: { amount: 100 } }],
    ['company_entry.update', { entryId: ENTRY, patch: [] }],
    ['company_entry.update', { entryId: ENTRY, patch: { status: 'approved' } }],
    ['company_entry.void', { entryId: ENTRY, reason: 5 }],
    ['company_entry.transition', { entryId: ENTRY }],
    ['company_member.rate_set', { memberId: MEMBER_ID, dailyRateMinor: 40000 }],
  ])('rejects malformed %s before RPC', async (kind, payload) => {
    const scoped = caller();
    const session = new SyncSession(scoped.client, service().client, OWNER);
    expect(await session.apply(mutation(kind as string, payload as Record<string, unknown>))).toMatchObject({ status: 'rejected', code: 'VALIDATION_FAILED' });
    expect(scoped.rpc).not.toHaveBeenCalled();
  });
});
