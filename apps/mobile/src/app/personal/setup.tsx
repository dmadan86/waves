/**
 * "Set up Personal": one screen, one question at a time, swapped in place under
 * a progress bar. Every answer is saved as it is given (see `lib/personalSetup`),
 * so leaving midway loses nothing, and every step can be skipped. The last
 * thing on the screen is the reveal: what comes in, what is fixed, what is free.
 */
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import {
  budgetStep,
  budgetDailyPace,
  format,
  money,
  type CurrencyCode,
  type PersonalRecurring,
} from '@waves/core';
import {
  AmountField,
  Button,
  Card,
  ChipRow,
  directionalIcon,
  iconSize,
  Row,
  Screen,
  Text,
  useTabBarClearance,
  useTheme,
} from '@waves/ui';

import { PersonalGuard } from '@/components/PersonalGuard';
import { DayStepper } from '@/components/RepeatPicker';
import { todayIso, useUpsertPersonalRecord, usePersonalLedger } from '@/data/personal';
import { deviceCountry, fill, plural, useStrings, type UiStrings } from '@/i18n';
import { useAuth, useViewerId } from '@/lib/auth';
import { useDefaultCurrency } from '@/lib/currency';
import { router } from '@/lib/navigation';
import { setOverlayBusy } from '@/lib/firstRun';
import { dismissPersonalIntro } from '@/lib/onboardingSeen';
import {
  answersToRecords,
  BILL_IDS,
  eatOutMonthly,
  eatOutPresets,
  regionHint,
  rememberSetup,
  SETUP_STEPS,
  setupSummary,
  setupAmountChanged,
  setupPrefillForUntouched,
  setupPrefill,
  type BillAnswer,
  type BillId,
  type EatFreq,
  type EmiAnswer,
  type HomeKind,
  type IncomeKind,
  type LoanKind,
  type SavingsBand,
  type SetupAnswers,
  type SetupContext,
  type SetupStep,
} from '@/lib/personalSetup';

type S = UiStrings['personalSetup'];
type PlainKey = { [K in keyof S]: S[K] extends string ? K : never }[keyof S];
/** Goes back one question; null on the first. Read by `Shell` so no step has to pass it on. */
const BackContext = createContext<(() => void) | null>(null);

type Save = (step: SetupStep, answers: SetupAnswers, savings?: SavingsBand) => Promise<void>;

interface StepProps {
  s: S;
  region: string | null;
  currency: CurrencyCode;
  locale: string;
  save: Save;
  skip: () => void;
  /** Income minus fixed bills so far, for the cap's starting figure. */
  free: bigint;
  incomePrefill?: { kind: IncomeKind; amount: bigint; day: number } | null;
  homePrefill?: { kind: HomeKind | null; amount: bigint; day: number } | null;
  billPrefill?: BillAnswer[];
}

function Shell({
  s,
  title,
  index,
  total,
  onSkip,
  children,
  privateLine,
}: {
  s: S;
  title: string;
  index: number;
  total: number;
  onSkip?: () => void;
  children: ReactNode;
  privateLine?: boolean;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const back = useContext(BackContext);
  // Setup lives under the tab bar: its bottom buttons must sit above it.
  const clearance = useTabBarClearance();
  return (
    <Screen>
      <View style={{ paddingHorizontal: theme.spacing.lg, gap: theme.spacing.md, flex: 1 }}>
        <Row style={{ alignItems: 'center', gap: theme.spacing.md, paddingTop: theme.spacing.sm }}>
          {back ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.common.back}
              hitSlop={10}
              onPress={back}
            >
              <Ionicons
                name={directionalIcon('arrow-back')}
                size={iconSize.md}
                color={theme.color.textMuted}
              />
            </Pressable>
          ) : null}
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
          {privateLine ? (
            <Row style={{ alignItems: 'center', gap: theme.spacing.xs }}>
              <Ionicons name="lock-closed-outline" size={14} color={theme.color.textMuted} />
              <Text variant="caption" tone="muted" style={{ flex: 1 }}>
                {s.privateLine}
              </Text>
            </Row>
          ) : null}
        </ScrollView>
        {onSkip ? (
          <View style={{ paddingBottom: clearance + theme.spacing.lg }}>
            <Button label={s.skip} variant="ghost" onPress={onSkip} />
          </View>
        ) : null}
      </View>
    </Screen>
  );
}

/** Chips that answer by being tapped. */
function Pick<T extends string>({
  options,
  onPick,
}: {
  options: readonly { value: T; label: string }[];
  onPick: (value: T) => void;
}) {
  return (
    <ChipRow<T> wrap variant="brand" onCard value={'' as T} options={options} onChange={onPick} />
  );
}

function Stepper({
  s,
  currency,
  value,
  onChange,
}: {
  s: S;
  currency: CurrencyCode;
  value: bigint;
  onChange: (v: bigint) => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const step = budgetStep(value, currency);
  const disc = (icon: 'remove' | 'add', label: string, next: bigint, off: boolean) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: off }}
      disabled={off}
      onPress={() => onChange(next)}
      style={{
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.color.surfaceMuted,
        opacity: off ? 0.4 : 1,
      }}
    >
      <Ionicons name={icon} size={iconSize.md} color={theme.color.text} />
    </Pressable>
  );
  const asMoney = (v: bigint): string => format(money(v, currency));
  return (
    <Row
      style={{ alignItems: 'center', justifyContent: 'space-between' }}
      accessibilityLabel={s.amountLabel}
    >
      {disc(
        'remove',
        fill(t.personal.lowerLimit, { amount: asMoney(step) }),
        value - step,
        value <= 0n,
      )}
      <View style={{ flex: 1, alignItems: 'center' }}>
        <AmountField currency={currency} value={value} onChange={onChange} />
      </View>
      {disc('add', fill(t.personal.raiseLimit, { amount: asMoney(step) }), value + step, false)}
    </Row>
  );
}

function AmountDay({
  s,
  currency,
  amount,
  day,
  onAmount,
  onDay,
  children,
}: {
  s: S;
  currency: CurrencyCode;
  amount: bigint;
  day: number;
  onAmount: (v: bigint) => void;
  onDay: (v: number) => void;
  children?: ReactNode;
}) {
  const theme = useTheme();
  return (
    <Card style={{ gap: theme.spacing.md }}>
      <Stepper s={s} currency={currency} value={amount} onChange={onAmount} />
      <DayStepper label={s.dayLabel} value={day} min={1} max={31} onChange={onDay} />
      {children}
    </Card>
  );
}

function IncomeStep({ s, currency, save, skip, index, total, incomePrefill }: StepProps & Pos) {
  const [kind, setKind] = useState<IncomeKind | null>(incomePrefill?.kind ?? null);
  const [amount, setAmount] = useState(incomePrefill?.amount ?? 0n);
  const [day, setDay] = useState(incomePrefill?.day ?? 1);
  const touched = useRef(false);
  useEffect(() => {
    const next = setupPrefillForUntouched(null, incomePrefill, touched.current);
    if (next) {
      setKind(next.kind);
      setAmount(next.amount);
      setDay(next.day);
    }
  }, [incomePrefill]);
  if (!kind) {
    return (
      <Shell s={s} title={s.incomeQ} index={index} total={total} onSkip={skip} privateLine>
        <Pick<IncomeKind | 'none'>
          options={[
            { value: 'salary', label: s.incomeSalary },
            { value: 'business', label: s.incomeBusiness },
            { value: 'freelance', label: s.incomeFreelance },
            { value: 'pension', label: s.incomePension },
            { value: 'none', label: s.incomeNone },
          ]}
          onPick={(v) =>
            v === 'none'
              ? void save('income', { income: { kind: 'none', amount: 0n, day: 1 } })
              : ((touched.current = true), setKind(v))
          }
        />
      </Shell>
    );
  }
  return (
    <Shell s={s} title={s.incomeDetailsQ} index={index} total={total} onSkip={skip}>
      <AmountDay
        s={s}
        currency={currency}
        amount={amount}
        day={day}
        onAmount={(v) => {
          touched.current = true;
          setAmount(v);
        }}
        onDay={(v) => {
          touched.current = true;
          setDay(v);
        }}
      />
      <Button
        label={s.cont}
        disabled={amount <= 0n}
        onPress={() => void save('income', { income: { kind, amount, day } })}
      />
    </Shell>
  );
}

function HomeStep({ s, region, currency, save, skip, index, total, homePrefill }: StepProps & Pos) {
  const [kind, setKind] = useState<HomeKind | null>(homePrefill?.kind ?? null);
  const [amount, setAmount] = useState(homePrefill?.amount ?? 0n);
  const [day, setDay] = useState(homePrefill?.day ?? 1);
  const touched = useRef(false);
  useEffect(() => {
    const next = setupPrefillForUntouched(null, homePrefill, touched.current);
    if (next) {
      setKind(next.kind);
      setAmount(next.amount);
      setDay(next.day);
    }
  }, [homePrefill]);
  if (!kind) {
    return (
      <Shell s={s} title={s.homeQ} index={index} total={total} onSkip={skip}>
        <Pick<HomeKind | 'none'>
          options={[
            { value: 'rent', label: s.homeRent },
            {
              value: 'home_loan',
              label: `${s.homeEmi}${regionHint('homeLoan', region)
                .map((key) => ` · ${s[key]}`)
                .join('')}`,
            },
            { value: 'none', label: s.homeNone },
          ]}
          onPick={(v) =>
            v === 'none'
              ? void save('home', { home: { kind: 'none', amount: 0n, day: 1 } })
              : ((touched.current = true), setKind(v))
          }
        />
      </Shell>
    );
  }
  return (
    <Shell s={s} title={s.homeDetailsQ} index={index} total={total} onSkip={skip}>
      <AmountDay
        s={s}
        currency={currency}
        amount={amount}
        day={day}
        onAmount={(v) => {
          touched.current = true;
          setAmount(v);
        }}
        onDay={(v) => {
          touched.current = true;
          setDay(v);
        }}
      />
      <Button
        label={s.cont}
        disabled={amount <= 0n}
        onPress={() => void save('home', { home: { kind, amount, day } })}
      />
    </Shell>
  );
}

function BillsStep({
  s,
  region,
  currency,
  save,
  skip,
  index,
  total,
  billPrefill = [],
}: StepProps & Pos) {
  const theme = useTheme();
  const [picked, setPicked] = useState<BillId[]>(billPrefill.map((row) => row.id));
  const [rows, setRows] = useState<BillAnswer[] | null>(billPrefill.length ? billPrefill : null);
  const touched = useRef(false);
  useEffect(() => {
    if (!touched.current && billPrefill.length) {
      setPicked(billPrefill.map((row) => row.id));
      setRows(billPrefill);
    }
  }, [billPrefill]);
  const name = (id: BillId): string => {
    const hintId =
      id === 'building_fees'
        ? 'buildingFees'
        : id === 'household_help'
          ? 'householdHelp'
          : id === 'investment_contribution'
            ? 'investmentContribution'
            : null;
    const hints = hintId ? regionHint(hintId, region).map((key) => s[key]) : [];
    return [s[BILL_LABEL[id]], ...hints].join(' · ');
  };
  if (!rows) {
    return (
      <Shell s={s} title={s.billsQ} index={index} total={total} onSkip={skip}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
          {BILL_IDS.map((id) => {
            const on = picked.includes(id);
            return (
              <Pressable
                key={id}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={name(id)}
                onPress={() => {
                  touched.current = true;
                  setPicked((p) => (on ? p.filter((x) => x !== id) : [...p, id]));
                }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  height: 36,
                  paddingHorizontal: theme.spacing.lg,
                  borderRadius: theme.radius.pill,
                  backgroundColor: on ? theme.color.brand : theme.color.surfaceMuted,
                }}
              >
                {on ? <Ionicons name="checkmark" size={14} color={theme.color.onBrand} /> : null}
                <Text
                  variant="caption"
                  style={{ color: on ? theme.color.onBrand : theme.color.textMuted }}
                >
                  {name(id)}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Button
          label={s.cont}
          onPress={() => {
            touched.current = true;
            if (picked.length) {
              setRows(
                picked.map(
                  (id) => billPrefill.find((row) => row.id === id) ?? { id, amount: 0n, day: 5 },
                ),
              );
            } else {
              void save('bills', { bills: [] });
            }
          }}
        />
      </Shell>
    );
  }
  const patch = (id: BillId, change: Partial<BillAnswer>): void => {
    touched.current = true;
    setRows((r) => r?.map((x) => (x.id === id ? { ...x, ...change } : x)) ?? r);
  };
  return (
    <Shell s={s} title={s.billsDetailsQ} index={index} total={total} onSkip={skip}>
      {rows.map((row) => (
        <View key={row.id} style={{ gap: theme.spacing.xs }}>
          <Text variant="body" style={{ fontWeight: '600' }}>
            {name(row.id)}
          </Text>
          <AmountDay
            s={s}
            currency={currency}
            amount={row.amount}
            day={row.day}
            onAmount={(amount) => patch(row.id, { amount })}
            onDay={(day) => patch(row.id, { day })}
          />
        </View>
      ))}
      <Button label={s.cont} onPress={() => void save('bills', { bills: rows })} />
    </Shell>
  );
}

const MONTH_CHOICES = ['6', '12', '24', '36', '60'];

function EmiStep({ s, region, currency, save, skip, index, total }: StepProps & Pos) {
  const [ask, setAsk] = useState(true);
  const [draft, setDraft] = useState<EmiAnswer | null>(null);
  if (ask) {
    return (
      <Shell s={s} title={s.loanQ} index={index} total={total} onSkip={skip}>
        <Pick<'yes' | 'no'>
          options={[
            { value: 'yes', label: s.yes },
            { value: 'no', label: s.no },
          ]}
          onPick={(v) =>
            v === 'no'
              ? void save('emi', { emi: { kind: 'none', emi: 0n, day: 1, monthsLeft: 1 } })
              : setAsk(false)
          }
        />
      </Shell>
    );
  }
  if (!draft) {
    return (
      <Shell s={s} title={s.loanTypeQ} index={index} total={total} onSkip={skip}>
        <Pick<LoanKind>
          options={[
            { value: 'car', label: s.loanCar },
            { value: 'personal', label: s.loanPersonal },
            {
              value: 'secured_other',
              label: `${s.loanGold}${regionHint('securedOther', region)
                .map((key) => ` · ${s[key]}`)
                .join('')}`,
            },
            { value: 'education', label: s.loanEducation },
            { value: 'card', label: s.loanCard },
          ]}
          onPick={(kind) => setDraft({ kind, emi: 0n, day: 5, monthsLeft: 12 })}
        />
      </Shell>
    );
  }
  return (
    <Shell s={s} title={s.loanDetailsQ} index={index} total={total} onSkip={skip}>
      <AmountDay
        s={s}
        currency={currency}
        amount={draft.emi}
        day={draft.day}
        onAmount={(emi) => setDraft({ ...draft, emi })}
        onDay={(day) => setDraft({ ...draft, day })}
      >
        <DayStepper
          label={s.monthsLeft}
          value={draft.monthsLeft}
          min={1}
          max={360}
          onChange={(monthsLeft) => setDraft({ ...draft, monthsLeft })}
        />
        <ChipRow
          variant="brand"
          onCard
          value={String(draft.monthsLeft)}
          options={MONTH_CHOICES.map((m) => ({ value: m, label: m }))}
          onChange={(m) => setDraft({ ...draft, monthsLeft: Number(m) })}
        />
      </AmountDay>
      <Button
        label={s.cont}
        disabled={draft.emi <= 0n}
        onPress={() => void save('emi', { emi: draft })}
      />
    </Shell>
  );
}

function EatStep({ s, currency, locale, save, skip, index, total }: StepProps & Pos) {
  const [freq, setFreq] = useState<EatFreq | null>(null);
  const [each, setEach] = useState<bigint | null>(null);
  const [monthly, setMonthly] = useState(0n);
  const presets = eatOutPresets(currency);
  if (!freq) {
    return (
      <Shell s={s} title={s.eatQ} index={index} total={total} onSkip={skip}>
        <Pick<EatFreq>
          options={[
            { value: 'rarely', label: s.eatRarely },
            { value: 'week12', label: s.eat12 },
            { value: 'week34', label: s.eat34 },
            { value: 'daily', label: s.eatMost },
          ]}
          onPick={setFreq}
        />
      </Shell>
    );
  }
  if (each === null) {
    return (
      <Shell s={s} title={s.eatEachQ} index={index} total={total} onSkip={skip}>
        <Pick<string>
          options={presets.map((p) => ({
            value: String(p),
            label: format(money(p, currency), { locale }),
          }))}
          onPick={(v) => {
            const amount = BigInt(v);
            setEach(amount);
            setMonthly(eatOutMonthly(freq, amount, currency));
          }}
        />
      </Shell>
    );
  }
  return (
    <Shell
      s={s}
      title={fill(s.eatMonthly, { amount: format(money(monthly, currency), { locale }) })}
      index={index}
      total={total}
      onSkip={skip}
    >
      <Stepper s={s} currency={currency} value={monthly} onChange={setMonthly} />
      <Button
        label={s.cont}
        disabled={monthly <= 0n}
        onPress={() => void save('eatOut', { eatOut: { freq, each, monthly } })}
      />
    </Shell>
  );
}

const BANDS: readonly [SavingsBand, PlainKey][] = [
  ['none', 'saveNone'],
  ['under1', 'saveUnder1'],
  ['1to3', 'save1to3'],
  ['3to6', 'save3to6'],
  ['6plus', 'save6plus'],
];

function SavingsStep({ s, save, skip, index, total }: StepProps & Pos) {
  return (
    <Shell s={s} title={s.savingsQ} index={index} total={total} onSkip={skip}>
      <Pick<SavingsBand>
        options={BANDS.map(([value, key]) => ({ value, label: s[key] }))}
        onPick={(band) => void save('savings', { savings: band }, band)}
      />
    </Shell>
  );
}

function CapStep({ s, currency, free, save, skip, index, total }: StepProps & Pos) {
  const step = budgetStep(free, currency);
  const [cap, setCap] = useState(() => (free / step) * step);
  return (
    <Shell s={s} title={s.capQ} index={index} total={total} onSkip={skip}>
      <Text variant="caption" tone="muted">
        {s.capHint}
      </Text>
      <Stepper s={s} currency={currency} value={cap} onChange={setCap} />
      <Button label={s.cont} disabled={cap <= 0n} onPress={() => void save('cap', { cap })} />
    </Shell>
  );
}

interface Pos {
  index: number;
  total: number;
}

const BILL_LABEL: Record<BillId, PlainKey> = {
  electricity: 'billElectricity',
  mobile: 'billMobile',
  wifi: 'billWifi',
  gas: 'billGas',
  household_help: 'billHelp',
  school: 'billSchool',
  building_fees: 'billSociety',
  insurance: 'billInsurance',
  investment_contribution: 'billSip',
};

const STEP_VIEW: Record<SetupStep, ComponentType<StepProps & Pos>> = {
  income: (p) => <IncomeStep {...p} />,
  home: (p) => <HomeStep {...p} />,
  bills: (p) => <BillsStep {...p} />,
  emi: (p) => <EmiStep {...p} />,
  eatOut: (p) => <EatStep {...p} />,
  savings: (p) => <SavingsStep {...p} />,
  cap: (p) => <CapStep {...p} />,
};

function Reveal({
  s,
  currency,
  locale,
  recurrings,
  today,
}: {
  s: S;
  currency: CurrencyCode;
  locale: string;
  recurrings: readonly PersonalRecurring[];
  today: string;
}) {
  const theme = useTheme();
  const clearance = useTabBarClearance();
  const sum = setupSummary(recurrings, today, currency);
  const perDay = budgetDailyPace(sum.free, today) ?? sum.perDay;
  const f = (v: bigint): string => format(money(v, currency), { locale });
  const month = new Date(`${today}T12:00:00`).toLocaleDateString(locale, { month: 'long' });
  const next = sum.next;
  const nextLine = !next
    ? null
    : next.days === 0
      ? fill(s.nextBillToday, { name: next.name })
      : fill(plural(locale, next.days, s.nextBillIn), { name: next.name, n: next.days });
  const row = (label: string, value: string, sub?: string) => (
    <Row style={{ justifyContent: 'space-between', alignItems: 'center', gap: theme.spacing.md }}>
      <View style={{ flex: 1 }}>
        <Text variant="body">{label}</Text>
        {sub ? (
          <Text variant="micro" tone="muted">
            {sub}
          </Text>
        ) : null}
      </View>
      <Text variant="body" style={{ fontWeight: '700' }}>
        {value}
      </Text>
    </Row>
  );
  return (
    <Screen>
      <View
        style={{
          flex: 1,
          paddingHorizontal: theme.spacing.lg,
          gap: theme.spacing.lg,
          paddingTop: theme.spacing.lg,
        }}
      >
        <Text variant="title" accessibilityRole="header">
          {fill(s.revealTitle, { month })}
        </Text>
        <Card style={{ gap: theme.spacing.md }}>
          {row(s.comingIn, f(sum.comingIn))}
          {row(
            s.fixedBills,
            f(sum.fixedTotal),
            fill(plural(locale, sum.fixedCount, s.fixedBillsCount), { n: sum.fixedCount }),
          )}
          {row(s.freeToSpend, f(sum.free), fill(s.perDay, { amount: f(perDay) }))}
        </Card>
        {nextLine ? (
          <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
            <Ionicons name="calendar-outline" size={iconSize.md} color={theme.color.brand} />
            <Text variant="body" style={{ flex: 1 }}>
              {nextLine}
            </Text>
          </Row>
        ) : null}
        <View style={{ flex: 1 }} />
        <View style={{ paddingBottom: clearance + theme.spacing.lg }}>
          <Button label={s.doneBtn} onPress={() => router.back()} />
        </View>
      </View>
    </Screen>
  );
}

function SetupBody() {
  const { t, locale } = useStrings();
  const s = t.personalSetup;
  const ownerId = useViewerId() ?? '';
  const { session } = useAuth();
  const currency = useDefaultCurrency();
  const region = deviceCountry();
  const upsert = useUpsertPersonalRecord();
  const ledger = usePersonalLedger();
  const params = useLocalSearchParams<{ step?: string }>();
  const [today] = useState(() => todayIso());
  useEffect(() => dismissPersonalIntro(ownerId), [ownerId]);
  // A question-by-question flow: no launch prompt may open over it.
  useEffect(() => {
    setOverlayBusy('personal-setup', true);
    return () => setOverlayBusy('personal-setup', false);
  }, []);
  // From a "finish" row the flow starts at that question; otherwise at the top.
  const [order] = useState<readonly SetupStep[]>(() => {
    const at = SETUP_STEPS.findIndex((x) => x === params.step);
    return at > 0 ? SETUP_STEPS.slice(at) : SETUP_STEPS;
  });
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (ownerId) void rememberSetup(ownerId, {});
  }, [ownerId]);

  const labels: Record<string, string> = {
    'income:salary': s.incomeSalary,
    'income:business': s.incomeBusiness,
    'income:freelance': s.incomeFreelance,
    'income:pension': s.incomePension,
    'home:rent': s.homeRent,
    'home:home_loan': s.homeEmi,
    'loan:car': `${s.loanCar} ${s.emiLabel}`,
    'loan:personal': `${s.loanPersonal} ${s.emiLabel}`,
    'loan:secured_other': `${s.loanGold} ${s.emiLabel}`,
    'loan:education': `${s.loanEducation} ${s.emiLabel}`,
    'loan:card': `${s.loanCard} ${s.emiLabel}`,
    ...Object.fromEntries(BILL_IDS.map((id) => [`bill:${id}`, s[BILL_LABEL[id]]])),
  };
  const ctx: SetupContext = { ownerId, currency, today, label: (k) => labels[k] ?? k };

  const save: Save = async (step, answers, savings) => {
    if (!session) return;
    for (const record of answersToRecords(answers, ctx)) {
      if (
        record.recordKind === 'recurring' &&
        !setupAmountChanged(
          ledger.recurrings.find((r) => r.id === record.recordId && r.active)?.amount ?? null,
          BigInt(String(record.data.amount ?? 0)),
        )
      )
        continue;
      try {
        await upsert.mutateAsync(record);
      } catch {
        // Local-first: a failed write is retried by the queue, never shown as a refusal.
      }
    }
    await rememberSetup(ownerId, { step, savings });
    setIndex((i) => i + 1);
  };
  const skip = (): void => setIndex((i) => i + 1);

  if (index >= order.length) {
    return (
      <Reveal
        s={s}
        currency={currency}
        locale={locale}
        recurrings={ledger.recurrings}
        today={today}
      />
    );
  }
  const step = order[index]!;
  const StepView = STEP_VIEW[step];
  const prefill = setupPrefill(ledger.recurrings, ctx);
  const incomePrefill = prefill.income;
  const homePrefill = prefill.home;
  const billPrefill = prefill.bills;
  return (
    <BackContext.Provider value={index > 0 ? () => setIndex((i) => i - 1) : null}>
      <View style={{ flex: 1 }} key={step}>
        <StepView
          s={s}
          region={region}
          currency={currency}
          locale={locale}
          save={save}
          skip={skip}
          free={setupSummary(ledger.recurrings, today, currency).free}
          index={index}
          total={order.length}
          incomePrefill={incomePrefill}
          homePrefill={homePrefill}
          billPrefill={billPrefill}
        />
      </View>
    </BackContext.Provider>
  );
}

export default function PersonalSetupScreen() {
  return (
    <PersonalGuard>
      <SetupBody />
    </PersonalGuard>
  );
}
