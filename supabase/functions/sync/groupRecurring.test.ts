/**
 * Repeating group expenses cross the sync boundary as two mutation kinds. The
 * payload is client JSON, so what reaches `waves_create_group_recurring_expense`
 * is validated here: the lists are lists of text lines, the rule id is present
 * (it is the idempotency key), and an edit carries an object.
 */

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

const create = {
  ruleId: '00000000-0000-4000-8000-0000000000aa',
  description: 'Rent',
  category: null,
  currency: 'INR',
  amount: '90000',
  splitType: 'equal',
  splitParams: { kind: 'equal' },
  payers: [{ memberId: MEMBER_ID, amount: '90000' }],
  shares: [{ memberId: MEMBER_ID, amount: '90000' }],
  notes: null,
  cadence: 'monthly',
  interval: 1,
  secondDay: null,
  anchorDate: '2026-11-01',
  endDate: null,
};

describe('group recurring expense sync payloads', () => {
  it('creates a rule through the RPC with the client-chosen id as the replay key', async () => {
    const scoped = caller();
    const session = new SyncSession(scoped.client, service().client, OWNER);

    const outcome = await session.apply(mutation('group_recurring.create', create));

    expect(outcome).toMatchObject({ status: 'applied' });
    expect(scoped.rpc).toHaveBeenCalledWith(
      'waves_create_group_recurring_expense',
      expect.objectContaining({
        p_group_id: GROUP_ID,
        p_id: create.ruleId,
        p_amount: '90000',
        p_cadence: 'monthly',
        p_interval: 1,
        p_second_day: null,
        p_anchor_date: '2026-11-01',
        p_end_date: null,
        p_payers: create.payers,
        p_shares: create.shares,
      }),
    );
  });

  it.each([
    ['no rule id', { ...create, ruleId: undefined }],
    ['numeric amount', { ...create, amount: 90000 }],
    ['empty payers', { ...create, payers: [] }],
    [
      'a payer line without text amount',
      { ...create, payers: [{ memberId: MEMBER_ID, amount: 5 }] },
    ],
    ['shares that are not a list', { ...create, shares: 'all' }],
  ])('refuses a create with %s before it reaches the RPC', async (_label, payload) => {
    const scoped = caller();
    const session = new SyncSession(scoped.client, service().client, OWNER);

    const outcome = await session.apply(mutation('group_recurring.create', payload));

    expect(outcome).toMatchObject({ status: 'rejected', code: 'VALIDATION_FAILED' });
    expect(scoped.rpc).not.toHaveBeenCalled();
  });

  it('passes an edit, pause or stop as a patch object', async () => {
    const scoped = caller();
    const session = new SyncSession(scoped.client, service().client, OWNER);

    const outcome = await session.apply(
      mutation('group_recurring.update', { ruleId: create.ruleId, patch: { status: 'paused' } }),
    );

    expect(outcome).toMatchObject({ status: 'applied' });
    expect(scoped.rpc).toHaveBeenCalledWith('waves_update_group_recurring_expense', {
      p_id: create.ruleId,
      p_patch: { status: 'paused' },
    });
  });

  it.each([
    ['no patch', { ruleId: create.ruleId }],
    ['a list patch', { ruleId: create.ruleId, patch: ['paused'] }],
    ['no rule id', { patch: { status: 'paused' } }],
  ])('refuses an update with %s', async (_label, payload) => {
    const scoped = caller();
    const session = new SyncSession(scoped.client, service().client, OWNER);

    const outcome = await session.apply(mutation('group_recurring.update', payload));

    expect(outcome).toMatchObject({ status: 'rejected', code: 'VALIDATION_FAILED' });
    expect(scoped.rpc).not.toHaveBeenCalled();
  });
});
