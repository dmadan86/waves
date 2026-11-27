import { useLocalSearchParams } from 'expo-router';

import { MoneyCalendar } from '@/components/home/MoneyCalendar';
import { useGroup } from '@/data/hooks';
import { hasGroupRentals } from '@/lib/rentalScope';

/** A couple/family space's own view, scoped to that group's bills and (couple/home) shared records. */
export default function GroupCalendarScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const groupId = typeof id === 'string' ? id : '';
  const { group } = useGroup(groupId);
  return (
    <MoneyCalendar
      groupId={groupId}
      ledgerGroupId={hasGroupRentals(group.data?.type) ? groupId : undefined}
      currency={group.data?.default_currency ?? undefined}
    />
  );
}
