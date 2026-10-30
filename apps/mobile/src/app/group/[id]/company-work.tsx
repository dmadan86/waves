import { useLocalSearchParams } from 'expo-router';
import { Screen } from '@waves/ui';
import { ScenicHeader } from '@/components/standard';
import { useStrings } from '@/i18n';
import { useWorkdayAccess } from '@/data/companyWorkday';
import TeamScreen from '@/components/company/work/TeamScreen';
import DailyWorkView from '@/components/company/work/DailyWorkView';
export default function CompanyWorkScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const access = useWorkdayAccess(id);
  const { t } = useStrings();
  return access.canManage ? (
    <TeamScreen groupId={id} initialTab="work" />
  ) : (
    <Screen edges={[]}>
      <ScenicHeader title={t.company.workMineTasks} />
      <DailyWorkView groupId={id} />
    </Screen>
  );
}
