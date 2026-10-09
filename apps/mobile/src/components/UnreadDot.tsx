/**
 * The small "something new" dot a list row's icon wears — the WhatsApp / Slack
 * / Gmail unread mark. Red like the bell's dot on the dashboard, so the app has
 * one meaning for it, with a ring in the row's surface colour so it reads as
 * sitting on the icon's shoulder rather than bleeding into it.
 *
 * Absolute at the top-end corner (`end`, not `right`), so it moves to the left
 * shoulder under Arabic. Purely visual: the row speaks "new activity" in its own
 * label, and this is hidden from screen readers.
 */

import { View } from 'react-native';

import { useTheme } from '@waves/ui';

const SIZE = 10;
const RING = 2;

export function UnreadDot({ ring }: { ring?: string }): React.JSX.Element {
  const theme = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: -1,
        end: -1,
        width: SIZE + RING * 2,
        height: SIZE + RING * 2,
        borderRadius: SIZE / 2 + RING,
        borderWidth: RING,
        borderColor: ring ?? theme.color.surface,
        backgroundColor: theme.color.negative,
      }}
    />
  );
}
