import { useLocalSearchParams } from 'expo-router';

import { ClientsList } from '@/components/company/clients/ClientsList';

export default function CompanyClientsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ClientsList groupId={id ?? ''} />;
}
