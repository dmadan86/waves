import { useLocalSearchParams } from 'expo-router';

import { TicketDetail } from '@/components/company/tickets/TicketDetail';

export default function CompanyTicketScreen() {
  const { id, ticketId } = useLocalSearchParams<{ id: string; ticketId?: string }>();
  return <TicketDetail groupId={id ?? ''} ticketId={ticketId ?? ''} />;
}
