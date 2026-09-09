import AsyncStorage from '@react-native-async-storage/async-storage';
import { beforeEach, describe, expect, it } from 'vitest';

import { onboardingSeen, rememberOnboardingSeen } from '@/lib/onboardingSeen';

const DEVICE_KEY = 'waves.onboarding_seen';
const ALICE = 'user-alice';
const BOB = 'user-bob';

describe('onboardingSeen', () => {
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

  it('lets the first account claim the old device-wide flag', async () => {
    await AsyncStorage.setItem(DEVICE_KEY, 'yes');

    // Alice was the one who saw it, so she is not toured again...
    expect(await onboardingSeen(ALICE)).toBe(true);
    expect(await AsyncStorage.getItem(`${DEVICE_KEY}.${ALICE}`)).toBe('yes');
    // ...and the phone stops answering on everybody else's behalf.
    expect(await AsyncStorage.getItem(DEVICE_KEY)).toBeNull();
    expect(await onboardingSeen(BOB)).toBe(false);
  });

  it('keeps the claim across a re-read', async () => {
    await AsyncStorage.setItem(DEVICE_KEY, 'yes');
    await onboardingSeen(ALICE);

    expect(await onboardingSeen(ALICE)).toBe(true);
  });

  it('clears a stale device flag when this account already has its own answer', async () => {
    await rememberOnboardingSeen(ALICE);
    await AsyncStorage.setItem(DEVICE_KEY, 'yes');

    expect(await onboardingSeen(ALICE)).toBe(true);
    expect(await AsyncStorage.getItem(DEVICE_KEY)).toBeNull();
    expect(await onboardingSeen(BOB)).toBe(false);
  });

  it('leaves an untouched device flag alone for a first-run phone', async () => {
    expect(await onboardingSeen(ALICE)).toBe(false);
    expect(await AsyncStorage.getItem(`${DEVICE_KEY}.${ALICE}`)).toBeNull();

    await rememberOnboardingSeen(ALICE);
    expect(await AsyncStorage.getItem(DEVICE_KEY)).toBeNull();
  });
});
