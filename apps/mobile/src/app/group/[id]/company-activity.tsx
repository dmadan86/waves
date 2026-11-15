import { useLocalSearchParams } from 'expo-router';

import { CompanyActivityScreen } from '@/components/company/CompanyActivityScreen';

export default function CompanyActivityRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <CompanyActivityScreen groupId={id ?? ''} />;
}
