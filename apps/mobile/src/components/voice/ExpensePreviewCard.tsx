/**
 * The heard expense as a structured card, built only from what the parser
 * actually returned: description and amount, category, who it is split with
 * and — only when the sentence said so or the product's default applies (an
 * equal split between several people) — the split type.
 *
 * Everything here is data the screen computed; the card decides nothing. Its
 * actions (Add expense, Edit) live in the screen's sticky bar so they stay in
 * reach however long the review grows.
 */

import { View } from 'react-native';

import { MoneyText, Text, useTheme } from '@waves/ui';

import { CategoryBadge } from '@/components/Category';
import { useStrings } from '@/i18n';

export interface ExpensePreview {
  description: string;
  /** Minor units in `currency`, or null when the amount is not a number yet. */
  amountMinor: bigint | null;
  /** The raw amount text, shown when it does not parse. */
  amountText: string;
  currency: string;
  category: string | null;
  categoryLabel: string | null;
  /** Names in the split, "You" first; null when no split applies yet. */
  splitWith: readonly string[] | null;
  /** "Equally", "Exact · …", "All on Ravi" — null when nothing confirmed it. */
  splitType: string | null;
}

function Chip({ label }: { label: string }) {
  const theme = useTheme();
  return (
    <View
      style={{
        paddingHorizontal: theme.spacing.sm,
        paddingVertical: 4,
        borderRadius: theme.radius.pill,
        backgroundColor: theme.color.brandSoft,
        maxWidth: '100%',
      }}
    >
      <Text
        variant="caption"
        style={{ fontWeight: '600', color: theme.color.text }}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ gap: 4 }}>
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }}>
        {children}
      </View>
    </View>
  );
}

export function ExpensePreviewCard({
  preview,
  locale,
}: {
  preview: ExpensePreview;
  locale: string;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  return (
    <View
      accessibilityRole="summary"
      style={{
        gap: theme.spacing.md,
        padding: theme.spacing.lg,
        borderRadius: theme.radius.lg,
        backgroundColor: theme.color.surface,
        ...theme.shadow.soft,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
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
      </View>
      {preview.categoryLabel ? (
        <Line label={t.voiceScreen.category}>
          <Chip label={preview.categoryLabel} />
        </Line>
      ) : null}
      {preview.splitWith && preview.splitWith.length > 0 ? (
        <Line label={t.voiceScreen.splitWith}>
          {preview.splitWith.map((name, index) => (
            <Chip key={`${name}-${index}`} label={name} />
          ))}
        </Line>
      ) : null}
      {preview.splitType ? (
        <Line label={t.voiceScreen.splitType}>
          <Text variant="body" style={{ fontWeight: '600' }}>
            {preview.splitType}
          </Text>
        </Line>
      ) : null}
    </View>
  );
}
