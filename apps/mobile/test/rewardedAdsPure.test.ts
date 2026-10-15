import { describe, expect, it } from 'vitest';

import {
  ADS_REQUEST_CONFIGURATION,
  adRequestOptions,
  isScanQuotaMessage,
  outcomeForAdError,
  parseAdsStatus,
  rewardAmount,
  rewardedUnitId,
  ssvOptions,
  TEST_REWARDED_UNIT,
  waitForCredit,
  type AdsStatus,
} from '@/lib/rewardedAdsPure';

const status = (usedToday: number): AdsStatus => ({
  eligible: true,
  reason: null,
  usedToday,
  dailyCap: 3,
  voicePerAd: 2,
  scansPerAd: 2,
});

describe('rewardedUnitId', () => {
  it('uses the configured unit in a release build', () => {
    expect(rewardedUnitId('android', { android: ' ca-app-pub-1/222 ' }, false)).toBe(
      'ca-app-pub-1/222',
    );
    expect(rewardedUnitId('ios', { ios: 'ca-app-pub-1/333' }, false)).toBe('ca-app-pub-1/333');
  });

  it("falls back to Google's test units when nothing is configured", () => {
    expect(rewardedUnitId('android', {}, false)).toBe(TEST_REWARDED_UNIT.android);
    expect(rewardedUnitId('ios', { ios: '  ' }, false)).toBe(TEST_REWARDED_UNIT.ios);
  });

  it('always uses the test unit in development, whatever is configured', () => {
    expect(rewardedUnitId('android', { android: 'ca-app-pub-1/222' }, true)).toBe(
      TEST_REWARDED_UNIT.android,
    );
  });
});

describe('ad request', () => {
  it('is non-personalized and carries the profile and the kind for server-side verification', () => {
    expect(adRequestOptions('profile-1', 'scan')).toEqual({
      requestNonPersonalizedAdsOnly: true,
      serverSideVerificationOptions: { userId: 'profile-1', customData: 'scan' },
    });
    expect(ssvOptions('p', 'voice')).toEqual({ userId: 'p', customData: 'voice' });
  });

  it('asks for family-safe content and tags nobody as a child', () => {
    expect(ADS_REQUEST_CONFIGURATION).toEqual({
      maxAdContentRating: 'PG',
      tagForChildDirectedTreatment: false,
      tagForUnderAgeOfConsent: false,
    });
  });
});

describe('outcomeForAdError', () => {
  it('names no-fill, network and everything else', () => {
    expect(outcomeForAdError({ code: 'googleMobileAds/error-code-no-fill' })).toBe('no-fill');
    expect(outcomeForAdError({ message: 'No ad to show' })).toBe('no-fill');
    expect(outcomeForAdError({ code: 'googleMobileAds/error-code-network-error' })).toBe('offline');
    expect(outcomeForAdError(new Error('Request timed out'))).toBe('offline');
    expect(outcomeForAdError({ code: 'googleMobileAds/error-code-internal-error' })).toBe('error');
    expect(outcomeForAdError(null)).toBe('error');
    expect(outcomeForAdError('boom')).toBe('error');
  });
});

describe('parseAdsStatus', () => {
  it("reads the server's answer", () => {
    expect(
      parseAdsStatus({
        eligible: true,
        reason: null,
        usedToday: 1,
        dailyCap: 3,
        voicePerAd: 2,
        scansPerAd: 4,
      }),
    ).toEqual({
      eligible: true,
      reason: null,
      usedToday: 1,
      dailyCap: 3,
      voicePerAd: 2,
      scansPerAd: 4,
    });
  });

  it('reads anything unexpected as not eligible', () => {
    expect(parseAdsStatus(null).eligible).toBe(false);
    expect(parseAdsStatus('yes').eligible).toBe(false);
    expect(parseAdsStatus({ eligible: 'true' }).eligible).toBe(false);
    expect(parseAdsStatus({ eligible: false, reason: 'paid' }).reason).toBe('paid');
  });

  it('picks the reward by kind', () => {
    expect(rewardAmount({ voicePerAd: 2, scansPerAd: 5 }, 'voice')).toBe(2);
    expect(rewardAmount({ voicePerAd: 2, scansPerAd: 5 }, 'scan')).toBe(5);
  });
});

describe('waitForCredit', () => {
  const noSleep = async (): Promise<void> => undefined;

  it('is true as soon as the count goes up, and never grants anything', async () => {
    const reads = [status(1), status(1), status(2)];
    let at = 0;
    const slept: number[] = [];
    const ok = await waitForCredit(
      1,
      async () => reads[at++] ?? null,
      async (ms) => {
        slept.push(ms);
      },
      10,
      1500,
    );
    expect(ok).toBe(true);
    expect(at).toBe(3);
    expect(slept).toEqual([1500, 1500]);
  });

  it('gives up after the attempts when the server never shows it', async () => {
    let reads = 0;
    const ok = await waitForCredit(
      1,
      async () => {
        reads += 1;
        return status(1);
      },
      noSleep,
      4,
    );
    expect(ok).toBe(false);
    expect(reads).toBe(4);
  });

  it('survives reads that fail or return nothing', async () => {
    let at = 0;
    const ok = await waitForCredit(
      0,
      async () => {
        at += 1;
        if (at === 1) throw new Error('down');
        if (at === 2) return null;
        return status(1);
      },
      noSleep,
    );
    expect(ok).toBe(true);
  });
});

describe('isScanQuotaMessage', () => {
  it('spots the receipt-parse quota refusal', () => {
    expect(isScanQuotaMessage('SCAN_QUOTA_REACHED: You have used all 20 scans')).toBe(true);
    expect(isScanQuotaMessage('RATE_LIMITED')).toBe(false);
    expect(isScanQuotaMessage(undefined)).toBe(false);
  });
});
