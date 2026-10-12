/**
 * Step 4: look at everything before anything is added.
 *
 * A summary, what the import does to each balance, filter chips, then one row per
 * expense with a tick box. The list is the screen's scroller (a FlatList with the
 * summary as its header) because a file can hold two thousand rows.
 */

import { memo, useCallback } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { FlatList, Pressable, View } from 'react-native';

import { format, type CurrencyCode } from '@waves/core';
import { Card, Chip, iconSize, MoneyText, Row, Text, useTheme } from '@waves/ui';

import { useStrings, plural, fill } from '@/i18n';
import { formatIsoDate } from '@/lib/groupImport/format';
import {
  rowsFor,
  type ReviewFilter,
  type ReviewModel,
  type ReviewRow,
} from '@/lib/groupImport/review';
import { importProblemText } from '@/lib/problemText';

const FILTERS: readonly ReviewFilter[] = ['all', 'attention', 'wont', 'duplicates'];

export function ReviewList({
  model,
  filter,
  groupCurrency,
  note,
  nameOf,
  onFilter,
  onTick,
  onEdit,
}: {
  model: ReviewModel;
  filter: ReviewFilter;
  groupCurrency: CurrencyCode;
  /** A line about the source, e.g. that Splitwise payers are reconstructed. */
  note: string | null;
  /** A name from the file as it should read on screen. */
  nameOf: (name: string) => string;
  onFilter: (filter: ReviewFilter) => void;
  onTick: (key: string, ticked: boolean) => void;
  onEdit: (key: string) => void;
}): React.JSX.Element {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const g = t.groupImport;
  const rows = rowsFor(model, filter);
  const { summary } = model;

  const filterLabel: Record<ReviewFilter, string> = {
    all: g.filterAll,
    attention: g.filterAttention,
    wont: g.filterWont,
    duplicates: g.filterDuplicates,
  };

  const renderItem = useCallback(
    ({ item }: { item: ReviewRow }) => (
      <ReviewRowView row={item} locale={locale} nameOf={nameOf} onTick={onTick} onEdit={onEdit} />
    ),
    [locale, nameOf, onTick, onEdit],
  );

  const header = (
    <View style={{ gap: theme.spacing.lg, paddingBottom: theme.spacing.md }}>
      <Card style={{ gap: theme.spacing.xs }}>
        <Text variant="subheading">
          {[
            plural(locale, summary.expenses, g.summaryExpenses),
            ...(summary.settlements > 0
              ? [plural(locale, summary.settlements, g.summarySettlements)]
              : []),
          ].join(' · ')}
        </Text>
        <MoneyText
          amount={summary.total}
          currency={groupCurrency}
          locale={locale}
          variant="title"
        />
        <Text variant="caption" tone="muted">
          {[
            summary.firstDate && summary.lastDate
              ? fill(g.summaryRange, {
                  from: formatIsoDate(summary.firstDate, locale, true),
                  to: formatIsoDate(summary.lastDate, locale, true),
                })
              : null,
            summary.newPeople > 0 ? plural(locale, summary.newPeople, g.summaryNewPeople) : null,
            summary.left > 0 ? plural(locale, summary.left, g.summaryLeft) : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
        {summary.otherCurrency > 0 ? (
          <Text variant="caption" tone="muted">
            {plural(locale, summary.otherCurrency, g.summaryOtherCurrency)}
          </Text>
        ) : null}
      </Card>

      {model.changes.length > 0 ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="subheading">{g.changesTitle}</Text>
          <Card padded={false}>
            {model.changes.slice(0, 6).map((change, index) => (
              <Row
                key={change.name}
                style={{
                  justifyContent: 'space-between',
                  paddingHorizontal: theme.spacing.lg,
                  paddingVertical: theme.spacing.sm,
                  borderTopWidth: index === 0 ? 0 : 1,
                  borderTopColor: theme.color.border,
                }}
              >
                <Text variant="body" numberOfLines={1} style={{ flex: 1 }}>
                  {nameOf(change.name)}
                </Text>
                <MoneyText
                  amount={change.net}
                  currency={groupCurrency}
                  locale={locale}
                  mode="balance"
                  showSign
                  variant="body"
                />
              </Row>
            ))}
          </Card>
          <Text variant="micro" tone="muted">
            {g.changesNote}
          </Text>
        </View>
      ) : null}

      {note ? (
        <Row style={{ alignItems: 'flex-start', gap: theme.spacing.sm }}>
          <Ionicons
            name="information-circle-outline"
            size={iconSize.md}
            color={theme.color.brand}
          />
          <Text variant="caption" tone="muted" style={{ flex: 1 }}>
            {note}
          </Text>
        </Row>
      ) : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
        {FILTERS.filter((key) => key === 'all' || model.counts[key] > 0).map((key) => (
          <Chip
            key={key}
            label={key === 'all' ? filterLabel[key] : `${filterLabel[key]} ${model.counts[key]}`}
            variant="brand"
            selected={filter === key}
            onPress={() => onFilter(key)}
            repeatable
          />
        ))}
      </View>
    </View>
  );

  return (
    <FlatList
      data={rows}
      keyExtractor={(row) => row.key}
      renderItem={renderItem}
      ListHeaderComponent={header}
      ListEmptyComponent={
        <Text tone="muted" align="center" style={{ paddingTop: theme.spacing.xl }}>
          {g.noneHere}
        </Text>
      }
      contentContainerStyle={{
        paddingHorizontal: theme.spacing.xl,
        paddingTop: theme.spacing.lg,
        paddingBottom: theme.spacing.xl,
      }}
      ItemSeparatorComponent={() => <View style={{ height: theme.spacing.sm }} />}
      showsVerticalScrollIndicator={false}
      initialNumToRender={14}
      windowSize={9}
    />
  );
}

const ReviewRowView = memo(function ReviewRowView({
  row,
  locale,
  nameOf,
  onTick,
  onEdit,
}: {
  row: ReviewRow;
  locale: string;
  nameOf: (name: string) => string;
  onTick: (key: string, ticked: boolean) => void;
  onEdit: (key: string) => void;
}): React.JSX.Element {
  const theme = useTheme();
  const { t } = useStrings();
  const g = t.groupImport;

  const who =
    row.kind === 'settlement'
      ? fill(g.rowSettlement, {
          from: nameOf(row.payers[0] ?? ''),
          to: nameOf(row.sharers[0] ?? ''),
        })
      : row.payers.length > 0
        ? plural(locale, row.sharers.length, {
            ...g.rowSplit,
          }).replace('{who}', row.payers.map(nameOf).join(', '))
        : '';
  const line = [row.date ? formatIsoDate(row.date, locale) : null, who].filter(Boolean).join(' · ');

  // Error first, then warnings, so the worst thing about a row is the line seen.
  const problems = [...row.issues]
    .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1))
    .slice(0, 2)
    .map((issue) =>
      importProblemText({ kind: issue.code, row: null, message: issue.message }, t.importLedger),
    );
  if (row.duplicate) {
    problems.unshift(
      fill(g.duplicateOf, {
        description: row.duplicate.existing.description,
        date: formatIsoDate(row.duplicate.existing.date, locale, true),
        amount: format(
          {
            minor: row.duplicate.existing.amount,
            currency: row.duplicate.existing.currency as CurrencyCode,
          },
          { locale },
        ),
      }),
    );
  }
  if (row.foreign) problems.push(fill(g.foreignNote, { currency: row.currency }));

  const wont = row.status === 'wont';
  const tone = wont ? theme.color.negative : theme.color.warning;
  const stateText = wont
    ? g.stateWont
    : row.status === 'duplicate'
      ? g.stateDuplicate
      : row.status === 'attention'
        ? g.stateAttention
        : '';
  const amountText =
    row.amount !== null
      ? format({ minor: row.amount, currency: row.currency as CurrencyCode }, { locale })
      : '';

  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'flex-start',
          backgroundColor: theme.color.surface,
          borderRadius: theme.radius.md,
          opacity: wont ? 0.8 : 1,
        },
        theme.shadow.soft,
      ]}
    >
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: row.ticked, disabled: !row.selectable }}
        accessibilityLabel={`${row.description}${stateText ? `, ${stateText}` : ''}`}
        disabled={!row.selectable}
        onPress={() => onTick(row.key, !row.ticked)}
        hitSlop={4}
        style={{ width: 48, minHeight: 56, alignItems: 'center', justifyContent: 'center' }}
      >
        <View
          style={{
            width: 24,
            height: 24,
            borderRadius: 7,
            borderWidth: 1.5,
            borderColor: row.ticked ? theme.color.brand : theme.color.textFaint,
            backgroundColor: row.ticked ? theme.color.brand : 'transparent',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {row.ticked ? (
            <Ionicons name="checkmark" size={iconSize.sm} color={theme.color.onBrand} />
          ) : null}
          {!row.selectable ? (
            <Ionicons name="close" size={iconSize.sm} color={theme.color.textFaint} />
          ) : null}
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={[
          row.description,
          amountText,
          row.date ? formatIsoDate(row.date, locale, true) : '',
          who,
          stateText,
        ]
          .filter(Boolean)
          .join(', ')}
        accessibilityHint={g.editHint}
        onPress={() => onEdit(row.key)}
        style={({ pressed }) => ({
          flex: 1,
          gap: 2,
          paddingVertical: theme.spacing.md,
          paddingEnd: theme.spacing.md,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Row style={{ justifyContent: 'space-between', gap: theme.spacing.sm }}>
          <Text variant="body" numberOfLines={1} style={{ flex: 1, fontWeight: '600' }}>
            {row.description}
          </Text>
          {row.amount !== null ? (
            <MoneyText
              amount={row.amount}
              currency={row.currency as CurrencyCode}
              locale={locale}
              variant="body"
              style={{ fontWeight: '600' }}
            />
          ) : null}
        </Row>
        {line ? (
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {row.edited ? `${g.edited} · ${line}` : line}
          </Text>
        ) : null}
        {problems.map((text, index) => (
          <Row key={index} style={{ alignItems: 'flex-start', gap: 4 }}>
            <Ionicons
              name={wont ? 'close-circle' : 'alert-circle-outline'}
              size={iconSize.sm}
              color={tone}
              style={{ marginTop: 2 }}
            />
            <Text variant="caption" style={{ flex: 1, color: tone }}>
              {text}
            </Text>
          </Row>
        ))}
      </Pressable>
    </View>
  );
});
