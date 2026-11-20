/**
 * One `voice_clip` event per voice clip, and `voice_fix` when the person later
 * edits what was heard. Facts about the engine only; see `voiceTelemetryPure`.
 */

import { Platform } from 'react-native';

import { track } from '@/lib/events';
import { clipProps, type ClipEngine } from '@/lib/voiceTelemetryPure';

export class VoiceClip {
  private t0 = Date.now();
  private engine: ClipEngine | null = null;
  private service: string | undefined;
  private firstWordMs: number | null = null;
  private error: string | null = null;
  private sent = false;

  setEngine(engine: ClipEngine, service?: string): void {
    this.engine = engine;
    this.service = service;
  }

  /** Call with each partial; the first non-empty one stamps the time. */
  words(text: string): void {
    if (this.firstWordMs === null && text.trim()) this.firstWordMs = Date.now() - this.t0;
  }

  fail(code: string): void {
    this.error ??= code;
  }

  send(): void {
    if (this.sent) return;
    this.sent = true;
    try {
      // Lazy: the native module must not load with every screen that only reports a fix.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Device = require('expo-device') as typeof import('expo-device');
      track(
        'voice_clip',
        clipProps({
          engine: this.engine,
          servicePackage: this.service,
          platform: Platform.OS,
          osVersion: Device.osVersion,
          make: Device.manufacturer,
          error: this.error,
          firstWordMs: this.firstWordMs,
        }),
      );
    } catch {
      // Analytics never reaches the caller.
    }
  }
}

/** The person fixed what the mic heard: the `name` or the `amount` of the saved expense. */
export function trackVoiceFix(field: 'name' | 'amount'): void {
  try {
    track('voice_fix', { field });
  } catch {
    // Never reaches the caller.
  }
}
