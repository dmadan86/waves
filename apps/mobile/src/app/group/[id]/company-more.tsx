import { useLocalSearchParams } from 'expo-router';

import { CompanyMore } from '@/components/company/bar/CompanyMore';

export default function CompanyMoreScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <CompanyMore groupId={id ?? ''} />;
}
