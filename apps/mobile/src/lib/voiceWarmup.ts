/**
 * Everything the voice mic would otherwise wait for at the tap, fetched ahead
 * of it.
 *
 * Mounted once, from the bottom bar that carries the mic, so it runs from app
 * start for as long as the app is open:
 *
 *  - the Pro advanced-voice answer (a server read, cached ten minutes) and the
 *    last answer remembered on the phone, so the mic never waits on the network
 *    to learn which engine to open;
 *  - the stored cloud-voice consent, read from AsyncStorage;
 *  - the installed-model probe and the permission read, once the first frame is
 *    up (they talk to the native recogniser and must not compete with launch),
 *    and again on each return to the foreground — where a model may have been
 *    installed, or a permission revoked, while the app was away.
 */

import { useEffect } from 'react';
import { AppState, InteractionManager } from 'react-native';

import { coolVoiceCapture, warmVoiceCapture } from '@/components/VoiceMicPanel';
import { useVoiceAgentStatus } from '@/data/hooks';
import { useViewerId } from '@/lib/auth';
import { preloadVoiceConsent } from '@/lib/voiceConsentStore';

export function useVoiceWarmup(): void {
  // Mounting the query is the prefetch; the answer is shared with the screen.
  useVoiceAgentStatus();

  const viewerId = useViewerId();
  useEffect(() => {
    if (viewerId) void preloadVoiceConsent(viewerId);
  }, [viewerId]);

  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => warmVoiceCapture());
    let state = AppState.currentState;
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'background') coolVoiceCapture();
      if (next === 'active' && state !== 'active') warmVoiceCapture();
      state = next;
    });
    return () => {
      task.cancel();
      subscription.remove();
    };
  }, []);
}
