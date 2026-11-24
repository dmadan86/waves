/**
 * The heard expense, kept to what matters: its description and amount, with
 * settings rows for payer and split. Tapping the top opens the amount and words
 * to correct; the rows open their matching people sheets. Category, date and
 * place live under the screen's one Details row.
 *
 * Everything here is data the screen computed; the card decides nothing. Its
 * action (Add) lives in the screen's footer so it stays in reach.
 */

import { Pressable, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { MoneyText, Text, iconSize, useTheme } from '@waves/ui';

import { CategoryBadge } from '@/components/Category';

export interface ExpensePreview {
  description: string;
  /** Minor units in `currency`, or null when the amount is not a number yet. */
  amountMinor: bigint | null;
  /** The raw amount text, shown when it does not parse. */
  amountText: string;
  currency: string;
  category: string | null;
}

/** Split and payer choices, shown as settings rows. */
export function SplitLine({
  splitValue,
  splitLabel,
  paidBy,
  paidByLabel,
  onPress,
  onPaidBy,
}: {
  splitValue: string;
  splitLabel: string;
  paidBy?: string | null;
  paidByLabel: string;
  onPress?: () => void;
  onPaidBy?: () => void;
}) {
  const theme = useTheme();
  const row = (
    label: string,
    value: string,
    accessibilityLabel: string,
    icon: React.ComponentProps<typeof Ionicons>['name'],
    press: (() => void) | undefined,
  ) => (
    <Pressable
      onPress={press}
      disabled={!press}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => ({
        minHeight: 48,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Ionicons name={icon} size={iconSize.md} color={theme.color.textMuted} />
      <Text style={{ flex: 1 }}>{label}</Text>
      <Text tone="muted">{value}</Text>
      <Ionicons name="chevron-forward" size={iconSize.sm} color={theme.color.textFaint} />
    </Pressable>
  );
  return (
    <View
      style={{
        borderTopWidth: 1,
        borderTopColor: theme.color.border,
        marginTop: theme.spacing.md,
        paddingTop: theme.spacing.xs,
      }}
    >
      {row(
        paidByLabel,
        paidBy ?? '',
        `${paidByLabel}: ${paidBy ?? ''}`,
        'person-outline',
        onPaidBy,
      )}
      {row(splitLabel, splitValue, `${splitLabel}: ${splitValue}`, 'people-outline', onPress)}
    </View>
  );
}

export function ExpensePreviewCard({
  preview,
  locale,
  onEdit,
  split,
}: {
  preview: ExpensePreview;
  locale: string;
  /** Tap the amount and words to correct them. */
  onEdit?: () => void;
  /** The split line, when one applies. */
  split?: {
    splitValue: string;
    splitLabel: string;
    paidBy?: string | null;
    paidByLabel: string;
    onPress?: () => void;
    onPaidBy?: () => void;
  } | null;
}) {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="summary"
      style={{
        gap: theme.spacing.xs,
        padding: theme.spacing.lg,
        borderRadius: theme.radius.lg,
        backgroundColor: theme.color.surface,
        ...theme.shadow.soft,
      }}
    >
      <Pressable
        onPress={onEdit}
        disabled={!onEdit}
        accessibilityRole={onEdit ? 'button' : undefined}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.md,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <CategoryBadge category={preview.category} description={preview.description} size={44} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="subheading" numberOfLines={2}>
            {preview.description}
          </Text>
          {preview.amountMinor !== null ? (
            <MoneyText
              amount={preview.amountMinor}
              currency={preview.currency}
              locale={locale}
              mode="plain"
              variant="title"
            />
          ) : (
            <Text variant="title">{`${preview.amountText} ${preview.currency}`.trim()}</Text>
          )}
        </View>
      </Pressable>
      {split ? <SplitLine {...split} /> : null}
    </View>
  );
}
