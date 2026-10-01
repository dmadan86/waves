import AsyncStorage from '@react-native-async-storage/async-storage';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  EMPTY_PHONE_PROMPT_STATE,
  PHONE_PROMPT_LATER_LIMIT,
  PhonePromptMode,
  phonePromptMode,
  readPhonePromptState,
  withLater,
  writePhonePromptState,
} from '@/lib/phonePrompt';

const TODAY = '2026-10-01';
const YESTERDAY = '2026-09-30';

/** Somebody the ask is for: signed in, no number, on a build that can verify one. */
const ASKABLE = { hasPhone: false, isGuest: false, canVerify: true, enabled: true };

describe('who is asked for a phone number', () => {
  it('asks a signed-in account with no number', () => {
    expect(phonePromptMode(ASKABLE, EMPTY_PHONE_PROMPT_STATE, TODAY)).toBe(PhonePromptMode.Soft);
  });

  it('never asks an account that already has one', () => {
    expect(phonePromptMode({ ...ASKABLE, hasPhone: true }, EMPTY_PHONE_PROMPT_STATE, TODAY)).toBe(
      PhonePromptMode.Hidden,
    );
  });

  it('leaves guests to their own card', () => {
    expect(phonePromptMode({ ...ASKABLE, isGuest: true }, EMPTY_PHONE_PROMPT_STATE, TODAY)).toBe(
      PhonePromptMode.Hidden,
    );
  });

  it('never offers a door this build cannot open', () => {
    expect(phonePromptMode({ ...ASKABLE, canVerify: false }, EMPTY_PHONE_PROMPT_STATE, TODAY)).toBe(
      PhonePromptMode.Hidden,
    );
  });

  it('stays off while the remote switch is off', () => {
    expect(phonePromptMode({ ...ASKABLE, enabled: false }, EMPTY_PHONE_PROMPT_STATE, TODAY)).toBe(
      PhonePromptMode.Hidden,
    );
  });

  it('does not wall in somebody with a number, however often they said later', () => {
    const tired = { laterCount: 10, lastLaterOn: YESTERDAY };
    expect(phonePromptMode({ ...ASKABLE, hasPhone: true }, tired, TODAY)).toBe(
      PhonePromptMode.Hidden,
    );
  });
});

describe('"Later"', () => {
  it('puts the ask off for the rest of the day', () => {
    const once = withLater(EMPTY_PHONE_PROMPT_STATE, TODAY);
    expect(phonePromptMode(ASKABLE, once, TODAY)).toBe(PhonePromptMode.Hidden);
  });

  it('brings it back the next day', () => {
    const once = withLater(EMPTY_PHONE_PROMPT_STATE, YESTERDAY);
    expect(phonePromptMode(ASKABLE, once, TODAY)).toBe(PhonePromptMode.Soft);
  });

  it(`stops being offered after ${PHONE_PROMPT_LATER_LIMIT} times`, () => {
    let state = EMPTY_PHONE_PROMPT_STATE;
    for (let day = 0; day < PHONE_PROMPT_LATER_LIMIT; day += 1) {
      state = withLater(state, YESTERDAY);
    }
    expect(phonePromptMode(ASKABLE, state, TODAY)).toBe(PhonePromptMode.Required);
  });

  it('still lets the last "Later" buy the rest of its day', () => {
    let state = EMPTY_PHONE_PROMPT_STATE;
    for (let day = 0; day < PHONE_PROMPT_LATER_LIMIT; day += 1) {
      state = withLater(state, TODAY);
    }
    expect(phonePromptMode(ASKABLE, state, TODAY)).toBe(PhonePromptMode.Hidden);
    expect(phonePromptMode(ASKABLE, state, '2026-10-02')).toBe(PhonePromptMode.Required);
  });
});

describe('the count on the device', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('starts fresh for an account it has never seen', async () => {
    expect(await readPhonePromptState('alice')).toEqual(EMPTY_PHONE_PROMPT_STATE);
  });

  it('is kept per account, so a second account on the phone starts its own', async () => {
    await writePhonePromptState('alice', { laterCount: 2, lastLaterOn: TODAY });

    expect(await readPhonePromptState('alice')).toEqual({ laterCount: 2, lastLaterOn: TODAY });
    expect(await readPhonePromptState('bob')).toEqual(EMPTY_PHONE_PROMPT_STATE);
  });

  it('reads anything unparseable as a fresh start, never as a wall', async () => {
    await AsyncStorage.setItem('waves.phone_prompt.alice', '{not json');
    expect(await readPhonePromptState('alice')).toEqual(EMPTY_PHONE_PROMPT_STATE);

    await AsyncStorage.setItem('waves.phone_prompt.alice', '{"laterCount":-4,"lastLaterOn":7}');
    expect(await readPhonePromptState('alice')).toEqual(EMPTY_PHONE_PROMPT_STATE);
  });
});
