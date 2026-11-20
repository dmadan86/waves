import { describe, expect, it } from 'vitest';

import { sanitizeProps } from '@/lib/eventsCore';
import { clipProps, word } from '@/lib/voiceTelemetryPure';

describe('clipProps', () => {
  it('describes a phone clip on Android and survives sanitising', () => {
    const props = clipProps({
      engine: 'phone',
      servicePackage: 'com.google.android.googlequicksearchbox',
      platform: 'android',
      osVersion: '14.0.1',
      make: 'Samsung Electronics',
      error: 'service-not-allowed',
      firstWordMs: 812.4,
    });
    expect(props).toEqual({
      engine: 'phone',
      service: 'google_app',
      os: '14',
      make: 'samsung_electronics',
      error: 'service-not-allowed',
      ms: '812',
    });
    expect(sanitizeProps(props)).toEqual(props);
  });
  it('omits service for cloud and ms when no word came', () => {
    const props = clipProps({ engine: 'cloud-stream', platform: 'android', firstWordMs: null });
    expect(props).toEqual({ engine: 'cloud-stream' });
  });
  it('word never lets a sentence through', () => {
    expect(word('Dinner at Rahul!')).toBe('dinner_at_rahul_');
    expect(word(undefined)).toBe('');
  });
});
