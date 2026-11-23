/**
 * Add or edit one income plan: whose it is, what it is, how much a month and
 * on which day. One screen, no steps. A plan only — it never moves a balance.
 */

import { useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { ScrollView, TextInput, View } from 'react-native';

import { INCOME_KINDS, type CurrencyCode, type IncomeKind } from '@waves/core';
import { AmountField, Button, Callout, Card, Row, Screen, Text, useTheme } from '@waves/ui';

import { AddFamilyMember, Chip } from '@/components/household/HouseholdParts';
import { PersonAvatar } from '@/components/PersonAvatar';
import { DayStepper } from '@/components/RepeatPicker';
import { withScenicGroup } from '@/components/ScenicScope';
import { PlainHeader } from '@/components/standard';
import { useDeleteIncome, useGroupIncome, useSetIncome } from '@/data/groupIncome';
import { useGroup } from '@/data/hooks';
import { displayName, isGhost, isViewer } from '@/data/types';
import { useStrings } from '@/i18n';
import { useViewerId } from '@/lib/auth';
import { friendlyError } from '@/lib/errors';
import { router } from '@/lib/navigation';

const KIND_LABEL = {
  salary: 'kindSalary',
  pension: 'kindPension',
  business: 'kindBusiness',
  rent: 'kindRent',
  other: 'kindOther',
} as const;

function IncomeEditScreen() {
  const { id, plan: planId } = useLocalSearchParams<{ id: string; plan?: string }>();
  const groupId = id ?? '';
  const theme = useTheme();
  const { t } = useStrings();
  const h = t.hhome;
  const viewerId = useViewerId();
  const { group, members } = useGroup(groupId);
  const { plans } = useGroupIncome(groupId);
  const setIncome = useSetIncome(groupId);
  const remove = useDeleteIncome(groupId);
  const editing = plans.find((plan) => plan.id === planId) ?? null;
  const people = (members.data ?? []).filter((member) => member.left_at === null);
  const me = people.find((member) => isViewer(member, viewerId));
  const currency = (editing?.currency ?? group.data?.default_currency ?? 'INR') as CurrencyCode;

  const [memberId, setMemberId] = useState<string | null>(editing?.memberId ?? me?.id ?? null);
  const [kind, setKind] = useState<IncomeKind>(editing?.kind ?? 'salary');
  const [label, setLabel] = useState(editing?.label ?? '');
  const [amount, setAmount] = useState<bigint>(editing?.amount ?? 0n);
  const [day, setDay] = useState(editing?.dayOfMonth ?? 1);
  const [error, setError] = useState<string | null>(null);

  const finalLabel = label.trim() || h[KIND_LABEL[kind]];
  const valid = memberId !== null && amount > 0n;

  const save = async (): Promise<void> => {
    if (!memberId || !valid) return;
    setError(null);
    try {
      await setIncome.mutateAsync({
        planId: editing?.id,
        memberId,
        label: finalLabel,
        kind,
        amount,
        currency,
        dayOfMonth: day,
      });
      router.back();
    } catch (caught) {
      setError(friendlyError(caught, t.couldNotSave, 'household.income.save'));
    }
  };

  const drop = async (): Promise<void> => {
    if (!editing) return;
    try {
      await remove.mutateAsync(editing.id);
      router.back();
    } catch (caught) {
      setError(friendlyError(caught, t.couldNotSave, 'household.income.remove'));
    }
  };

  return (
    <Screen edges={['bottom']}>
      <PlainHeader title={editing ? h.incomeEditTitle : h.incomeNewTitle} />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: theme.spacing.lg,
          gap: theme.spacing.md,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Text variant="subheading" accessibilityRole="header">
          {h.whoQ}
        </Text>
        <Row style={{ flexWrap: 'wrap', gap: theme.spacing.sm }}>
          {people.map((member) => {
            const name = displayName(member, viewerId, null, t.misc.someone);
            const selected = memberId === member.id;
            return (
              <Chip
                key={member.id}
                label={name}
                selected={selected}
                onPress={() => setMemberId(member.id)}
              />
            );
          })}
        </Row>
        <AddFamilyMember groupId={groupId} onAdded={setMemberId} />

        <Text variant="subheading" accessibilityRole="header">
          {h.labelQ}
        </Text>
        <Row style={{ flexWrap: 'wrap', gap: theme.spacing.sm }}>
          {INCOME_KINDS.map((option) => (
            <Chip
              key={option}
              label={h[KIND_LABEL[option]]}
              selected={kind === option}
              onPress={() => setKind(option)}
            />
          ))}
        </Row>
        <Card>
          <TextInput
            value={label}
            onChangeText={setLabel}
            placeholder={h[KIND_LABEL[kind]]}
            placeholderTextColor={theme.color.textFaint}
            accessibilityLabel={h.labelQ}
            maxLength={40}
            style={{ fontSize: 16, color: theme.color.text, minHeight: 44 }}
          />
        </Card>

        <Text variant="subheading" accessibilityRole="header">
          {h.amountQ}
        </Text>
        <Card>
          <AmountField currency={currency} value={amount} onChange={setAmount} />
        </Card>

        <Text variant="subheading" accessibilityRole="header">
          {h.dayQ}
        </Text>
        <Card>
          <DayStepper label={h.dayQ} value={day} min={1} max={28} onChange={setDay} />
        </Card>

        <Text variant="caption" tone="muted">
          {h.incomeNote}
        </Text>
        {memberId && people.find((m) => m.id === memberId && isGhost(m)) ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
            <PersonAvatar
              name={displayName(
                people.find((m) => m.id === memberId)!,
                viewerId,
                null,
                '',
              )}
              ghost
              size={24}
            />
            <Text variant="caption" tone="muted" style={{ flex: 1 }}>
              {h.memberHint}
            </Text>
          </View>
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
        <Button label={t.common.save} disabled={!valid || setIncome.isPending} onPress={save} />
        {editing ? <Button label={h.removeIncome} variant="ghost" onPress={drop} /> : null}
      </View>
    </Screen>
  );
}

export default withScenicGroup(IncomeEditScreen);
