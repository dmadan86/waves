import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Redirect } from 'expo-router';
import { Screen } from '@waves/ui';
import { CompanyPeople } from '@/components/company/bar/CompanyPeople';
import { SectionShell } from '@/components/company/bar/SectionShell';
import { DepartmentSheet } from '@/components/company/DepartmentSheet';
import type { OverflowMenuItem } from '@/components/OverflowMenu';
import { ScenicHeader } from '@/components/standard';
import { useCompanyEntries } from '@/data/companyEntries';
import { useWorkdayAccess } from '@/data/companyWorkday';
import { useStrings } from '@/i18n';
import AttendanceView from './AttendanceView';
import DailyWorkView from './DailyWorkView';
import { TeamSegment, type TeamTab } from './TeamSegment';

const key = (id: string) => `waves.company.team-tab:${id}`;
const isTab = (v: unknown): v is TeamTab => v === 'people' || v === 'attendance' || v === 'work';

/**
 * The company bar's Team tab: one shell (company header + People | Attendance | Tasks segment) and
 * the three views inside it, none of which draws a header of its own. The old people / attendance /
 * work routes open the same screen on their segment.
 */
export default function TeamScreen({
  groupId,
  initialTab,
}: {
  groupId: string;
  initialTab?: TeamTab;
}) {
  const { t } = useStrings();
  const view = useCompanyEntries(groupId);
  const access = useWorkdayAccess(groupId);
  const [departments, setDepartments] = useState(false);
  const [notEmployed, setNotEmployed] = useState(false);
  const [tab, setTab] = useState<TeamTab>(initialTab ?? 'attendance');
  useEffect(() => {
    if (initialTab) {
      // An explicit route is the latest choice: Team reopens there next time.
      if (access.canManage)
        void AsyncStorage.setItem(key(groupId), initialTab).catch(() => undefined);
      return;
    }
    let live = true;
    void AsyncStorage.getItem(key(groupId))
      .then((saved) => {
        if (live && isTab(saved)) setTab(saved);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [groupId, initialTab, access.canManage]);
  const choose = (next: TeamTab) => {
    setTab(next);
    void AsyncStorage.setItem(key(groupId), next).catch(() => undefined);
  };
  if (!access.canManage) {
    // Employees have no Team tab: their own attendance / tasks, and no People list.
    if (view.ready && initialTab === 'people') return <Redirect href={`/group/${groupId}`} />;
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
  }
  const menuItems: OverflowMenuItem[] = [
    {
      icon: 'person-remove-outline',
      label: t.company.notEmployed,
      onPress: () => {
        choose('people');
        setNotEmployed(true);
      },
    },
    { icon: 'download-outline', label: t.company.exportAction, route: `/group/${groupId}/export` },
    ...(view.isOwner && !view.suspended
      ? [
          {
            icon: 'person-add-outline',
            label: t.people.inviteTitle,
            route: `/group/${groupId}/invite`,
          } as OverflowMenuItem,
          {
            icon: 'git-branch-outline',
            label: t.company.departments,
            onPress: () => setDepartments(true),
          } as OverflowMenuItem,
        ]
      : []),
  ];
  return (
    <SectionShell
      groupId={groupId}
      view={view}
      menuItems={menuItems}
      segment={<TeamSegment groupId={groupId} value={tab} onChange={choose} />}
    >
      {tab === 'people' ? (
        <CompanyPeople
          groupId={groupId}
          notEmployed={notEmployed}
          onLeaveNotEmployed={() => setNotEmployed(false)}
        />
      ) : tab === 'attendance' ? (
        <AttendanceView groupId={groupId} embedded />
      ) : (
        <DailyWorkView groupId={groupId} embedded />
      )}
      {view.isOwner ? (
        <DepartmentSheet
          groupId={groupId}
          visible={departments}
          onClose={() => setDepartments(false)}
          manageOnly
        />
      ) : null}
    </SectionShell>
  );
}
