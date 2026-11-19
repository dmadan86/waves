/**
 * Whether the bar's mic can start listening on the spot: the phone has a
 * recogniser and the permission is already granted. Read ahead of the press and
 * kept, because the press cannot wait for an async answer. The native module is
 * required inside a `try` for the reason `VoiceMicPanel` explains: an older
 * binary throws on import.
 */

import { Platform } from 'react-native';

interface SpeechModule {
  isRecognitionAvailable(): boolean;
  getPermissionsAsync(): Promise<{ granted: boolean }>;
}

const native: SpeechModule | null = (() => {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('expo-speech-recognition') as { ExpoSpeechRecognitionModule: SpeechModule })
      .ExpoSpeechRecognitionModule;
  } catch {
    return null;
  }
})();

let granted = false;

/** Re-read the permission (on launch, on foreground, after a voice visit). */
export async function refreshHoldMic(): Promise<void> {
  try {
    granted = (await native?.getPermissionsAsync())?.granted === true;
  } catch {
    granted = false;
  }
}

export function holdMicState(): { recognition: boolean; micGranted: boolean } {
  let recognition = false;
  try {
    recognition = native?.isRecognitionAvailable() === true;
  } catch {
    recognition = false;
  }
  return { recognition, micGranted: granted };
}
