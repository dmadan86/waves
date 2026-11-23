/**
 * Add a property to rent out: one screen, one question at a time under a
 * progress bar, every step skippable. Saved together at the end.
 */
import { useState } from 'react';

import { PROPERTY_TYPES, type PropertyType } from '@waves/core';
import { Button } from '@waves/ui';

import { PersonalGuard } from '@/components/PersonalGuard';
import { FlowShell, Pick, TextAnswer } from '@/components/wealth/parts';
import { TENANT_STEPS, TenantFlow, type TenantDraft } from '@/components/wealth/TenantFlow';
import { todayIso } from '@/data/personal';
import {
  FREE_CAP_ERROR,
  usePersonalWealth,
  useWealthWrites,
  type RentalDraft,
} from '@/data/personalWealth';
import { useStrings } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { useDefaultCurrency } from '@/lib/currency';
import { useEntitlement } from '@/lib/useEntitlement';
import { router } from '@/lib/navigation';
import { regionOf } from '@/lib/wealthPlan';

type Step = 'type' | 'name' | 'rented' | 'tenant';

function AddBody() {
  const { t } = useStrings();
  const w = t.wealth;
  const { profile } = useAuth();
  const region = regionOf(profile?.country_code);
  const currency = useDefaultCurrency();
  const writes = useWealthWrites();
  const wealth = usePersonalWealth();
  const { isPro } = useEntitlement();
  const [today] = useState(() => todayIso());

  const [type, setType] = useState<PropertyType>('house');
  const [name, setName] = useState('');
  const [rented, setRented] = useState<boolean | null>(null);
  const [at, setAt] = useState(0);

  const order: Step[] = [
    'type',
    'name',
    'rented',
    ...(rented ? (Array.from({ length: TENANT_STEPS }, () => 'tenant') as Step[]) : []),
  ];
  const index = Math.min(at, order.length - 1);
  const step = order[index]!;
  const base = { index, total: order.length };

  const save = async (tenant: TenantDraft | null): Promise<void> => {
    if (!isPro && wealth.properties.filter((p) => p.status === 'active').length >= 1) {
      router.push('/paywall');
      return;
    }
    const draft: RentalDraft = {
      type,
      name: name.trim() || w.propertyTypes[type],
      currency,
      today,
      tenant,
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
        <FlowShell title={w.rentedNowQ} {...base} onSkip={() => void save(null)}>
          <Pick<'yes' | 'no'>
            options={[
              { value: 'yes', label: w.yes },
              { value: 'no', label: w.no },
            ]}
            onPick={(v) => {
              if (v === 'no') void save(null);
              else {
                setRented(true);
                setAt(3);
              }
            }}
          />
        </FlowShell>
      );
    default:
      return (
        <TenantFlow
          currency={currency}
          region={region}
          today={today}
          offset={3}
          total={order.length}
          onSkip={() => void save(null)}
          onDone={(tn) => void save(tn)}
        />
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
