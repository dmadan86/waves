import { useLocalSearchParams } from 'expo-router';
import TeamScreen from '@/components/company/work/TeamScreen';
export default function CompanyWorkScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  return <TeamScreen groupId={id} initialTab="work" />;
}
