import AsyncStorage from '@react-native-async-storage/async-storage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  EMPTY_PHONE_PROMPT_STATE,
  PHONE_PROMPT_LATER_LIMIT,
  PHONE_PROMPT_LATER_BACKOFF_DAYS,
  localDay,
  PhonePromptMode,
  phonePromptMode,
  readPhonePromptShown,
  readPhonePromptState,
  writePhonePromptShown,
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

  it('never becomes required', () => {
    let state = EMPTY_PHONE_PROMPT_STATE;
    for (let day = 0; day < PHONE_PROMPT_LATER_LIMIT; day += 1) {
      state = withLater(state, YESTERDAY);
    }
    expect(phonePromptMode(ASKABLE, state, TODAY)).toBe(PhonePromptMode.Soft);
  });

  it('uses the daily pause before the limit and a 30-day pause after', () => {
    let state = EMPTY_PHONE_PROMPT_STATE;
    state = withLater(state, TODAY);
    expect(phonePromptMode(ASKABLE, state, TODAY)).toBe(PhonePromptMode.Hidden);
    expect(phonePromptMode(ASKABLE, state, '2026-10-02')).toBe(PhonePromptMode.Soft);

    for (let count = 1; count < PHONE_PROMPT_LATER_LIMIT; count += 1) {
      state = withLater(state, TODAY);
    }
    expect(phonePromptMode(ASKABLE, state, '2026-10-02')).toBe(PhonePromptMode.Soft);
    state = withLater(state, '2026-10-02');
    expect(phonePromptMode(ASKABLE, state, '2026-10-31')).toBe(PhonePromptMode.Hidden);
    expect(phonePromptMode(ASKABLE, state, '2026-11-01')).toBe(PhonePromptMode.Soft);
    expect(PHONE_PROMPT_LATER_BACKOFF_DAYS).toBe(30);
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

describe('"Later" holds on every runtime', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('names the day as YYYY-MM-DD even when Intl formats it another way', () => {
    // Hermes with an India locale answered d/m/y here, which parsed to NaN and
    // made "Later" never hide the ask.
    vi.stubGlobal('Intl', {
      DateTimeFormat: class {
        format = () => '28/11/2026';
      },
    });
    expect(localDay(new Date(2026, 10, 28, 12))).toBe('2026-11-28');
  });

  it('keeps hiding the ask for today when the stored day is unreadable', () => {
    const state = { laterCount: 1, lastLaterOn: '28/11/2026' };
    expect(phonePromptMode(ASKABLE, state, '2026-11-28')).toBe(PhonePromptMode.Hidden);
  });

  it('rewrites an unreadable stored day once, so the cooldown can end', async () => {
    await AsyncStorage.setItem(
      'waves.phone_prompt.u1',
      JSON.stringify({ laterCount: 1, lastLaterOn: '11/28/2026' }),
    );
    const state = await readPhonePromptState('u1');
    expect(state.lastLaterOn).toBe(localDay());
    expect(phonePromptMode(ASKABLE, state, localDay())).toBe(PhonePromptMode.Hidden);
    const later = new Date();
    later.setDate(later.getDate() + 2);
    expect(phonePromptMode(ASKABLE, state, localDay(later))).toBe(PhonePromptMode.Soft);
    expect(await readPhonePromptState('u1')).toEqual(state);
  });
});

describe('shown today', () => {
  beforeEach(async () => AsyncStorage.clear());

  it('stays quiet for the rest of the day once shown, even if never answered', () => {
    expect(phonePromptMode(ASKABLE, EMPTY_PHONE_PROMPT_STATE, TODAY, TODAY)).toBe(
      PhonePromptMode.Hidden,
    );
    expect(phonePromptMode(ASKABLE, EMPTY_PHONE_PROMPT_STATE, TODAY, YESTERDAY)).toBe(
      PhonePromptMode.Soft,
    );
  });

  it('remembers the day per account and ignores junk', async () => {
    expect(await readPhonePromptShown('alice')).toBeNull();
    await writePhonePromptShown('alice', TODAY);
    expect(await readPhonePromptShown('alice')).toBe(TODAY);
    expect(await readPhonePromptShown('bob')).toBeNull();
    await AsyncStorage.setItem('waves.phone_prompt_shown.alice', 'garbage');
    expect(await readPhonePromptShown('alice')).toBeNull();
  });
});
