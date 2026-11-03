'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

import { CompanyFrame } from '@/components/CompanyFrame';
import { calendarStrings as s } from '@/lib/company/calendarStrings';
import { useEmployeeActions } from '@/lib/company/employeeDetail';
import { memberName, useCompanyView, type CompanyMember } from '@/lib/company/view';

/** Owners, their managers and each manager's team in one tree. */
export default function CompanyHierarchyPage() {
  const { groupId } = useParams<{ groupId: string }>();
  return (
    <CompanyFrame groupId={groupId}>
      <div className="app-body">
        <div className="app-main">
          <div className="page-head">
            <h1>{s.hierarchyTitle}</h1>
          </div>
          <Tree groupId={groupId} />
        </div>
      </div>
    </CompanyFrame>
  );
}

function Tree({ groupId }: { groupId: string }) {
  const view = useCompanyView(groupId);
  const { assign } = useEmployeeActions(groupId);
  const [error, setError] = useState<string | null>(null);
  const live = view.members.filter((m) => !m.left_at);
  const managers = live.filter((m) => m.role === 'manager');
  if (!view.isOwner) return <p className="faint">{s.none}</p>;

  const move = (m: CompanyMember, managerId: string) =>
    assign({ memberId: m.id, managerId: managerId || null, reason: '' }).then(
      () => setError(null),
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
  const row = (m: CompanyMember, pill?: string, sub?: string) => (
    <div
      key={m.id}
      style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}
    >
      <div>
        <Link href={`/c/${groupId}/statement/${m.id}`}>{memberName(m, s.someone)}</Link>
        {pill ? <span className="faint"> · {pill}</span> : null}
        <div className="faint">{[m.employee_id, sub].filter(Boolean).join(' · ')}</div>
      </div>
      {m.role === 'member' ? (
        <select
          aria-label={s.reportsTo}
          value={m.manager_id ?? ''}
          onChange={(e) => void move(m, e.target.value)}
        >
          <option value="">{s.noManager}</option>
          {managers.map((g) => (
            <option key={g.id} value={g.id}>
              {memberName(g, s.someone)}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
  const direct = live.filter((m) => m.role === 'member' && !m.manager_id);
  return (
    <>
      {error ? <p role="alert">{error}</p> : null}
      <h2>{s.owners}</h2>
      <div className="card">
        {live.filter((m) => m.role === 'admin').map((m) => row(m, s.pillOwner))}
      </div>
      {managers.map((mgr) => {
        const team = live.filter((m) => m.manager_id === mgr.id);
        return (
          <div className="card" key={mgr.id}>
            {row(
              mgr,
              s.manager,
              team.length === 1
                ? s.employeeOne
                : s.employeeMany.replace('{n}', String(team.length)),
            )}
            {team.map((m) => row(m))}
          </div>
        );
      })}
      {direct.length > 0 ? (
        <>
          <h2>{s.reportsToOwners}</h2>
          <div className="card">{direct.map((m) => row(m))}</div>
        </>
      ) : null}
    </>
  );
}
