/**
 * "Just me", carried out: drafts become personal records, and a draft is closed
 * only after its record is queued. What the person is told has to be true about
 * both halves of a partial run.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CaptureRow } from '@/data/types';

import { flush, renderHook } from './support/fakeReact';

vi.mock('react', async () => (await import('./support/fakeReact')).reactModule());

const h = vi.hoisted(() => ({
  upsert: vi.fn(async (_input: { recordId: string; recordKind: string; data: unknown }) => {}),
  close: vi.fn(async (_id: string) => {}),
  blockWrite: vi.fn(() => false),
  toast: vi.fn(),
  notify: vi.fn(async (_input: { title: string; body: string }) => {}),
}));

vi.mock('@/data/hooks', () => ({ useDeleteCapture: () => ({ mutateAsync: h.close }) }));
vi.mock('@/data/personal', () => ({ useUpsertPersonalRecord: () => ({ mutateAsync: h.upsert }) }));
vi.mock('@/lib/guestGuard', () => ({ useGuestGuard: () => ({ blockWrite: h.blockWrite }) }));
vi.mock('@/lib/toast', () => ({ useToast: () => ({ show: h.toast }) }));
vi.mock('@/lib/dialog', () => ({ useDialog: () => ({ notify: h.notify }) }));
vi.mock('@/lib/errors', () => ({
  friendlyError: (caught: unknown, fallback: string) =>
    `${fallback} (${caught instanceof Error ? caught.message : String(caught)})`,
}));
vi.mock('@/i18n', () => ({
  plural: (_locale: string, count: number, form: string) => `${count} ${form}`,
  useStrings: () => ({
    locale: 'en',
    t: {
      voice: { anExpense: 'An expense' },
      captures: {
        title: 'Captures',
        placedInPersonal: 'filed under just me',
        assignBatchSomeFailed: 'still waiting',
        couldNotSave: 'Could not save',
      },
    },
  }),
}));

const { usePlaceInPersonal } = await import('@/lib/usePlaceInPersonal');

function capture(id: string, amount: unknown = '45000'): CaptureRow {
  return {
    id,
    description: 'Dinner',
    category: null,
    currency: 'INR',
    amount,
    expense_date: '2026-03-10',
  } as unknown as CaptureRow;
}

const place = () => renderHook(() => usePlaceInPersonal()).result.current;

beforeEach(() => {
  h.upsert.mockReset();
  h.close.mockReset();
  h.blockWrite.mockReset().mockReturnValue(false);
  h.toast.mockReset();
  h.notify.mockReset();
});

describe('usePlaceInPersonal', () => {
  it('queues each record, then closes its draft, and says how many landed', async () => {
    const order: string[] = [];
    h.upsert.mockImplementation(async ({ recordId }) => void order.push(`upsert ${recordId}`));
    h.close.mockImplementation(async (id) => void order.push(`close ${id}`));

    const done = await place()({ lockKey: 'a', items: [capture('a'), capture('b')] });

    expect(done).toEqual(['a', 'b']);
    expect(order).toEqual(['upsert a', 'close a', 'upsert b', 'close b']);
    expect(h.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ recordId: 'a', recordKind: 'txn' }),
    );
    expect(h.toast).toHaveBeenCalledWith('2 filed under just me');
    expect(h.notify).not.toHaveBeenCalled();
  });

  it('says nothing for an empty pile', async () => {
    expect(await place()({ lockKey: 'a', items: [] })).toEqual([]);
    expect(h.toast).not.toHaveBeenCalled();
  });

  it('keeps a draft whose record was refused, and names both halves and the reason', async () => {
    h.upsert.mockImplementation(async ({ recordId }) => {
      if (recordId === 'b') throw new Error('queue full');
    });

    const done = await place()({ lockKey: 'a', items: [capture('a'), capture('b')] });

    expect(done).toEqual(['a']);
    expect(h.close).toHaveBeenCalledTimes(1);
    expect(h.close).toHaveBeenCalledWith('a');
    expect(h.notify).toHaveBeenCalledWith({
      title: 'Captures',
      body: '1 filed under just me\n\n1 still waiting\n\nCould not save (queue full)',
    });
  });

  it('reports a draft with no usable amount as still waiting, without inventing a reason', async () => {
    const done = await place()({ lockKey: 'x', items: [capture('x', 'lots')] });

    expect(done).toEqual([]);
    expect(h.upsert).not.toHaveBeenCalled();
    expect(h.notify).toHaveBeenCalledWith({ title: 'Captures', body: '1 still waiting' });
  });

  it('writes nothing for a guest', async () => {
    h.blockWrite.mockReturnValue(true);

    expect(await place()({ lockKey: 'a', items: [capture('a')] })).toEqual([]);
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it('ignores a second tap on the same target while the first is still filing', async () => {
    let release!: () => void;
    h.upsert.mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)));
    const run = place();

    const first = run({ lockKey: 'a', items: [capture('a')] });
    const second = await run({ lockKey: 'a', items: [capture('a')] });
    expect(second).toEqual([]);

    release();
    expect(await first).toEqual(['a']);
    await flush();

    // And the lock is released once the first finishes.
    expect(await run({ lockKey: 'a', items: [capture('a')] })).toEqual(['a']);
  });

  it('turns a failure outside the loop into a toast, leaving the drafts where they were', async () => {
    h.notify.mockRejectedValueOnce(new Error('dialog gone'));

    const done = await place()({ lockKey: 'x', items: [capture('x', null)] });

    expect(done).toEqual([]);
    expect(h.toast).toHaveBeenCalledWith('Could not save (dialog gone)', 'negative');
  });
});
