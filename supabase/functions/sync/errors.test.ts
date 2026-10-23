import { describe, expect, it, vi } from 'vitest';

import { HttpError } from '../_shared/auth.ts';
import { SyncSession } from './index.ts';

function setup() {
  let recorded: { result: unknown } | null = null;
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({ data: recorded, error: null }),
    insert: async (row: { result: unknown }) => {
      recorded = row;
      return { error: null };
    },
  };
  const session = new SyncSession({} as never, { from: () => query } as never, 'owner');
  const dispatch = vi.spyOn(session as unknown as { dispatch: () => Promise<unknown> }, 'dispatch');
  const mutation = {
    clientMutationId: 'retry-1',
    kind: 'group.update',
    groupId: 'group-1',
    payload: {},
  } as never;
  return { session, dispatch, mutation };
}

describe('mutation errors', () => {
  it.each([
    { code: '57014', message: 'statement timeout' },
    { code: '23505', message: 'duplicate key from overlapping replay' },
    new HttpError(503, 'UNAVAILABLE', 'try again'),
  ])('fails the request and permits idempotent replay: %s', async (error) => {
    const { session, dispatch, mutation } = setup();
    dispatch.mockRejectedValueOnce(error).mockResolvedValue({ id: 'saved' });
    await expect(session.apply(mutation)).rejects.toBe(error);
    expect(await session.apply(mutation)).toMatchObject({
      status: 'applied',
      result: { id: 'saved' },
    });
    expect(await session.apply(mutation)).toMatchObject({
      status: 'duplicate',
      result: { id: 'saved' },
    });
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it.each([
    { code: 'P0001', message: 'BAD_AMOUNT: invalid amount' },
    { code: '23514', message: 'check constraint violated' },
    { code: '42501', message: 'permission denied' },
  ])('keeps deterministic errors rejected: %s', async (error) => {
    const { session, dispatch, mutation } = setup();
    dispatch.mockRejectedValue(error);
    expect(await session.apply(mutation)).toMatchObject({ status: 'rejected' });
  });
});
