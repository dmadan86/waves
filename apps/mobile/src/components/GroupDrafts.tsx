/**
 * The drafts waiting against one group, at the top of its ledger.
 *
 * A draft (A34) is money that was caught but is not an expense yet. Until now
 * the only place they were visible was Review, which is the right home for one
 * that does not know where it belongs — but a draft made *for this group*
 * knows exactly where it belongs, and leaving it in another tab means opening
 * the group it is destined for and seeing no sign of it. The money looks lost
 * while sitting safely one screen away.
 *
 * So it is shown here as well, and above the ledger rather than below it: the
 * whole reason a draft is still a draft is that somebody has to come back and
 * finish it, and a row under a month of expenses is a row nobody comes back to.
 * It is not *in* the ledger — nothing here counts towards a balance, and the
 * card says so — because an amount with no rate is not yet an amount this group
 * can add up.
 *
 * Tapping one opens the group's own add-expense form through the same
 * `assignCaptureHref` the Review inbox uses, so a draft finished from here and
 * a draft finished from there become the same expense and close the same row.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import { format as formatMoney, money as coreMoney, type CurrencyCode } from '@waves/core';
import {
  Card,
  directionalIcon,
  Divider,
  iconSize,
  MoneyText,
  Row,
  Text,
  useTheme,
} from '@waves/ui';

import type { CaptureRow } from '@/data/types';
import { useStrings } from '@/i18n';
import { assignCaptureHref } from '@/lib/captureAssign';
import { showDate } from '@/lib/expenseDay';
import { router } from '@/lib/navigation';

/** What a draft is called when nobody described it. The category would be the
    better answer, as it is in the ledger — but a draft kept for a missing rate
    usually has no category either, so the amount carries the row. */
function draftTitle(capture: CaptureRow, fallback: string): string {
  const said = (capture.description ?? '').trim();
  return said === '' ? fallback : said;
}

export function GroupDrafts({
  groupId,
  captures,
}: {
  groupId: string;
  /** Already filtered to this group by the caller, which holds the read. */
  captures: readonly CaptureRow[];
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();

  if (captures.length === 0) return null;

  return (
    <Card style={{ gap: theme.spacing.sm }}>
      <Row style={{ gap: theme.spacing.sm, alignItems: 'center' }}>
        <Ionicons name="time-outline" size={iconSize.md} color={theme.color.brand} />
        <View style={{ flex: 1 }}>
          <Text variant="subheading">{t.group.draftsHere}</Text>
          <Text variant="caption" tone="muted">
            {t.group.draftsHereHint}
          </Text>
        </View>
      </Row>

      {captures.map((capture, index) => (
        <View key={capture.id}>
          {index > 0 ? <Divider /> : null}
          <Pressable
            accessibilityRole="button"
            // A label on the row hides the text inside it, so everything the
            // eye gets from the three pieces below has to be said here too.
            // Without the amount and the day, two untitled drafts — which is
            // what most drafts are — are one repeated word to a screen reader.
            accessibilityLabel={[
              draftTitle(capture, t.expense.untitled),
              formatMoney(coreMoney(BigInt(capture.amount), capture.currency as CurrencyCode), {
                locale,
              }),
              showDate(capture.expense_date, locale),
            ].join(', ')}
            onPress={() => router.push(assignCaptureHref(capture, groupId))}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing.sm,
              // A row a thumb can find, on a card that is mostly text.
              minHeight: 44,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <View style={{ flex: 1 }}>
              <Text variant="body" numberOfLines={1}>
                {draftTitle(capture, t.expense.untitled)}
              </Text>
              <Text variant="micro" tone="faint">
                {showDate(capture.expense_date, locale)}
              </Text>
            </View>
            {/* The amount in the currency it was caught in, which for a draft
                kept because of its currency is the entire point of the row. */}
            <MoneyText
              amount={BigInt(capture.amount)}
              currency={capture.currency}
              locale={locale}
              variant="body"
            />
            <Ionicons
              name={directionalIcon('chevron-forward')}
              size={iconSize.sm}
              color={theme.color.textFaint}
              // Decorative: the row already says where it goes.
              accessibilityElementsHidden
              importantForAccessibility="no"
            />
          </Pressable>
        </View>
      ))}
    </Card>
  );
}
