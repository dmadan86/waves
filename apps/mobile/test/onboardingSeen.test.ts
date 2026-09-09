import AsyncStorage from '@react-native-async-storage/async-storage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  forgetTours,
  onboardingSeen,
  rememberOnboardingSeen,
  rememberTourSeen,
  tourSeen,
} from '@/lib/onboardingSeen';

/** The device-wide keys that used to answer on everybody's behalf. */
const OLD_INTRO_KEY = 'waves.onboarding_seen';
const OLDER_INTRO_KEY = 'baaki.onboarding_seen';
const OLD_TOUR_KEY = 'waves.tour_seen_v1';

const ALICE = 'user-alice';
const BOB = 'user-bob';

describe('the intro flag', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('shows the intro to an account that has never seen it', async () => {
    expect(await onboardingSeen(ALICE)).toBe(false);
  });

  it('remembers per account, not per phone', async () => {
    await rememberOnboardingSeen(ALICE);

    expect(await onboardingSeen(ALICE)).toBe(true);
    // The bug this replaces: Bob signing in on Alice's phone never met the tour.
    expect(await onboardingSeen(BOB)).toBe(false);
  });

  it('ignores the old device-wide answer, so an existing account is asked once more', async () => {
    // What a handset that ran the app before the intro moved behind sign-in
    // looks like: somebody swiped past the cards on the login screen, before
    // there was an account to attribute it to.
    await AsyncStorage.setItem(OLD_INTRO_KEY, 'yes');

    expect(await onboardingSeen(ALICE)).toBe(false);
    // And it is not quietly claimed on the way past, so the account after
    // Alice is asked for itself too.
    expect(await onboardingSeen(BOB)).toBe(false);
  });

  it('does not let the old key back in once an account has answered', async () => {
    await AsyncStorage.setItem(OLD_INTRO_KEY, 'yes');
    await rememberOnboardingSeen(ALICE);

    expect(await onboardingSeen(ALICE)).toBe(true);
    expect(await onboardingSeen(BOB)).toBe(false);
  });

  it('writes nowhere but its own account slot', async () => {
    await rememberOnboardingSeen(ALICE);

    expect(await AsyncStorage.getItem(`${OLD_INTRO_KEY}.${ALICE}`)).toBe('yes');
    expect(await AsyncStorage.getItem(OLD_INTRO_KEY)).toBeNull();
  });
});

describe('the coach-mark flag', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('runs the coach-marks for an account that has never had them', async () => {
    expect(await tourSeen(ALICE)).toBe(false);
  });

  it('remembers per account, not per phone', async () => {
    await rememberTourSeen(ALICE);

    expect(await tourSeen(ALICE)).toBe(true);
    expect(await tourSeen(BOB)).toBe(false);
  });

  it('ignores the old device-wide answer', async () => {
    await AsyncStorage.setItem(OLD_TOUR_KEY, 'yes');

    expect(await tourSeen(ALICE)).toBe(false);
  });

  it('is a separate answer from the intro', async () => {
    await rememberOnboardingSeen(ALICE);

    expect(await onboardingSeen(ALICE)).toBe(true);
    expect(await tourSeen(ALICE)).toBe(false);
  });
});

/**
 * The module's one behavioural asymmetry, and the only thing its header spends a
 * paragraph arguing: a phone that cannot answer sends the two flags in opposite
 * directions. Worth pinning, because both directions look arbitrary until you
 * remember which of the two is a full-screen gate.
 */
describe('when storage will not answer', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    // Seeded so neither assertion below can pass by accident: Alice has had the
    // coach-marks and has *not* had the intro, so a working read would answer
    // false then true, and the failing reads have to answer true then false to
    // prove the catch is what spoke.
    await rememberTourSeen(ALICE);

    vi.spyOn(AsyncStorage, 'getItem').mockRejectedValue(new Error('storage unavailable'));
    vi.spyOn(AsyncStorage, 'setItem').mockRejectedValue(new Error('storage unavailable'));
    vi.spyOn(AsyncStorage, 'removeItem').mockRejectedValue(new Error('storage unavailable'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lets the intro through rather than trapping somebody behind it', async () => {
    expect(await onboardingSeen(ALICE)).toBe(true);
  });

  it('offers the coach-marks, because the worst case is a tap on the X', async () => {
    expect(await tourSeen(ALICE)).toBe(false);
  });

  it('reports rather than throws, so a gate is never left waiting', async () => {
    await expect(rememberOnboardingSeen(ALICE)).resolves.toBeUndefined();
    await expect(rememberTourSeen(ALICE)).resolves.toBeUndefined();
    await expect(forgetTours(ALICE)).resolves.toBeUndefined();
  });
});

describe('forgetting a deleted account', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('drops both of its answers and nobody else’s', async () => {
    await rememberOnboardingSeen(ALICE);
    await rememberTourSeen(ALICE);
    await rememberOnboardingSeen(BOB);

    await forgetTours(ALICE);

    expect(await onboardingSeen(ALICE)).toBe(false);
    expect(await tourSeen(ALICE)).toBe(false);
    expect(await onboardingSeen(BOB)).toBe(true);
  });
});

/**
 * One test, not several: `legacyKeys` runs its migration once, at import, so a
 * second case would be asserting against a sweep that had already happened. The
 * seeding therefore covers every shape at once, and the import is the last thing
 * to run.
 */
describe('retiring the device-wide flags', () => {
  it('sweeps them away, and cannot resurrect an answer from the pre-rename key', async () => {
    await AsyncStorage.clear();
    // The `baaki.` source surviving next to an empty `waves.` destination is
    // exactly the shape that used to bring the answer back: a source whose
    // delete failed on an earlier launch was re-migrated on the next one, and
    // the next new account inherited "seen" from it. It is no longer a move.
    await AsyncStorage.setItem(OLDER_INTRO_KEY, 'yes');
    await AsyncStorage.setItem(OLD_INTRO_KEY, 'yes');
    await AsyncStorage.setItem(OLD_TOUR_KEY, 'yes');
    // Something that IS still moved, to prove the sweep did not eat the rest.
    await AsyncStorage.setItem('baaki.theme_scheme', 'dark');

    // Imported here rather than at the top of the file so the keys above are in
    // place before the module runs its one-shot migration on import.
    const { legacyKeysMigrated } = await import('@/lib/legacyKeys');
    await legacyKeysMigrated;

    expect(await AsyncStorage.getItem(OLDER_INTRO_KEY)).toBeNull();
    expect(await AsyncStorage.getItem(OLD_INTRO_KEY)).toBeNull();
    expect(await AsyncStorage.getItem(OLD_TOUR_KEY)).toBeNull();
    expect(await AsyncStorage.getItem('waves.theme_scheme')).toBe('dark');

    // And nobody inherits anything from any of it.
    expect(await onboardingSeen(ALICE)).toBe(false);
    expect(await tourSeen(ALICE)).toBe(false);
  });
});
