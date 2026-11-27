/** Add a tenant to a vacant property: the tenancy questions of the add flow, one at a time. */
import { useState } from 'react';
import { useLocalSearchParams } from 'expo-router';

import { PersonalGuard } from '@/components/PersonalGuard';
import { TENANT_STEPS, TenantFlow } from '@/components/wealth/TenantFlow';
import { todayIso } from '@/data/personal';
import { usePersonalWealth, useWealthWrites } from '@/data/personalWealth';
import { useAuth } from '@/lib/auth';
import { router } from '@/lib/navigation';
import { regionOf } from '@/lib/wealthPlan';

function TenantBody() {
  const { id, space } = useLocalSearchParams<{ id: string; space?: string }>();
  const { profile } = useAuth();
  const { properties } = usePersonalWealth(space);
  const writes = useWealthWrites(space);
  const [today] = useState(() => todayIso());
  const prop = properties.find((p) => p.id === id);
  if (!prop) return null;
  return (
    <TenantFlow
      currency={prop.currency}
      region={regionOf(profile?.country_code)}
      today={today}
      offset={0}
      total={TENANT_STEPS}
      onSkip={() => router.back()}
      onDone={(tenant) => {
        void writes
          .addTenant(prop, tenant, today)
          // Local-first: the queue retries; nothing is shown as a refusal.
          .catch(() => {})
          .finally(() => router.back());
      }}
    />
  );
}

export default function AddTenantScreen() {
  return (
    <PersonalGuard>
      <TenantBody />
    </PersonalGuard>
  );
}
