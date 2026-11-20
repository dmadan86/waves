/**
 * The Android speech service to hand `ExpoSpeechRecognitionModule.start` as
 * `androidRecognitionServicePackage` (undefined on iOS). Read once, cached.
 * The native module is required lazily, as every other caller does.
 */

import { Platform } from 'react-native';

import { pickRecognitionService } from '@/lib/speechServicePure';

let cached: string | undefined | null = null;

export function androidSpeechService(): string | undefined {
  if (Platform.OS !== 'android') return undefined;
  if (cached !== null) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ExpoSpeechRecognitionModule: speech } = require('expo-speech-recognition') as {
      ExpoSpeechRecognitionModule: typeof import('expo-speech-recognition').ExpoSpeechRecognitionModule;
    };
    cached = pickRecognitionService(
      speech.getSpeechRecognitionServices(),
      speech.getDefaultRecognitionService().packageName,
    );
  } catch {
    cached = undefined;
  }
  return cached;
}
