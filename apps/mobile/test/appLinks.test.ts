/**
 * The Android App Links claim must be as narrow as the invite parser.
 *
 * Android's `pathPrefix` is a raw starts-with check. `/g` also matches
 * `/groups`, and `/join` also matches `/joining`, which would pull ordinary web
 * pages into the app even though `+native-intent` deliberately passes them
 * through unchanged. These assertions pin the route boundaries in app.json,
 * because this is native config and cannot be caught by the JS router tests.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

interface IntentData {
  readonly scheme?: string;
  readonly host?: string;
  readonly path?: string;
  readonly pathPrefix?: string;
}

interface IntentFilter {
  readonly action?: string;
  readonly autoVerify?: boolean;
  readonly data?: readonly IntentData[];
}

interface AppConfig {
  readonly expo?: {
    readonly android?: {
      readonly intentFilters?: readonly IntentFilter[];
    };
  };
}

const appConfig = JSON.parse(
  readFileSync(join(__dirname, '../app.json'), 'utf8'),
) as AppConfig;

const appLinkData =
  appConfig.expo?.android?.intentFilters?.find(
    (filter) => filter.action === 'VIEW' && filter.autoVerify === true,
  )?.data ?? [];

function matcherFor(path: string): IntentData | undefined {
  return appLinkData.find((entry) => entry.path === path || entry.pathPrefix === path);
}

describe('Android App Links config', () => {
  it('claims only the invite route boundaries, not every web path with that prefix', () => {
    expect(matcherFor('/join')).toMatchObject({ path: '/join' });
    expect(matcherFor('/join/')).toMatchObject({ pathPrefix: '/join/' });
    expect(matcherFor('/g')).toMatchObject({ path: '/g' });
    expect(matcherFor('/g/')).toMatchObject({ pathPrefix: '/g/' });

    expect(appLinkData).not.toContainEqual(expect.objectContaining({ pathPrefix: '/join' }));
    expect(appLinkData).not.toContainEqual(expect.objectContaining({ pathPrefix: '/g' }));
  });

  it('keeps every app link on the verified invite host', () => {
    expect(appLinkData.length).toBeGreaterThan(0);
    for (const entry of appLinkData) {
      expect(entry).toMatchObject({ scheme: 'https', host: 'app.wavs.co.in' });
    }
  });
});
