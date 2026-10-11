/**
 * A recorded payment carries the day it was paid.
 *
 * `settlement.create` rides the offline queue, so the date the person picked
 * (or "today", chosen on the phone) has to reach `waves_record_settlement`
 * as `p_paid_at`. An older build sends no `paidAt` at all; that must stay a
 * valid mutation, with the database dating the row itself.
 */

import { describe, expect, it, vi } from 'vitest';

import { SyncSession } from './index.ts';

const OWNER = 'owner-profile-id';
const GROUP_ID = '99999999-8888-7777-6666-555555555555';

function caller() {
  const rpc = vi.fn(() => Promise.resolve({ data: 'settlement-id', error: null }));
  return { client: { rpc } as never, rpc };
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

function create(payload: Record<string, unknown>, clientMutationId: string) {
  return {
    clientMutationId,
    kind: 'settlement.create',
    groupId: GROUP_ID,
    seq: 1,
    clientCreatedAt: '2026-10-10T01:00:00.000Z',
    payload: { from: 'm1', to: 'm2', amount: '5000', method: 'upi', ...payload },
  } as never;
}

describe('settlement.create and the paid date', () => {
  it('passes the chosen day to the database', async () => {
    const scoped = caller();
    const session = new SyncSession(scoped.client, service().client, OWNER);

    const outcome = await session.apply(create({ paidAt: '2026-10-08' }, 'paid-1'));

    expect(outcome).toMatchObject({ status: 'applied' });
    expect(scoped.rpc).toHaveBeenCalledWith(
      'waves_record_settlement',
      expect.objectContaining({ p_paid_at: '2026-10-08' }),
    );
  });

  it('leaves the date to the database when an older build sends none', async () => {
    const scoped = caller();
    const session = new SyncSession(scoped.client, service().client, OWNER);

    const outcome = await session.apply(create({}, 'paid-2'));

    expect(outcome).toMatchObject({ status: 'applied' });
    expect(scoped.rpc).toHaveBeenCalledWith(
      'waves_record_settlement',
      expect.objectContaining({ p_paid_at: null }),
    );
  });
});
