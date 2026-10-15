/**
 * The pure half of referrals: codes, links, what the server's answers mean, the
 * progress line and the note that waits for an account. No device needed.
 */

import { describe, expect, it } from 'vitest';

import { redirectSystemPath } from '@/app/+native-intent';
import {
  captureInstallReferrer,
  daysEarnedText,
  daysFraction,
  isDefinitiveRefusal,
  makePendingReferralStore,
  normalizeReferralCode,
  parseClaimOutcome,
  parseMyReferral,
  PENDING_REFERRAL_TTL_MS,
  referralCodeFromInstallReferrer,
  referralCodeFromUrl,
  referralLink,
  referralShareText,
} from '@/lib/referral';

const CODE = 'ABCD2345';

describe('normalizeReferralCode', () => {
  it('accepts a code in any case, with spaces or dashes', () => {
    expect(normalizeReferralCode(CODE)).toBe(CODE);
    expect(normalizeReferralCode('abcd2345')).toBe(CODE);
    expect(normalizeReferralCode(' abcd-2345 ')).toBe(CODE);
    expect(normalizeReferralCode('ABCD 2345')).toBe(CODE);
  });

  it('refuses anything that is not shaped like a code the server mints', () => {
    expect(normalizeReferralCode('')).toBeNull();
    expect(normalizeReferralCode(null)).toBeNull();
    expect(normalizeReferralCode(undefined)).toBeNull();
    expect(normalizeReferralCode('ABCD234')).toBeNull();
    expect(normalizeReferralCode('ABCD23456')).toBeNull();
    // 0, O, 1, I and L are not in the alphabet.
    expect(normalizeReferralCode('ABCD2340')).toBeNull();
    expect(normalizeReferralCode('ABCDO345')).toBeNull();
    expect(normalizeReferralCode('ABCD2I45')).toBeNull();
  });
});

describe('referralLink', () => {
  it('builds /r/<CODE> on the web origin', () => {
    expect(referralLink(CODE, 'https://app.wavs.co.in')).toBe('https://app.wavs.co.in/r/ABCD2345');
    expect(referralLink('abcd-2345', 'https://app.wavs.co.in/')).toBe(
      'https://app.wavs.co.in/r/ABCD2345',
    );
  });

  it('refuses to build a link for a malformed code', () => {
    expect(() => referralLink('nope')).toThrow();
  });
});

describe('referralCodeFromUrl', () => {
  it('reads the app link, the marketing domain and the custom scheme', () => {
    expect(referralCodeFromUrl('https://app.wavs.co.in/r/ABCD2345')).toBe(CODE);
    expect(referralCodeFromUrl('https://app.wavs.co.in/r/abcd2345/')).toBe(CODE);
    expect(referralCodeFromUrl('https://wavs.co.in/r/ABCD2345')).toBe(CODE);
    expect(referralCodeFromUrl('waves://r/ABCD2345')).toBe(CODE);
    expect(referralCodeFromUrl('waves:///r/ABCD2345')).toBe(CODE);
  });

  it('ignores other hosts, other paths and malformed codes', () => {
    expect(referralCodeFromUrl('https://evil.example/r/ABCD2345')).toBeNull();
    expect(referralCodeFromUrl('https://app.wavs.co.in/join#ABCD2345')).toBeNull();
    expect(referralCodeFromUrl('https://app.wavs.co.in/r/SHORT')).toBeNull();
    expect(referralCodeFromUrl('https://app.wavs.co.in/r/ABCD2345/more')).toBeNull();
    expect(referralCodeFromUrl('waves://evil/r/ABCD2345')).toBeNull();
    expect(referralCodeFromUrl('not a url')).toBeNull();
  });

  it('is what the native intent uses to route a referral link', () => {
    expect(redirectSystemPath({ path: 'https://app.wavs.co.in/r/abcd2345', initial: true })).toBe(
      '/r/ABCD2345',
    );
    expect(redirectSystemPath({ path: 'waves://r/ABCD2345', initial: false })).toBe('/r/ABCD2345');
  });
});

describe('referralShareText', () => {
  it('is one line: the message, then the link', () => {
    const text = referralShareText(
      '  I use Waves. Join me:  ',
      'https://app.wavs.co.in/r/ABCD2345',
    );
    expect(text).toBe('I use Waves. Join me: https://app.wavs.co.in/r/ABCD2345');
    expect(text).not.toContain('\n');
  });
});

describe('parseMyReferral', () => {
  const good = {
    ok: true,
    code: CODE,
    invited: 3,
    pending: 1,
    rewarded: 2,
    days_earned: 14,
    days_cap: 30,
    days_remaining: 16,
  };

  it('reads the server shape', () => {
    expect(parseMyReferral(good)).toEqual({
      code: CODE,
      invited: 3,
      pending: 1,
      rewarded: 2,
      daysEarned: 14,
      daysCap: 30,
      daysRemaining: 16,
    });
  });

  it('refuses a guest answer, a bad code and missing numbers', () => {
    expect(parseMyReferral({ ok: false, reason: 'ACCOUNT_REQUIRED' })).toBeNull();
    expect(parseMyReferral({ ...good, code: 'x' })).toBeNull();
    expect(parseMyReferral({ ...good, days_earned: undefined })).toBeNull();
    expect(parseMyReferral({ ...good, pending: -1 })).toBeNull();
    expect(parseMyReferral(null)).toBeNull();
    expect(parseMyReferral('nope')).toBeNull();
  });
});

describe('claim outcomes', () => {
  it('reads an acceptance and each refusal', () => {
    expect(parseClaimOutcome({ ok: true, referral_id: 'x' })).toEqual({ ok: true });
    expect(parseClaimOutcome({ ok: false, reason: 'SELF_REFERRAL' })).toEqual({
      ok: false,
      reason: 'SELF_REFERRAL',
    });
    expect(parseClaimOutcome({ ok: false, reason: 'SOMETHING_NEW' })).toEqual({
      ok: false,
      reason: 'UNKNOWN',
    });
    expect(parseClaimOutcome(null)).toEqual({ ok: false, reason: 'UNKNOWN' });
  });

  it('drops the remembered code for a final answer, keeps it for one that can change', () => {
    for (const reason of [
      'UNKNOWN_CODE',
      'SELF_REFERRAL',
      'ALREADY_CLAIMED',
      'NOT_NEW_USER',
    ] as const) {
      expect(isDefinitiveRefusal(reason)).toBe(true);
    }
    expect(isDefinitiveRefusal('ACCOUNT_REQUIRED')).toBe(false);
    expect(isDefinitiveRefusal('UNKNOWN')).toBe(false);
  });
});

describe('days text', () => {
  const copy = { progress: '{earned} of {cap} days earned', capReached: 'All {cap} days earned' };

  it('says how many days are earned out of the cap', () => {
    expect(daysEarnedText({ daysEarned: 0, daysCap: 30, daysRemaining: 30 }, copy)).toBe(
      '0 of 30 days earned',
    );
    expect(daysEarnedText({ daysEarned: 21, daysCap: 30, daysRemaining: 9 }, copy)).toBe(
      '21 of 30 days earned',
    );
  });

  it('switches to the cap sentence when nothing more can be earned', () => {
    expect(daysEarnedText({ daysEarned: 30, daysCap: 30, daysRemaining: 0 }, copy)).toBe(
      'All 30 days earned',
    );
  });

  it('turns earned days into a 0-1 fraction that never leaves that range', () => {
    expect(daysFraction({ daysEarned: 15, daysCap: 30 })).toBe(0.5);
    expect(daysFraction({ daysEarned: 45, daysCap: 30 })).toBe(1);
    expect(daysFraction({ daysEarned: 0, daysCap: 0 })).toBe(0);
  });
});

describe('the pending referral note', () => {
  function memory() {
    const map = new Map<string, string>();
    return {
      map,
      storage: {
        getItem: async (key: string) => map.get(key) ?? null,
        setItem: async (key: string, value: string) => void map.set(key, value),
        removeItem: async (key: string) => void map.delete(key),
      },
    };
  }

  it('remembers a code and gives it back until cleared', async () => {
    const { storage } = memory();
    const store = makePendingReferralStore(storage);
    expect(await store.peek()).toBeNull();
    await store.remember('abcd-2345');
    expect(await store.peek()).toBe(CODE);
    expect(await store.peek()).toBe(CODE);
    await store.clear();
    expect(await store.peek()).toBeNull();
  });

  it('does not keep something that is not a code', async () => {
    const { storage, map } = memory();
    await makePendingReferralStore(storage).remember('nope');
    expect(map.size).toBe(0);
  });

  it('lets a stale note expire', async () => {
    const { storage } = memory();
    let now = 1_000;
    const store = makePendingReferralStore(storage, () => now);
    await store.remember(CODE);
    now += PENDING_REFERRAL_TTL_MS + 1;
    expect(await store.peek()).toBeNull();
  });

  it('never throws when storage does', async () => {
    const broken = {
      getItem: async () => {
        throw new Error('keystore');
      },
      setItem: async () => {
        throw new Error('keystore');
      },
      removeItem: async () => {
        throw new Error('keystore');
      },
    };
    const store = makePendingReferralStore(broken);
    await expect(store.remember(CODE)).resolves.toBeUndefined();
    await expect(store.peek()).resolves.toBeNull();
    await expect(store.clear()).resolves.toBeUndefined();
  });
});

describe('referralCodeFromInstallReferrer', () => {
  it('reads the code from a plain referrer', () => {
    expect(referralCodeFromInstallReferrer('waves_ref=ABCD2345')).toBe(CODE);
  });

  it('reads an urlencoded referrer and a lower-case code', () => {
    expect(referralCodeFromInstallReferrer('waves_ref%3Dabcd2345')).toBe(CODE);
    expect(referralCodeFromInstallReferrer('waves_ref=abcd%2D2345')).toBe(CODE);
  });

  it('ignores extra utm params around it', () => {
    expect(
      referralCodeFromInstallReferrer(
        'utm_source=google-play&utm_medium=organic&waves_ref=ABCD2345&utm_campaign=x',
      ),
    ).toBe(CODE);
  });

  it('is null for garbage, a bad code, a missing key and an empty string', () => {
    expect(referralCodeFromInstallReferrer('')).toBeNull();
    expect(referralCodeFromInstallReferrer('   ')).toBeNull();
    expect(referralCodeFromInstallReferrer(null)).toBeNull();
    expect(referralCodeFromInstallReferrer('utm_source=google-play&utm_medium=organic')).toBeNull();
    expect(referralCodeFromInstallReferrer('%%%&&==')).toBeNull();
    expect(referralCodeFromInstallReferrer('waves_ref=')).toBeNull();
    expect(referralCodeFromInstallReferrer('waves_ref=ABCD234')).toBeNull();
    expect(referralCodeFromInstallReferrer('waves_ref=ABCD2340')).toBeNull();
    expect(referralCodeFromInstallReferrer('other_ref=ABCD2345')).toBeNull();
  });
});

describe('captureInstallReferrer', () => {
  const setup = (opts: { referrer: string | null; checked?: boolean; waiting?: string | null }) => {
    let checked = opts.checked ?? false;
    let waiting = opts.waiting ?? null;
    const reads: number[] = [];
    return {
      deps: {
        read: async () => {
          reads.push(1);
          return opts.referrer;
        },
        done: async () => checked,
        markDone: async () => {
          checked = true;
        },
        pending: {
          peek: async () => waiting,
          remember: async (c: string) => {
            waiting = c;
          },
        },
      },
      state: () => ({ checked, waiting, reads: reads.length }),
    };
  };

  it('stores the code as the pending referral, once', async () => {
    const t = setup({ referrer: 'waves_ref=ABCD2345' });
    expect(await captureInstallReferrer(t.deps)).toBe(CODE);
    expect(t.state()).toMatchObject({ checked: true, waiting: CODE });
    expect(await captureInstallReferrer(t.deps)).toBeNull();
    expect(t.state().reads).toBe(1);
  });

  it('never overwrites a code that came from a deep link', async () => {
    const t = setup({ referrer: 'waves_ref=ABCD2345', waiting: 'WXYZ6789' });
    expect(await captureInstallReferrer(t.deps)).toBeNull();
    expect(t.state().waiting).toBe('WXYZ6789');
  });

  it('does nothing for a missing or junk referrer, and does not ask again', async () => {
    const t = setup({ referrer: null });
    expect(await captureInstallReferrer(t.deps)).toBeNull();
    expect(t.state()).toMatchObject({ checked: true, waiting: null });
  });

  it('never throws', async () => {
    const t = setup({ referrer: null });
    t.deps.read = async () => {
      throw new Error('boom');
    };
    expect(await captureInstallReferrer(t.deps)).toBeNull();
  });
});
