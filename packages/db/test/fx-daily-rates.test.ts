/**
 * `fx_daily_rates`, the fx-rate function's daily cache (migration
 * 20261009180000).
 *
 * Pinned: no client role can read or write it — not even zero rows through
 * RLS, a refused grant — and the service role (the edge function) can; and the
 * CHECKs refuse a rate that is not exact digits, an unknown source, an
 * ExchangeRate-API rate (latest-only, so no dated day's), and a second row for
 * the same pair and day.
 */

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { asRole, connect, expectDenied } from './helpers';

let client: Client;

beforeAll(async () => {
  client = await connect();
  await client.query(`DELETE FROM fx_daily_rates WHERE from_currency = 'VND'`);
  await client.query(
    `INSERT INTO fx_daily_rates (from_currency, to_currency, day, num, den, source)
     VALUES ('VND', 'INR', '2026-09-20', '33647', '10000000', 'currency-api')`,
  );
});

afterAll(async () => {
  await client.query(`DELETE FROM fx_daily_rates WHERE from_currency = 'VND'`);
  await client.end();
});

describe('who may reach fx_daily_rates', () => {
  // One statement per transaction: the first refusal aborts the transaction.
  for (const role of ['anon', 'authenticated'] as const) {
    it(`${role} cannot read it`, async () => {
      const denied = await asRole(client, role, { sub: randomUUID(), role }, () =>
        expectDenied(client.query(`SELECT * FROM public.fx_daily_rates`)),
      );
      expect(denied).toMatch(/permission denied/i);
    });

    it(`${role} cannot write it`, async () => {
      const insert = await asRole(client, role, { sub: randomUUID(), role }, () =>
        expectDenied(
          client.query(
            `INSERT INTO public.fx_daily_rates (from_currency, to_currency, day, num, den, source)
             VALUES ('VND', 'INR', '2026-09-21', '1', '1', 'ecb')`,
          ),
        ),
      );
      expect(insert).toMatch(/permission denied/i);

      const update = await asRole(client, role, { sub: randomUUID(), role }, () =>
        expectDenied(client.query(`UPDATE public.fx_daily_rates SET num = '1'`)),
      );
      expect(update).toMatch(/permission denied/i);

      const remove = await asRole(client, role, { sub: randomUUID(), role }, () =>
        expectDenied(client.query(`DELETE FROM public.fx_daily_rates`)),
      );
      expect(remove).toMatch(/permission denied/i);
    });
  }

  it('the service role reads and writes it', async () => {
    await asRole(client, 'service_role', { role: 'service_role' }, async () => {
      await client.query(
        `INSERT INTO public.fx_daily_rates (from_currency, to_currency, day, num, den, source)
         VALUES ('VND', 'INR', '2026-09-22', '3365', '1000000', 'ecb')`,
      );
      const { rows } = await client.query(
        `SELECT num, den FROM public.fx_daily_rates
          WHERE from_currency = 'VND' AND to_currency = 'INR' ORDER BY day DESC LIMIT 1`,
      );
      expect(rows[0]).toEqual({ num: '3365', den: '1000000' });
    });
  });
});

describe('what a row may hold', () => {
  const insert = (over: Record<string, string>) => {
    const row = {
      from: 'VND',
      to: 'INR',
      day: '2026-09-23',
      num: '1',
      den: '1',
      source: 'ecb',
      ...over,
    };
    return client.query(
      `INSERT INTO fx_daily_rates (from_currency, to_currency, day, num, den, source)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [row.from, row.to, row.day, row.num, row.den, row.source],
    );
  };

  it.each([
    ['a decimal num', { num: '0.0033' }],
    ['a zero den', { den: '0' }],
    ['a negative num', { num: '-3' }],
    ['an unknown source', { source: 'manual' }],
    // Latest-only: never any dated day's rate, so never cached as one.
    ['an ExchangeRate-API rate', { source: 'exchangerate-api' }],
    ['a lower-case code', { from: 'vnd' }],
    ['the same currency both sides', { to: 'VND' }],
  ])('refuses %s', async (_name, over) => {
    expect(await expectDenied(insert(over))).toMatch(/violates check constraint/i);
  });

  it('refuses a second row for the same pair and day', async () => {
    expect(await expectDenied(insert({ day: '2026-09-20' }))).toMatch(/duplicate key/i);
  });
});
