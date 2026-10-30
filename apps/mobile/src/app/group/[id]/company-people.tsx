/** Company bar: people. */

import { useLocalSearchParams } from 'expo-router';

import { CompanyPeople } from '@/components/company/bar/CompanyPeople';

export default function CompanyPeopleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <CompanyPeople groupId={id ?? ''} />;
}
