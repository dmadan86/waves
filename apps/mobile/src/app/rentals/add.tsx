/**
 * Add a property to rent out: one screen, one question at a time under a
 * progress bar, every step skippable. Saved together at the end.
 */
import { useState } from 'react';

import { PROPERTY_TYPES, type PropertyType, type RentFrequency } from '@waves/core';
import { AmountField, Button, Card, useTheme } from '@waves/ui';

import { PersonalGuard } from '@/components/PersonalGuard';
import { DayStepper } from '@/components/RepeatPicker';
import { DateAnswer, FlowShell, Pick, TextAnswer } from '@/components/wealth/parts';
import { todayIso } from '@/data/personal';
import {
  FREE_CAP_ERROR,
  usePersonalWealth,
  useWealthWrites,
  type RentalDraft,
} from '@/data/personalWealth';
import { fill, useStrings } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { useDefaultCurrency } from '@/lib/currency';
import { useEntitlement } from '@/lib/useEntitlement';
import { router } from '@/lib/navigation';
import { depositTerm, regionOf } from '@/lib/wealthPlan';

type Step =
  'type' | 'name' | 'rented' | 'tenant' | 'rent' | 'day' | 'deposit' | 'dates' | 'escalation';
const FREQS: readonly RentFrequency[] = ['weekly', 'fortnightly', 'monthly', 'quarterly', 'yearly'];
const PCTS = [3, 5, 7, 10];

function AddBody() {
  const theme = useTheme();
  const { t } = useStrings();
  const w = t.wealth;
  const { profile } = useAuth();
  const region = regionOf(profile?.country_code);
  const termKey = depositTerm(region);
  const currency = useDefaultCurrency();
  const writes = useWealthWrites();
  const wealth = usePersonalWealth();
  const { isPro } = useEntitlement();
  const [today] = useState(() => todayIso());

  const [type, setType] = useState<PropertyType>('house');
  const [name, setName] = useState('');
  const [rented, setRented] = useState<boolean | null>(null);
  const [tenant, setTenant] = useState('');
  const [phone, setPhone] = useState('');
  const [rent, setRent] = useState(0n);
  const [frequency, setFrequency] = useState<RentFrequency>('monthly');
  const [day, setDay] = useState(1);
  const [deposit, setDeposit] = useState(0n);
  const [start, setStart] = useState<string | null>(today);
  const [end, setEnd] = useState<string | null>(null);
  const [pct, setPct] = useState<number | null>(null);
  const [at, setAt] = useState(0);

  const order: Step[] = [
    'type',
    'name',
    'rented',
    ...(rented ? (['tenant', 'rent', 'day', 'deposit', 'dates', 'escalation'] as Step[]) : []),
  ];
  const index = Math.min(at, order.length - 1);
  const step = order[index]!;
  const base = { index, total: order.length };
  const weekly = frequency === 'weekly' || frequency === 'fortnightly';

  const save = async (withTenant: boolean, pctNow: number | null = pct): Promise<void> => {
    if (!isPro && wealth.properties.filter((p) => p.status === 'active').length >= 1) {
      router.push('/paywall');
      return;
    }
    const draft: RentalDraft = {
      type,
      name: name.trim() || w.propertyTypes[type],
      currency,
      today,
      tenant:
        withTenant && tenant.trim() && rent > 0n
          ? {
              name: tenant.trim(),
              phone,
              rent,
              frequency,
              day,
              deposit,
              startDate: start ?? today,
              endDate: end,
              escalationPct: pctNow,
            }
          : null,
    };
    try {
      await writes.createRental(draft);
    } catch (error) {
      if (error instanceof Error && error.message === FREE_CAP_ERROR) {
        router.push('/paywall');
        return;
      }
      // Local-first: the queue retries; nothing is shown as a refusal.
    }
    router.back();
  };
  const next = (): void => (at + 1 >= order.length ? void save(!!rented) : setAt((i) => i + 1));
  const cont = t.personalSetup.cont;

  switch (step) {
    case 'type':
      return (
        <FlowShell title={w.propWhatQ} {...base}>
          <Pick<PropertyType>
            options={PROPERTY_TYPES.map((v) => ({ value: v, label: w.propertyTypes[v] }))}
            onPick={(v) => {
              setType(v);
              setAt(1);
            }}
          />
        </FlowShell>
      );
    case 'name':
      return (
        <FlowShell title={w.propNameQ} {...base} onSkip={() => setAt(2)}>
          <TextAnswer
            value={name}
            onChange={setName}
            placeholder={w.propNamePlaceholder}
            label={w.propNameQ}
          />
          <Button label={cont} disabled={!name.trim()} onPress={() => setAt(2)} />
        </FlowShell>
      );
    case 'rented':
      return (
        <FlowShell title={w.rentedNowQ} {...base} onSkip={() => void save(false)}>
          <Pick<'yes' | 'no'>
            options={[
              { value: 'yes', label: w.yes },
              { value: 'no', label: w.no },
            ]}
            onPick={(v) => {
              if (v === 'no') void save(false);
              else {
                setRented(true);
                setAt(3);
              }
            }}
          />
        </FlowShell>
      );
    case 'tenant':
      return (
        <FlowShell title={w.tenantNameQ} {...base} onSkip={() => void save(false)}>
          <TextAnswer
            value={tenant}
            onChange={setTenant}
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
          <Button label={cont} disabled={!tenant.trim()} onPress={next} />
        </FlowShell>
      );
    case 'rent':
      return (
        <FlowShell title={w.rentQ} {...base} onSkip={() => void save(false)}>
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
        <FlowShell title={weekly ? w.invStartQ : w.invDayQ} {...base} onSkip={next}>
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
          title={fill(w.depositQ, { term: w.depositNouns[termKey] })}
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
        <FlowShell title={w.startEndQ} {...base} onSkip={next}>
          <Card style={{ gap: theme.spacing.md }}>
            <DateAnswer label={w.startDate} value={start} onChange={setStart} />
            <DateAnswer label={w.endDate} value={end} onChange={setEnd} clearLabel={w.openEnded} />
          </Card>
          <Button label={cont} onPress={next} />
        </FlowShell>
      );
    default:
      return (
        <FlowShell title={w.escalationQ} {...base} onSkip={() => void save(true)}>
          <Pick<string>
            options={[
              { value: 'none', label: w.escalationNone },
              ...PCTS.map((p) => ({ value: String(p), label: fill(w.escalationPct, { pct: p }) })),
            ]}
            onPick={(v) => {
              const chosen = v === 'none' ? null : Number(v);
              setPct(chosen);
              void save(true, chosen);
            }}
          />
        </FlowShell>
      );
  }
}

export default function AddRentalScreen() {
  return (
    <PersonalGuard>
      <AddBody />
    </PersonalGuard>
  );
}
