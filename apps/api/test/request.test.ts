/**
 * Idempotency and paging, which are the two places a well-behaved client gets
 * quietly wrong answers rather than errors.
 *
 * The idempotency cases matter most. This API stores no table of past
 * responses — it derives the `client_mutation_id` the ledger already dedups on,
 * so "the same key means the same write" has to hold as an arithmetic property
 * of the derivation rather than as a lookup somebody remembered to do. If the
 * derivation ever became non-deterministic, or stopped including the token, a
 * retry would post a second expense and two developers who both chose the key
 * "1" would overwrite each other.
 */

import { describe, expect, it } from 'vitest';

import { ApiError } from '../src/server/errors';
import {
  decodeCursor,
  derivedId,
  encodeCursor,
  keysetFilter,
  mutationIdFor,
  pageSize,
  queryFlag,
  requiredMutationIdFor,
  toPage,
} from '../src/server/request';

const TOKEN_A = '11111111-1111-4111-8111-111111111111';
const TOKEN_B = '22222222-2222-4222-8222-222222222222';

describe('the idempotency key', () => {
  it('gives the same mutation id for the same key, every time', () => {
    const first = mutationIdFor(TOKEN_A, 'POST /v1/expenses', 'dinner-2026-09-08');
    const second = mutationIdFor(TOKEN_A, 'POST /v1/expenses', 'dinner-2026-09-08');
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('scopes the key to the token, so two developers cannot collide on "1"', () => {
    expect(mutationIdFor(TOKEN_A, 'POST /v1/expenses', 'the-one-key')).not.toBe(
      mutationIdFor(TOKEN_B, 'POST /v1/expenses', 'the-one-key'),
    );
  });

  it('scopes the key to the route, so one key does not tie a write to a payment', () => {
    expect(mutationIdFor(TOKEN_A, 'POST /v1/expenses', 'one-key-only')).not.toBe(
      mutationIdFor(TOKEN_A, 'POST /v1/settlements', 'one-key-only'),
    );
  });

  it('mints a fresh id when no key was sent, because that is what "will not retry" means', () => {
    const a = mutationIdFor(TOKEN_A, 'POST /v1/expenses', null);
    const b = mutationIdFor(TOKEN_A, 'POST /v1/expenses', null);
    expect(a).not.toBe(b);
  });

  it('refuses a key too short to be one', () => {
    // Short keys collide by accident, which is worse than not having one.
    expect(() => mutationIdFor(TOKEN_A, 'POST /v1/expenses', 'abc')).toThrow(ApiError);
    expect(() => mutationIdFor(TOKEN_A, 'POST /v1/expenses', 'x'.repeat(201))).toThrow(ApiError);
  });

  it('derives distinct but stable ids for the several rows one write needs', () => {
    const mutationId = mutationIdFor(TOKEN_A, 'POST /v1/groups', 'trip-to-goa');
    expect(derivedId(mutationId, 'group')).toBe(derivedId(mutationId, 'group'));
    expect(derivedId(mutationId, 'group')).not.toBe(derivedId(mutationId, 'creator-member'));
  });

  it('requires an idempotency key for settlement payments', () => {
    expect(() => requiredMutationIdFor(TOKEN_A, 'POST /v1/settlements', null)).toThrow(ApiError);
    expect(() => requiredMutationIdFor(TOKEN_A, 'POST /v1/settlements', '   ')).toThrow(ApiError);
  });

  it('keeps required settlement ids stable when a key is present', () => {
    expect(requiredMutationIdFor(TOKEN_A, 'POST /v1/settlements', 'upi-payment-42')).toBe(
      requiredMutationIdFor(TOKEN_A, 'POST /v1/settlements', 'upi-payment-42'),
    );
  });
});

describe('paging', () => {
  it('round-trips a cursor', () => {
    const cursor = { key: '2026-09-08T11:22:33.444Z', id: 'abc-123' };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it('refuses a cursor it did not issue rather than silently starting over', () => {
    expect(() => decodeCursor('not a cursor at all')).toThrow(ApiError);
  });

  it('treats a missing cursor as the first page', () => {
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor('')).toBeNull();
  });

  it('caps the page size and refuses a nonsense one', () => {
    expect(pageSize(undefined)).toBe(25);
    expect(pageSize('10')).toBe(10);
    expect(pageSize('100000')).toBe(100);
    expect(() => pageSize('0')).toThrow(ApiError);
    expect(() => pageSize('lots')).toThrow(ApiError);
  });

  it('only offers a next cursor when a row was actually held back', () => {
    const rows = [
      { id: 'c', at: '2026-09-03' },
      { id: 'b', at: '2026-09-02' },
      { id: 'a', at: '2026-09-01' },
    ];
    const cursorOf = (row: (typeof rows)[number]) => ({ key: row.at, id: row.id });

    // Asked for two, fetched three: there is more.
    const partial = toPage(rows, 2, cursorOf);
    expect(partial.data).toHaveLength(2);
    expect(decodeCursor(partial.next_cursor)).toEqual({ key: '2026-09-02', id: 'b' });

    // Asked for three, fetched three: this is the end, and a client that kept
    // following a cursor here would loop on the last page forever.
    const complete = toPage(rows, 3, cursorOf);
    expect(complete.data).toHaveLength(3);
    expect(complete.next_cursor).toBeNull();
  });

  it('breaks the sort-key tie on the id, so same-millisecond rows still advance', () => {
    const filter = keysetFilter({ key: '2026-09-02', id: 'b' }, 'created_at');
    expect(filter).toBe('created_at.lt.2026-09-02,and(created_at.eq.2026-09-02,id.lt.b)');
  });
});

describe('a boolean in a query string', () => {
  it('accepts the spellings people actually type', () => {
    for (const yes of ['true', 'TRUE', '1', 'yes', 'on', ' True ']) {
      expect(queryFlag(yes, 'include_archived'), yes).toBe(true);
    }
    for (const no of ['false', '0', 'no', 'off', 'FALSE']) {
      expect(queryFlag(no, 'include_archived'), no).toBe(false);
    }
  });

  it('treats an absent parameter as false and a nonsense one as a mistake', () => {
    expect(queryFlag(undefined, 'include_archived')).toBe(false);
    expect(queryFlag('', 'include_archived')).toBe(false);
    // The failure this exists to stop: `=maybe` silently reading as false is a
    // plausible answer to a question the caller did not ask.
    expect(() => queryFlag('maybe', 'include_archived')).toThrow(ApiError);
  });
});
