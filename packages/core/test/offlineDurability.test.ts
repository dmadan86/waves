/**
 * What survives when the offline queue holds something the app cannot use.
 *
 * ADR-005 promises that a change is safe the moment it is saved on the phone.
 * Two failures broke that promise in opposite directions, and both are asserted
 * here:
 *
 *  1. A queued mutation the overlay cannot materialise threw out of a
 *     render-time `useMemo`. The payload is on disk, so the throw repeated on
 *     every launch — a crash loop the user cannot escape without reinstalling,
 *     which takes the rest of the queue with it.
 *  2. A transient failure (offline, 5xx) must retry forever, with backoff
 *     capped at five minutes; only a permanent refusal is dead-lettered.
 */

import { describe, expect, it } from 'vitest';

import {
  applyOutcomes,
  backoffMs,
  deadLettered,
  discard,
  enqueue,
  markFailed,
  MAX_ATTEMPTS,
  MutationKind,
  nextBatch,
  overlayPending,
  parseAmount,
  retryNow,
  SyncRejectionCode,
  type MirrorExpense,
  type MutationEnvelope,
  type QueuedMutation,
} from '../src/sync/index.js';

const GROUP = 'group-1';
const OTHER = 'group-2';

const envelope = (
  id: string,
  payload: Record<string, unknown>,
  groupId = GROUP,
): MutationEnvelope => ({
  clientMutationId: id,
  kind: MutationKind.ExpenseCreate,
  groupId,
  clientCreatedAt: '2026-03-01T00:00:00.000Z',
  payload,
});

const goodPayload = (expenseId: string) => ({
  expenseId,
  description: 'Chai',
  expenseDate: '2026-03-01',
  currency: 'INR',
  amount: '900',
  splitParams: { kind: 'equal' },
  participants: ['m1', 'm2'],
  payers: { m1: '900' },
});

/** The shape a build from six months ago, or a truncated write, can leave
 *  behind: everything the overlay reads is present, and the amount is not a
 *  number. `parseAmount` raises a typed MoneyError on it. */
const badPayload = (expenseId: string) => ({
  ...goodPayload(expenseId),
  amount: 'nine hundred',
});

const queued = (envelopes: readonly MutationEnvelope[]): QueuedMutation[] =>
  envelopes.reduce<QueuedMutation[]>((queue, item) => enqueue(queue, item), []);

describe('a queued mutation the overlay cannot materialise', () => {
  it('really is unparseable — the tests below are not asserting a no-op', () => {
    // `pendingShares` calls exactly this on the queued payload's amount. If it
    // ever stopped throwing, every test below would pass for the wrong reason.
    expect(() => parseAmount(badPayload('e1').amount)).toThrow();
  });

  it('is dropped, and every other queued expense still renders', () => {
    const queue = queued([
      envelope('m-good-1', goodPayload('e1')),
      envelope('m-bad', badPayload('e2')),
      envelope('m-good-2', goodPayload('e3')),
    ]);

    const rows = overlayPending([], queue, { groupId: GROUP });

    expect(rows.map((row) => row.id).sort()).toEqual(['e1', 'e3']);
    expect(rows.every((row) => row.pending)).toBe(true);
  });

  it('leaves the server rows it was overlaying untouched', () => {
    const server: MirrorExpense[] = [
      {
        id: 'e-server',
        group_id: GROUP,
        deleted_at: null,
        created_at: '2026-02-01T00:00:00.000Z',
        currentVersion: {
          id: 'v1',
          version_no: 1,
          description: 'Dinner',
          category: null,
          category_meta: null,
          expense_date: '2026-02-01',
          currency: 'INR',
          amount: '1000',
          split_type: 'equal',
          split_params: { kind: 'equal' },
          author_member_id: 'm1',
          notes: null,
          payment_method: null,
          receipt_share_url: null,
          location: null,
          created_at: '2026-02-01T00:00:00.000Z',
          payers: [{ member_id: 'm1', amount: '1000' }],
          shares: [
            { member_id: 'm1', amount: '500' },
            { member_id: 'm2', amount: '500' },
          ],
        },
      } as MirrorExpense,
    ];

    const rows = overlayPending(server, queued([envelope('m-bad', badPayload('e2'))]), {
      groupId: GROUP,
    });

    // The whole point: one bad queue entry must not take the ledger with it.
    expect(rows).toEqual(server);
  });

  it('drops only the bad mutation, not the later edits of other expenses', () => {
    const queue = queued([
      envelope('m-bad', badPayload('e1')),
      envelope('m-good', goodPayload('e2')),
    ]);
    // An update after the bad create, on a different expense, still applies.
    const withUpdate: QueuedMutation[] = [
      ...queue,
      {
        ...envelope('m-update', { ...goodPayload('e2'), description: 'Chai, again' }),
        kind: MutationKind.ExpenseUpdate,
        seq: 3,
        attempts: 0,
        nextAttemptAt: 0,
        lastError: null,
      },
    ];

    const rows = overlayPending([], withUpdate, { groupId: GROUP });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.currentVersion?.description).toBe('Chai, again');
  });
});

describe('a mutation that keeps failing', () => {
  /** Fail the whole queue `times` times: the batch goes out and comes back failed together. */
  const fail = (queue: QueuedMutation[], times: number): QueuedMutation[] => {
    let current = queue;
    for (let attempt = 0; attempt < times; attempt += 1) {
      // Far enough past each backoff that the batch is eligible again.
      const now = (attempt + 1) * backoffMs(1000);
      current = markFailed(current, nextBatch(current, { now }), 'network', now);
    }
    return current;
  };

  const at = (id: string, attempts: number, groupId = GROUP): QueuedMutation => ({
    ...envelope(id, goodPayload(`e-${id}`), groupId),
    seq: Number(id.replace(/\D/g, '')),
    attempts,
    nextAttemptAt: 0,
    lastError: null,
  });

  const refuse = (queue: QueuedMutation[], id: string): QueuedMutation[] =>
    applyOutcomes(queue, [
      {
        clientMutationId: id,
        status: 'rejected',
        code: SyncRejectionCode.ValidationFailed,
        message: 'bad',
      },
    ]).queue;

  it('keeps retrying a network or 5xx failure past the old 8-attempt cap', () => {
    const failed = fail(queued([envelope('m1', goodPayload('e1'))]), MAX_ATTEMPTS + 4);

    expect(failed[0]?.attempts).toBe(MAX_ATTEMPTS + 4);
    expect(deadLettered(failed)).toEqual([]);
    expect(
      nextBatch(failed, { now: Number.MAX_SAFE_INTEGER }).map((i) => i.clientMutationId),
    ).toEqual(['m1']);
  });

  it('caps the backoff at five minutes however many attempts', () => {
    expect(backoffMs(1)).toBe(2000);
    expect(backoffMs(9)).toBe(5 * 60_000);
    expect(backoffMs(1000)).toBe(5 * 60_000);
    const failed = fail(queued([envelope('m1', goodPayload('e1'))]), 30);
    expect((failed[0]?.nextAttemptAt ?? 0) - 30 * backoffMs(1000)).toBe(5 * 60_000);
  });

  it('dead-letters a permanent (4xx) refusal, and holds its own group only', () => {
    const queue = refuse([at('m1', 0), at('m2', 0), at('m3', 0, OTHER)], 'm1');

    expect(deadLettered(queue).map((item) => item.clientMutationId)).toEqual(['m1']);
    expect(nextBatch(queue, { now: 0 }).map((item) => item.clientMutationId)).toEqual(['m3']);
  });

  it('moves again once the user retries the refused head', () => {
    const queue = refuse([at('m1', 0), at('m2', 0)], 'm1');
    const retried = retryNow(queue, 'm1');

    expect(deadLettered(retried)).toEqual([]);
    expect(nextBatch(retried, { now: 0 }).map((item) => item.clientMutationId)).toEqual([
      'm1',
      'm2',
    ]);
  });

  it('moves again once the user discards the refused head', () => {
    const queue = refuse([at('m1', 0), at('m2', 0)], 'm1');
    const dropped = discard(queue, 'm1');

    expect(deadLettered(dropped)).toEqual([]);
    expect(nextBatch(dropped, { now: 0 }).map((item) => item.clientMutationId)).toEqual(['m2']);
  });
});
