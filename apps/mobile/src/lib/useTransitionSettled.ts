/**
 * Whether the screen's push animation has finished.
 *
 * A pushed screen that builds something heavy on its first render — Activity
 * turns the whole local history into a day-grouped feed — does that work on
 * the same frames the slide-in is trying to draw. The slide then stalls halfway
 * and lurches the rest of the way. Rendering a light placeholder until this
 * turns true, and the real content after, keeps the slide on its own frames.
 *
 * Listens for the stack's `transitionEnd`. A short fallback covers a screen that
 * was never pushed (no animation, a deep link); once a push has started, only
 * its end settles it, with a long cap (`activeCapMs`) in case that event is
 * ever lost, so content is never held back indefinitely.
 */
import { useEffect, useState } from 'react';
import { useNavigation } from 'expo-router';

export function useTransitionSettled(fallbackMs = 450, activeCapMs = 1500): boolean {
  const navigation = useNavigation();
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    if (settled) return undefined;
    // Short: covers a screen that was never pushed (no animation, a deep link).
    let timer = setTimeout(() => setSettled(true), fallbackMs);
    type Event = { data?: { closing?: boolean } };
    // A push is under way: the short timer would fire mid-slide on a slow
    // phone and put the heavy work right back on the animation's frames. Wait
    // for its end instead, with a long cap in case that event is ever lost.
    const offStart = navigation.addListener(
      'transitionStart' as never,
      ((event: Event) => {
        if (event?.data?.closing) return;
        clearTimeout(timer);
        timer = setTimeout(() => setSettled(true), activeCapMs);
      }) as never,
    );
    const offEnd = navigation.addListener(
      'transitionEnd' as never,
      ((event: Event) => {
        if (!event?.data?.closing) setSettled(true);
      }) as never,
    );
    return () => {
      clearTimeout(timer);
      offStart();
      offEnd();
    };
  }, [navigation, settled, fallbackMs, activeCapMs]);

  return settled;
}
