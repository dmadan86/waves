import { expect, it } from 'vitest';

import { watchBlocked, type CreditsStatus } from '@/lib/adCreditsPure';

const wallet: CreditsStatus = {
  credits: 0,
  walletCap: 30,
  perAd: 6,
  costs: { voice: 1, scan: 2, export: 6, group: 6 },
  canWatch: false,
  reason: null,
  nextAt: null,
};

it.each(['daily_cap', 'voluntary_daily'] as const)('blocks watching for %s', (reason) => {
  expect(watchBlocked({ ...wallet, reason })).toBe('daily');
});

it.each([null, 'ineligible', 'wallet_full', 'hourly_cap', 'gap', 'voluntary_weekly'] as const)(
  'does not treat %s as a daily limit',
  (reason) => expect(watchBlocked({ ...wallet, reason })).toBeNull(),
);

it('does not block an absent wallet or an available watch', () => {
  expect(watchBlocked(null)).toBeNull();
  expect(watchBlocked({ ...wallet, canWatch: true })).toBeNull();
  expect(watchBlocked({ ...wallet, canWatch: true, reason: 'daily_cap' })).toBeNull();
});
