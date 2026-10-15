/**
 * The AdMob plugin in app.json carries Google's TEST app ids and the SKAdNetwork
 * ids; app.config.ts swaps in the real app ids from the environment. iOS keeps no
 * tracking-permission string, so there is no App Tracking Transparency prompt.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import type { ExpoConfig } from 'expo/config';

import makeConfig from '../app.config';

const appJson = JSON.parse(readFileSync(join(__dirname, '..', 'app.json'), 'utf8')) as {
  expo: ExpoConfig;
};

function adsOptions(env: Record<string, string | undefined>): Record<string, unknown> {
  const saved = { a: process.env.ADMOB_ANDROID_APP_ID, i: process.env.ADMOB_IOS_APP_ID };
  if (env.android === undefined) delete process.env.ADMOB_ANDROID_APP_ID;
  else process.env.ADMOB_ANDROID_APP_ID = env.android;
  if (env.ios === undefined) delete process.env.ADMOB_IOS_APP_ID;
  else process.env.ADMOB_IOS_APP_ID = env.ios;
  try {
    const config = makeConfig({ config: appJson.expo, projectRoot: '.' } as never);
    const plugin = (config.plugins ?? []).find(
      (p) => Array.isArray(p) && p[0] === 'react-native-google-mobile-ads',
    ) as [string, Record<string, unknown>];
    return plugin[1];
  } finally {
    if (saved.a === undefined) delete process.env.ADMOB_ANDROID_APP_ID;
    else process.env.ADMOB_ANDROID_APP_ID = saved.a;
    if (saved.i === undefined) delete process.env.ADMOB_IOS_APP_ID;
    else process.env.ADMOB_IOS_APP_ID = saved.i;
  }
}

describe('AdMob plugin config', () => {
  it("ships Google's test app ids by default", () => {
    const options = adsOptions({});
    expect(options.androidAppId).toBe('ca-app-pub-3940256099942544~3347511713');
    expect(options.iosAppId).toBe('ca-app-pub-3940256099942544~1458002511');
    expect(options.delayAppMeasurementInit).toBe(true);
  });

  it('takes real app ids from ADMOB_ANDROID_APP_ID / ADMOB_IOS_APP_ID', () => {
    const options = adsOptions({ android: 'ca-app-pub-1~2', ios: 'ca-app-pub-1~3' });
    expect(options.androidAppId).toBe('ca-app-pub-1~2');
    expect(options.iosAppId).toBe('ca-app-pub-1~3');
    const one = adsOptions({ android: 'ca-app-pub-1~2' });
    expect(one.androidAppId).toBe('ca-app-pub-1~2');
    expect(one.iosAppId).toBe('ca-app-pub-3940256099942544~1458002511');
  });

  it('lists the SKAdNetwork identifiers, without duplicates', () => {
    const items = adsOptions({}).skAdNetworkItems as string[];
    expect(items.length).toBeGreaterThan(30);
    expect(items).toContain('cstr6suwn9.skadnetwork');
    expect(new Set(items).size).toBe(items.length);
    for (const id of items) expect(id).toMatch(/^[a-z0-9]+\.skadnetwork$/);
  });

  it('asks for no tracking permission on iOS (non-personalized ads only)', () => {
    const options = adsOptions({});
    expect(options.userTrackingUsageDescription).toBeUndefined();
    const infoPlist = (appJson.expo.ios?.infoPlist ?? {}) as Record<string, unknown>;
    expect(infoPlist.NSUserTrackingUsageDescription).toBeUndefined();
  });
});
