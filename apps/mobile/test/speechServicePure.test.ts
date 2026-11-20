import { describe, expect, it } from 'vitest';

import { formatVoiceDiag } from '@/lib/voiceDiagPure';
import {
  isServiceStartError,
  pickRecognitionService,
  serviceWord,
  shouldRetryWithDefault,
} from '@/lib/speechServicePure';

describe('pickRecognitionService', () => {
  it('prefers the Google app when listed', () => {
    expect(
      pickRecognitionService(
        ['com.google.android.as', 'com.google.android.googlequicksearchbox'],
        'com.x',
      ),
    ).toBe('com.google.android.googlequicksearchbox');
  });
  it('else the default service', () => {
    expect(pickRecognitionService(['com.samsung.bixby'], 'com.samsung.bixby')).toBe(
      'com.samsung.bixby',
    );
  });
  it('never picks com.google.android.as by name', () => {
    expect(pickRecognitionService(['com.google.android.as'], 'com.google.android.as')).toBe(
      'com.google.android.tts',
    );
  });
  it('falls back to the Google TTS service', () => {
    expect(pickRecognitionService([], '')).toBe('com.google.android.tts');
  });
});

describe('service start errors', () => {
  it('recognises bind/busy/refused codes only', () => {
    expect(['client', 'busy', 'service-not-allowed'].every(isServiceStartError)).toBe(true);
    expect(isServiceStartError('no-speech')).toBe(false);
  });
  it('retries once, and only with a named service', () => {
    expect(shouldRetryWithDefault('client', 'com.x', false)).toBe(true);
    expect(shouldRetryWithDefault('client', 'com.x', true)).toBe(false);
    expect(shouldRetryWithDefault('client', undefined, false)).toBe(false);
  });
  it('words for telemetry have no dots', () => {
    expect(serviceWord('com.google.android.googlequicksearchbox')).toBe('google_app');
    expect(serviceWord(undefined)).toBe('default');
    expect(serviceWord('com.foo')).toBe('other');
  });
});

describe('diag strip', () => {
  it('shows the Android service only for the phone engine', () => {
    const base = { firstFrameMs: 10, attachMs: null, attachFailed: null, chars: 4 };
    expect(
      formatVoiceDiag({
        ...base,
        engine: 'phone',
        service: 'com.google.android.googlequicksearchbox',
      }),
    ).toContain('svc googlequicksearchbox');
    expect(formatVoiceDiag({ ...base, engine: 'cloud-stream', service: 'com.x' })).not.toContain(
      'svc',
    );
  });
});
