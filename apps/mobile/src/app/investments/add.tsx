/**
 * Add an investment: one screen, one question at a time under a progress bar,
 * every step skippable. The answers are saved together at the end, so leaving
 * midway leaves nothing half-made.
 */
import { useState } from 'react';
import { View } from 'react-native';

import { AmountField, Button, Card, Row, Text, Toggle, useTheme } from '@waves/ui';
import type { InvestmentType, RentFrequency } from '@waves/core';

import { PersonalGuard } from '@/components/PersonalGuard';
import { DayStepper } from '@/components/RepeatPicker';
import { DateAnswer, FlowShell, Pick, TextAnswer } from '@/components/wealth/parts';
import { INVESTMENT_ICON, STEP_ICON, YES_NO_ICON } from '@/lib/wizardIcons';
import { todayIso } from '@/data/personal';
import {
  FREE_CAP_ERROR,
  usePersonalWealth,
  useWealthWrites,
  type InvestmentDraft,
} from '@/data/personalWealth';
import { useStrings } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { useDefaultCurrency } from '@/lib/currency';
import { useEntitlement } from '@/lib/useEntitlement';
import { router } from '@/lib/navigation';
import { regionOf, typeHint } from '@/lib/wealthPlan';
import { INVESTMENT_TYPES } from '@waves/core';
import { INVESTMENT_WIZARD_STEPS, wizardProgress } from '@/lib/wealthFlow';

type Step = 'type' | 'payout' | 'name' | 'howMuch' | 'day' | 'auto' | 'opening' | 'value';
const FREQS: readonly RentFrequency[] = ['weekly', 'fortnightly', 'monthly', 'quarterly', 'yearly'];
const MATURES: readonly InvestmentType[] = [
  'deposit',
  'bonds',
  'insurance_linked',
  'savings_group',
];
const WITH_WRAPPER: readonly InvestmentType[] = ['retirement', 'deposit', 'fund', 'bonds'];

function AddBody() {
  const theme = useTheme();
  const { t } = useStrings();
  const w = t.wealth;
  const { profile } = useAuth();
  const region = regionOf(profile?.country_code);
  const currency = useDefaultCurrency();
  const writes = useWealthWrites();
  const wealth = usePersonalWealth();
  const { isPro } = useEntitlement();
  const [today] = useState(() => todayIso());

  const [type, setType] = useState<InvestmentType | null>(null);
  const [payout, setPayout] = useState<boolean | null>(null);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState(0n);
  const [frequency, setFrequency] = useState<RentFrequency>('monthly');
  const [day, setDay] = useState(1);
  const [startDate, setStartDate] = useState<string | null>(today);
  const [auto, setAuto] = useState<boolean | null>(null);
  const [opening, setOpening] = useState(0n);
  const [value, setValue] = useState(0n);
  const [wrapper, setWrapper] = useState(false);
  const [maturityDate, setMaturityDate] = useState<string | null>(null);
  const [at, setAt] = useState(0);

  const plainBill = type === 'insurance_linked' && payout === false;
  const weekly = frequency === 'weekly' || frequency === 'fortnightly';
  const order: Step[] = [
    'type',
    ...(type === 'insurance_linked' ? (['payout'] as Step[]) : []),
    'name',
    'howMuch',
    ...(amount > 0n ? (['day', 'auto'] as Step[]) : []),
    ...(plainBill ? [] : (['opening', 'value'] as Step[])),
  ];
  const step = order[Math.min(at, order.length - 1)]!;
  const base = wizardProgress(at, INVESTMENT_WIZARD_STEPS);
  const next = (): void => setAt((i) => i + 1);

  const draft = (autoPost: boolean): InvestmentDraft => ({
    type: type ?? 'other',
    name: name.trim() || w.types[type ?? 'other'],
    currency,
    amount,
    frequency,
    day,
    autoPost,
    openingInvested: opening,
    currentValue: value > 0n ? value : null,
    taxWrapper: wrapper,
    maturityDate,
    startDate: weekly ? startDate : null,
    today,
  });

  const finish = async (autoPost: boolean, plain: boolean): Promise<void> => {
    if (!plain && !isPro && wealth.investments.filter((i) => i.status === 'active').length >= 3) {
      router.push('/paywall');
      return;
    }
    try {
      if (plain) await writes.createPlainBill(draft(autoPost));
      else await writes.createInvestment(draft(autoPost));
    } catch (error) {
      if (error instanceof Error && error.message === FREE_CAP_ERROR) {
        router.push('/paywall');
        return;
      }
      // Local-first: the queue retries; nothing is shown as a refusal.
    }
    router.back();
  };

  // Past the last question the answers are saved, so skipping the last step also saves.
  const advance = (autoPost = auto ?? false): void => {
    if (at + 1 >= order.length) void finish(autoPost, plainBill);
    else next();
  };

  if (step === 'type') {
    return (
      <FlowShell title={w.invWhatQ} icon={STEP_ICON.invType} {...base}>
        <Pick<InvestmentType>
          options={INVESTMENT_TYPES.map((v) => {
            const hint = typeHint(v, region);
            return {
              value: v,
              label: hint ? `${w.types[v]} (${hint})` : w.types[v],
              icon: INVESTMENT_ICON[v],
            };
          })}
          onPick={(v) => {
            setType(v);
            next();
          }}
        />
      </FlowShell>
    );
  }
  if (step === 'payout') {
    return (
      <FlowShell
        title={w.insuranceQ}
        icon={STEP_ICON.payout}
        {...base}
        note={payout === false ? w.insuranceNo : undefined}
      >
        <Pick<'yes' | 'no'>
          options={[
            { value: 'yes', label: w.yes, icon: YES_NO_ICON.yes },
            { value: 'no', label: w.no, icon: YES_NO_ICON.no },
          ]}
          onPick={(v) => {
            setPayout(v === 'yes');
            next();
          }}
        />
      </FlowShell>
    );
  }
  if (step === 'name') {
    return (
      <FlowShell title={w.invNameQ} icon={STEP_ICON.invName} {...base} onSkip={next}>
        <TextAnswer
          value={name}
          onChange={setName}
          placeholder={w.invNamePlaceholder}
          label={w.invNameQ}
        />
        <Button fullWidth label={t.personalSetup.cont} disabled={!name.trim()} onPress={next} />
      </FlowShell>
    );
  }
  if (step === 'howMuch') {
    return (
      <FlowShell
        title={w.invHowMuchQ}
        icon={STEP_ICON.invHowMuch}
        {...base}
        onSkip={() => {
          setAmount(0n);
          next();
        }}
      >
        <Card style={{ gap: theme.spacing.md }}>
          <AmountField currency={currency} value={amount} onChange={setAmount} />
          <Pick<RentFrequency>
            value={frequency}
            options={FREQS.map((f) => ({ value: f, label: w.frequencies[f] }))}
            onPick={setFrequency}
          />
        </Card>
        <Button fullWidth label={t.personalSetup.cont} disabled={amount <= 0n} onPress={next} />
      </FlowShell>
    );
  }
  if (step === 'day') {
    return (
      <FlowShell
        title={weekly ? w.invStartQ : w.invDayQ}
        icon={STEP_ICON.day}
        {...base}
        onSkip={next}
      >
        <Card style={{ gap: theme.spacing.md }}>
          {weekly ? (
            <DateAnswer label={w.invStartQ} value={startDate} onChange={setStartDate} />
          ) : (
            <DayStepper
              label={t.personalSetup.dayLabel}
              value={day}
              min={1}
              max={31}
              onChange={setDay}
            />
          )}
        </Card>
        <Button fullWidth label={t.personalSetup.cont} onPress={next} />
      </FlowShell>
    );
  }
  if (step === 'auto') {
    return (
      <FlowShell
        title={w.invAutoQ}
        icon={STEP_ICON.invAuto}
        {...base}
        onSkip={() => advance(false)}
      >
        <Pick<'yes' | 'no'>
          options={[
            { value: 'yes', label: w.invAutoYes, icon: YES_NO_ICON.yes },
            { value: 'no', label: w.invAutoNo, icon: YES_NO_ICON.no },
          ]}
          onPick={(v) => {
            setAuto(v === 'yes');
            advance(v === 'yes');
          }}
        />
      </FlowShell>
    );
  }
  if (step === 'opening') {
    return (
      <FlowShell
        title={w.invOpeningQ}
        icon={STEP_ICON.invOpening}
        {...base}
        onSkip={() => {
          setOpening(0n);
          next();
        }}
      >
        <Card style={{ gap: theme.spacing.md }}>
          <AmountField currency={currency} value={opening} onChange={setOpening} />
          {type && WITH_WRAPPER.includes(type) ? (
            <Row
              style={{
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: theme.spacing.md,
              }}
            >
              <Text variant="caption" style={{ flex: 1 }}>
                {w.taxWrapper}
              </Text>
              <Toggle
                value={wrapper}
                onValueChange={setWrapper}
                accessibilityLabel={w.taxWrapper}
              />
            </Row>
          ) : null}
        </Card>
        <Button fullWidth label={t.personalSetup.cont} onPress={next} />
      </FlowShell>
    );
  }
  return (
    <FlowShell
      title={w.invValueQ}
      icon={STEP_ICON.invValue}
      {...base}
      note={w.valueNote}
      onSkip={() => {
        setValue(0n);
        void finish(auto ?? false, false);
      }}
    >
      <Card style={{ gap: theme.spacing.md }}>
        <AmountField currency={currency} value={value} onChange={setValue} />
        {type && MATURES.includes(type) ? (
          <DateAnswer
            label={w.maturityQ}
            value={maturityDate}
            onChange={setMaturityDate}
            clearLabel={w.noEndDate}
          />
        ) : null}
      </Card>
      <View>
        <Button fullWidth label={w.save} onPress={() => void finish(auto ?? false, false)} />
      </View>
    </FlowShell>
  );
}

export default function AddInvestmentScreen() {
  return (
    <PersonalGuard>
      <AddBody />
    </PersonalGuard>
  );
}
