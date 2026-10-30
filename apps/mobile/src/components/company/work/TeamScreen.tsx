import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Screen } from '@waves/ui';
import { ScenicHeader } from '@/components/standard';
import { useWorkdayAccess } from '@/data/companyWorkday';
import { useStrings } from '@/i18n';
import AttendanceView from './AttendanceView';
import DailyWorkView from './DailyWorkView';
import { TeamSegment } from './TeamSegment';

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
  }, [groupId, initialTab]);
  const choose = (value: string) => {
    const next = value as 'attendance' | 'work';
    setTab(next);
    void AsyncStorage.setItem(key(groupId), next).catch(() => undefined);
  };
  if (!access.canManage)
    return (
      <Screen edges={[]}>
        <ScenicHeader
          title={initialTab === 'attendance' ? t.company.attendanceMine : t.company.workMineTasks}
        />
        {initialTab === 'attendance' ? (
          <AttendanceView groupId={groupId} />
        ) : (
          <DailyWorkView groupId={groupId} />
        )}
      </Screen>
    );
  const segment = <TeamSegment groupId={groupId} value={tab} onChange={choose} />;
  return (
    <Screen edges={[]}>
      {tab === 'attendance' ? (
        <AttendanceView groupId={groupId} segment={segment} onSwitch={() => choose('work')} />
      ) : (
        <DailyWorkView
          groupId={groupId}
          segment={segment}
          header={
            <ScenicHeader
              wash
              titleAlign="start"
              title={t.company.workTitle}
              onTitlePress={() => choose('attendance')}
              titleHint={t.company.attendanceTitle}
            />
          }
        />
      )}
    </Screen>
  );
}
