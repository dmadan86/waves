/**
 * The demo's one-time decision, and its one-way removal.
 *
 * `useDemoActive` is a thin React subscription over these — a hydrated
 * mirror and a `useSync()` context the plain functions here do not need —
 * so the behaviour worth pinning is tested at the level that holds it: a
 * brand-new account gets the demo exactly once, an account that already had
 * groups never does, the decision survives a cold reload the same way every
 * other per-account flag in this app does (`lib/onboardingSeen.ts`,
 * `lib/dismissed.ts`), and removing it is final.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetDemoStoreForTest,
  demoStateSync,
  ensureDemoDecision,
  removeDemo,
  subscribeDemoState,
} from '@/demo/store';

const ALICE = 'user-alice';
const BOB = 'user-bob';

beforeEach(async () => {
  __resetDemoStoreForTest();
  await AsyncStorage.clear();
});

describe('the first decision', () => {
  it('gives a brand-new account the demo', async () => {
    expect(await ensureDemoDecision(ALICE, true)).toBe('active');
    expect(demoStateSync(ALICE)).toBe('active');
  });

  it('never gives an account that already had groups the demo', async () => {
    expect(await ensureDemoDecision(ALICE, false)).toBe('skipped');
    expect(demoStateSync(ALICE)).toBe('skipped');
  });

  it('decides each account independently', async () => {
    await ensureDemoDecision(ALICE, true);
    await ensureDemoDecision(BOB, false);
    expect(demoStateSync(ALICE)).toBe('active');
    expect(demoStateSync(BOB)).toBe('skipped');
  });

  it('is asked only once — a later call with the opposite answer changes nothing', async () => {
    await ensureDemoDecision(ALICE, true);
    expect(await ensureDemoDecision(ALICE, false)).toBe('active');
    expect(demoStateSync(ALICE)).toBe('active');
  });

  it('is unresolved before it is ever asked', () => {
    expect(demoStateSync(ALICE)).toBeNull();
  });

  it('resolves the same decision only once even when asked concurrently', async () => {
    const [a, b] = await Promise.all([
      ensureDemoDecision(ALICE, true),
      ensureDemoDecision(ALICE, false),
    ]);
    // Whichever `isNewAccount` wins the race, both callers must see the same
    // settled answer rather than two different ones for the one account.
    expect(a).toBe(b);
  });
});

describe('surviving a cold reload', () => {
  it('reads back the same decision after the in-memory cache is gone', async () => {
    await ensureDemoDecision(ALICE, true);
    __resetDemoStoreForTest();
    expect(demoStateSync(ALICE)).toBeNull();
    expect(await ensureDemoDecision(ALICE, false)).toBe('active');
  });

  it('reads back a removal the same way', async () => {
    await ensureDemoDecision(ALICE, true);
    await removeDemo(ALICE);
    __resetDemoStoreForTest();
    expect(await ensureDemoDecision(ALICE, true)).toBe('removed');
  });
});

describe('removal', () => {
  it('is final — asking again never reinstates it, whatever is passed', async () => {
    await ensureDemoDecision(ALICE, true);
    await removeDemo(ALICE);
    expect(demoStateSync(ALICE)).toBe('removed');
    expect(await ensureDemoDecision(ALICE, true)).toBe('removed');
  });

  it('tells subscribers at once', async () => {
    await ensureDemoDecision(ALICE, true);
    const heard = vi.fn();
    const off = subscribeDemoState(heard);
    await removeDemo(ALICE);
    expect(heard).toHaveBeenCalled();
    off();
  });

  it('does nothing harmful to an account that was never given the demo', async () => {
    await ensureDemoDecision(ALICE, false); // skipped
    await removeDemo(ALICE);
    expect(demoStateSync(ALICE)).toBe('removed');
  });
});

describe('a storage read that fails', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('still decides from the honest in-memory answer rather than hanging', async () => {
    vi.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('disk'));
    expect(await ensureDemoDecision(ALICE, true)).toBe('active');
  });
});
