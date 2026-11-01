import { useLocalSearchParams } from 'expo-router';

import { ClientDetail } from '@/components/company/clients/ClientDetail';

export default function CompanyClientScreen() {
  const { id, clientId } = useLocalSearchParams<{ id: string; clientId?: string }>();
  return <ClientDetail groupId={id ?? ''} clientId={clientId ?? ''} />;
}
