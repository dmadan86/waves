import { expect, it } from 'vitest';
import {
  decideGate,
  classifyFailure,
  isNoFill,
  shouldProbeAdHost,
  oweAd,
  shouldOfferOwed,
  afterOwedOutcome,
  OWED_TTL_MS,
  type OwedAd,
} from '@/lib/adGateEngine';

it.each([
  [true, false, null, 'allow'],
  [false, false, false, 'allow'],
  [false, false, true, 'allow_owe'],
  [false, true, null, 'allow_owe'],
  [false, true, true, 'ask'],
] as const)('decides paid=%s online=%s required=%s', (paid, online, required, expected) => {
  expect(decideGate({ paid, online, required })).toBe(expected);
});
it.each([
  [false, 'network-error 0.0.0.0', false, 3, 'offline'],
  [
    true,
    'network-error Failed to connect to googleads.g.doubleclick.net/0.0.0.0:443',
    null,
    0,
    'blocked',
  ],
  [true, 'network-error unreachable', false, 0, 'blocked'],
  [true, 'no-fill', true, 3, 'nofill_allow'],
  [true, 'no-fill', true, 2, 'retry'],
  [true, 'network-error', true, 3, 'retry'],
  [true, 'network-error', null, 3, 'retry'],
  [true, 'unknown', false, 3, 'retry'],
] as const)(
  'classifies online=%s failure=%s reachable=%s streak=%s',
  (online, failure, adHostReachable, noFillStreak, expected) => {
    expect(classifyFailure({ online, failure, adHostReachable, noFillStreak })).toBe(expected);
  },
);
it.each(['no-fill', 'TIMEOUT', 'internal-error', 'mediation-no-fill'])('recognizes %s', (failure) =>
  expect(isNoFill(failure)).toBe(true),
);
it('rejects other failures', () => expect(isNoFill('network-error')).toBe(false));
it.each([
  [false, 'network-error', false],
  [true, 'network-error', true],
  [true, 'UNKNOWN', true],
  [true, 'timeout', false],
  [true, 'network-error 127.0.0.1', false],
] as const)('probes online=%s failure=%s', (online, failure, expected) =>
  expect(shouldProbeAdHost({ online, failure })).toBe(expected),
);
const debt: OwedAd = { placement: 'group_create_rewarded', createdAt: 100, prompts: 0 };
it('creates one debt', () => expect(oweAd(null, debt.placement, 100)).toEqual(debt));
it('keeps existing debt intact', () => expect(oweAd(debt, 'export_rewarded', 200)).toBe(debt));
const ready = { now: 101, online: true, paid: false, promptedThisSession: false, busy: false };
it('has no debt to offer', () => expect(shouldOfferOwed(null, ready)).toBe('none'));
it.each([
  [{ paid: true }, 'clear'],
  [{ now: 100 + OWED_TTL_MS }, 'clear'],
  [{ online: false }, 'wait'],
  [{ promptedThisSession: true }, 'wait'],
  [{ busy: true }, 'wait'],
  [{ now: 99 + OWED_TTL_MS }, 'offer'],
  [{}, 'offer'],
] as const)('offers with %j', (patch, expected) =>
  expect(shouldOfferOwed(debt, { ...ready, ...patch })).toBe(expected),
);
it('clears exhausted prompts before waiting', () =>
  expect(shouldOfferOwed({ ...debt, prompts: 3 }, { ...ready, online: false })).toBe('clear'));
it('completion clears debt', () => expect(afterOwedOutcome(debt, 'completed')).toBeNull());
it.each(['skipped', 'declined'] as const)('%s increments prompts', (outcome) =>
  expect(afterOwedOutcome(debt, outcome)).toEqual({ ...debt, prompts: 1 }),
);
it.each(['skipped', 'declined'] as const)('%s clears at the cap', (outcome) =>
  expect(afterOwedOutcome({ ...debt, prompts: 2 }, outcome)).toBeNull(),
);
it.each(['failed', 'cancelled'] as const)('%s preserves debt', (outcome) =>
  expect(afterOwedOutcome(debt, outcome)).toBe(debt),
);
