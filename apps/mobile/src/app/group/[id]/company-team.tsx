import { useLocalSearchParams } from 'expo-router';
import TeamScreen from '@/components/company/work/TeamScreen';
export default function CompanyTeamScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  return <TeamScreen groupId={id} />;
}
