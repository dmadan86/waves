/**
 * Whether the screen's push animation has finished.
 *
 * A pushed screen that builds something heavy on its first render — Activity
 * turns the whole local history into a day-grouped feed — does that work on
 * the same frames the slide-in is trying to draw. The slide then stalls halfway
 * and lurches the rest of the way. Rendering a light placeholder until this
 * turns true, and the real content after, keeps the slide on its own frames.
 *
 * Listens for the stack's `transitionEnd`. A fallback timer covers any path
 * where that never arrives (no animation, a deep link that mounts the screen
 * without a push, a navigator that does not emit it), so content is never held
 * back for more than `fallbackMs`.
 */
import { useEffect, useState } from 'react';
import { useNavigation } from 'expo-router';

export function useTransitionSettled(fallbackMs = 450): boolean {
  const navigation = useNavigation();
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    if (settled) return undefined;
    const timer = setTimeout(() => setSettled(true), fallbackMs);
    const unsubscribe = navigation.addListener(
      // Typed per navigator; every stack emits it.
      'transitionEnd' as never,
      ((event: { data?: { closing?: boolean } }) => {
        if (!event?.data?.closing) setSettled(true);
      }) as never,
    );
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [navigation, settled, fallbackMs]);

  return settled;
}
