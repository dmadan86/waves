/**
 * Budget and trip-rate sync payloads are a boundary, not a typed function call.
 *
 * The app sends these from four different shapes of use: a user/rider setting
 * their own trip ceiling, a traveller/admin setting the whole trip and category
 * caps, and a financer/admin pinning an FX rate. The intended clear operation is
 * explicit `null`; a missing or non-text amount/rate is a malformed payload and
 * must be refused before it reaches the RPC. Otherwise an older or buggy client
 * can accidentally clear a budget/rate by omitting a field.
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

function mutation(kind: string, payload: Record<string, unknown>, clientMutationId = kind) {
  return {
    clientMutationId,
    kind,
    groupId: GROUP_ID,
    seq: 1,
    clientCreatedAt: '2026-09-06T04:00:00.000Z',
    payload,
  } as never;
}

describe('trip budget and rate sync payloads', () => {
  it('lets a rider set their own trip budget with a string amount', async () => {
    const scoped = caller();
    const session = new SyncSession(scoped.client, service().client, OWNER);

    const outcome = await session.apply(
      mutation('member_budget.set', {
        amountMinor: '120000',
        currency: 'INR',
        visibility: 'group',
      }),
    );

    expect(outcome).toMatchObject({ status: 'applied' });
    expect(scoped.rpc).toHaveBeenCalledWith('waves_set_my_trip_budget', {
      p_group_id: GROUP_ID,
      p_amount_minor: '120000',
      p_currency: 'INR',
      p_visibility: 'group',
    });
  });

  it.each([
    ['missing amount', {}],
    ['numeric amount', { amountMinor: 120000 }],
    ['null amount', { amountMinor: null }],
  ])('refuses a rider member-budget set with %s', async (_label, payload) => {
    const scoped = caller();
    const session = new SyncSession(scoped.client, service().client, OWNER);

    const outcome = await session.apply(mutation('member_budget.set', payload));

    expect(outcome).toMatchObject({ status: 'rejected', code: 'VALIDATION_FAILED' });
    expect(scoped.rpc).not.toHaveBeenCalled();
  });

  it('lets a traveller clear the overall trip budget with explicit null', async () => {
    const scoped = caller();
    const session = new SyncSession(scoped.client, service().client, OWNER);

    const outcome = await session.apply(
      mutation('group_budget.set', { amountMinor: null, currency: null }),
    );

    expect(outcome).toMatchObject({ status: 'applied' });
    expect(scoped.rpc).toHaveBeenCalledWith('waves_set_group_budget', {
      p_group_id: GROUP_ID,
      p_amount_minor: null,
      p_currency: null,
    });
  });

  it.each([
    ['missing amount', {}],
    ['numeric amount', { amountMinor: 120000 }],
  ])(
    'refuses a traveller group-budget set with %s instead of clearing it',
    async (_label, payload) => {
      const scoped = caller();
      const session = new SyncSession(scoped.client, service().client, OWNER);

      const outcome = await session.apply(mutation('group_budget.set', payload));

      expect(outcome).toMatchObject({ status: 'rejected', code: 'VALIDATION_FAILED' });
      expect(scoped.rpc).not.toHaveBeenCalled();
    },
  );

  it('lets a traveller clear one category budget with explicit null', async () => {
    const scoped = caller();
    const session = new SyncSession(scoped.client, service().client, OWNER);

    const outcome = await session.apply(
      mutation('category_budget.set', { category: 'food', amountMinor: null, currency: null }),
    );

    expect(outcome).toMatchObject({ status: 'applied' });
    expect(scoped.rpc).toHaveBeenCalledWith('waves_set_category_budget', {
      p_group_id: GROUP_ID,
      p_category: 'food',
      p_amount_minor: null,
      p_currency: null,
    });
  });

  it.each([
    ['missing category', { amountMinor: '25000' }],
    ['numeric category', { category: 12, amountMinor: '25000' }],
    ['missing amount', { category: 'food' }],
    ['numeric amount', { category: 'food', amountMinor: 25000 }],
  ])('refuses a traveller category-budget set with %s', async (_label, payload) => {
    const scoped = caller();
    const session = new SyncSession(scoped.client, service().client, OWNER);

    const outcome = await session.apply(mutation('category_budget.set', payload));

    expect(outcome).toMatchObject({ status: 'rejected', code: 'VALIDATION_FAILED' });
    expect(scoped.rpc).not.toHaveBeenCalled();
  });

  it('lets a financer clear a pinned FX rate with explicit nulls', async () => {
    const scoped = caller();
    const session = new SyncSession(scoped.client, service().client, OWNER);

    const outcome = await session.apply(
      mutation('group_fx_rate.set', { from: 'USD', num: null, den: null, source: 'manual' }),
    );

    expect(outcome).toMatchObject({ status: 'applied' });
    expect(scoped.rpc).toHaveBeenCalledWith('waves_set_group_fx_rate', {
      p_group_id: GROUP_ID,
      p_from: 'USD',
      p_num: null,
      p_den: null,
      p_source: 'manual',
    });
  });

  it.each([
    ['missing currency', { num: '83', den: '1' }],
    ['numeric currency', { from: 840, num: '83', den: '1' }],
    ['missing numerator', { from: 'USD', den: '1' }],
    ['numeric numerator', { from: 'USD', num: 83, den: '1' }],
    ['missing denominator', { from: 'USD', num: '83' }],
    ['numeric denominator', { from: 'USD', num: '83', den: 1 }],
  ])('refuses a financer FX-rate set with %s', async (_label, payload) => {
    const scoped = caller();
    const session = new SyncSession(scoped.client, service().client, OWNER);

    const outcome = await session.apply(mutation('group_fx_rate.set', payload));

    expect(outcome).toMatchObject({ status: 'rejected', code: 'VALIDATION_FAILED' });
    expect(scoped.rpc).not.toHaveBeenCalled();
  });
});
