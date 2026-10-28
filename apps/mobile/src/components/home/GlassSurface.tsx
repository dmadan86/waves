/**
 * A frosted glass card for the scenic heroes: the scene behind shows through as
 * atmosphere, blurred and mostly washed out, so it never competes with the
 * figures on it. Home's balance card and Personal's month tiles both stand on it.
 *
 * The shadow lives on the outer view and the clipping on the inner one — a
 * view that clips cannot also cast a shadow on iOS.
 */

import { useState, type ReactNode, type RefObject } from 'react';
import Svg, { Path } from 'react-native-svg';
import { BlurView } from 'expo-blur';
import { I18nManager, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@waves/ui';

export function GlassSurface({
  children,
  blurTarget,
  style,
  folderTab = false,
}: {
  children: ReactNode;
  /** Raised start-side header; contents reserve the first 34dp for its label. */
  folderTab?: boolean;
  /** What the glass blurs on Android — the hero's scene, wrapped in a
   *  `BlurTargetView`. iOS blurs whatever is behind it without being told. */
  blurTarget?: RefObject<View | null>;
  /** Padding and layout for the contents. */
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const dark = theme.scheme === 'dark';
  const [size, setSize] = useState({ width: 0, height: 0 });
  if (folderTab) {
    const { width: w, height: h } = size;
    const r = Math.min(theme.radius.xl, w / 4, h / 4);
    const tab = w * 0.5;
    // One continuous silhouette avoids a seam where the tab meets the body.
    const path = `M ${r} 0 H ${tab - 30} C ${tab - 8} 0 ${tab - 12} 34 ${tab + 12} 34 H ${w - r} Q ${w} 34 ${w} ${34 + r} V ${h - r} Q ${w} ${h} ${w - r} ${h} H ${r} Q 0 ${h} 0 ${h - r} V ${r} Q 0 0 ${r} 0 Z`;
    return (
      <View
        onLayout={({ nativeEvent }) => setSize(nativeEvent.layout)}
        style={{
          shadowColor: '#322864',
          shadowOpacity: 0.12,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 12 },
        }}
      >
        {w > 0 && h > 0 ? (
          <Svg
            pointerEvents="none"
            width={w}
            height={h}
            style={[
              StyleSheet.absoluteFill,
              { transform: [{ scaleX: I18nManager.isRTL ? -1 : 1 }] },
            ]}
          >
            <Path
              d={path}
              fill={dark ? 'rgba(28, 26, 44, 0.96)' : 'rgba(255, 255, 255, 0.94)'}
              stroke={dark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.65)'}
              strokeWidth={1}
            />
          </Svg>
        ) : null}
        <View style={style}>{children}</View>
      </View>
    );
  }
  return (
    <View
      style={{
        borderRadius: theme.radius.xl,
        shadowColor: '#322864',
        shadowOpacity: 0.12,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 12 },
      }}
    >
      <View
        style={[
          {
            borderRadius: theme.radius.xl,
            overflow: 'hidden',
            borderWidth: 1,
            borderColor: dark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.65)',
          },
          style,
        ]}
      >
        <BlurView
          intensity={GLASS_BLUR}
          tint={dark ? 'dark' : 'light'}
          // Android draws a real blur only when asked; without it the card is
          // simply translucent, which the fill below already keeps readable.
          experimentalBlurMethod="dimezisBlurView"
          blurTarget={blurTarget}
          style={StyleSheet.absoluteFill}
        />
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: dark ? 'rgba(28, 26, 44, 0.82)' : 'rgba(255, 255, 255, 0.82)' },
          ]}
        />
        {children}
      </View>
    </View>
  );
}

/** How hard the glass blurs what is behind it. */
const GLASS_BLUR = 40;
