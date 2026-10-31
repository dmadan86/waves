/** Old People route: opens Team on its People segment. */

import { useLocalSearchParams } from 'expo-router';

import TeamScreen from '@/components/company/work/TeamScreen';

export default function CompanyPeopleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <TeamScreen groupId={id ?? ''} initialTab="people" />;
}
