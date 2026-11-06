import { useLocalSearchParams } from 'expo-router';
import TasksScreen from '@/components/company/work/TasksScreen';
export default function CompanyWorkScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  return <TasksScreen groupId={id} />;
}
