import { useLocalSearchParams } from 'expo-router';

import { SuspendedGate } from '@/components/company/SuspendedBanner';
import { TicketForm } from '@/components/company/tickets/TicketForm';

export default function CompanyTicketAddScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  return (
    <SuspendedGate groupId={id}>
      <TicketForm groupId={id} />
    </SuspendedGate>
  );
}
