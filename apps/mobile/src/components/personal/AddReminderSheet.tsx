/**
 * Add Reminder: a title, an optional amount, a date and how often it repeats.
 * With an amount it becomes a manual (not auto-posted) expense rule, which then
 * shows up as a bill; without one it is a private date of kind `other` (dates
 * repeat yearly, so the repeat choice only applies when there is an amount).
 */

import { useState } from 'react';
import { Platform, Pressable, TextInput, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';

import { encodeRecurring, parseMinorInput, sanitiseMinorInput } from '@waves/core';
import { Button, ChipRow, Row, Sheet, Text, useTheme } from '@waves/ui';

import { localIsoDate, useUpsertPersonalRecord } from '@/data/personal';
import { useSaveDate } from '@/data/personalDates';
import { useStrings } from '@/i18n';
import { nextDateLabel } from '@/lib/recurringList';

type Repeat = 'none' | 'monthly' | 'yearly';

const dateFrom = (iso: string): Date => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d);
};

export function AddReminderSheet({
  visible,
  currency,
  today,
  onClose,
}: {
  visible: boolean;
  currency: string;
  today: string;
  onClose: () => void;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const h = t.personalHome;
  const upsert = useUpsertPersonalRecord();
  const saveDate = useSaveDate();
  const [title, setTitle] = useState('');
  const [amountText, setAmountText] = useState('');
  const [date, setDate] = useState(today);
  const [repeat, setRepeat] = useState<Repeat>('none');
  const [picking, setPicking] = useState(false);

  const amount = parseMinorInput(amountText, currency);
  const busy = upsert.isPending || saveDate.isPending;
  const canSave = title.trim().length > 0 && !busy;

  const done = () => {
    setTitle('');
    setAmountText('');
    setRepeat('none');
    setDate(today);
    onClose();
  };

  const save = () => {
    const note = title.trim();
    if (amount > 0n) {
      upsert.mutate(
        {
          recordKind: 'recurring',
          data: encodeRecurring({
            txnKind: 'expense',
            amount,
            currency,
            category: null,
            note,
            cadence: repeat === 'yearly' ? 'yearly' : 'monthly',
            interval: 1,
            secondDay: null,
            anchorDate: date,
            nextDate: date,
            // A one-off ends on its own day.
            endDate: repeat === 'none' ? date : null,
            autoPost: false,
            active: true,
          }),
        },
        { onSuccess: done },
      );
    } else {
      saveDate.save(
        {
          label: 'other',
          name: note,
          day: Number(date.slice(8, 10)),
          month: Number(date.slice(5, 7)),
          year: null,
        },
        done,
      );
    }
  };

  const field = {
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.lg,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: Platform.OS === 'ios' ? theme.spacing.md : theme.spacing.sm,
    fontSize: 16,
    color: theme.color.text,
    backgroundColor: theme.color.surface,
  } as const;

  return (
    <Sheet visible={visible} onClose={onClose} closeLabel={t.common.close}>
      <View style={{ gap: theme.spacing.md }}>
        <Text variant="title">{h.addReminder}</Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          maxLength={60}
          placeholder={h.reminderTitle}
          placeholderTextColor={theme.color.textFaint}
          accessibilityLabel={h.reminderTitle}
          style={field}
        />
        <TextInput
          value={amountText}
          onChangeText={(v) => setAmountText(sanitiseMinorInput(v, currency))}
          keyboardType="decimal-pad"
          placeholder={h.reminderAmount}
          placeholderTextColor={theme.color.textFaint}
          accessibilityLabel={h.reminderAmount}
          style={field}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${h.reminderDate}: ${nextDateLabel(date, locale)}`}
          onPress={() => setPicking((p) => !p)}
          style={[field, { flexDirection: 'row', justifyContent: 'space-between' }]}
        >
          <Text tone="muted">{h.reminderDate}</Text>
          <Text style={{ fontWeight: '600' }}>{nextDateLabel(date, locale)}</Text>
        </Pressable>
        {picking ? (
          <DateTimePicker
            value={dateFrom(date)}
            mode="date"
            onChange={(event, picked) => {
              if (Platform.OS !== 'ios') setPicking(false);
              if (event.type === 'set' && picked) setDate(localIsoDate(picked));
            }}
          />
        ) : null}
        {amount > 0n ? (
          <View accessibilityLabel={h.repeat}>
            <ChipRow<Repeat>
              value={repeat}
              onChange={setRepeat}
              variant="brand"
              onCard
              options={[
                { value: 'none', label: h.repeatNone },
                { value: 'monthly', label: h.repeatMonthly },
                { value: 'yearly', label: h.repeatYearly },
              ]}
            />
          </View>
        ) : null}
        <Row style={{ gap: theme.spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Button label={t.common.cancel} variant="secondary" fullWidth onPress={onClose} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label={t.common.save} fullWidth disabled={!canSave} onPress={save} />
          </View>
        </Row>
      </View>
    </Sheet>
  );
}
