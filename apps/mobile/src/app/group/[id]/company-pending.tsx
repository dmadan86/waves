import { useLocalSearchParams } from 'expo-router';

import { CompanyPending } from '@/components/company/bar/CompanyPending';

export default function CompanyPendingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <CompanyPending groupId={id ?? ''} />;
}
