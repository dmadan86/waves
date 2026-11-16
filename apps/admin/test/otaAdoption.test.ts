import { describe, expect, it } from 'vitest';

import { adoption } from '../src/lib/otaAdoption';

describe('OTA adoption', () => {
  it('counts devices per platform, store version and update, newest version first', () => {
    const rows = adoption([
      { platform: 'android 15', app_version: '1.3.2+1a2b3c4d' },
      { platform: 'android 14', app_version: '1.3.2+1a2b3c4d' },
      { platform: 'android 15', app_version: '1.3.2' },
      { platform: 'android 13', app_version: '1.2.10' },
      { platform: 'ios 18.1', app_version: '1.3.2' },
      { platform: null, app_version: null },
    ]);
    expect(rows).toEqual([
      { platform: 'android', version: '1.3.2', update: '1a2b3c4d', devices: 2 },
      { platform: 'android', version: '1.3.2', update: null, devices: 1 },
      { platform: 'android', version: '1.2.10', update: null, devices: 1 },
      { platform: 'ios', version: '1.3.2', update: null, devices: 1 },
      { platform: 'unknown', version: 'unknown', update: null, devices: 1 },
    ]);
  });
});
