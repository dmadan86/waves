/**
 * Make or edit a joint goal. One screen, one question at a time, the steps
 * swapped in place (no route jumps): what for (+ a picture), how much, by when,
 * for whom, each person's monthly amount. The last three are optional.
 */

import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import type { CurrencyCode } from '@waves/core';
import { AmountField, Button, Callout, iconSize, Row, Screen, Text, useTheme } from '@waves/ui';

import { DateField } from '@/components/goals/DateField';
import { goalMonthYear } from '@/components/goals/goalText';
import { withScenicGroup } from '@/components/ScenicScope';
import { PlainHeader, StandardCard } from '@/components/standard';
import { useGroupGoals, useSetGoal } from '@/data/groupGoals';
import { useGroup } from '@/data/hooks';
import { displayName } from '@/data/types';
import { fill, useStrings } from '@/i18n';
import { friendlyError } from '@/lib/errors';
import { router } from '@/lib/navigation';

const EMOJI = ['🏠', '✈️', '🎓', '🚗', '💍', '👶', '🎁', '🏥'];
const STEPS = ['name', 'amount', 'date', 'for', 'plan'] as const;
type Step = (typeof STEPS)[number];
const OPTIONAL: readonly Step[] = ['date', 'for', 'plan'];

function GoalEditScreen() {
  const { id, goal: editingId } = useLocalSearchParams<{ id: string; goal?: string }>();
  const groupId = id ?? '';
  const theme = useTheme();
  const { t, locale } = useStrings();
  const g = t.groupGoals;
  const { group, members } = useGroup(groupId);
  const { goals } = useGroupGoals(groupId);
  const setGoal = useSetGoal(groupId);
  const editing = goals.find((view) => view.goal.id === editingId)?.goal ?? null;
  const people = members.data ?? [];

  const [step, setStep] = useState<number>(0);
  const [name, setName] = useState(editing?.name ?? '');
  const [emoji, setEmoji] = useState<string | null>(editing?.emoji ?? null);
  const [amount, setAmount] = useState<bigint>(editing?.targetMinor ?? 0n);
  const [date, setDate] = useState<string | null>(editing?.targetDate ?? null);
  const [forId, setForId] = useState<string | null>(editing?.forMemberId ?? null);
  const [plan, setPlan] = useState<Readonly<Record<string, bigint>>>(editing?.monthlyPlan ?? {});
  const [error, setError] = useState<string | null>(null);

  const current: Step = STEPS[step] ?? 'name';
  const last = step === STEPS.length - 1;
  const currency = (editing?.currency ?? group.data?.default_currency ?? 'INR') as CurrencyCode;
  const valid = current === 'name' ? name.trim() !== '' : current === 'amount' ? amount > 0n : true;

  const finish = async (): Promise<void> => {
    setError(null);
    try {
      const goalId = await setGoal.mutateAsync({
        goalId: editing?.id,
        name,
        emoji,
        targetMinor: amount,
        currency,
        targetDate: date,
        forMemberId: forId,
        monthlyPlan: plan,
      });
      if (editing) router.back();
      else router.replace(`/group/${groupId}/goal/${goalId}`);
    } catch (caught) {
      setError(friendlyError(caught, g.couldNotSave, 'groupGoal.save'));
    }
  };
  const next = (): void => (last ? void finish() : setStep(step + 1));

  const question =
    current === 'name'
      ? g.nameQ
      : current === 'amount'
        ? g.amountQ
        : current === 'date'
          ? g.dateQ
          : current === 'for'
            ? g.forQ
            : g.planQ;

  return (
    <Screen edges={['bottom']}>
      <PlainHeader
        title={editing ? g.editTitle : g.newTitle}
        onBack={() => (step > 0 ? setStep(step - 1) : router.back())}
      />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: theme.spacing.lg,
          gap: theme.spacing.md,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Text variant="micro" tone="muted">
          {fill(g.stepOf, { n: step + 1, total: STEPS.length })}
        </Text>
        <Text variant="heading" accessibilityRole="header">
          {question}
        </Text>

        {current === 'name' ? (
          <>
            <StandardCard>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder={g.namePlaceholder}
                placeholderTextColor={theme.color.textFaint}
                accessibilityLabel={g.nameQ}
                autoFocus
                maxLength={60}
                returnKeyType="next"
                onSubmitEditing={() => name.trim() !== '' && next()}
                style={{ fontSize: 16, color: theme.color.text, minHeight: 44 }}
              />
            </StandardCard>
            <Text variant="caption" tone="muted">
              {g.emojiLabel}
            </Text>
            <Row style={{ flexWrap: 'wrap', gap: theme.spacing.sm }}>
              {EMOJI.map((option) => {
                const selected = emoji === option;
                return (
                  <Pressable
                    key={option}
                    accessibilityRole="button"
                    accessibilityLabel={option}
                    accessibilityState={{ selected }}
                    onPress={() => setEmoji(selected ? null : option)}
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: theme.radius.md,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderWidth: selected ? 2 : 1,
                      borderColor: selected ? theme.color.brand : theme.color.border,
                      backgroundColor: selected ? theme.color.brandSoft : 'transparent',
                    }}
                  >
                    <Text style={{ fontSize: 20 }}>{option}</Text>
                  </Pressable>
                );
              })}
            </Row>
          </>
        ) : null}

        {current === 'amount' ? (
          <StandardCard>
            <AmountField currency={currency} value={amount} onChange={setAmount} autoFocus />
          </StandardCard>
        ) : null}

        {current === 'date' ? (
          <StandardCard>
            <DateField
              text={date ? goalMonthYear(date, locale) : g.noDate}
              value={date}
              label={g.dateQ}
              onChange={setDate}
              minimumDate={new Date()}
            />
          </StandardCard>
        ) : null}

        {current === 'for' ? (
          <StandardCard>
            {[
              { id: null, label: g.forAll },
              ...people.map((m) => ({
                id: m.id as string | null,
                label: displayName(m, null, null, t.misc.someone),
              })),
            ].map((option, index) => {
              const selected = forId === option.id;
              return (
                <Pressable
                  key={option.id ?? 'all'}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  onPress={() => setForId(option.id)}
                  style={{
                    minHeight: 48,
                    justifyContent: 'center',
                    borderTopWidth: index > 0 ? 1 : 0,
                    borderTopColor: theme.color.border,
                  }}
                >
                  <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
                    <Text variant="body" style={{ flex: 1 }}>
                      {option.label}
                    </Text>
                    {selected ? (
                      <Ionicons name="checkmark" size={iconSize.lg} color={theme.color.brand} />
                    ) : null}
                  </Row>
                </Pressable>
              );
            })}
          </StandardCard>
        ) : null}

        {current === 'plan' ? (
          <>
            <Text variant="caption" tone="muted">
              {g.planHint}
            </Text>
            <StandardCard>
              {people.map((member, index) => (
                <View
                  key={member.id}
                  style={{
                    paddingVertical: theme.spacing.sm,
                    borderTopWidth: index > 0 ? 1 : 0,
                    borderTopColor: theme.color.border,
                  }}
                >
                  <Text variant="caption" tone="muted">
                    {displayName(member, null, null, t.misc.someone)}
                  </Text>
                  <AmountField
                    currency={currency}
                    value={plan[member.id] ?? 0n}
                    size="compact"
                    onChange={(minor) => setPlan((prev) => ({ ...prev, [member.id]: minor }))}
                  />
                </View>
              ))}
            </StandardCard>
          </>
        ) : null}
      </ScrollView>

      <View
        style={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: theme.spacing.md,
          gap: theme.spacing.xs,
        }}
      >
        {error ? <Callout tone="negative">{error}</Callout> : null}
        <Button
          label={last ? (editing ? g.saveChanges : g.create) : g.next}
          disabled={!valid || setGoal.isPending}
          onPress={next}
        />
        {OPTIONAL.includes(current) ? (
          <Button
            label={g.skip}
            variant="ghost"
            disabled={setGoal.isPending}
            onPress={() => {
              if (current === 'date') setDate(null);
              if (current === 'for') setForId(null);
              if (current === 'plan') setPlan({});
              next();
            }}
          />
        ) : null}
      </View>
    </Screen>
  );
}

export default withScenicGroup(GoalEditScreen);
