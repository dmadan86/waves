import { useWindowDimensions, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { useTheme } from '@waves/ui';

/**
 * Two soft waves across the foot of the screen, just above the tab bar — the
 * page's quiet close, on every tab. Decoration only.
 */
export function FooterWaves({ bottom }: { bottom: number }) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const dark = theme.scheme === 'dark';
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ position: 'absolute', left: 0, right: 0, bottom }}
    >
      <Svg width={width} height={WAVES_HEIGHT} viewBox="0 0 400 90" preserveAspectRatio="none">
        <Path
          d="M0 40 Q 60 10 130 30 T 260 38 T 400 20 L400 90 L0 90 Z"
          fill={dark ? 'rgba(255,255,255,0.04)' : '#ECEAFB'}
        />
        <Path
          d="M0 62 Q 90 40 180 58 T 400 48 L400 90 L0 90 Z"
          fill={dark ? 'rgba(255,255,255,0.06)' : '#E3E0FA'}
        />
      </Svg>
    </View>
  );
}

/** How tall the waves stand, and how far they tuck under the tab bar's rounded top. */
export const WAVES_HEIGHT = 90;
export const WAVES_TUCK = 24;
