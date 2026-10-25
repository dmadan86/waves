import { afterEach, describe, expect, it, vi } from 'vitest';
import { runGateAd, prepareInterstitial } from '@/lib/adGateRunner';
import { gateAllows } from '@/lib/adPacingPure';
import type { AdsSdk } from '@/lib/rewardedAd';
vi.mock('@/lib/adEvents', () => ({ noteAdFailure: vi.fn() }));
function fixture(mode: 'completed' | 'skipped' | 'error' | 'timeout' | 'throw' = 'completed') {
  const listeners = new Map<string, () => void>();
  const emit = (name: string) => listeners.get(name)?.();
  const shown = vi.fn();
  const ad = {
    addAdEventListener: (event: string, callback: () => void) => {
      listeners.set(event, callback);
      return () => {
        listeners.delete(event);
      };
    },
    load: vi.fn(() => {
      if (mode === 'throw') throw new Error('SDK failed');
      if (mode === 'timeout') return;
      emit(mode === 'error' ? 'error' : 'loaded');
    }),
    show: vi.fn(async () => {
      emit('opened');
      if (mode === 'completed') emit('earned');
      emit('closed');
    }),
  };
  const sdk: AdsSdk = {
    MobileAds: () => ({ setRequestConfiguration: async () => {}, initialize: async () => {} }),
    AdsConsent: {
      gatherConsent: async () => ({ canRequestAds: true }),
      getConsentInfo: async () => ({ canRequestAds: true }),
      requestInfoUpdate: async () => ({}),
      showPrivacyOptionsForm: async () => {},
    },
    RewardedAd: { createForAdRequest: vi.fn(() => ad) },
    InterstitialAd: { createForAdRequest: () => ad },
    AdEventType: { LOADED: 'loaded', OPENED: 'opened', CLOSED: 'closed', ERROR: 'error' },
    RewardedAdEventType: { LOADED: 'loaded', EARNED_REWARD: 'earned' },
  };
  const deps = { loadSdk: async () => sdk, isOnline: async () => true, unitId: () => 'test-unit' };
  return { sdk, deps, shown, ad, listeners };
}
afterEach(() => vi.useRealTimers());
describe('rewarded action gates with the existing SDK contract', () => {
  it('unlocks only after reward + close and reports one real impression', async () => {
    const f = fixture();
    expect(await runGateAd(true, f.deps, f.shown)).toBe('completed');
    expect(f.shown).toHaveBeenCalledOnce();
    expect(f.listeners.size).toBe(0);
    expect(f.sdk.RewardedAd.createForAdRequest).toHaveBeenCalledWith('test-unit', {
      requestNonPersonalizedAdsOnly: true,
    });
  });
  it('keeps the action pending on early close', async () => {
    const f = fixture('skipped');
    expect(gateAllows(await runGateAd(true, f.deps, f.shown))).toBe(false);
  });
  it.each(['error', 'throw'] as const)(
    'stays shut on %s without inventing impressions',
    async (mode) => {
      const f = fixture(mode);
      expect(gateAllows(await runGateAd(true, f.deps, f.shown))).toBe(false);
      expect(f.shown).not.toHaveBeenCalled();
      expect(f.listeners.size).toBe(0);
    },
  );
  it('reports failed on offline, absent SDK and denied consent', async () => {
    const f = fixture();
    expect(await runGateAd(true, { ...f.deps, isOnline: async () => false }, f.shown)).toBe(
      'failed',
    );
    expect(
      await runGateAd(
        true,
        {
          ...f.deps,
          loadSdk: async () => {
            throw new Error('unavailable');
          },
        },
        f.shown,
      ),
    ).toBe('failed');
    f.sdk.AdsConsent.gatherConsent = async () => ({ canRequestAds: false });
    expect(await runGateAd(true, f.deps, f.shown)).toBe('failed');
    expect(f.shown).not.toHaveBeenCalled();
  });
  it('times out no-fill and releases listeners', async () => {
    vi.useFakeTimers();
    const f = fixture('timeout');
    const result = runGateAd(true, f.deps, f.shown);
    await vi.advanceTimersByTimeAsync(20001);
    expect(await result).toBe('failed');
    expect(f.listeners.size).toBe(0);
  });
  it('preloads without showing, then shows only at a permitted transition', async () => {
    const f = fixture();
    const prepared = await prepareInterstitial(f.deps);
    expect(prepared).not.toBeNull();
    expect(f.ad.show).not.toHaveBeenCalled();
    expect(await runGateAd(false, f.deps, f.shown, prepared!, () => false)).toBe('failed');
    expect(f.ad.show).not.toHaveBeenCalled();
    expect(await runGateAd(false, f.deps, f.shown, prepared!)).toBe('skipped');
    expect(f.ad.load).toHaveBeenCalledOnce();
    expect(f.shown).toHaveBeenCalledOnce();
  });
});
