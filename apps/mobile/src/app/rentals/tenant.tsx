/** Add a tenant to a vacant property: the tenancy questions of the add flow, one at a time. */
import { useState } from 'react';
import { useLocalSearchParams } from 'expo-router';

import { PersonalGuard } from '@/components/PersonalGuard';
import { TENANT_STEPS, TenantFlow } from '@/components/wealth/TenantFlow';
import { todayIso } from '@/data/personal';
import { useMyMemberId, usePersonalWealth, useWealthWrites } from '@/data/personalWealth';
import { useAuth } from '@/lib/auth';
import { router } from '@/lib/navigation';
import { reportHandled } from '@/lib/observability';
import { writesReady } from '@/lib/rentalScope';
import { regionOf } from '@/lib/wealthPlan';

function TenantBody() {
  const { id, space } = useLocalSearchParams<{ id: string; space?: string }>();
  const { profile } = useAuth();
  const { properties } = usePersonalWealth(space);
  const writes = useWealthWrites(space);
  const memberId = useMyMemberId(space);
  const [today] = useState(() => todayIso());
  const prop = properties.find((p) => p.id === id);
  // The group member id loads after the records: wait, so a finished form is never dropped.
  if (!prop || !writesReady(space, memberId)) return null;
  return (
    <TenantFlow
      currency={prop.currency}
      region={regionOf(profile?.country_code)}
      today={today}
      offset={0}
      total={TENANT_STEPS}
      onSkip={() => router.back()}
      onDone={(tenant) => {
        void writes.addTenant(prop, tenant, today).then(
          () => router.back(),
          (error) => reportHandled(error, 'rentals.tenant.add'),
        );
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
