/**
 * Two small promises `data/api.ts` makes that nothing else checks.
 *
 * `fetchSettledTotals` — the "settled through you" figure — counts only
 * settlements this person was part of. Row-level security already narrows the
 * rows to groups they are in, but a settlement between two *other* members of
 * the same group is not theirs, and adding it would flatter the number.
 *
 * `writeExpense` — the direct online write — always carries an idempotency key
 * (so a retry after a flaky network cannot double-post), and turns the one
 * refusal a person meets while doing nothing wrong, a rate limit, into a
 * sentence in their own language rather than a code.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  settlementRows: [] as unknown[],
  statusFilter: null as null | { column: string; values: string[] },
  invoke: vi.fn(),
}));

vi.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));
vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }));
vi.mock('@/lib/phoneAuth', () => ({ attachPhoneCode: vi.fn(), sendPhoneCode: vi.fn() }));
vi.mock('@/lib/storage', () => ({ imageUrl: vi.fn(), putImage: vi.fn(), removeImage: vi.fn() }));
vi.mock('@/lib/backend', () => ({
  backendConfigured: true,
  backend: {
    functions: { invoke: h.invoke },
    from: (table: string) => ({
      select: () => ({
        in: async (column: string, values: string[]) => {
          expect(table).toBe('settlements');
          h.statusFilter = { column, values };
          return { data: h.settlementRows, error: null };
        },
      }),
    }),
  },
}));

const { fetchSettledTotals, writeExpense } = await import('@/data/api');
const { STRINGS_BY_LANGUAGE } = await import('@/i18n');

const ME = 'p-me';

const settlement = (
  currency: string,
  amount: string | number,
  from: string | null,
  to: string | null,
) => ({
  currency,
  amount,
  from: from === null ? null : { profile_id: from },
  to: to === null ? null : { profile_id: to },
});

beforeEach(() => {
  h.settlementRows = [];
  h.statusFilter = null;
  h.invoke.mockReset();
});

describe('fetchSettledTotals', () => {
  it('sums only settlements I paid or received, per currency, as bigint', async () => {
    h.settlementRows = [
      settlement('INR', '150000', ME, 'p-ravi'), // I paid
      settlement('INR', 50_000, 'p-asha', ME), // I received (numeric over the wire)
      settlement('INR', '999999', 'p-ravi', 'p-asha'), // between two others — not mine
      settlement('EUR', '2500', ME, 'p-asha'),
      settlement('EUR', '100', null, null), // ghosts on both sides — not mine
      settlement('USD', '700', 'p-ravi', null),
    ];

    const totals = await fetchSettledTotals(ME);

    expect([...totals.entries()]).toEqual([
      ['INR', 200_000n],
      ['EUR', 2_500n],
    ]);
    expect(typeof totals.get('INR' as never)).toBe('bigint');
    // Only settlements that actually closed — never a claim still awaiting a yes.
    expect(h.statusFilter).toEqual({ column: 'status', values: ['confirmed', 'auto_confirmed'] });
  });

  it('is empty, not zero-filled, when nothing of mine has settled', async () => {
    h.settlementRows = [settlement('INR', '100', 'p-ravi', 'p-asha')];
    expect((await fetchSettledTotals(ME)).size).toBe(0);
  });
});

describe('writeExpense', () => {
  const input = {
    groupId: 'g-goa',
    description: 'Dinner',
    expenseDate: '2026-09-01',
    currency: 'INR',
    amount: 90_000n,
    splitParams: { kind: 'equal' } as const,
    participants: ['m-me', 'm-ravi'],
    payers: { 'm-me': 90_000n },
  };

  /** A non-2xx from the edge function, as supabase-js wraps it. */
  const functionError = (status: number, body: unknown, headers: Record<string, string> = {}) => ({
    message: `Edge Function returned a non-2xx status code (${status})`,
    context: {
      headers: new Headers(headers),
      json: async () => body,
    },
  });

  it('mints a UUID idempotency key when the caller did not give one', async () => {
    h.invoke.mockResolvedValue({ data: { expenseId: 'e1', versionId: 'v1', versionNo: 1 } });

    await writeExpense(input);

    const [name, options] = h.invoke.mock.calls[0]!;
    expect(name).toBe('expense-write');
    expect((options as { body: { clientMutationId: string } }).body.clientMutationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('keeps the caller’s idempotency key when one is given', async () => {
    h.invoke.mockResolvedValue({ data: { expenseId: 'e1', versionId: 'v1', versionNo: 1 } });

    await writeExpense({ ...input, clientMutationId: 'retry-key-1' });

    const body = (h.invoke.mock.calls[0]![1] as { body: { clientMutationId: string } }).body;
    expect(body.clientMutationId).toBe('retry-key-1');
  });

  it('says "try again in a little while" for a 429 with a long Retry-After', async () => {
    h.invoke.mockResolvedValue({
      data: null,
      error: functionError(
        429,
        { code: 'RATE_LIMITED', message: 'slow down' },
        { 'Retry-After': '120' },
      ),
    });

    await expect(writeExpense(input)).rejects.toThrow(STRINGS_BY_LANGUAGE.en.common.tooFastLater);
  });

  it('says "wait a moment" for a 429 with a short or missing Retry-After', async () => {
    h.invoke.mockResolvedValue({
      data: null,
      error: functionError(429, { code: 'RATE_LIMITED' }, { 'Retry-After': '30' }),
    });
    await expect(writeExpense(input)).rejects.toThrow(STRINGS_BY_LANGUAGE.en.common.tooFastMoment);

    h.invoke.mockResolvedValue({ data: null, error: functionError(429, { code: 'RATE_LIMITED' }) });
    await expect(writeExpense(input)).rejects.toThrow(STRINGS_BY_LANGUAGE.en.common.tooFastMoment);
  });

  it('surfaces any other refusal as the server’s own code and message', async () => {
    h.invoke.mockResolvedValue({
      data: null,
      error: functionError(403, { code: 'NOT_A_MEMBER', message: 'Not in this group' }),
    });
    await expect(writeExpense(input)).rejects.toThrow('NOT_A_MEMBER: Not in this group');
  });

  it('falls back to the transport message when the body is not JSON', async () => {
    h.invoke.mockResolvedValue({
      data: null,
      error: Object.assign(new Error('Failed to send a request to the Edge Function'), {
        context: {
          headers: new Headers(),
          json: async () => {
            throw new SyntaxError('Unexpected token <');
          },
        },
      }),
    });
    await expect(writeExpense(input)).rejects.toThrow(
      'Failed to send a request to the Edge Function',
    );
  });
});
