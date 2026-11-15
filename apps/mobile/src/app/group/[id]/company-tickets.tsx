import { useLocalSearchParams } from 'expo-router';

import { TicketsList } from '@/components/company/tickets/TicketsList';

export default function CompanyTicketsScreen() {
  const { id, clientId } = useLocalSearchParams<{ id: string; clientId?: string }>();
  return <TicketsList groupId={id ?? ''} clientId={clientId} />;
}
