import { useLocalSearchParams } from 'expo-router';

import { FollowUps } from '@/components/company/clients/FollowUps';

export default function CompanyFollowUpsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <FollowUps groupId={id ?? ''} />;
}
