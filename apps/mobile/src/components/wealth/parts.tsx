/** Small pieces shared by the Investments and Rentals screens. */

import { useState, type ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Platform, Pressable, ScrollView, TextInput, View } from 'react-native';

import { formatParts, money, type CurrencyCode } from '@waves/core';
import {
  AmountField,
  Button,
  ChipRow,
  iconSize,
  Row,
  Screen,
  Sheet,
  Text,
  useTabBarClearance,
  useTheme,
} from '@waves/ui';

import { BALANCE_MASK } from '@/components/home/HomeBalanceCard';
import { localIsoDate } from '@/data/personal';
import { fill, useStrings } from '@/i18n';
import { usePersonalAmountsHidden } from '@/lib/amountsHidden';
import { dateFrom, showDate } from '@/lib/expenseDay';
import { router } from '@/lib/navigation';
import { wizardFooterPadding } from '@/lib/wealthFlow';

/** Money as the person's own locale writes it: masked when amounts are hidden, no bare ".00". */
export function useWealthMoney(): (amount: bigint, currency: CurrencyCode) => string {
  const { hidden } = usePersonalAmountsHidden();
  const { locale } = useStrings();
  return (amount, currency) => {
    if (hidden) return BALANCE_MASK;
    const p = formatParts(money(amount, currency), { locale });
    return /[1-9]/.test(p.fraction) ? p.text : p.lead + p.trail;
  };
}

/** One question at a time under a progress bar, skippable. */
export function FlowShell({
  title,
  index,
  total,
  onSkip,
  children,
  note,
}: {
  title: string;
  index: number;
  total: number;
  onSkip?: () => void;
  children: ReactNode;
  note?: string;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const s = t.personalSetup;
  const clearance = useTabBarClearance();
  return (
    <Screen>
      <View style={{ paddingHorizontal: theme.spacing.lg, gap: theme.spacing.md, flex: 1 }}>
        <Row style={{ alignItems: 'center', gap: theme.spacing.md, paddingTop: theme.spacing.sm }}>
          <View
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel={fill(s.stepOf, { n: index + 1, total })}
            accessibilityValue={{ min: 0, max: total, now: index + 1 }}
            style={{
              flex: 1,
              height: 6,
              borderRadius: 3,
              flexDirection: 'row',
              backgroundColor: theme.color.surfaceMuted,
              overflow: 'hidden',
            }}
          >
            <View
              style={{
                width: `${((index + 1) / total) * 100}%`,
                backgroundColor: theme.color.brand,
              }}
            />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.common.close}
            hitSlop={10}
            onPress={() => router.back()}
          >
            <Ionicons name="close" size={iconSize.md} color={theme.color.textMuted} />
          </Pressable>
        </Row>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ gap: theme.spacing.lg, paddingBottom: theme.spacing.xl }}
        >
          <Text variant="title" accessibilityRole="header">
            {title}
          </Text>
          {children}
          {note ? (
            <Text variant="caption" tone="muted">
              {note}
            </Text>
          ) : null}
        </ScrollView>
        {onSkip ? (
          <View style={{ paddingBottom: wizardFooterPadding(clearance, theme.spacing.lg) }}>
            <Button label={s.skip} variant="ghost" onPress={onSkip} />
          </View>
        ) : null}
      </View>
    </Screen>
  );
}

/** Chips that answer by being tapped. */
export function Pick<T extends string>({
  options,
  onPick,
  value,
}: {
  options: readonly { value: T; label: string }[];
  onPick: (value: T) => void;
  value?: T;
}) {
  return (
    <ChipRow<T>
      wrap
      variant="brand"
      onCard
      value={value ?? ('' as T)}
      options={options}
      onChange={onPick}
    />
  );
}

/** A single-line text answer. */
export function TextAnswer({
  value,
  onChange,
  placeholder,
  label,
  keyboardType,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  label: string;
  keyboardType?: 'default' | 'phone-pad' | 'numeric';
}) {
  const theme = useTheme();
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={theme.color.textFaint}
      accessibilityLabel={label}
      keyboardType={keyboardType}
      style={{
        fontSize: 16,
        color: theme.color.text,
        paddingVertical: 12,
        paddingHorizontal: theme.spacing.md,
        borderRadius: theme.radius.md,
        backgroundColor: theme.color.surfaceMuted,
      }}
    />
  );
}

/** A date that opens the system picker on tap; optional dates can be cleared. */
export function DateAnswer({
  label,
  value,
  onChange,
  clearLabel,
}: {
  label: string;
  value: string | null;
  onChange: (iso: string | null) => void;
  clearLabel?: string;
}) {
  const theme = useTheme();
  const { locale } = useStrings();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: theme.spacing.xs }}>
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          onPress={() => setOpen(true)}
          style={{
            flex: 1,
            paddingVertical: 12,
            paddingHorizontal: theme.spacing.md,
            borderRadius: theme.radius.md,
            backgroundColor: theme.color.surfaceMuted,
          }}
        >
          <Text variant="body">{value ? showDate(value, locale) : clearLabel}</Text>
        </Pressable>
        {value && clearLabel ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={clearLabel}
            onPress={() => onChange(null)}
          >
            <Ionicons
              name="close-circle-outline"
              size={iconSize.md}
              color={theme.color.textMuted}
            />
          </Pressable>
        ) : null}
      </Row>
      {open ? (
        <DateTimePicker
          value={dateFrom(value ?? localIsoDate(new Date()))}
          mode="date"
          onChange={(event, picked) => {
            if (Platform.OS !== 'ios') setOpen(false);
            if (event.type === 'set' && picked) onChange(localIsoDate(picked));
          }}
        />
      ) : null}
    </View>
  );
}

export type PillTone = 'positive' | 'warning' | 'negative' | 'neutral';

/** A small status pill. */
export function StatusPill({ label, tone }: { label: string; tone: PillTone }) {
  const theme = useTheme();
  const bg =
    tone === 'positive'
      ? theme.tint.mint.bg
      : tone === 'warning'
        ? theme.tint.peach.bg
        : tone === 'negative'
          ? theme.tint.coral.bg
          : theme.color.surfaceMuted;
  return (
    <View
      style={{
        paddingHorizontal: theme.spacing.sm,
        paddingVertical: 2,
        borderRadius: theme.radius.pill,
        backgroundColor: bg,
      }}
    >
      <Text variant="micro" style={{ fontWeight: '600' }}>
        {label}
      </Text>
    </View>
  );
}

/** A sheet that asks for one amount (and, optionally, a date). */
export function AmountSheet({
  visible,
  title,
  currency,
  initial = 0n,
  withDate = false,
  notePlaceholder,
  saveLabel,
  onSave,
  onClose,
}: {
  visible: boolean;
  title: string;
  currency: CurrencyCode;
  initial?: bigint;
  withDate?: boolean;
  /** Show a one-line note field with this placeholder. */
  notePlaceholder?: string;
  saveLabel: string;
  onSave: (amount: bigint, date: string, note: string) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const [amount, setAmount] = useState(initial);
  const [date, setDate] = useState<string | null>(null);
  const [note, setNote] = useState('');
  return (
    <Sheet visible={visible} onClose={onClose} title={title} closeLabel={t.common.close}>
      <View style={{ gap: theme.spacing.lg }}>
        <AmountField currency={currency} value={amount} onChange={setAmount} />
        {withDate ? (
          <DateAnswer
            label={t.wealth.today}
            value={date ?? localIsoDate(new Date())}
            onChange={(d) => setDate(d)}
          />
        ) : null}
        {notePlaceholder ? (
          <TextAnswer
            value={note}
            onChange={setNote}
            placeholder={notePlaceholder}
            label={notePlaceholder}
          />
        ) : null}
        <Button
          label={saveLabel}
          disabled={amount <= 0n}
          onPress={() => {
            onSave(amount, date ?? localIsoDate(new Date()), note);
            setAmount(0n);
            setDate(null);
            setNote('');
          }}
        />
      </View>
    </Sheet>
  );
}

/** A one-field sheet for renaming a record, on the screen that shows it. */
export function RenameSheet({
  visible,
  title,
  placeholder,
  initial,
  onSave,
  onClose,
}: {
  visible: boolean;
  title: string;
  placeholder: string;
  initial: string;
  onSave: (name: string) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const [name, setName] = useState(initial);
  return (
    <Sheet visible={visible} onClose={onClose} title={title} closeLabel={t.common.close}>
      <View style={{ gap: theme.spacing.lg }}>
        <TextAnswer value={name} onChange={setName} placeholder={placeholder} label={placeholder} />
        <Button
          label={t.common.save}
          disabled={name.trim() === ''}
          onPress={() => onSave(name.trim())}
        />
      </View>
    </Sheet>
  );
}
