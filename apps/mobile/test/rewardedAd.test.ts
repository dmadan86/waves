/**
 * The rewarded-ad flow with a fake SDK: every way it can end, and the promise
 * that nothing is granted by the phone — the outcome is 'credited' only when the
 * server's own count went up.
 */

import { describe, expect, it, vi } from 'vitest';

import { runRewardedAd, type AdsSdk, type RewardedAdDeps } from '@/lib/rewardedAd';
import type { AdsStatus } from '@/lib/rewardedAdsPure';

type Listener = (payload?: unknown) => void;

const EVENTS = {
  AdEventType: { LOADED: 'loaded', CLOSED: 'closed', ERROR: 'error' },
  RewardedAdEventType: { LOADED: 'rewarded_loaded', EARNED_REWARD: 'rewarded_earned_reward' },
};

interface Script {
  /** What happens once load() is called. */
  onLoad: (emit: (type: string, payload?: unknown) => void) => void;
  canRequestAds?: boolean;
  consentFails?: boolean;
  showFails?: boolean;
}

function fakeSdk(script: Script) {
  const listeners = new Map<string, Listener[]>();
  const emit = (type: string, payload?: unknown): void => {
    for (const l of listeners.get(type) ?? []) l(payload);
  };
  const created: { unit: string; options: Record<string, unknown> }[] = [];
  const setRequestConfiguration = vi.fn(async () => undefined);
  const initialize = vi.fn(async () => undefined);
  const sdk: AdsSdk = {
    ...EVENTS,
    MobileAds: () => ({ setRequestConfiguration, initialize }),
    AdsConsent: {
      gatherConsent: async () => {
        if (script.consentFails) throw new Error('network error');
        return { canRequestAds: script.canRequestAds ?? true };
      },
      requestInfoUpdate: async () => ({ privacyOptionsRequirementStatus: 'NOT_REQUIRED' }),
      showPrivacyOptionsForm: async () => undefined,
    },
    RewardedAd: {
      createForAdRequest: (unit, options) => {
        created.push({ unit, options });
        return {
          addAdEventListener: (type, listener) => {
            listeners.set(type, [...(listeners.get(type) ?? []), listener]);
            return () => {
              listeners.set(
                type,
                (listeners.get(type) ?? []).filter((l) => l !== listener),
              );
            };
          },
          load: () => script.onLoad(emit),
          show: async () => {
            if (script.showFails) throw new Error('internal');
          },
        };
      },
    },
  };
  return { sdk, created, setRequestConfiguration, initialize };
}

const status = (usedToday: number): AdsStatus => ({
  eligible: true,
  reason: null,
  usedToday,
  dailyCap: 3,
  voicePerAd: 2,
  scansPerAd: 2,
});

function deps(over: Partial<RewardedAdDeps> & { sdk?: AdsSdk } = {}): RewardedAdDeps {
  const { sdk, ...rest } = over;
  return {
    loadSdk: async () => {
      if (!sdk) throw new Error('not installed');
      return sdk;
    },
    isOnline: async () => true,
    unitId: () => 'ca-app-pub-3940256099942544/5224354917',
    readStatus: async () => status(1),
    sleep: async () => undefined,
    ...rest,
  };
}

const input = { profileId: 'profile-1', kind: 'voice' as const, baselineUsedToday: 0 };

/** load -> loaded -> earned -> closed */
const watched: Script['onLoad'] = (emit) => {
  queueMicrotask(() => {
    emit('rewarded_loaded');
    emit('rewarded_earned_reward', { amount: 1, type: 'Reward' });
    emit('closed');
  });
};

describe('runRewardedAd', () => {
  it('is credited only when the server count went up, with a non-personalized request carrying the SSV ids', async () => {
    const f = fakeSdk({ onLoad: watched });
    const outcome = await runRewardedAd(input, deps({ sdk: f.sdk }));
    expect(outcome).toBe('credited');
    expect(f.created).toEqual([
      {
        unit: 'ca-app-pub-3940256099942544/5224354917',
        options: {
          requestNonPersonalizedAdsOnly: true,
          serverSideVerificationOptions: { userId: 'profile-1', customData: 'voice' },
        },
      },
    ]);
    expect(f.setRequestConfiguration).toHaveBeenCalledWith({
      maxAdContentRating: 'PG',
      tagForChildDirectedTreatment: false,
      tagForUnderAgeOfConsent: false,
      testDeviceIdentifiers: [],
    });
  });

  it("is pending, not credited, when Google's callback has not reached the server yet", async () => {
    const f = fakeSdk({ onLoad: watched });
    const outcome = await runRewardedAd(
      input,
      deps({ sdk: f.sdk, readStatus: async () => status(0) }),
    );
    expect(outcome).toBe('pending');
  });

  it('never trusts the ad event alone: a reward event with no server count is not credited', async () => {
    const f = fakeSdk({ onLoad: watched });
    const read = vi.fn(async () => null);
    expect(await runRewardedAd(input, deps({ sdk: f.sdk, readStatus: read }))).toBe('pending');
    expect(read).toHaveBeenCalled();
  });

  it('closing early earns nothing and does not even ask the server', async () => {
    const f = fakeSdk({
      onLoad: (emit) =>
        queueMicrotask(() => {
          emit('rewarded_loaded');
          emit('closed');
        }),
    });
    const read = vi.fn(async () => status(1));
    expect(await runRewardedAd(input, deps({ sdk: f.sdk, readStatus: read }))).toBe('closed-early');
    expect(read).not.toHaveBeenCalled();
  });

  it('says no-fill when the network has no ad', async () => {
    const f = fakeSdk({
      onLoad: (emit) =>
        queueMicrotask(() => emit('error', { code: 'googleMobileAds/error-code-no-fill' })),
    });
    expect(await runRewardedAd(input, deps({ sdk: f.sdk }))).toBe('no-fill');
  });

  it('maps a network failure while loading to offline, and other failures to error', async () => {
    const net = fakeSdk({
      onLoad: (emit) => queueMicrotask(() => emit('error', { message: 'network error' })),
    });
    expect(await runRewardedAd(input, deps({ sdk: net.sdk }))).toBe('offline');
    const other = fakeSdk({
      onLoad: (emit) => queueMicrotask(() => emit('error', { code: 'internal-error' })),
    });
    expect(await runRewardedAd(input, deps({ sdk: other.sdk }))).toBe('error');
  });

  it('is an error when show() itself fails', async () => {
    const f = fakeSdk({
      showFails: true,
      onLoad: (emit) => queueMicrotask(() => emit('rewarded_loaded')),
    });
    expect(await runRewardedAd(input, deps({ sdk: f.sdk }))).toBe('error');
  });

  it('is offline without touching the SDK when the phone has no connection', async () => {
    const loadSdk = vi.fn(async () => fakeSdk({ onLoad: watched }).sdk);
    expect(await runRewardedAd(input, deps({ loadSdk, isOnline: async () => false }))).toBe(
      'offline',
    );
    expect(loadSdk).not.toHaveBeenCalled();
  });

  it('is unavailable when the SDK is not in this build', async () => {
    expect(await runRewardedAd(input, deps())).toBe('unavailable');
  });

  it('stops at the consent choice: no request is made when ads may not be requested', async () => {
    const f = fakeSdk({ canRequestAds: false, onLoad: watched });
    expect(await runRewardedAd(input, deps({ sdk: f.sdk }))).toBe('consent');
    expect(f.created).toHaveLength(0);
    expect(f.initialize).not.toHaveBeenCalled();
  });

  it('still loads the ad when the consent check itself errors', async () => {
    const f = fakeSdk({ consentFails: true, onLoad: watched });
    expect(await runRewardedAd(input, deps({ sdk: f.sdk }))).toBe('credited');
  });

  it('gives up on an ad that never loads', async () => {
    vi.useFakeTimers();
    try {
      const f = fakeSdk({ onLoad: () => undefined });
      const run = runRewardedAd(input, deps({ sdk: f.sdk }));
      await vi.advanceTimersByTimeAsync(25_000);
      expect(await run).toBe('no-fill');
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports its phases in order', async () => {
    const f = fakeSdk({ onLoad: watched });
    const phases: string[] = [];
    await runRewardedAd(input, deps({ sdk: f.sdk, onPhase: (p) => phases.push(p) }));
    expect(phases).toEqual(['preparing', 'loading', 'showing', 'confirming']);
  });
});
