/**
 * The flush "Add receipt" invitation: a tinted camera disc, two lines of text,
 * and a trailing control, with no card of its own.
 *
 * This is the expense screen's empty-gallery row ({@link ExpenseReceipts}),
 * pulled out so the capture form's own bill prompt can wear the same look
 * instead of the boxed card it used to draw — the one mismatch its own
 * screen's sibling, the group expense form, didn't share. The two callers
 * keep their own tap behaviour (a scan vs. the gallery's camera-first add) and
 * their own trailing control (a "+" glyph here by default, a Browse pill or a
 * spinner there) — only the row's shape is shared.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Pressable, View, type AccessibilityActionEvent } from 'react-native';

import { iconSize, Text, useTheme } from '@waves/ui';

export function ReceiptAddRow({
  title,
  subtitle,
  busy = false,
  disabled = false,
  onPress,
  onLongPress,
  accessibilityLabel,
  accessibilityHint,
  accessibilityActions,
  onAccessibilityAction,
  trailing,
}: {
  title: string;
  /** A second line under the title, when there is one to show — left off once
   *  the row has something more useful to say (an item count, a "could not
   *  read" notice) than restating what the glyph already does. */
  subtitle?: string;
  /** Swaps the camera glyph for a spinner, for the moment between a photo
   *  being picked and it being ready to show as its own tile. */
  busy?: boolean;
  disabled?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  accessibilityLabel: string;
  accessibilityHint?: string;
  accessibilityActions?: readonly { name: string; label?: string }[];
  onAccessibilityAction?: (event: AccessibilityActionEvent) => void;
  /** The row's own trailing control. A plain "+" glyph when left off — the
   *  gallery's own empty state — or a caller's own (a Browse pill, a spinner
   *  while scanning). */
  trailing?: React.ReactNode;
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={onAccessibilityAction}
      // Tall enough to be a comfortable target (48, the Android minimum) and
      // no taller — hit slop can't stand in for that, since React Native
      // clips it to the parent, and the parent here is exactly this row.
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 48,
        gap: theme.spacing.md,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: theme.radius.md,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.color.brandSoft,
        }}
      >
        {busy ? (
          <ActivityIndicator color={theme.color.brand} />
        ) : (
          <Ionicons name="camera-outline" size={iconSize.lg} color={theme.color.brand} />
        )}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="subheading" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="micro" tone="muted" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing ?? <Ionicons name="add" size={iconSize.lg} color={theme.color.brand} />}
    </Pressable>
  );
}
