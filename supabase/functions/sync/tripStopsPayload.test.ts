/**
 * The itinerary's sync payload is a boundary, not a typed function call.
 *
 * The whole list travels at once, and an empty list is how it is cleared — so
 * a payload that forgot the field, or sent something that is not a list of
 * `{ country, start, end }` strings, must be refused before it reaches the
 * RPC rather than quietly clearing a trip's stops. The calendar rules (order,
 * overlap, inside the trip) are the RPC's and are tested against Postgres in
 * packages/db; this only guards the shape.
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

function mutation(payload: Record<string, unknown>) {
  return {
    clientMutationId: 'trip_stops.set',
    kind: 'trip_stops.set',
    groupId: GROUP_ID,
    seq: 1,
    clientCreatedAt: '2026-09-06T04:00:00.000Z',
    payload,
  } as never;
}

const bali = { country: 'ID', start: '2026-10-01', end: '2026-10-05' };
const singapore = { country: 'SG', start: '2026-10-06', end: '2026-10-08' };

describe('trip itinerary sync payload', () => {
  it('hands the whole list to the RPC', async () => {
    const scoped = caller();
    const session = new SyncSession(scoped.client, service().client, OWNER);

    const outcome = await session.apply(mutation({ stops: [bali, singapore] }));

    expect(outcome).toMatchObject({ status: 'applied' });
    expect(scoped.rpc).toHaveBeenCalledWith('waves_set_trip_stops', {
      p_group_id: GROUP_ID,
      p_stops: [bali, singapore],
    });
  });

  it('clears with an explicit empty list', async () => {
    const scoped = caller();
    const session = new SyncSession(scoped.client, service().client, OWNER);

    const outcome = await session.apply(mutation({ stops: [] }));

    expect(outcome).toMatchObject({ status: 'applied' });
    expect(scoped.rpc).toHaveBeenCalledWith('waves_set_trip_stops', {
      p_group_id: GROUP_ID,
      p_stops: [],
    });
  });

  it('drops anything but the three fields of a stop', async () => {
    const scoped = caller();
    const session = new SyncSession(scoped.client, service().client, OWNER);

    await session.apply(mutation({ stops: [{ ...bali, extra: 'x' }] }));

    expect(scoped.rpc).toHaveBeenCalledWith('waves_set_trip_stops', {
      p_group_id: GROUP_ID,
      p_stops: [bali],
    });
  });

  it.each([
    ['missing stops', {}],
    ['null stops', { stops: null }],
    ['an object instead of a list', { stops: { country: 'ID' } }],
    ['a stop without a country', { stops: [{ start: '2026-10-01', end: '2026-10-05' }] }],
    [
      'a stop with a numeric day',
      { stops: [{ country: 'ID', start: 20261001, end: '2026-10-05' }] },
    ],
    ['a null stop', { stops: [null] }],
    [
      'sixteen stops',
      {
        stops: Array.from({ length: 16 }, (_, i) => ({
          country: 'ID',
          start: `2026-01-${String(i + 1).padStart(2, '0')}`,
          end: `2026-01-${String(i + 1).padStart(2, '0')}`,
        })),
      },
    ],
  ])('refuses %s before the RPC', async (_label, payload) => {
    const scoped = caller();
    const session = new SyncSession(scoped.client, service().client, OWNER);

    const outcome = await session.apply(mutation(payload));

    expect(outcome).toMatchObject({ status: 'rejected', code: 'VALIDATION_FAILED' });
    expect(scoped.rpc).not.toHaveBeenCalledWith('waves_set_trip_stops', expect.anything());
  });
});
