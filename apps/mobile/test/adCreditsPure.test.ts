import { describe, expect, it } from 'vitest';
import { creditButtonKey, parseCredits, parseSpend, showCreditsRow } from '@/lib/adCreditsPure';
import { decideGate } from '@/lib/adGateEngine';
const wallet = {
  credits: 6,
  walletCap: 30,
  perAd: 6,
  costs: { voice: 1, scan: 2, export: 6, group: 6 },
  canWatch: true,
  reason: null,
  nextAt: null,
} as const;
const gate = {
  paid: false,
  online: true,
  required: true,
  placement: 'export_rewarded',
  localGroups: 1,
  credits: 0,
  passesUsed: 0,
} as const;
it('parses the server wallet, rejects absent migration keys, and hides the row', () => {
  expect(parseCredits(wallet)).toEqual(wallet);
  for (const raw of [null, undefined, {}, { credits: 6 }, { error: 'missing function' }]) {
    const status = parseCredits(raw);
    expect(status).toBeNull();
    expect(showCreditsRow(false, status)).toBe(false);
    expect(decideGate({ ...gate, credits: status?.credits ?? 0 })).toBe('ask');
  }
  expect(showCreditsRow(true, wallet)).toBe(false);
  expect(showCreditsRow(false, wallet)).toBe(true);
});
it('orders paid, free action, online wallet, then ad; offline never spends', () => {
  expect(decideGate({ ...gate, paid: true })).toBe('allow');
  expect(decideGate({ ...gate, required: false, credits: 6 })).toBe('allow');
  expect(decideGate({ ...gate, credits: 6 })).toBe('use_credit');
  expect(decideGate({ ...gate, credits: 5 })).toBe('ask');
  expect(decideGate({ ...gate, credits: 30, online: false })).toBe('offline_pass');
  expect(decideGate({ ...gate, credits: 30, online: false, passesUsed: 2 })).toBe('offline_capped');
  expect(decideGate({ ...gate, credits: 2, cost: 2 })).toBe('use_credit');
});
it('missing or malformed spend RPC results fail open without throwing', () => {
  for (const raw of [
    null,
    {},
    { error: 'missing function' },
    { ok: true },
    { ok: true, spent: '6' },
    { ok: false },
    { ok: false, reason: 'unknown' },
  ])
    expect(parseSpend(raw)).toBeNull();
  expect(parseSpend({ ok: true, spent: 6 })).toEqual({ ok: true, spent: 6 });
  expect(parseSpend({ ok: false, reason: 'insufficient', credits: 0 })).toMatchObject({
    ok: false,
  });
});
it.each([
  ['daily_cap', 'tomorrow'],
  ['voluntary_daily', 'tomorrow'],
  ['voluntary_weekly', 'later'],
  ['hourly_cap', 'later'],
  ['gap', 'later'],
  ['wallet_full', 'full'],
  ['ineligible', 'unavailable'],
] as const)('maps %s to %s', (reason, key) =>
  expect(creditButtonKey({ ...wallet, canWatch: false, reason })).toBe(key),
);
it('one tap stays available only when server canWatch is true', () =>
  expect(creditButtonKey(wallet)).toBe('watch'));
