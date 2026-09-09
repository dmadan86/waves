/**
 * The header the expense *form* wears — the same panel the expense screen wears.
 *
 * Viewing a bill and editing it used to be two unrelated places: the view was a
 * brand wash carrying the category badge, the title and the amount; the form was
 * a white page with a centred word at the top and a 44pt number floating in the
 * middle of it, so the number moved, changed colour and changed size the moment
 * you tapped Edit. Here the form opens on the same wash, with the category badge
 * in the same corner and the amount on the same line — the only difference being
 * that on this side you can type into it.
 *
 * That also settles what the amount costs: it and its currency now share one
 * line inside the header instead of owning a third of the first screenful, and
 * the running total in the pinned action bar is no longer a second copy of a
 * number already shouting from the top.
 */

import { type ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { currencySymbol, type CategoryMeta } from '@waves/core';
import { AmountField, directionalIcon, Gradient, iconSize, Row, Text, useTheme } from '@waves/ui';

import { CategoryBadge } from '@/components/Category';
import { useStrings } from '@/i18n';
import { router } from '@/lib/navigation';

export function ExpenseHero({
  title,
  category,
  categoryMeta,
  description,
  currency,
  amount,
  onAmountChange,
  onPressCurrency,
  right,
  leading = 'back',
  autoFocusAmount = false,
}: {
  /** The one line above the amount: what this form is, and where it lands. */
  title: string;
  category: string | null;
  categoryMeta?: CategoryMeta | null;
  /** What has been typed so far — the badge sharpens its guess from it. */
  description?: string | null;
  currency: string;
  amount: bigint;
  onAmountChange: (value: bigint) => void;
  onPressCurrency: () => void;
  /**
   * A trailing action. Omitted, nothing stands in for it: the row used to keep a
   * 44pt spacer there for balance, but the amount field now grows into whatever
   * the row has spare, and an empty box holding 44 points away from it is 44
   * points the number does not get.
   */
  right?: ReactNode;
  /** A modal (capture) dismisses with an X; a pushed page goes back. */
  leading?: 'close' | 'back';
  /** Focus the amount and raise the keyboard on mount — set when the screen was
   *  opened to change the amount (tapping the total on the expense screen). */
  autoFocusAmount?: boolean;
}): React.JSX.Element {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useStrings();

  return (
    <Gradient
      radius={0}
      colors={theme.gradient.brand}
      style={{
        paddingTop: insets.top + theme.spacing.md,
        paddingHorizontal: theme.spacing.xl,
        paddingBottom: theme.spacing.lg,
        borderBottomLeftRadius: theme.radius.xxl,
        borderBottomRightRadius: theme.radius.xxl,
      }}
    >
      <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel={leading === 'back' ? t.common.back : t.common.close}
          hitSlop={10}
          style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
        >
          <Ionicons
            name={leading === 'back' ? directionalIcon('chevron-back') : 'close'}
            size={iconSize.xxl}
            color={theme.color.onBrand}
          />
        </Pressable>

        {/* The same badge, in the same place, as on the expense screen — it moves
            as the note is typed, so the guess is visible before saving rather
            than a surprise on the bill afterwards. */}
        <CategoryBadge
          category={category}
          meta={categoryMeta}
          description={description}
          size={40}
        />

        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text variant="micro" tone="onBrand" numberOfLines={1} style={{ opacity: 0.85 }}>
            {title}
          </Text>
          {/* Amount and currency on one line, and the line belongs to the
              amount: the field takes the whole run between the category badge
              and the pill, which sits hard against the trailing edge. The two
              used to be sized by their content, so a freshly opened form put a
              well barely wider than the "0" in it next to a currency pill
              floating in the middle of the header, with the rest of the line
              empty — the smallest thing on the row was the one the screen is
              for. Nothing here wraps: the pill refuses to shrink and the field
              gives ground (and drops a point or two of type) instead. */}
          <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
            <AmountField
              currency={currency}
              value={amount}
              onChange={onAmountChange}
              size="hero"
              tone="onBrand"
              framed
              autoFocus={autoFocusAmount}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${t.captures.currencyLabel}: ${currency}`}
              onPress={onPressCurrency}
              hitSlop={10}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.spacing.xs,
                // Whatever the amount does, the pill keeps its own width: a
                // three-letter code squeezed to "IN…" beside a long total would
                // be the one part of this row that must never be ambiguous.
                flexShrink: 0,
                // A real tap target, not a label: the pill is the only way to
                // change the currency, and `hitSlop` alone left it under 44pt.
                minHeight: 36,
                paddingVertical: theme.spacing.xs,
                paddingHorizontal: theme.spacing.md,
                borderRadius: theme.radius.pill,
                // A ghost outline, not a filled chip: now that the amount wears
                // the well, a solid pill beside it drew the eye to the currency
                // instead of the number. A hairline ring keeps it a real, legible
                // control without out-competing the field it annotates.
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.45)',
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text variant="caption" tone="onBrand" style={{ opacity: 0.8 }}>
                {currencySymbol(currency)}
              </Text>
              <Text variant="caption" tone="onBrand" style={{ fontWeight: '700' }}>
                {currency}
              </Text>
              <Ionicons name="chevron-down" size={iconSize.sm} color={theme.color.onBrand} />
            </Pressable>
          </Row>
        </View>

        {right}
      </Row>
    </Gradient>
  );
}
