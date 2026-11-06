import { Screen } from '@waves/ui';
import { SectionShell } from '@/components/company/bar/SectionShell';
import { ScenicHeader } from '@/components/standard';
import { useCompanyEntries } from '@/data/companyEntries';
import { useWorkdayAccess } from '@/data/companyWorkday';
import { useStrings } from '@/i18n';
import DailyWorkView from './DailyWorkView';

/** Company tasks on their own screen: the company header over the task list (an employee sees only theirs). */
export default function TasksScreen({ groupId }: { groupId: string }) {
  const { t } = useStrings();
  const view = useCompanyEntries(groupId);
  const access = useWorkdayAccess(groupId);
  if (!access.canManage)
    return (
      <Screen edges={[]}>
        <ScenicHeader title={t.company.workMineTasks} />
        <DailyWorkView groupId={groupId} />
      </Screen>
    );
  return (
    <SectionShell groupId={groupId} view={view} subtitle={t.company.teamTabTasks} segment={null}>
      <DailyWorkView groupId={groupId} embedded />
    </SectionShell>
  );
}
