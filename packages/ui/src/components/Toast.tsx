import { useEffect, useRef, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, View } from 'react-native';

import { useTheme } from '../theme';
import { Callout, type CalloutTone } from './Callout';

/**
 * "That worked" — said briefly, over whatever screen you have arrived at.
 *
 * {@link Callout} is already this app's shape for a message worth reading, and
 * this is deliberately built on it rather than beside it: the same tinted panel,
 * the same mark, the same words. What it adds is the one thing a Callout cannot
 * do, which is outlive the screen that raised it. A confirmation for something
 * that *finishes* a screen has nowhere to live otherwise — by the time it is
 * true, the screen that would have shown it is gone.
 *
 * The rules it follows are the ones a transient message has to follow to be
 * fair:
 *
 *  - **Colour is never the only signal.** The positive tone brings a tick and a
 *    sentence with it, so it still says "saved" to somebody who cannot see that
 *    it is green.
 *  - **It never takes the screen.** The layer is `box-none` and the panel is not
 *    touchable, so every tap goes to the app underneath; nothing is blocked and
 *    no focus moves.
 *  - **It announces itself.** A screen reader is told the message when it
 *    appears, politely — it does not interrupt whatever is being read.
 *  - **It gets out of the way of the bottom bar.** The caller passes the
 *    clearance for the screen it is over (`useTabBarClearance` /
 *    `useScreenClearance`), because only the app knows which of those applies.
 *  - **Motion is optional.** `animated` off means it simply appears, which is
 *    what a reduce-motion preference asks for.
 *
 * Presentational on purpose — it shows what it is given and calls back when its
 * time is up. Deciding *when* something worked belongs to the app, not here.
 */
export function Toast({
  message,
  tone = 'positive',
  visible,
  onDone,
  bottom,
  durationMs = 3200,
  animated = true,
}: {
  /** The line to show. A node when it needs more than a sentence. */
  message: ReactNode;
  tone?: CalloutTone;
  visible: boolean;
  /** Its time is up — the caller should clear the message. */
  onDone: () => void;
  /** How far above the bottom edge to sit, past the bar and the system inset. */
  bottom: number;
  durationMs?: number;
  animated?: boolean;
}) {
  const theme = useTheme();
  // Held in a ref, not state: the fade is a value the animation owns, and a
  // re-render per frame is exactly what `useNativeDriver` exists to avoid.
  const fade = useRef(new Animated.Value(0)).current;
  // The message a screen reader was last told, so a re-render never repeats it.
  const announced = useRef<string | null>(null);

  useEffect(() => {
    if (!visible) {
      fade.setValue(0);
      announced.current = null;
      return;
    }
    if (animated) {
      Animated.timing(fade, {
        toValue: 1,
        duration: 180,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start();
    } else {
      fade.setValue(1);
    }
    const timer = setTimeout(onDone, durationMs);
    return () => clearTimeout(timer);
  }, [animated, durationMs, fade, onDone, visible]);

  // Said out loud once per message. `accessibilityLiveRegion` covers Android on
  // its own; iOS needs to be told, and telling both is harmless because the
  // announcement is keyed on the message rather than on the render.
  useEffect(() => {
    if (!visible || typeof message !== 'string') return;
    if (announced.current === message) return;
    announced.current = message;
    AccessibilityInfo.announceForAccessibility(message);
  }, [message, visible]);

  if (!visible) return null;

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom,
        paddingHorizontal: theme.spacing.xl,
      }}
    >
      <Animated.View
        pointerEvents="none"
        accessibilityLiveRegion="polite"
        style={{
          opacity: fade,
          transform: [
            {
              translateY: fade.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }),
            },
          ],
          // Lifted off the screen underneath — it is a layer, not part of the
          // page, and without a shadow it reads as a panel somebody forgot.
          shadowColor: '#000',
          shadowOpacity: 0.18,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
          elevation: 8,
          borderRadius: theme.radius.md,
          backgroundColor: theme.color.surface,
        }}
      >
        <Callout tone={tone}>{message}</Callout>
      </Animated.View>
    </View>
  );
}
