/**
 * The tenancy questions, one per step: who, rent, day, deposit, dates, yearly
 * increase. Shared by "Add a property" and "Add a tenant" on a vacant one.
 */
import { useState } from 'react';

import type { CurrencyCode, RentFrequency } from '@waves/core';
import { AmountField, Button, Card, useTheme } from '@waves/ui';

import { DayStepper } from '@/components/RepeatPicker';
import { DateAnswer, FlowShell, Pick, TextAnswer } from '@/components/wealth/parts';
import type { RentalDraft } from '@/data/personalWealth';
import { ESCALATION_ICON, STEP_ICON } from '@/lib/wizardIcons';
import { fill, useStrings } from '@/i18n';
import { depositTerm, type Region } from '@/lib/wealthPlan';

export type TenantDraft = NonNullable<RentalDraft['tenant']>;

const FREQS: readonly RentFrequency[] = ['weekly', 'fortnightly', 'monthly', 'quarterly', 'yearly'];
const PCTS = [3, 5, 7, 10];
type Step = 'tenant' | 'rent' | 'day' | 'deposit' | 'dates' | 'escalation';
const ORDER: readonly Step[] = ['tenant', 'rent', 'day', 'deposit', 'dates', 'escalation'];

export const TENANT_STEPS = ORDER.length;

export function TenantFlow({
  currency,
  region,
  today,
  offset,
  total,
  onSkip,
  onDone,
}: {
  currency: CurrencyCode;
  region: Region;
  today: string;
  /** Steps already shown before these (for the progress bar). */
  offset: number;
  total: number;
  /** Leave without a tenant. */
  onSkip: () => void;
  onDone: (tenant: TenantDraft) => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const w = t.wealth;
  const noun = w.depositNouns[depositTerm(region)];
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [rent, setRent] = useState(0n);
  const [frequency, setFrequency] = useState<RentFrequency>('monthly');
  const [day, setDay] = useState(1);
  const [deposit, setDeposit] = useState(0n);
  const [start, setStart] = useState<string | null>(today);
  const [end, setEnd] = useState<string | null>(null);
  const [at, setAt] = useState(0);

  const step = ORDER[at]!;
  const base = { index: offset + at, total };
  const weekly = frequency === 'weekly' || frequency === 'fortnightly';
  const cont = t.personalSetup.cont;
  const finish = (pct: number | null): void =>
    onDone({
      name: name.trim(),
      phone,
      rent,
      frequency,
      day,
      deposit,
      startDate: start ?? today,
      endDate: end,
      escalationPct: pct,
    });
  const next = (): void => setAt((i) => i + 1);

  switch (step) {
    case 'tenant':
      return (
        <FlowShell title={w.tenantNameQ} icon={STEP_ICON.tenant} {...base} onSkip={onSkip}>
          <TextAnswer
            value={name}
            onChange={setName}
            placeholder={w.tenantNameQ}
            label={w.tenantNameQ}
          />
          <TextAnswer
            value={phone}
            onChange={setPhone}
            placeholder={w.tenantPhone}
            label={w.tenantPhone}
            keyboardType="phone-pad"
          />
          <Button label={cont} disabled={!name.trim()} onPress={next} />
        </FlowShell>
      );
    case 'rent':
      return (
        <FlowShell title={w.rentQ} icon={STEP_ICON.rent} {...base} onSkip={onSkip}>
          <Card style={{ gap: theme.spacing.md }}>
            <AmountField currency={currency} value={rent} onChange={setRent} />
            <Pick<RentFrequency>
              value={frequency}
              options={FREQS.map((f) => ({ value: f, label: w.frequencies[f] }))}
              onPick={setFrequency}
            />
          </Card>
          <Button label={cont} disabled={rent <= 0n} onPress={next} />
        </FlowShell>
      );
    case 'day':
      return (
        <FlowShell
          title={weekly ? w.invStartQ : w.invDayQ}
          icon={STEP_ICON.day}
          {...base}
          onSkip={next}
        >
          <Card>
            {weekly ? (
              <DateAnswer label={w.invStartQ} value={start} onChange={setStart} />
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
          <Button label={cont} onPress={next} />
        </FlowShell>
      );
    case 'deposit':
      return (
        <FlowShell
          title={fill(w.depositQ, { term: noun })}
          icon={STEP_ICON.deposit}
          {...base}
          onSkip={() => {
            setDeposit(0n);
            next();
          }}
        >
          <Card>
            <AmountField currency={currency} value={deposit} onChange={setDeposit} />
          </Card>
          <Button label={cont} onPress={next} />
        </FlowShell>
      );
    case 'dates':
      return (
        <FlowShell title={w.startEndQ} icon={STEP_ICON.dates} {...base} onSkip={next}>
          <Card style={{ gap: theme.spacing.md }}>
            <DateAnswer label={w.startDate} value={start} onChange={setStart} />
            <DateAnswer label={w.endDate} value={end} onChange={setEnd} clearLabel={w.openEnded} />
          </Card>
          <Button label={cont} onPress={next} />
        </FlowShell>
      );
    default:
      return (
        <FlowShell
          title={w.escalationQ}
          icon={STEP_ICON.escalation}
          {...base}
          onSkip={() => finish(null)}
        >
          <Pick<string>
            options={[
              { value: 'none', label: w.escalationNone, icon: 'remove-circle-outline' as const },
              ...PCTS.map((p) => ({
                value: String(p),
                label: fill(w.escalationPct, { pct: p }),
                icon: ESCALATION_ICON,
              })),
            ]}
            onPick={(v) => finish(v === 'none' ? null : Number(v))}
          />
        </FlowShell>
      );
  }
}
