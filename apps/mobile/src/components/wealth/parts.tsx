/** Small pieces shared by the Investments and Rentals screens. */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, {
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type EntryExitAnimationFunction,
} from 'react-native-reanimated';

import { formatParts, money, type CurrencyCode } from '@waves/core';
import {
  AmountField,
  Button,
  Card,
  ChipRow,
  iconSize,
  isRtlLayout,
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
import { EASE_IN_OUT, EASE_OUT, PressableScale, SPRING_POP } from '@/lib/anim';
import { usePersonalAmountsHidden } from '@/lib/amountsHidden';
import { dateFrom, showDate } from '@/lib/expenseDay';
import { useReducedMotion } from '@/lib/reducedMotion';
import { router } from '@/lib/navigation';
import { wizardFooterPadding } from '@/lib/wealthFlow';
import { usesTiles, type IconName } from '@/lib/wizardIcons';

/** The question slides in from the trailing edge; no exit, so nothing ever waits to show the next. */
const stepIn =
  (dx: number): EntryExitAnimationFunction =>
  () => {
    'worklet';
    return {
      initialValues: { opacity: 0, transform: [{ translateX: dx }] },
      animations: {
        opacity: withTiming(1, { duration: 200 }),
        transform: [{ translateX: withTiming(0, { duration: 220, easing: EASE_OUT }) }],
      },
    };
  };

/** The progress fill glides to its notch; it starts at its target, so mount does not sweep. */
function ProgressFill({ pct }: { pct: number }) {
  const theme = useTheme();
  const reduce = useReducedMotion();
  const v = useSharedValue(pct);
  useEffect(() => {
    v.set(reduce ? pct : withTiming(pct, { duration: 260, easing: EASE_IN_OUT }));
  }, [pct, reduce, v]);
  const style = useAnimatedStyle(() => ({ width: `${v.get()}%` }));
  return <Animated.View style={[{ backgroundColor: theme.color.brand }, style]} />;
}

const TILE_TINTS = ['lilac', 'sky', 'peach', 'mint', 'pink', 'coral'] as const;

/** Step icon in a soft brand circle with "Step n of N" beside it, above the question. */
export function StepHeader({
  icon,
  index,
  total,
  stepLabel,
}: {
  icon: IconName;
  index: number;
  total: number;
  stepLabel: string;
}) {
  const theme = useTheme();
  return (
    <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: 28,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.color.brandSoft,
        }}
      >
        <Ionicons name={icon} size={28} color={theme.color.brand} />
      </View>
      <Text variant="caption" tone="muted" accessibilityLabel={`${index + 1}/${total}`}>
        {stepLabel}
      </Text>
    </Row>
  );
}

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
  icon,
}: {
  title: string;
  index: number;
  total: number;
  onSkip?: () => void;
  children: ReactNode;
  note?: string;
  icon?: IconName;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const s = t.personalSetup;
  const clearance = useTabBarClearance();
  const reduce = useReducedMotion();
  const entering = reduce ? FadeIn.duration(150) : stepIn(isRtlLayout() ? -16 : 16);
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
            <ProgressFill pct={((index + 1) / total) * 100} />
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
          contentContainerStyle={{ paddingBottom: theme.spacing.xl }}
        >
          <Animated.View key={index} entering={entering} style={{ gap: theme.spacing.lg }}>
            {icon ? (
              <StepHeader
                icon={icon}
                index={index}
                total={total}
                stepLabel={fill(s.stepOf, { n: index + 1, total })}
              />
            ) : null}
            <Text variant="title" accessibilityRole="header">
              {title}
            </Text>
            {children}
            {note ? (
              <Text variant="caption" tone="muted">
                {note}
              </Text>
            ) : null}
          </Animated.View>
        </ScrollView>
        {onSkip ? (
          <View style={{ paddingBottom: wizardFooterPadding(clearance, theme.spacing.lg) }}>
            <Button fullWidth label={s.skip} variant="ghost" onPress={onSkip} />
          </View>
        ) : null}
      </View>
    </Screen>
  );
}

/**
 * Answers that are picked by tapping: a 2-column grid of icon tiles when every
 * option has an icon, plain chips otherwise.
 */
export function Pick<T extends string>({
  options,
  onPick,
  value,
}: {
  options: readonly { value: T; label: string; icon?: IconName }[];
  onPick: (value: T) => void;
  value?: T;
}) {
  const theme = useTheme();
  if (!usesTiles(options)) {
    return (
      <ChipRow<T>
        wrap
        variant="brand"
        onCard
        value={value ?? ('' as T)}
        options={options.map(({ value: v, label }) => ({ value: v, label }))}
        onChange={onPick}
      />
    );
  }
  return (
    <Row style={{ flexWrap: 'wrap', gap: theme.spacing.md }}>
      {options.map((o, i) => {
        const selected = o.value === value;
        const tint = theme.tint[TILE_TINTS[i % TILE_TINTS.length]!];
        return (
          <PickTile
            key={o.value}
            label={o.label}
            icon={o.icon!}
            tint={tint}
            selected={selected}
            onPick={() => onPick(o.value)}
          />
        );
      })}
    </Row>
  );
}

/** A single-line text answer. */
export function TextAnswer({
  value,
  onChange,
  placeholder,
  label,
  keyboardType,
  bordered = false,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  label: string;
  keyboardType?: 'default' | 'phone-pad' | 'numeric';
  /** Outlined like the form's select fields, for one-screen forms. */
  bordered?: boolean;
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
        ...(bordered
          ? {
              minHeight: 46,
              borderRadius: theme.radius.lg,
              borderWidth: 1,
              borderColor: theme.color.border,
              backgroundColor: theme.color.surface,
            }
          : { borderRadius: theme.radius.md, backgroundColor: theme.color.surfaceMuted }),
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
          fullWidth
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
          fullWidth
          label={t.common.save}
          disabled={name.trim() === ''}
          onPress={() => onSave(name.trim())}
        />
      </View>
    </Sheet>
  );
}

/** One icon tile of a `Pick`: the selected look fades in as overlays, and the icon bubble pops. */
function PickTile({
  label,
  icon,
  tint,
  selected,
  onPick,
}: {
  label: string;
  icon: IconName;
  tint: { bg: string; ink: string };
  selected: boolean;
  onPick: () => void;
}) {
  const theme = useTheme();
  const reduce = useReducedMotion();
  const sel = useSharedValue(selected ? 1 : 0);
  const bubble = useSharedValue(1);
  const wasSelected = useRef(selected);
  useEffect(() => {
    sel.set(withTiming(selected ? 1 : 0, { duration: reduce ? 0 : 150, easing: EASE_OUT }));
    if (selected && !wasSelected.current && !reduce) {
      bubble.set(0.9);
      bubble.set(withSpring(1, SPRING_POP));
    }
    wasSelected.current = selected;
  }, [selected, reduce, sel, bubble]);
  const fillStyle = useAnimatedStyle(() => ({ opacity: sel.get() }));
  const bubbleStyle = useAnimatedStyle(() => ({ transform: [{ scale: bubble.get() }] }));
  const radius = theme.scenic ? theme.radius.md : theme.radius.lg;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPick}
      style={{ flexBasis: '47%', flexGrow: 1 }}
    >
      <Card
        padded={false}
        style={{
          alignItems: 'center',
          gap: theme.spacing.sm,
          paddingVertical: theme.spacing.md,
          paddingHorizontal: theme.spacing.sm,
          borderWidth: 2,
          borderColor: 'transparent',
          backgroundColor: theme.color.surface,
        }}
      >
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              top: -2,
              bottom: -2,
              left: -2,
              right: -2,
              borderRadius: radius,
              backgroundColor: theme.color.brandSoft,
            },
            fillStyle,
          ]}
        />
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              top: -2,
              bottom: -2,
              left: -2,
              right: -2,
              borderRadius: radius,
              borderWidth: 2,
              borderColor: theme.color.brand,
            },
            fillStyle,
          ]}
        />
        <Animated.View
          style={[
            {
              width: 44,
              height: 44,
              borderRadius: 22,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: selected ? theme.color.brand : tint.bg,
            },
            bubbleStyle,
          ]}
        >
          <Ionicons
            name={icon}
            size={iconSize.lg}
            color={selected ? theme.color.onBrand : tint.ink}
          />
        </Animated.View>
        <Text
          variant="caption"
          numberOfLines={2}
          style={{ textAlign: 'center', fontWeight: selected ? '700' : '500' }}
        >
          {label}
        </Text>
      </Card>
    </PressableScale>
  );
}
