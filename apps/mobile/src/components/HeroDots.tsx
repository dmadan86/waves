import { Animated, View } from 'react-native';
import { Row, useTheme } from '@waves/ui';

/**
 * The dot pager — the "swipe me" signal, rendered by the screen in the middle
 * of the row of buttons under the balance it pages through. A wide white pill
 * marks the active slide over a row of faint dots that read against any of the
 * slide washes.
 *
 * The pill slides off the carousel's live `scrollX`, native-driven, so it tracks
 * the finger at 60fps exactly like the hero colour crossfade — not off a React
 * state that only lands at `onMomentumScrollEnd`, which is what made the dots lag
 * a beat behind the swipe. Native driver animates transform/opacity only (never
 * width or colour), so the active mark is a fixed-width pill that *translates*
 * across static dots rather than one dot growing and the row reflowing.
 */
const DOT_SIZE = 6;
const DOT_ACTIVE_WIDTH = 18;

export function HeroDots({
  count,
  scrollX,
  snap,
}: {
  count: number;
  scrollX: Animated.Value;
  snap: number;
}) {
  const theme = useTheme();
  const gap = theme.spacing.xs;
  const step = DOT_SIZE + gap; // centre-to-centre distance between dots
  const trackWidth = count * DOT_SIZE + Math.max(0, count - 1) * gap;
  // Map scroll offset (0, snap, 2·snap, …) to the pill's position over each dot.
  // interpolate needs ≥2 strictly-ascending inputs, so a lone slide is a static
  // pill with no interpolation.
  const translateX =
    count > 1
      ? scrollX.interpolate({
          inputRange: Array.from({ length: count }, (_, i) => i * snap),
          outputRange: Array.from({ length: count }, (_, i) => i * step),
          extrapolate: 'clamp',
        })
      : 0;
  return (
    // Centred in whatever room the caller gives it, which on the hero is the
    // slack between the expense pill and the group disc. Nothing to align to an
    // edge here: the row it sits in has a button at each end, and the middle is
    // the only place a pager can be without looking like it belongs to one of
    // them.
    <Row style={{ justifyContent: 'center' }}>
      <View style={{ width: trackWidth, height: DOT_SIZE }}>
        <Row style={{ position: 'absolute', left: 0, top: 0, gap }}>
          {Array.from({ length: count }, (_, index) => (
            <View
              key={index}
              style={{
                width: DOT_SIZE,
                height: DOT_SIZE,
                borderRadius: DOT_SIZE / 2,
                backgroundColor: 'rgba(255, 255, 255, 0.35)',
              }}
            />
          ))}
        </Row>
        <Animated.View
          style={{
            position: 'absolute',
            top: 0,
            // Seat the wide pill centred on the first dot; the translate then
            // carries that centre from dot to dot.
            left: (DOT_SIZE - DOT_ACTIVE_WIDTH) / 2,
            width: DOT_ACTIVE_WIDTH,
            height: DOT_SIZE,
            borderRadius: DOT_SIZE / 2,
            backgroundColor: '#FFFFFF',
            transform: [{ translateX }],
          }}
        />
      </View>
    </Row>
  );
}
