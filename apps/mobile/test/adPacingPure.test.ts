import { describe, expect, it } from 'vitest';
import {
  looksAdBlocked,
  AD_PACING_DEFAULTS as defaults,
  gateAllows,
  gateRequired,
  initialPacing,
  nextGap,
  paceExpense,
  type PacingInput,
} from '@/lib/adPacingPure';
const now = Date.UTC(2026, 9, 27, 12);
const input: PacingInput = {
  now,
  createdAt: now - 10 * 86400000,
  sessionStartedAt: now - 120000,
  enabled: true,
  paid: false,
  personal: false,
  saved: true,
  online: true,
  lastAdAt: 0,
  lastRewardedAt: 0,
  lastInterstitialAt: 0,
};
const ready = { ...initialPacing(42), total: 10, since: 5 };
describe('expense pacing', () => {
  it('honors account and expense grace independently, including boundaries', () => {
    expect(paceExpense(ready, { ...input, createdAt: now - 86400000 }).reason).toBe(
      'blocked_grace',
    );
    expect(paceExpense({ ...ready, total: 4 }, input).reason).toBe('blocked_grace');
    expect(
      paceExpense({ ...ready, total: 5 }, { ...input, createdAt: now - 3 * 86400000 }).show,
    ).toBe(true);
  });
  it('never counts or serves personal, paid, offline or failed saves, or disabled rollout', () => {
    for (const patch of [
      { personal: true },
      { paid: true },
      { online: false },
      { saved: false },
      { enabled: false },
    ]) {
      expect(paceExpense(ready, { ...input, ...patch })).toMatchObject({
        state: ready,
        show: false,
      });
    }
  });
  it('generates stable, varying gaps from 3 to 5 and never serves early', () => {
    let seed = 42;
    const gaps = new Set<number>();
    for (let i = 0; i < 100; i++) {
      const roll = nextGap(seed, 3, 5);
      expect(roll).toEqual(nextGap(seed, 3, 5));
      seed = roll.seed;
      gaps.add(roll.gap);
      expect(paceExpense({ ...ready, gap: roll.gap, since: roll.gap - 2 }, input).show).toBe(false);
      const decision = paceExpense({ ...ready, gap: roll.gap, since: roll.gap - 1 }, input);
      expect(decision.show).toBe(true);
      expect(decision.state.since).toBe(0);
    }
    expect([...gaps].sort()).toEqual([3, 4, 5]);
  });
  it('applies cooldown, any-ad spacing and rewarded quiet independently', () => {
    for (const patch of [
      { lastInterstitialAt: now - 179000 },
      { lastAdAt: now - 59000 },
      { lastRewardedAt: now - 299000 },
    ])
      expect(paceExpense(ready, { ...input, ...patch }).show).toBe(false);
    expect(
      paceExpense(ready, {
        ...input,
        lastInterstitialAt: now - 180000,
        lastAdAt: now - 60000,
        lastRewardedAt: now - 300000,
      }).show,
    ).toBe(true);
  });
  it('enforces the UTC daily budget and resets only daily counters at midnight', () => {
    const state = { ...ready, day: '2026-10-27', today: 3 };
    expect(paceExpense(state, input).show).toBe(false);
    const tomorrow = paceExpense(state, { ...input, now: now + 86400000 });
    expect(tomorrow.show).toBe(true);
    expect(tomorrow.state.today).toBe(1);
  });
  it('has a session grace, session cap and purchase/error quiet window', () => {
    expect(paceExpense(ready, { ...input, sessionStartedAt: now - 59000 }).show).toBe(false);
    expect(paceExpense({ ...ready, sessionShown: 2 }, input).show).toBe(false);
    expect(paceExpense(ready, { ...input, sensitiveMoment: true }).show).toBe(false);
  });
  it('uses configured knobs including zero cap and changed gaps', () => {
    expect(paceExpense(ready, input, { ...defaults, interstitial_daily_cap: 0 }).show).toBe(false);
    expect(
      paceExpense({ ...ready, since: 2, gap: 5 }, input, { ...defaults, gap_max: 3 }).show,
    ).toBe(true);
  });
});
describe('gate decisions', () => {
  it('only a watched ad unlocks; failures keep the gate shut', () => {
    expect(gateAllows('failed')).toBe(false);
    expect(gateAllows('completed')).toBe(true);
  });
  it('respects cancellation and early dismissal', () => {
    expect(gateAllows('cancelled')).toBe(false);
    expect(gateAllows('skipped')).toBe(false);
  });
});

it('gates every export and group after the first, never paid or disabled users', () => {
  const group = {
    enabled: true,
    paid: false,
    placement: 'group_create_rewarded' as const,
    createdGroups: 0,
  };
  expect(gateRequired(group)).toBe(false);
  expect(gateRequired({ ...group, createdGroups: 1 })).toBe(true);
  // `enabled` is the server's verdict (rollout or allowlist); a server-disabled status never gates.
  expect(gateRequired({ ...group, createdGroups: 1, enabled: false })).toBe(false);
  expect(gateRequired({ ...group, createdGroups: 10000 })).toBe(true);
  expect(gateRequired({ ...group, placement: 'export_rewarded' })).toBe(true);
  expect(gateRequired({ ...group, placement: 'export_rewarded', paid: true })).toBe(false);
  expect(gateRequired({ ...group, createdGroups: 2, enabled: false })).toBe(false);
});

describe('looksAdBlocked', () => {
  it('spots blocking DNS but not ordinary failures', () => {
    expect(looksAdBlocked('Failed to connect to googleads.g.doubleclick.net/0.0.0.0:443')).toBe(
      true,
    );
    expect(looksAdBlocked('Unable to resolve host "googleads.g.doubleclick.net"')).toBe(true);
    expect(looksAdBlocked('3 No fill.')).toBe(false);
    expect(looksAdBlocked('timeout')).toBe(false);
  });
});

it('requires an ad host for sinkhole evidence and recognizes IPv6 blocking', () => {
  expect(looksAdBlocked('googleads [::]')).toBe(true);
  expect(looksAdBlocked('pagead2 :: port 443')).toBe(true);
  expect(looksAdBlocked('unable to resolve host example.com')).toBe(false);
  expect(looksAdBlocked('googleads 10.0.0.0')).toBe(false);
  expect(looksAdBlocked('pagead2 network-error timeout')).toBe(false);
});
