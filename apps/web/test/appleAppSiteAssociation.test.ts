/**
 * The iOS link-claim document says what Apple needs, in the shape Apple reads.
 *
 * A wrong app id, a missing path or a non-JSON body all fail the same way: an
 * invite QR opens Safari instead of Waves, with no error anywhere. So the
 * document is pinned here, and held to the same invite paths the Android intent
 * filter claims, so the two platforms cannot drift apart.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { APP_ID, GET } from '../src/app/.well-known/apple-app-site-association/route';

const appJson = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../mobile/app.json', import.meta.url)), 'utf8'),
) as {
  expo: {
    ios: { bundleIdentifier: string; appleTeamId: string; associatedDomains?: string[] };
    android: { intentFilters: { data: { host: string; path?: string; pathPrefix?: string }[] }[] };
  };
};

describe('apple-app-site-association', () => {
  it('names the app by its team and bundle id', () => {
    const { ios } = appJson.expo;
    expect(APP_ID).toBe(`${ios.appleTeamId}.${ios.bundleIdentifier}`);
  });

  it('is served as JSON, claiming the invite paths for that app', async () => {
    const response = GET();
    expect(response.headers.get('content-type')).toMatch(/application\/json/);
    const body = (await response.json()) as {
      applinks: { details: { appIDs: string[]; components: { '/': string }[] }[] };
    };
    const [detail] = body.applinks.details;
    expect(detail?.appIDs).toEqual([APP_ID]);
    expect(detail?.components.map((c) => c['/'])).toEqual(['/join', '/join/*', '/g', '/g/*']);
  });

  it('claims the same paths as the Android intent filter', () => {
    const android = appJson.expo.android.intentFilters
      .flatMap((filter) => filter.data)
      .map((d) => (d.path ? d.path : `${d.pathPrefix}*`));
    expect(android.sort()).toEqual(['/g', '/g/*', '/join', '/join/*'].sort());
  });

  it('is declared by the app for the same host', () => {
    const hosts = new Set(
      appJson.expo.android.intentFilters.flatMap((filter) => filter.data).map((d) => d.host),
    );
    expect(appJson.expo.ios.associatedDomains).toEqual([...hosts].map((h) => `applinks:${h}`));
  });
});
