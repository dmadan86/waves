import { describe, expect, it } from 'vitest';

import { groupDebtsByPerson, joinAmounts } from '../src/lib/debtsByPerson';
import type { PlanTransfer } from '../src/lib/settlePlan';

const t = (from: string, to: string, amount: bigint, currency = 'INR'): PlanTransfer => ({
  from,
  to,
  amount,
  currency,
});

const shape = (rows: ReturnType<typeof groupDebtsByPerson>) =>
  rows.map((row) => [row.memberId, row.amounts.map((a) => `${a.currency}:${a.minor}`)]);

describe('groupDebtsByPerson', () => {
  it('folds one person owing in two currencies into one row', () => {
    const rows = groupDebtsByPerson(
      [t('matt', 'me', 2500n, 'EUR'), t('matt', 'me', 295250n, 'INR')],
      'from',
      'INR',
    );
    expect(shape(rows)).toEqual([['matt', ['INR:295250', 'EUR:2500']]]);
    expect(rows[0]?.amounts[1]?.transfer).toEqual(t('matt', 'me', 2500n, 'EUR'));
  });

  it('groups by the payee on the "you owe" side', () => {
    const rows = groupDebtsByPerson(
      [t('me', 'ana', 100n, 'USD'), t('me', 'ana', 200n), t('me', 'bo', 50n)],
      'to',
      'INR',
    );
    expect(shape(rows)).toEqual([
      ['ana', ['INR:200', 'USD:100']],
      ['bo', ['INR:50']],
    ]);
  });

  it('orders people by the group-currency amount, largest first', () => {
    const rows = groupDebtsByPerson(
      [t('a', 'me', 100n), t('b', 'me', 900n), t('c', 'me', 500n)],
      'from',
      'INR',
    );
    expect(rows.map((row) => row.memberId)).toEqual(['b', 'c', 'a']);
  });

  it('puts people with nothing in the group currency after, more currencies first', () => {
    const rows = groupDebtsByPerson(
      [
        t('x', 'me', 10n, 'EUR'),
        t('y', 'me', 5n, 'EUR'),
        t('y', 'me', 7n, 'USD'),
        t('z', 'me', 1n),
      ],
      'from',
      'INR',
    );
    expect(rows.map((row) => row.memberId)).toEqual(['z', 'y', 'x']);
  });

  it('keeps the plan order on ties', () => {
    const rows = groupDebtsByPerson(
      [t('b', 'me', 100n), t('a', 'me', 100n), t('d', 'me', 3n, 'EUR'), t('c', 'me', 4n, 'USD')],
      'from',
      'INR',
    );
    expect(rows.map((row) => row.memberId)).toEqual(['b', 'a', 'd', 'c']);
  });

  it('orders one person’s amounts: group currency, then larger, then by code', () => {
    const rows = groupDebtsByPerson(
      [t('a', 'me', 5n, 'USD'), t('a', 'me', 9n, 'EUR'), t('a', 'me', 5n, 'AED'), t('a', 'me', 1n)],
      'from',
      'INR',
    );
    expect(shape(rows)).toEqual([['a', ['INR:1', 'EUR:9', 'AED:5', 'USD:5']]]);
  });

  it('drops zero amounts', () => {
    expect(groupDebtsByPerson([t('a', 'me', 0n)], 'from', 'INR')).toEqual([]);
  });
});

describe('joinAmounts', () => {
  it('reads as a list', () => {
    expect(joinAmounts([], 'and', ', ')).toBe('');
    expect(joinAmounts(['€25.00'], 'and', ', ')).toBe('€25.00');
    expect(joinAmounts(['€25.00', '₹2,952.50'], 'and', ', ')).toBe('€25.00 and ₹2,952.50');
    expect(joinAmounts(['a', 'b', 'c'], 'and', ', ')).toBe('a, b and c');
  });
});
