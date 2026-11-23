import { expect, it } from 'vitest';

import { otherCurrencyChips } from '@/data/totals';

it('splits the non-headline currencies by direction', () => {
  const t = (currency: string, owed: bigint, owing: bigint) => ({
    currency,
    net: owed - owing,
    owed,
    owing,
  });
  expect(
    otherCurrencyChips([t('INR', 10n, 4n), t('USD', 2464n, 0n), t('VND', 0n, 18000n)], 'INR'),
  ).toEqual({
    owed: [{ currency: 'USD', amount: 2464n }],
    owing: [{ currency: 'VND', amount: 18000n }],
  });
});
