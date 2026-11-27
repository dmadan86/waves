/**
 * Add an investment: one form, saved together. Fields that do not apply to the
 * chosen type or schedule stay hidden, so a minimal save is type, name and amount.
 */
import { useState, type ReactElement } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { INVESTMENT_TYPES, type InvestmentType, type RentFrequency } from '@waves/core';
import { Button, iconSize, Row, Screen, Sheet, Text, Toggle, useTheme } from '@waves/ui';

import { PersonalGuard } from '@/components/PersonalGuard';
import { FieldLabel, SelectField } from '@/components/company/EntryForm';
import { PlainHeader } from '@/components/standard';
import { MoneyBox, YesNoPills } from '@/components/wealth/FormParts';
import { DateAnswer, TextAnswer } from '@/components/wealth/parts';
import { todayIso } from '@/data/personal';
import { FREE_CAP_ERROR, usePersonalWealth, useWealthWrites } from '@/data/personalWealth';
import { fill, useStrings } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { useBottomClearance } from '@/lib/clearance';
import { useDefaultCurrency } from '@/lib/currency';
import {
  buildInvestmentDraft,
  investmentFormReady,
  investmentFormShows,
  investmentFormStart,
  overFreeCap,
  type InvestmentForm,
} from '@/lib/investmentForm';
import { router } from '@/lib/navigation';
import { reportHandled } from '@/lib/observability';
import { useEntitlement } from '@/lib/useEntitlement';
import { regionOf, typeHint } from '@/lib/wealthPlan';
import { INVESTMENT_ICON } from '@/lib/wizardIcons';

const FREQS: readonly RentFrequency[] = ['weekly', 'fortnightly', 'monthly', 'quarterly', 'yearly'];
const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

function AddBody() {
  const theme = useTheme();
  const clearance = useBottomClearance();
  const { t } = useStrings();
  const w = t.wealth;
  const { profile } = useAuth();
  const region = regionOf(profile?.country_code);
  const currency = useDefaultCurrency();
  const writes = useWealthWrites();
  const wealth = usePersonalWealth();
  const { isPro } = useEntitlement();
  const [today] = useState(() => todayIso());
  const [f, setF] = useState<InvestmentForm>(() => investmentFormStart(today));
  const [sheet, setSheet] = useState<'type' | 'freq' | 'day' | null>(null);
  const set = (p: Partial<InvestmentForm>): void => setF((c) => ({ ...c, ...p }));

  const show = investmentFormShows(f);
  const typeText = (v: InvestmentType): string => {
    const hint = typeHint(v, region);
    return hint ? `${w.types[v]} (${hint})` : w.types[v];
  };

  const save = async (): Promise<void> => {
    const { draft, plain } = buildInvestmentDraft(f, {
      currency,
      today,
      fallbackName: w.types[f.type],
    });
    const active = wealth.investments.filter((i) => i.status === 'active').length;
    if (overFreeCap(plain, isPro, active)) {
      router.push('/paywall');
      return;
    }
    try {
      if (plain) await writes.createPlainBill(draft);
      else await writes.createInvestment(draft);
    } catch (error) {
      if (error instanceof Error && error.message === FREE_CAP_ERROR) {
        router.push('/paywall');
        return;
      }
      // Local-first: the queue retries; nothing is shown as a refusal, but a write
      // that never reached the phone must not vanish unseen.
      reportHandled(error, 'investments.add.save');
    }
    router.back();
  };

  const row = (label: string, selected: boolean, onPress: () => void, icon?: ReactElement) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, minHeight: 48 }}
    >
      {icon}
      <Text variant="body" style={{ flex: 1, fontWeight: selected ? '700' : '400' }}>
        {label}
      </Text>
      {selected ? <Ionicons name="checkmark" size={iconSize.md} color={theme.color.brand} /> : null}
    </Pressable>
  );
  const pick = (patch: Partial<InvestmentForm>): void => {
    set(patch);
    setSheet(null);
  };

  return (
    <Screen edges={[]}>
      <PlainHeader title={w.addInvestment} />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: theme.spacing.lg,
          gap: theme.spacing.md,
        }}
      >
        <FieldLabel>{w.investmentTypeLabel}</FieldLabel>
        <SelectField
          label={w.investmentTypeLabel}
          icon={INVESTMENT_ICON[f.type]}
          text={typeText(f.type)}
          onPress={() => setSheet('type')}
        />
        {show.payout ? (
          <>
            <FieldLabel>{w.insuranceQ}</FieldLabel>
            <YesNoPills
              value={f.payout}
              onChange={(payout) => set({ payout })}
              options={[
                { value: 'yes', label: w.yes },
                { value: 'no', label: w.no },
              ]}
            />
            {f.payout === 'no' ? (
              <Text variant="caption" tone="muted">
                {w.insuranceNo}
              </Text>
            ) : null}
          </>
        ) : null}
        <FieldLabel>{w.invNameQ}</FieldLabel>
        <TextAnswer
          value={f.name}
          onChange={(name) => set({ name })}
          placeholder={w.invNamePlaceholder}
          label={w.invNameQ}
          bordered
        />
        <Row style={{ gap: theme.spacing.md }}>
          <View style={{ flex: 1, gap: theme.spacing.xs }}>
            <FieldLabel>{w.recurringAmountLabel}</FieldLabel>
            <MoneyBox currency={currency} value={f.amount} onChange={(amount) => set({ amount })} />
          </View>
          <View style={{ flex: 1, gap: theme.spacing.xs }}>
            <FieldLabel>{w.howOftenLabel}</FieldLabel>
            <SelectField
              label={w.howOftenLabel}
              icon="repeat-outline"
              text={w.frequencies[f.frequency]}
              onPress={() => setSheet('freq')}
            />
          </View>
        </Row>
        {show.day ? (
          <>
            <FieldLabel>{w.invDayQ}</FieldLabel>
            <SelectField
              label={w.invDayQ}
              icon="calendar-outline"
              text={fill(w.dayOfMonth, { n: f.day })}
              onPress={() => setSheet('day')}
            />
          </>
        ) : null}
        {show.startDate ? (
          <DateAnswer
            label={w.invStartQ}
            value={f.startDate}
            onChange={(startDate) => set({ startDate })}
          />
        ) : null}
        {show.auto ? (
          <>
            <FieldLabel>{w.invAutoQ}</FieldLabel>
            <YesNoPills
              value={f.auto}
              onChange={(auto) => set({ auto })}
              options={[
                { value: 'yes', label: w.invAutoYes },
                { value: 'no', label: w.invAutoNo },
              ]}
            />
          </>
        ) : null}
        {show.opening ? (
          <>
            <FieldLabel>{w.invOpeningQ}</FieldLabel>
            <MoneyBox
              currency={currency}
              value={f.opening}
              onChange={(opening) => set({ opening })}
            />
          </>
        ) : null}
        {show.value ? (
          <>
            <FieldLabel>{w.invValueQ}</FieldLabel>
            <MoneyBox currency={currency} value={f.value} onChange={(value) => set({ value })} />
            <Text variant="micro" tone="muted">
              {w.valueNote}
            </Text>
          </>
        ) : null}
        {show.maturity ? (
          <DateAnswer
            label={w.maturityQ}
            value={f.maturityDate}
            onChange={(maturityDate) => set({ maturityDate })}
            clearLabel={w.noEndDate}
          />
        ) : null}
        {show.wrapper ? (
          <Row
            style={{ alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.md }}
          >
            <Text variant="caption" style={{ flex: 1 }}>
              {w.taxWrapper}
            </Text>
            <Toggle
              value={f.wrapper}
              onValueChange={(wrapper) => set({ wrapper })}
              accessibilityLabel={w.taxWrapper}
            />
          </Row>
        ) : null}
      </ScrollView>
      <View
        style={{
          paddingHorizontal: theme.spacing.lg,
          paddingTop: theme.spacing.md,
          paddingBottom: clearance + theme.spacing.md,
          backgroundColor: theme.color.bg,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: theme.color.border,
        }}
      >
        <Button
          label={w.saveInvestmentBtn}
          disabled={!investmentFormReady(f)}
          fullWidth
          onPress={() => void save()}
        />
      </View>

      <Sheet
        visible={sheet === 'type'}
        onClose={() => setSheet(null)}
        title={w.investmentTypeLabel}
        closeLabel={t.common.close}
      >
        <ScrollView style={{ maxHeight: 360 }}>
          {INVESTMENT_TYPES.map((v) =>
            row(
              typeText(v),
              v === f.type,
              () => pick({ type: v }),
              <Ionicons name={INVESTMENT_ICON[v]} size={iconSize.md} color={theme.color.brand} />,
            ),
          )}
        </ScrollView>
      </Sheet>
      <Sheet
        visible={sheet === 'freq'}
        onClose={() => setSheet(null)}
        title={w.howOftenLabel}
        closeLabel={t.common.close}
      >
        {FREQS.map((v) => row(w.frequencies[v], v === f.frequency, () => pick({ frequency: v })))}
      </Sheet>
      <Sheet
        visible={sheet === 'day'}
        onClose={() => setSheet(null)}
        title={w.invDayQ}
        closeLabel={t.common.close}
      >
        <ScrollView style={{ maxHeight: 360 }}>
          {DAYS.map((d) => row(fill(w.dayOfMonth, { n: d }), d === f.day, () => pick({ day: d })))}
        </ScrollView>
      </Sheet>
    </Screen>
  );
}

export default function AddInvestmentScreen() {
  return (
    <PersonalGuard>
      <AddBody />
    </PersonalGuard>
  );
}
