/**
 * Quick bill picker: tap every bill the household pays, then give each an
 * amount, a day and who pays. Both steps are one screen, swapped in place.
 * Bills become repeating group expenses (pooled in a Share-it group); the two
 * estimates, groceries and petrol, become a category budget instead of a bill
 * that posts by itself.
 */

import { useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { ScrollView, View } from 'react-native';

import {
  BILL_PRESETS,
  billPresetLabelKey,
  deterministicId,
  Frequency,
  nextDayOfMonth,
  savablePicks,
  type BillPreset,
  type BillPresetId,
  type CurrencyCode,
} from '@waves/core';
import { AmountField, Button, Callout, Card, Row, Screen, Text, useTheme } from '@waves/ui';

import { Chip } from '@/components/household/HouseholdParts';
import { DayStepper } from '@/components/RepeatPicker';
import { withScenicGroup } from '@/components/ScenicScope';
import { PlainHeader } from '@/components/standard';
import { useCreateGroupRecurring } from '@/data/groupRecurring';
import { useGroup, useSetCategoryBudget } from '@/data/hooks';
import { todayIso } from '@/data/personal';
import { displayName, isViewer } from '@/data/types';
import { plural, useStrings } from '@/i18n';
import { useViewerId } from '@/lib/auth';
import { friendlyError } from '@/lib/errors';
import { router } from '@/lib/navigation';

interface Pick {
  amount: bigint;
  day: number;
  payerId: string;
}

const FREQUENCY = {
  month: Frequency.Monthly,
  quarter: Frequency.Quarterly,
  year: Frequency.Yearly,
} as const;

function AddBillsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const groupId = id ?? '';
  const theme = useTheme();
  const { t, locale } = useStrings();
  const h = t.hhome;
  const viewerId = useViewerId();
  const { group, members } = useGroup(groupId);
  const create = useCreateGroupRecurring(groupId);
  const setBudget = useSetCategoryBudget(groupId);
  const people = (members.data ?? []).filter((member) => member.left_at === null);
  const meId = people.find((member) => isViewer(member, viewerId))?.id ?? people[0]?.id ?? '';
  const currency = (group.data?.default_currency ?? 'INR') as CurrencyCode;

  const [details, setDetails] = useState(false);
  const [picks, setPicks] = useState<Partial<Record<BillPresetId, Pick>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const countryCode = group.data?.country_code;
  const presets = BILL_PRESETS.filter(
    (preset) => preset.id !== 'milk' || countryCode?.toUpperCase() === 'IN',
  );
  const label = (preset: BillPresetId): string =>
    h.presets[billPresetLabelKey(preset, countryCode)];
  const chosen = presets.filter((preset) => picks[preset.id]);
  const toggle = (preset: BillPreset): void =>
    setPicks((prev) => {
      const next = { ...prev };
      if (next[preset.id]) delete next[preset.id];
      else next[preset.id] = { amount: 0n, day: preset.day, payerId: meId };
      return next;
    });
  const patch = (preset: BillPresetId, change: Partial<Pick>): void =>
    setPicks((prev) => ({ ...prev, [preset]: { ...prev[preset]!, ...change } }));

  const ready = chosen.every((preset) => (picks[preset.id]?.amount ?? 0n) > 0n);

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const flat = chosen.map((preset) => ({ preset: preset.id, ...picks[preset.id]! }));
      const { bills, budgets } = savablePicks(flat);
      const today = todayIso();
      for (const bill of bills) {
        const preset = BILL_PRESETS.find((p) => p.id === bill.preset)!;
        const anchorDate = nextDayOfMonth(today, bill.day);
        await create.mutateAsync({
          ruleId: deterministicId(`hhbill:${groupId}:${bill.preset}:${anchorDate}:${bill.amount}`),
          template: {
            description: label(bill.preset),
            category: preset.category,
            currency,
            amount: bill.amount,
            splitParams: { kind: 'equal' },
            participants: people.map((member) => member.id),
            payers: { [bill.payerId]: bill.amount },
          },
          when: { frequency: FREQUENCY[preset.every], anchorDate },
        });
      }
      for (const budget of budgets) {
        const preset = BILL_PRESETS.find((p) => p.id === budget.preset)!;
        await setBudget.mutateAsync({
          category: preset.category,
          amountMinor: budget.amount,
          currency,
        });
      }
      router.back();
    } catch (caught) {
      setError(friendlyError(caught, t.couldNotSave, 'household.addBills'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={['bottom']}>
      <PlainHeader
        title={h.pickTitle}
        onBack={() => (details ? setDetails(false) : router.back())}
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
        {details ? (
          <>
            <Text variant="heading" accessibilityRole="header">
              {h.pickDetails}
            </Text>
            {chosen.map((preset) => {
              const pick = picks[preset.id]!;
              return (
                <Card key={preset.id} style={{ gap: theme.spacing.sm }}>
                  <Text style={{ fontWeight: '700' }}>{label(preset.id)}</Text>
                  {preset.estimate ? (
                    <Text variant="caption" tone="muted">
                      {h.estimateNote}
                    </Text>
                  ) : preset.every !== 'month' ? (
                    <Text variant="caption" tone="muted">
                      {preset.every === 'quarter' ? h.perQuarter : h.perYear}
                    </Text>
                  ) : null}
                  <AmountField
                    currency={currency}
                    value={pick.amount}
                    size="compact"
                    onChange={(amount) => patch(preset.id, { amount })}
                  />
                  {preset.estimate ? null : (
                    <>
                      <Row style={{ alignItems: 'center', justifyContent: 'space-between' }}>
                        <Text variant="caption" tone="muted">
                          {h.pickDay}
                        </Text>
                        <DayStepper
                          label={`${label(preset.id)} ${h.pickDay}`}
                          value={pick.day}
                          min={1}
                          max={28}
                          onChange={(day) => patch(preset.id, { day })}
                        />
                      </Row>
                      {people.length > 1 ? (
                        <View style={{ gap: theme.spacing.xs }}>
                          <Text variant="caption" tone="muted">
                            {h.pickWho}
                          </Text>
                          <Row style={{ flexWrap: 'wrap', gap: theme.spacing.sm }}>
                            {people.map((member) => (
                              <Chip
                                key={member.id}
                                label={displayName(member, viewerId, null, t.misc.someone)}
                                selected={pick.payerId === member.id}
                                onPress={() => patch(preset.id, { payerId: member.id })}
                              />
                            ))}
                          </Row>
                        </View>
                      ) : null}
                    </>
                  )}
                </Card>
              );
            })}
          </>
        ) : (
          <>
            <Text variant="heading" accessibilityRole="header">
              {h.pickSub}
            </Text>
            <Row style={{ flexWrap: 'wrap', gap: theme.spacing.sm }}>
              {presets.map((preset) => (
                <Chip
                  key={preset.id}
                  icon={preset.icon}
                  label={label(preset.id)}
                  selected={Boolean(picks[preset.id])}
                  onPress={() => toggle(preset)}
                />
              ))}
            </Row>
          </>
        )}
      </ScrollView>

      <View
        style={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: theme.spacing.md,
          gap: theme.spacing.xs,
        }}
      >
        {error ? <Callout tone="negative">{error}</Callout> : null}
        {details && !ready ? (
          <Text variant="caption" tone="muted" align="center">
            {h.pickNeed}
          </Text>
        ) : null}
        <Button
          label={details ? plural(locale, chosen.length, h.pickSave) : h.pickNext}
          disabled={chosen.length === 0 || (details && (!ready || busy))}
          onPress={() => (details ? void save() : setDetails(true))}
        />
      </View>
    </Screen>
  );
}

export default withScenicGroup(AddBillsScreen);
