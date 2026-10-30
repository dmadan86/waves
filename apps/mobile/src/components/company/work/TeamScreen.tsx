import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ScrollView } from 'react-native';
import { Screen } from '@waves/ui';
import { ScenicHeader, SegmentedPills } from '@/components/standard';
import { useWorkdayAccess } from '@/data/companyWorkday';
import { useStrings } from '@/i18n';
import AttendanceView from './AttendanceView';
import DailyWorkView from './DailyWorkView';

const key = (id: string) => `waves.company.team-tab:${id}`;
export default function TeamScreen({
  groupId,
  initialTab,
}: {
  groupId: string;
  initialTab?: 'attendance' | 'work';
}) {
  const { t } = useStrings();
  const access = useWorkdayAccess(groupId);
  const [tab, setTab] = useState<'attendance' | 'work'>(initialTab ?? 'attendance');
  useEffect(() => {
    if (initialTab) return;
    let live = true;
    void AsyncStorage.getItem(key(groupId))
      .then((saved) => {
        if (live && (saved === 'attendance' || saved === 'work')) setTab(saved);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [groupId]);
  const choose = (value: string) => {
    const next = value as 'attendance' | 'work';
    setTab(next);
    void AsyncStorage.setItem(key(groupId), next).catch(() => undefined);
  };
  if (!access.canManage)
    return (
      <Screen edges={[]}>
        <ScenicHeader title={t.company.workMineTasks} />
        <DailyWorkView groupId={groupId} />
      </Screen>
    );
  return (
    <Screen edges={[]}>
      <ScenicHeader title="Team">
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <SegmentedPills
            options={[
              { value: 'attendance', label: 'Attendance' },
              { value: 'work', label: 'Daily Work' },
            ]}
            value={tab}
            onChange={choose}
          />
        </ScrollView>
      </ScenicHeader>
      {tab === 'attendance' ? (
        <AttendanceView groupId={groupId} />
      ) : (
        <DailyWorkView groupId={groupId} />
      )}
    </Screen>
  );
}
