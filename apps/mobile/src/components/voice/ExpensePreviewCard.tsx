/**
 * The heard expense, kept to what matters: its description and amount, and one
 * plain line for who shares it ("Split equally with: You, Ravi, Priya"). Tapping
 * the top opens the amount and words to correct; tapping the split line opens
 * the people. Category, date and place live under the screen's one Details row.
 *
 * Everything here is data the screen computed; the card decides nothing. Its
 * action (Add) lives in the screen's footer so it stays in reach.
 */

import { Pressable, View } from 'react-native';

import { MoneyText, Text, useTheme } from '@waves/ui';

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

/** The split as one tappable line, with who paid beneath it when it was not you. */
export function SplitLine({
  text,
  paidBy,
  onPress,
  onPaidBy,
}: {
  text: string;
  paidBy?: string | null;
  onPress?: () => void;
  onPaidBy?: () => void;
}) {
  const theme = useTheme();
  const row = (label: string, press: (() => void) | undefined, muted: boolean) => (
    <Pressable
      onPress={press}
      disabled={!press}
      accessibilityRole={press ? 'button' : 'text'}
      style={({ pressed }) => ({
        minHeight: 44,
        justifyContent: 'center',
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Text
        variant={muted ? 'caption' : 'body'}
        tone={muted ? 'muted' : undefined}
        style={press && !muted ? { color: theme.color.brand, fontWeight: '600' } : undefined}
      >
        {label}
      </Text>
    </Pressable>
  );
  return (
    <View>
      {row(text, onPress, false)}
      {paidBy ? row(paidBy, onPaidBy, true) : null}
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
    text: string;
    paidBy?: string | null;
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
