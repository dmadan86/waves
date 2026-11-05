/**
 * The flat surface the tab roots group their figures on: page-white, 12pt
 * corners, a hairline, no blur, no shadow (the calm standard; the name is
 * historical, from when it was frosted glass over a photo).
 */

import type { ReactNode, RefObject } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@waves/ui';

export function GlassSurface({
  children,
  style,
}: {
  children: ReactNode;
  /** Unused now; kept so older call sites type-check. */
  blurTarget?: RefObject<View | null>;
  folderTab?: boolean;
  /** Padding and layout for the contents. */
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        {
          borderRadius: theme.radius.lg,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: theme.color.border,
          backgroundColor: theme.color.surface,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
