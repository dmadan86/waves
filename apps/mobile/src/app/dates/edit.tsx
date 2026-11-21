/**
 * Add or edit a private date (B4): type chips, a name when one is needed, day
 * and month (no year; work anniversaries may say which year they started).
 * Private to this person; sharing with groups is a later phase.
 */

import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams } from 'expo-router';
import {
  Button,
  Chip,
  iconSize,
  Row,
  Screen,
  Text,
  Toggle,
  useTabBarClearance,
  useTheme,
} from '@waves/ui';
import { DATE_LABEL_KINDS, type DateLabelKind } from '@waves/core';

import { PlainHeader, StandardCard } from '@/components/standard';
import { usePersonalDates, useSaveDate } from '@/data/personalDates';
import { useDeletePersonalRecord } from '@/data/personal';
import { useStrings } from '@/i18n';
import { birthdayToDate, dateToBirthday } from '@/lib/birthday';
import { useDialog } from '@/lib/dialog';
import { router } from '@/lib/navigation';

const NEEDS_NAME: readonly DateLabelKind[] = ['family_birthday', 'other'];

export default function EditDateScreen() {
  const theme = useTheme();
  const clearance = useTabBarClearance();
  const { t, locale } = useStrings();
  const { confirm } = useDialog();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const existing = usePersonalDates().find((d) => d.id === id);
  const { save, isPending } = useSaveDate();
  const remove = useDeletePersonalRecord();

  const [label, setLabel] = useState<DateLabelKind>(existing?.label ?? 'family_birthday');
  const [name, setName] = useState(existing?.name ?? '');
  const [when, setWhen] = useState({ day: existing?.day ?? 1, month: existing?.month ?? 1 });
  const [year, setYear] = useState(existing?.year ? String(existing.year) : '');
  const [picking, setPicking] = useState(false);
  // The saved date can arrive after the first render (the ledger is still
  // loading): fill the form once when it does, so Save never writes defaults over it.
  const filled = useRef(Boolean(existing));
  useEffect(() => {
    if (!existing || filled.current) return;
    filled.current = true;
    setLabel(existing.label);
    setName(existing.name ?? '');
    setWhen({ day: existing.day, month: existing.month });
    setYear(existing.year ? String(existing.year) : '');
  }, [existing]);

  const needsName = NEEDS_NAME.includes(label);
  const yearNum = Number(year);
  const yearOk = year === '' || (Number.isInteger(yearNum) && yearNum >= 1950 && yearNum <= 2100);
  // Editing waits for the saved date, so Save cannot write the blank form over it.
  const canSave =
    (!id || existing !== undefined) && (!needsName || name.trim() !== '') && yearOk && !isPending;

  const pick = (): void => {
    const value = birthdayToDate(when);
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value,
        mode: 'date',
        onChange: (e, d) => e.type === 'set' && d && setWhen(dateToBirthday(d)),
      });
    } else setPicking((p) => !p);
  };

  const onSave = (): void => {
    if (!canSave) return;
    save(
      {
        // Editing keeps the route's id even if the record has not loaded yet.
        id: existing?.id ?? id,
        carried: existing?.carried,
        label,
        name: needsName ? name.trim() : '',
        day: when.day,
        month: when.month,
        year: label === 'work_anniversary' && year !== '' ? yearNum : null,
      },
      () => router.back(),
    );
  };

  const tile = (big: string, small: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${small} ${big}`}
      onPress={pick}
      style={{
        flex: 1,
        alignItems: 'center',
        paddingVertical: theme.spacing.md,
        backgroundColor: theme.color.surface,
        borderRadius: theme.radius.lg,
        borderWidth: theme.scheme === 'dark' ? 0 : 1,
        borderColor: theme.color.border,
      }}
    >
      <Text style={{ fontSize: 24, lineHeight: 30, fontWeight: '800' }}>{big}</Text>
      <Text variant="caption" tone="muted">
        {small}
      </Text>
    </Pressable>
  );

  return (
    <Screen edges={[]}>
      <PlainHeader title={existing ? t.dates.editExisting : t.dates.editNew} />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: clearance,
          gap: theme.spacing.md,
        }}
      >
        <Row style={{ gap: theme.spacing.sm, flexWrap: 'wrap' }}>
          {DATE_LABEL_KINDS.map((kind) => (
            <Chip
              key={kind}
              label={t.dates.kinds[kind]}
              selected={label === kind}
              onPress={() => setLabel(kind)}
            />
          ))}
        </Row>

        {needsName ? (
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder={t.dates.namePlaceholder}
            placeholderTextColor={theme.color.textMuted}
            accessibilityLabel={t.dates.name}
            maxLength={60}
            style={{
              height: 48,
              paddingHorizontal: theme.spacing.md,
              borderRadius: theme.radius.lg,
              backgroundColor: theme.color.surface,
              color: theme.color.text,
              fontSize: 16,
            }}
          />
        ) : null}

        <Row style={{ gap: theme.spacing.md }}>
          {tile(String(when.day), t.dates.day)}
          {tile(birthdayToDate(when).toLocaleDateString(locale, { month: 'long' }), t.dates.month)}
        </Row>
        {Platform.OS === 'ios' && picking ? (
          <DateTimePicker
            value={birthdayToDate(when)}
            mode="date"
            display="inline"
            onChange={(e, d) => e.type !== 'dismissed' && d && setWhen(dateToBirthday(d))}
          />
        ) : null}

        {label === 'work_anniversary' ? (
          <TextInput
            value={year}
            onChangeText={(v) => setYear(v.replace(/\D/g, '').slice(0, 4))}
            placeholder={t.dates.sinceYear}
            placeholderTextColor={theme.color.textMuted}
            accessibilityLabel={t.dates.sinceYear}
            keyboardType="number-pad"
            style={{
              height: 48,
              paddingHorizontal: theme.spacing.md,
              borderRadius: theme.radius.lg,
              backgroundColor: theme.color.surface,
              color: theme.color.text,
              fontSize: 16,
            }}
          />
        ) : null}

        {/* Sharing needs a profiles migration (phase 2): shown, but off and not yet usable. */}
        <StandardCard>
          <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '700' }}>{t.dates.shareLabel}</Text>
              <Text variant="caption" tone="muted">
                {t.dates.shareComing}
              </Text>
            </View>
            <Toggle
              value={false}
              onValueChange={() => {}}
              disabled
              accessibilityLabel={t.dates.shareLabel}
            />
          </Row>
        </StandardCard>
        <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
          <Ionicons name="lock-closed-outline" size={iconSize.sm} color={theme.color.textMuted} />
          <Text variant="caption" tone="muted" style={{ flex: 1 }}>
            {needsName ? t.dates.privacyFamily : t.dates.privacyMine}
          </Text>
        </Row>

        <Button label={t.dates.save} fullWidth disabled={!canSave} onPress={onSave} />
        {existing ? (
          <Button
            label={t.dates.remove}
            variant="ghost"
            fullWidth
            onPress={() =>
              void confirm({
                title: t.common.delete,
                body: t.dates.remove,
                confirmLabel: t.common.delete,
                tone: 'danger',
              }).then((ok) => {
                if (ok) remove.mutate(existing.id, { onSuccess: () => router.back() });
              })
            }
          />
        ) : (
          <Button label={t.dates.notNow} variant="ghost" fullWidth onPress={() => router.back()} />
        )}
      </ScrollView>
    </Screen>
  );
}
