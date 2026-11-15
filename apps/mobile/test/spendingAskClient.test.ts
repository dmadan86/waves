import { describe, expect, it, vi } from 'vitest';

import { askRefusal, parseAskAnswer } from '../src/lib/spendingAsk/client';

vi.mock('@/lib/backend', () => ({ backend: { functions: { invoke: vi.fn() } } }));

describe('parseAskAnswer', () => {
  it('accepts a well-formed answer', () => {
    expect(
      parseAskAnswer({
        answer: ' Hi ',
        facts: [{ label: 'Spent', amountMinor: '-100', currency: 'INR' }],
        subscriptions: [
          {
            merchant: 'netflix',
            amountMinor: '64900',
            currency: 'INR',
            cadence: 'monthly',
            lastDate: '2026-10-05',
          },
        ],
      }),
    ).toEqual({
      answer: 'Hi',
      facts: [{ label: 'Spent', amountMinor: '-100', currency: 'INR' }],
      subscriptions: [
        {
          merchant: 'netflix',
          amountMinor: '64900',
          currency: 'INR',
          cadence: 'monthly',
          lastDate: '2026-10-05',
        },
      ],
    });
  });
  it('rejects a reply with no answer', () => {
    expect(parseAskAnswer(null)).toBeNull();
    expect(parseAskAnswer({ answer: '  ' })).toBeNull();
    expect(parseAskAnswer({ answer: 5 })).toBeNull();
  });
  it('drops rows with floats, bad currency or unknown cadence', () => {
    const out = parseAskAnswer({
      answer: 'x',
      facts: [
        { label: 'a', amountMinor: '1.5', currency: 'INR' },
        { label: 'b', amountMinor: '1', currency: 'rupees' },
      ],
      subscriptions: [
        {
          merchant: 'm',
          amountMinor: '1',
          currency: 'INR',
          cadence: 'daily',
          lastDate: '2026-10-05',
        },
        {
          merchant: 'm',
          amountMinor: '-1',
          currency: 'INR',
          cadence: 'monthly',
          lastDate: '2026-10-05',
        },
      ],
    });
    expect(out).toEqual({ answer: 'x', facts: [], subscriptions: [] });
  });
});

describe('askRefusal', () => {
  const failure = (status: number, body: unknown) => ({
    context: new Response(JSON.stringify(body), { status }),
  });
  it('maps statuses and codes', async () => {
    expect(await askRefusal(failure(402, { code: 'SPENDING_ASK_PAID' }))).toEqual({ kind: 'paid' });
    expect(
      await askRefusal(failure(429, { code: 'SPENDING_ASK_QUOTA_REACHED', used: 60, limit: 60 })),
    ).toEqual({
      kind: 'quota',
      used: 60,
      limit: 60,
    });
    expect(await askRefusal(failure(429, { code: 'RATE_LIMITED' }))).toEqual({ kind: 'rate' });
    expect(await askRefusal(failure(503, {}))).toEqual({ kind: 'unavailable' });
    expect(await askRefusal(failure(500, {}))).toEqual({ kind: 'error' });
    expect(await askRefusal(new Error('x'))).toEqual({ kind: 'error' });
  });
});
