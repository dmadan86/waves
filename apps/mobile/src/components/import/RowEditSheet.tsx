/**
 * Fix one row without leaving the review: its words, amount, date, who paid, who
 * shares it and its category. Kept simple on purpose: anything finer is better
 * done in the expense itself once it is in.
 */

import { useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';

import { CATEGORIES, parseLooseAmount, type CurrencyCode, type DecimalStyle } from '@waves/core';
import { Button, Callout, Chip, Row, Sheet, Text, useTheme } from '@waves/ui';

import { useStrings } from '@/i18n';
import { isIsoDay, minorToPlain } from '@/lib/groupImport/format';
import type { ReviewRow, RowEdit } from '@/lib/groupImport/review';

export interface EditContext {
  row: ReviewRow;
  /** Names in the file, the only people a row can be given to. */
  people: readonly string[];
  category: string | null;
  decimalStyle: DecimalStyle;
}

export function RowEditSheet({
  context,
  edited,
  nameOf,
  onSave,
  onReset,
  onClose,
}: {
  context: EditContext;
  edited: boolean;
  nameOf: (name: string) => string;
  onSave: (edit: RowEdit) => void;
  onReset: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const { t } = useStrings();
  const g = t.groupImport;
  const { row } = context;
  const expense = row.kind === 'expense';
  const currency = row.currency as CurrencyCode;

  const [description, setDescription] = useState(row.description);
  const [amount, setAmount] = useState(
    row.amount !== null ? minorToPlain(row.amount, currency) : '',
  );
  const [date, setDate] = useState(row.date ?? '');
  const [payer, setPayer] = useState<string | null>(
    row.payers.length === 1 ? (row.payers[0] ?? null) : null,
  );
  const [payerTouched, setPayerTouched] = useState(false);
  const [sharers, setSharers] = useState<string[]>(
    row.sharers.filter((name) => context.people.includes(name)),
  );
  const [sharersTouched, setSharersTouched] = useState(false);
  const [category, setCategory] = useState<string | null>(context.category);
  const [categoryTouched, setCategoryTouched] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const field = {
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    fontSize: 16,
    minHeight: 44,
    color: theme.color.text,
    backgroundColor: theme.color.surface,
  } as const;

  const save = (): void => {
    const edit: RowEdit = {};
    if (description.trim() !== row.description) edit.description = description;
    const parsed = parseLooseAmount(amount, currency, context.decimalStyle);
    if (!parsed.ok || parsed.minor <= 0n) {
      setProblem(g.invalidAmount);
      return;
    }
    if (parsed.minor !== row.amount) edit.amount = parsed.minor;
    if (!isIsoDay(date)) {
      setProblem(g.invalidDate);
      return;
    }
    if (date.trim() !== row.date) edit.date = date.trim();
    if (expense) {
      if (payerTouched && payer) edit.payer = payer;
      if (sharersTouched && sharers.length > 0) edit.participants = sharers;
      if (categoryTouched) edit.category = category;
    }
    onSave(edit);
  };

  const label = (text: string): React.JSX.Element => (
    <Text variant="caption" tone="muted">
      {text}
    </Text>
  );

  return (
    <Sheet
      visible
      onClose={onClose}
      title={g.editTitle}
      closeLabel={t.common.close}
      style={{ maxHeight: '92%' }}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        style={{ flexShrink: 1 }}
      >
        <View style={{ gap: theme.spacing.md, paddingBottom: theme.spacing.sm }}>
          {problem ? <Callout tone="negative">{problem}</Callout> : null}
          <View style={{ gap: theme.spacing.xs }}>
            {label(g.fieldDescription)}
            <TextInput
              value={description}
              onChangeText={setDescription}
              accessibilityLabel={g.fieldDescription}
              style={field}
            />
          </View>
          <Row style={{ gap: theme.spacing.md, alignItems: 'flex-start' }}>
            <View style={{ flex: 1, gap: theme.spacing.xs }}>
              {label(`${g.fieldAmount} (${row.currency})`)}
              <TextInput
                value={amount}
                onChangeText={(text) => {
                  setAmount(text);
                  setProblem(null);
                }}
                keyboardType="decimal-pad"
                accessibilityLabel={g.fieldAmount}
                style={field}
              />
            </View>
            <View style={{ flex: 1, gap: theme.spacing.xs }}>
              {label(g.fieldDate)}
              <TextInput
                value={date}
                onChangeText={(text) => {
                  setDate(text);
                  setProblem(null);
                }}
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel={g.fieldDate}
                style={field}
              />
            </View>
          </Row>

          {expense ? (
            <>
              <View style={{ gap: theme.spacing.xs }}>
                {label(g.fieldPayer)}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
                  {context.people.map((name) => (
                    <Chip
                      key={name}
                      label={nameOf(name)}
                      variant="brand"
                      selected={payer === name}
                      onPress={() => {
                        setPayer(name);
                        setPayerTouched(true);
                      }}
                      repeatable
                    />
                  ))}
                </View>
              </View>
              <View style={{ gap: theme.spacing.xs }}>
                {label(g.fieldSplit)}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
                  {context.people.map((name) => (
                    <Chip
                      key={name}
                      label={nameOf(name)}
                      variant="brand"
                      selected={sharers.includes(name)}
                      onPress={() => {
                        setSharers((now) =>
                          now.includes(name) ? now.filter((one) => one !== name) : [...now, name],
                        );
                        setSharersTouched(true);
                      }}
                      repeatable
                    />
                  ))}
                </View>
              </View>
              <View style={{ gap: theme.spacing.xs }}>
                {label(g.fieldCategory)}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
                  <Chip
                    label={g.categoryNone}
                    variant="brand"
                    selected={category === null}
                    onPress={() => {
                      setCategory(null);
                      setCategoryTouched(true);
                    }}
                    repeatable
                  />
                  {CATEGORIES.map((one) => (
                    <Chip
                      key={one.id}
                      label={t.categories[one.id]}
                      variant="brand"
                      selected={category === one.id}
                      onPress={() => {
                        setCategory(one.id);
                        setCategoryTouched(true);
                      }}
                      repeatable
                    />
                  ))}
                </View>
              </View>
            </>
          ) : null}
        </View>
      </ScrollView>
      <Row style={{ gap: theme.spacing.sm, marginTop: theme.spacing.md }}>
        {edited ? (
          <View style={{ flex: 1 }}>
            <Button label={g.resetRow} variant="secondary" fullWidth onPress={onReset} />
          </View>
        ) : (
          <View style={{ flex: 1 }}>
            <Button label={t.common.cancel} variant="secondary" fullWidth onPress={onClose} />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Button label={t.common.save} variant="brand" fullWidth onPress={save} />
        </View>
      </Row>
    </Sheet>
  );
}
