/**
 * "Show in Spending", inside the answer card: the entries the answer was about,
 * top five, then "Show all" to list the rest right there. Nothing navigates.
 */

import { useState } from 'react';
import { View } from 'react-native';

import { format, money, type CurrencyCode, type PersonalTxn } from '@waves/core';
import { Text, useTheme } from '@waves/ui';

import { fill, useStrings } from '@/i18n';
import { shortDate } from '@/lib/assistantAnswers';
import { MATCH_PREVIEW, visibleMatches } from '@/lib/assistantInline';
import { SmallAction } from './SmallAction';

export function InlineSpendingList({ rows }: { rows: readonly PersonalTxn[] }) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const s = t.inline;
  const [all, setAll] = useState(false);
  const shown = visibleMatches(rows, all);

  if (rows.length === 0) {
    return (
      <Text variant="caption" tone="muted">
        {s.noMatches}
      </Text>
    );
  }
  return (
    <View style={{ gap: theme.spacing.xs }}>
      {shown.map((txn) => {
        const title =
          txn.note?.trim() ||
          (txn.category ? (t.categories as Record<string, string>)[txn.category] : '') ||
          t.categories.other;
        const amount = format(money(txn.amount, txn.currency as CurrencyCode), { locale });
        return (
          <View
            key={txn.id}
            accessible
            accessibilityLabel={`${title}, ${shortDate(txn.date, locale)}, ${amount}`}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: theme.spacing.sm,
              minHeight: 36,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1}>{title}</Text>
              <Text variant="micro" tone="muted">
                {shortDate(txn.date, locale)}
              </Text>
            </View>
            <Text style={{ fontWeight: '700' }}>{amount}</Text>
          </View>
        );
      })}
      {rows.length > MATCH_PREVIEW ? (
        <SmallAction
          label={all ? s.showLess : fill(s.showAll, { count: rows.length })}
          onPress={() => setAll((now) => !now)}
        />
      ) : null}
    </View>
  );
}
