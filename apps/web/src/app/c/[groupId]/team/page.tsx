'use client';

import { Suspense } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';

import { SegmentedTabs } from '@/components/SegmentedTabs';
import { CompanyFrame } from '@/components/CompanyFrame';
import { TeamAttendance } from '@/components/TeamAttendance';
import { TeamDepartments } from '@/components/TeamDepartments';
import { TeamPeople } from '@/components/TeamPeople';
import { TeamWork } from '@/components/TeamWork';
import { teamStrings as s } from '@/lib/company/teamStrings';
import { useCompanyView } from '@/lib/company/view';
import { useWorkdayAccess } from '@/lib/company/workday';

type Seg = 'people' | 'attendance' | 'work';
const isSeg = (v: string | null): v is Seg => v === 'people' || v === 'attendance' || v === 'work';

function TeamBody({ groupId }: { groupId: string }) {
  const view = useCompanyView(groupId);
  const access = useWorkdayAccess(groupId);
  const router = useRouter();
  const params = useSearchParams();
  const raw = params.get('seg');
  // Employees have no People list: their own attendance and tasks only.
  const seg: Seg = isSeg(raw) && (access.canManage || raw !== 'people') ? raw : 'attendance';
  const choose = (next: Seg) => router.replace(`/c/${groupId}/team?seg=${next}`);

  return (
    <div className="app-body">
      <div className="app-main">
        <div className="page-head">
          <h1>{s.title}</h1>
        </div>
        <SegmentedTabs
          label={s.title}
          value={seg}
          onChange={choose}
          tabs={[
            ...(access.canManage ? [{ value: 'people' as const, label: s.people }] : []),
            {
              value: 'attendance' as const,
              label: access.canManage ? s.attendance : s.myAttendance,
            },
            { value: 'work' as const, label: access.canManage ? s.work : s.myTasks },
          ]}
        />
        {seg === 'people' ? (
          <>
            <TeamPeople groupId={groupId} />
            {view.isOwner && !view.suspended ? <TeamDepartments groupId={groupId} /> : null}
          </>
        ) : seg === 'attendance' ? (
          <TeamAttendance groupId={groupId} />
        ) : (
          <TeamWork groupId={groupId} />
        )}
      </div>
    </div>
  );
}

export default function TeamPage() {
  const { groupId } = useParams<{ groupId: string }>();
  return (
    <CompanyFrame groupId={groupId}>
      <Suspense>
        <TeamBody groupId={groupId} />
      </Suspense>
    </CompanyFrame>
  );
}
