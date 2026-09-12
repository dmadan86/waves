/**
 * When the reminder is decided on.
 *
 * A headless component, mounted once inside the lock and auth gates beside
 * `<AutoBackup />`. It renders nothing; it exists because the only honest
 * source for the waiting drafts is a hook, and a hook needs somewhere to live.
 *
 * Like `AutoBackup`, it is deliberately **not** a background task — no
 * `expo-background-task`, no WorkManager, no BGTaskScheduler. The difference is
 * that here that costs almost nothing: the reminder itself is an OS alarm and
 * fires with the app closed. What needs the app open is only the *deciding*.
 *
 * The honest limit, stated rather than papered over: a reminder already set for
 * this evening fires whether or not the app is opened again, but the *next* one
 * is only ever set on a pass. So somebody who never opens Waves again hears
 * from it once and then not at all — which is the right way round for a feature
 * whose whole risk is becoming a nag.
 *
 * ## Two effects, on purpose
 *
 * The AppState subscription is keyed on the owner alone, so it is not torn down
 * and rebuilt every time somebody saves an expense — the same reason
 * `AutoBackup` keeps its ledger in a ref. The pass itself is keyed on what
 * would change the answer: the count, the age of the oldest draft, and the
 * language the text would be written in. That second effect is what makes
 * placing the last draft cancel this evening's reminder immediately, rather
 * than whenever the app next happens to be foregrounded — the single most
 * important thing this feature has to get right.
 *
 * ## Why nothing is throttled
 *
 * `AutoBackup` throttles because a backup is the whole ledger over the network.
 * A pass here is two AsyncStorage reads, a permission read and a list of
 * pending alarms — and the one event that must never wait is the cancel.
 */

import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { useCaptureNudgePass, useNudgePassInputs } from './useNudgePass';

export function CaptureNudge() {
  const inputs = useNudgePassInputs();
  const pass = useCaptureNudgePass(inputs);

  // The freshest callback, so a pass raised by the subscription below never
  // runs on a stale count.
  const passRef = useRef(pass);
  useEffect(() => {
    passRef.current = pass;
  }, [pass]);

  // One subscription for the life of the session.
  useEffect(() => {
    if (!inputs.ownerId) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') passRef.current();
    });
    return () => subscription.remove();
  }, [inputs.ownerId]);

  // And a pass whenever what we would say — or whether we would say it — moves.
  useEffect(() => {
    pass();
  }, [pass]);

  return null;
}
