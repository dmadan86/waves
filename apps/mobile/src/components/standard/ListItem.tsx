import type { ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View, type ViewStyle } from 'react-native';
import { directionalIcon, iconSize, Row, Text, useTheme, type TextTone } from '@waves/ui';

/** Leading tile / avatar size of every list row. Build avatars and icon tiles at this size. */
export const LIST_TILE = 44;

/** Rows grouped in one white rounded card: hairline dividers, no per-row borders or shadows. */
export function ListCard({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const theme = useTheme();
  return (
    <View
      style={[
        {
          borderRadius: theme.radius.lg,
          borderWidth: 1,
          borderColor: theme.color.border,
          backgroundColor: theme.color.surface,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** The one small pill action at the end of a row ("Remind", "Pay"). */
export function ListPill({
  label,
  accessibilityLabel,
  onPress,
  disabled,
  filled = false,
}: {
  label: string;
  accessibilityLabel?: string;
  onPress: () => void;
  disabled?: boolean;
  filled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({
        paddingHorizontal: theme.spacing.md,
        height: 32,
        borderRadius: theme.radius.pill,
        justifyContent: 'center',
        backgroundColor: filled ? theme.color.brand : theme.color.brandSoft,
        opacity: pressed || disabled ? 0.6 : 1,
      })}
    >
      <Text
        variant="caption"
        style={{ fontWeight: '700', color: filled ? theme.color.onBrand : theme.color.brand }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * The one list row (the Home dashboard row): a 44dp leading tile or avatar, a semibold title
 * with an optional muted sub-line, then at the end ONE of: an amount with a small caption
 * under it, a pill action, a control (a menu button), or a chevron. Put rows in a `ListCard`;
 * pass `divider` on every row but the first. Extend this component, never the screen.
 */
export function ListItem({
  leading,
  title,
  titleAccessory,
  subtitle,
  amount,
  amountTone,
  amountColor,
  caption,
  captionTone = 'muted',
  captionColor,
  trailing,
  chevron = false,
  onPress,
  divider = false,
  position,
  strong = false,
  accessibilityLabel,
  testID,
}: {
  leading?: ReactNode;
  title: string;
  /** Sits beside the title (a small tag). */
  titleAccessory?: ReactNode;
  /** A string, or a node for a richer line (a type tag then text). */
  subtitle?: ReactNode;
  /** A string, or a node (a skeleton while it loads). */
  amount?: ReactNode;
  amountTone?: TextTone;
  /** An exact colour for the amount (income green), over its tone. */
  amountColor?: string;
  /** The small line under the amount ("in 4 days"). */
  caption?: ReactNode;
  captionTone?: TextTone;
  /** An exact colour for the caption (a due-date warning), over its tone. */
  captionColor?: string;
  /** A pill or menu button at the end. Sits beside the pressable text, not inside it. */
  trailing?: ReactNode;
  chevron?: boolean;
  onPress?: () => void;
  /** A hairline above the row: every row but the first of a card. */
  divider?: boolean;
  /**
   * For a flat list (FlashList) where rows cannot sit inside a `ListCard`: the row draws its own
   * slice of the card, so consecutive rows read as one. Leave unset inside a `ListCard`.
   */
  position?: 'first' | 'middle' | 'last' | 'only';
  /** Heavier title, for unread. */
  strong?: boolean;
  accessibilityLabel?: string;
  testID?: string;
}) {
  const theme = useTheme();
  const frame: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.sm,
    borderTopWidth: divider ? 1 : 0,
    borderTopColor: theme.color.border,
    ...(position
      ? {
          backgroundColor: theme.color.surface,
          borderColor: theme.color.border,
          borderStartWidth: 1,
          borderEndWidth: 1,
          borderTopWidth: 1,
          borderBottomWidth: position === 'last' || position === 'only' ? 1 : 0,
          ...(position === 'first' || position === 'only'
            ? { borderTopStartRadius: theme.radius.lg, borderTopEndRadius: theme.radius.lg }
            : null),
          ...(position === 'last' || position === 'only'
            ? { borderBottomStartRadius: theme.radius.lg, borderBottomEndRadius: theme.radius.lg }
            : null),
        }
      : null),
  };
  const chevronNode = chevron ? (
    <Ionicons
      name={directionalIcon('chevron-forward')}
      size={iconSize.sm}
      color={theme.color.textMuted}
    />
  ) : null;
  const body = (
    <>
      {leading}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Row style={{ alignItems: 'center', gap: theme.spacing.xs }}>
          <Text
            variant="body"
            numberOfLines={1}
            style={{ flexShrink: 1, fontWeight: strong ? '800' : '600' }}
          >
            {title}
          </Text>
          {titleAccessory}
        </Row>
        {typeof subtitle === 'string' ? (
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : (
          subtitle
        )}
      </View>
      {amount !== undefined || caption ? (
        <View style={{ alignItems: 'flex-end', gap: 2 }}>
          {typeof amount === 'string' ? (
            <Text
              numberOfLines={1}
              tone={amountTone}
              style={{ fontWeight: '700', ...(amountColor ? { color: amountColor } : null) }}
            >
              {amount}
            </Text>
          ) : (
            amount
          )}
          {typeof caption === 'string' ? (
            <Text
              variant="micro"
              tone={captionTone}
              numberOfLines={1}
              style={captionColor ? { color: captionColor, fontWeight: '600' } : undefined}
            >
              {caption}
            </Text>
          ) : (
            caption
          )}
        </View>
      ) : null}
    </>
  );
  if (trailing) {
    return (
      <View style={frame} testID={testID}>
        <Pressable
          accessibilityRole={onPress ? 'button' : undefined}
          accessibilityLabel={accessibilityLabel ?? title}
          disabled={!onPress}
          onPress={onPress}
          style={({ pressed }) => ({
            flex: 1,
            minWidth: 0,
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.md,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          {body}
        </Pressable>
        {trailing}
        {chevronNode}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={accessibilityLabel ?? title}
      disabled={!onPress}
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => ({ ...frame, opacity: pressed ? 0.6 : 1 })}
    >
      {body}
      {chevronNode}
    </Pressable>
  );
}
