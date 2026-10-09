/**
 * "Paid to": type who outside the group the money went to, or pick one this
 * group has paid before.
 *
 * A small sheet over the add/edit form: one text field (the keyboard comes up
 * with it), the group's earlier payees under it, most-used first and narrowed
 * as you type, and Clear / Done. Tapping a suggestion is the whole answer, so
 * it picks and closes in one tap.
 *
 * It keeps its own draft, seeded each time it opens, so a dismissed sheet
 * changes nothing on the form.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Platform, TextInput, View } from 'react-native';

import { cleanPayee, PAYEE_MAX_LENGTH } from '@waves/core';
import { Button, iconSize, Row, Sheet, Text, useTheme } from '@waves/ui';

import { ChoiceRow } from '@/components/expense/SheetOverlay';
import { useStrings } from '@/i18n';
import { payeeSuggestions } from '@/lib/payeeSuggestions';

export function PayeeSheet({
  visible,
  value,
  usedBefore,
  onChange,
  onClose,
}: {
  visible: boolean;
  /** The payee on the form now, or null. */
  value: string | null;
  /** Every payee on this group's expenses, newest first (repeats included). */
  usedBefore: readonly (string | null | undefined)[];
  onChange: (next: string | null) => void;
  onClose: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const { t } = useStrings();
  const [draft, setDraft] = useState(value ?? '');
  const field = useRef<TextInput>(null);

  // Seeded once per opening, in render (see EditTextSheet for why not an effect).
  const [opened, setOpened] = useState(false);
  if (visible && !opened) {
    setOpened(true);
    setDraft(value ?? '');
  }
  if (!visible && opened) setOpened(false);

  useEffect(() => {
    if (!visible) return;
    const id = setTimeout(() => field.current?.focus(), 150);
    return () => clearTimeout(id);
  }, [visible]);

  const suggestions = useMemo(() => payeeSuggestions(usedBefore, draft), [usedBefore, draft]);

  const finish = (next: string | null): void => {
    onChange(cleanPayee(next));
    onClose();
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={t.expense.payee.label}
      closeLabel={t.common.close}
    >
      <View style={{ gap: theme.spacing.md }}>
        <Text variant="caption" tone="muted">
          {t.expense.payee.hint}
        </Text>
        <TextInput
          ref={field}
          value={draft}
          onChangeText={setDraft}
          maxLength={PAYEE_MAX_LENGTH}
          autoCapitalize="words"
          autoCorrect={false}
          accessibilityLabel={t.expense.payee.label}
          placeholder={t.expense.payee.placeholder}
          placeholderTextColor={theme.color.textFaint}
          returnKeyType="done"
          onSubmitEditing={() => finish(draft)}
          style={{
            borderWidth: 1,
            borderColor: theme.color.border,
            borderRadius: theme.radius.lg,
            paddingHorizontal: theme.spacing.md,
            paddingVertical: Platform.OS === 'ios' ? theme.spacing.md : theme.spacing.sm,
            fontSize: 16,
            color: theme.color.text,
            backgroundColor: theme.color.surface,
          }}
        />

        {suggestions.length > 0 ? (
          <View>
            <Text variant="micro" tone="muted">
              {t.expense.payee.used}
            </Text>
            {suggestions.map((payee) => (
              <ChoiceRow
                key={payee}
                label={payee}
                leading={
                  <Ionicons name="time-outline" size={iconSize.md} color={theme.color.textMuted} />
                }
                onPress={() => finish(payee)}
              />
            ))}
          </View>
        ) : null}

        <Row style={{ gap: theme.spacing.sm }}>
          {/* Clear only when there is something to clear. */}
          {value || draft.trim() ? (
            <View style={{ flex: 1 }}>
              <Button
                label={t.expense.payee.clear}
                variant="secondary"
                fullWidth
                onPress={() => finish(null)}
              />
            </View>
          ) : null}
          <View style={{ flex: 1 }}>
            <Button label={t.common.done} fullWidth onPress={() => finish(draft)} />
          </View>
        </Row>
      </View>
    </Sheet>
  );
}
