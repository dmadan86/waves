/**
 * Step 2: which column is which.
 *
 * One row per column in the file, each a dropdown (a sheet of choices, so it is
 * as easy with a screen reader as without), then the two questions a file can
 * leave open (day or month first, comma or dot decimals), asked only when the
 * file really is ambiguous, and a live preview of the first rows as the reader
 * will take them. The preview is the reader's own output: if it looks right here
 * it imports right.
 */

import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import {
  resolveDates,
  type CurrencyCode,
  type DecimalStyle,
  type DetectedLayout,
  type ImportDateOrder,
} from '@waves/core';
import { Callout, Card, Chip, iconSize, MoneyText, Row, Text, useTheme } from '@waves/ui';

import { ChoiceRow, SheetOverlay } from '@/components/expense/SheetOverlay';
import { useStrings, type UiStrings } from '@/i18n';
import { choiceForColumn, COLUMN_CHOICES, type ColumnChoice } from '@/lib/groupImport/columns';
import { formatIsoDate } from '@/lib/groupImport/format';

export interface PreviewRow {
  key: string;
  description: string;
  date: string | null;
  amount: bigint | null;
  currency: CurrencyCode;
  unreadable: boolean;
}

export function choiceLabel(choice: ColumnChoice, g: UiStrings['groupImport']): string {
  switch (choice) {
    case 'date':
      return g.colDate;
    case 'description':
      return g.colDescription;
    case 'amount':
      return g.colAmount;
    case 'currency':
      return g.colCurrency;
    case 'paid_by':
      return g.colPaidBy;
    case 'split':
      return g.colSplit;
    case 'category':
      return g.colCategory;
    case 'type':
      return g.colType;
    case 'person':
      return g.colPerson;
    case 'ignore':
      return g.colIgnore;
  }
}

export function ColumnMapper({
  header,
  samples,
  layout,
  detected,
  preview,
  noAmount,
  dateSample,
  onPick,
  onDateOrder,
  onDecimalStyle,
}: {
  header: readonly string[];
  /** The first non-empty value in each column, to show what it holds. */
  samples: readonly string[];
  layout: DetectedLayout;
  /** The layout as first detected, to mark the columns that were found rather than set. */
  detected: DetectedLayout;
  preview: readonly PreviewRow[];
  /** No amount column is chosen yet. */
  noAmount: boolean;
  /** A date cell from the file, to show what each reading makes of it. */
  dateSample: string | null;
  onPick: (column: number, choice: ColumnChoice) => void;
  onDateOrder: (order: ImportDateOrder) => void;
  onDecimalStyle: (style: DecimalStyle) => void;
}): React.JSX.Element {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const g = t.groupImport;
  const [picking, setPicking] = useState<number | null>(null);

  const readAs = (order: ImportDateOrder): string => {
    if (!dateSample) return '';
    const cell = resolveDates([dateSample], { order, allowSerial: true }).cells[0];
    return cell?.iso ? formatIsoDate(cell.iso, locale, true) : '—';
  };

  return (
    <View style={{ gap: theme.spacing.lg }}>
      <Text variant="body" tone="muted">
        {g.columnsHint}
      </Text>

      <Card padded={false}>
        {header.map((cell, column) => {
          const choice = choiceForColumn(layout, column);
          const found = choice !== 'ignore' && choiceForColumn(detected, column) === choice;
          const name = cell.trim() || g.columnFallback.replace('{n}', String(column + 1));
          return (
            <Pressable
              key={column}
              accessibilityRole="button"
              accessibilityLabel={`${name}, ${choiceLabel(choice, g)}`}
              accessibilityHint={g.chooseColumn.replace('{header}', name)}
              onPress={() => setPicking(column)}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.spacing.sm,
                minHeight: 52,
                paddingHorizontal: theme.spacing.lg,
                paddingVertical: theme.spacing.sm,
                borderTopWidth: column === 0 ? 0 : 1,
                borderTopColor: theme.color.border,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <View style={{ width: 20, alignItems: 'center' }}>
                {found ? (
                  <Ionicons
                    name="checkmark-circle"
                    size={iconSize.md}
                    color={theme.color.positive}
                  />
                ) : null}
              </View>
              <View style={{ flex: 1, gap: 1 }}>
                <Text variant="body" numberOfLines={1} style={{ fontWeight: '600' }}>
                  {name}
                </Text>
                {samples[column] ? (
                  <Text variant="caption" tone="muted" numberOfLines={1}>
                    {samples[column]}
                  </Text>
                ) : null}
              </View>
              <Text
                variant="caption"
                tone={choice === 'ignore' ? 'faint' : 'brand'}
                numberOfLines={1}
                style={{ maxWidth: '42%', fontWeight: '600' }}
              >
                {choiceLabel(choice, g)}
              </Text>
              <Ionicons name="chevron-down" size={iconSize.sm} color={theme.color.textFaint} />
            </Pressable>
          );
        })}
      </Card>

      {layout.dateAmbiguous && dateSample ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="subheading">{g.dateOrderTitle}</Text>
          <Row style={{ gap: theme.spacing.sm }}>
            <Chip
              label={g.dateDayFirst}
              variant="brand"
              selected={layout.dateOrder === 'dmy'}
              onPress={() => onDateOrder('dmy')}
              repeatable
            />
            <Chip
              label={g.dateMonthFirst}
              variant="brand"
              selected={layout.dateOrder === 'mdy'}
              onPress={() => onDateOrder('mdy')}
              repeatable
            />
          </Row>
          <Text variant="caption" tone="muted">
            {g.dateReadsAs
              .replace('{raw}', dateSample)
              .replace('{date}', readAs(layout.dateOrder ?? 'dmy'))}
          </Text>
        </View>
      ) : null}

      {layout.decimalAmbiguous ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="subheading">{g.decimalTitle}</Text>
          <Row style={{ gap: theme.spacing.sm }}>
            <Chip
              label="1,234.56"
              variant="brand"
              selected={layout.decimalStyle === 'dot'}
              onPress={() => onDecimalStyle('dot')}
              repeatable
            />
            <Chip
              label="1.234,56"
              variant="brand"
              selected={layout.decimalStyle === 'comma'}
              onPress={() => onDecimalStyle('comma')}
              repeatable
            />
          </Row>
        </View>
      ) : null}

      {noAmount ? <Callout tone="warning">{g.needAmount}</Callout> : null}

      {preview.length > 0 ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="subheading">{g.previewTitle}</Text>
          <Card padded={false}>
            {preview.map((row, index) => (
              <View
                key={row.key}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.spacing.md,
                  paddingHorizontal: theme.spacing.lg,
                  paddingVertical: theme.spacing.md,
                  borderTopWidth: index === 0 ? 0 : 1,
                  borderTopColor: theme.color.border,
                }}
              >
                <View style={{ flex: 1, gap: 1 }}>
                  <Text variant="body" numberOfLines={1} style={{ fontWeight: '600' }}>
                    {row.description}
                  </Text>
                  <Text
                    variant="caption"
                    tone={row.unreadable ? 'negative' : 'muted'}
                    numberOfLines={1}
                  >
                    {row.unreadable
                      ? g.previewUnreadable
                      : row.date
                        ? formatIsoDate(row.date, locale, true)
                        : '—'}
                  </Text>
                </View>
                {row.amount !== null ? (
                  <MoneyText
                    amount={row.amount}
                    currency={row.currency}
                    locale={locale}
                    variant="body"
                    style={{ fontWeight: '600' }}
                  />
                ) : null}
              </View>
            ))}
          </Card>
        </View>
      ) : null}

      {picking !== null ? (
        <SheetOverlay
          title={g.chooseColumn.replace(
            '{header}',
            header[picking]?.trim() || g.columnFallback.replace('{n}', String(picking + 1)),
          )}
          onClose={() => setPicking(null)}
        >
          {COLUMN_CHOICES.map((choice) => (
            <ChoiceRow
              key={choice}
              leading={<View style={{ width: 4 }} />}
              label={choiceLabel(choice, g)}
              selected={choiceForColumn(layout, picking) === choice}
              onPress={() => {
                onPick(picking, choice);
                setPicking(null);
              }}
            />
          ))}
        </SheetOverlay>
      ) : null}
    </View>
  );
}
