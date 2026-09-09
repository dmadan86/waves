/**
 * A message that has to be read while a `Modal` is on screen.
 *
 * The app says "that did not work" with a `Toast`, and a toast is the right
 * shape for it — a line that fades, over the screen you are already on, with
 * nothing to answer. But the toast host is an ordinary absolutely-positioned
 * View in the app's own tree, and a React Native `Modal` is its own native
 * window: anything the toast host draws while a modal is presented is painted
 * *underneath* it, and nobody ever sees it.
 *
 * That never showed up before, because these failures used to be `Alert.alert`
 * — a native alert, which always won. Replacing the alert with a toast quietly
 * turned five messages into nothing at all: post a comment with no network and
 * the composer stays open with your text in it and says nothing, so you press
 * send again.
 *
 * So a message raised from inside a modal is drawn inside that modal. This is
 * the shape for the dark, full-bleed ones — the receipt viewer, the annotator,
 * the cropper — which have no layout to slot a `Callout` into. It floats at the
 * foot, above the system bar, and stays until it is dismissed or the thing that
 * raised it is fixed: unlike a toast it does not fade, because the case it
 * exists for is somebody glancing away for four seconds.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Callout, iconSize, Row, Text, useTheme } from '@waves/ui';

import { useStrings } from '@/i18n';

export function ModalNotice({
  message,
  onDismiss,
  offset,
}: {
  /** Null draws nothing, so a caller can hold this at the foot of its tree. */
  message: string | null;
  onDismiss: () => void;
  /**
   * How far above the system bar to float, when the default would land on
   * something the modal already draws down there — the receipt viewer's page
   * counter, say. The safe-area inset is added on top of it either way.
   */
  offset?: number;
}): React.JSX.Element | null {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useStrings();

  if (message === null) return null;

  return (
    <View
      // `box-none` so the picture underneath keeps taking pinches and swipes
      // everywhere the panel itself is not.
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: insets.bottom + (offset ?? theme.spacing.xxxl),
        paddingHorizontal: theme.spacing.xl,
      }}
    >
      <View
        style={{
          borderRadius: theme.radius.md,
          backgroundColor: theme.color.surface,
          // Lifted, because it is a layer over a photograph rather than part of
          // a page — without a shadow it reads as a panel somebody forgot.
          shadowColor: '#000',
          shadowOpacity: 0.24,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: 6 },
          elevation: 10,
        }}
      >
        <Callout tone="negative">
          <Row style={{ gap: theme.spacing.sm, alignItems: 'flex-start' }}>
            <Text variant="body" style={{ flex: 1 }}>
              {message}
            </Text>
            <Pressable
              onPress={onDismiss}
              accessibilityRole="button"
              accessibilityLabel={t.common.close}
              hitSlop={10}
            >
              <Ionicons name="close" size={iconSize.md} color={theme.color.textMuted} />
            </Pressable>
          </Row>
        </Callout>
      </View>
    </View>
  );
}
