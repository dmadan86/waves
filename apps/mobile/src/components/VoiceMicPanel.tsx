/**
 * The voice mic, or nothing — the same launch-safety wrapper `DictateButton` is.
 *
 * `expo-speech-recognition` calls `requireNativeModule` at the top of its file,
 * which throws in any binary compiled before the module was added. expo-router
 * loads every route file to build the route tree, so a plain import in the
 * `voice` route would cost the whole app at launch, not just the mic. The import
 * lives in `VoiceCapture` and is reached from here inside a `try`, so an older
 * binary falls back to a plain message instead of a red screen.
 */

import { Platform } from 'react-native';

import type { VoiceCaptureProps } from './VoiceCapture';

type VoiceComponent = (props: VoiceCaptureProps) => React.ReactNode;

interface VoiceModule {
  VoiceCapture: VoiceComponent;
  warmVoiceCapture: () => void;
  coolVoiceCapture: () => void;
}

const loaded: VoiceModule | null = (() => {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return null;
  try {
    // Deliberately require, not import: an import is hoisted and would run at
    // module load, which is the thing being avoided.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('./VoiceCapture') as VoiceModule;
  } catch {
    return null;
  }
})();

const Voice: VoiceComponent | null = loaded?.VoiceCapture ?? null;

/** Whether this build can capture speech at all — the screen adapts if not. */
export const voiceAvailable = Voice !== null;

/**
 * Do the slow, silent parts of opening the mic ahead of the tap (the installed-
 * model probe, the permission read). A no-op on a build without the module.
 */
export function warmVoiceCapture(): void {
  try {
    loaded?.warmVoiceCapture();
  } catch {
    // Warming is an optimisation; the start does it all again if it must.
  }
}

/** Forget what may change while the app is in the background. See VoiceCapture. */
export function coolVoiceCapture(): void {
  try {
    loaded?.coolVoiceCapture();
  } catch {
    // As above.
  }
}

export function VoiceMicPanel(props: VoiceCaptureProps) {
  if (!Voice) return null;
  return <Voice {...props} />;
}
