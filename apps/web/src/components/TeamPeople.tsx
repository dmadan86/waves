'use client';

/** Team > People: one row per person with today's mark, open tasks and balance. */
import { useMemo, useState } from 'react';
import Link from 'next/link';

import { employmentPeople, isNotEmployed } from '@/lib/company/employment';
import {
  attendanceToday,
  balancesByMember,
  listPeople,
  managerBalances,
  openTasksToday,
  wholeMoney,
  type Balance,
  type PeopleRow,
} from '@/lib/company/people';
import { teamStrings as s } from '@/lib/company/teamStrings';
import { memberName, todayIso, useCompanyView, type CompanyMember } from '@/lib/company/view';
import { useAttendance, useWorkTasks } from '@/lib/company/workday';

const SETTLED: Balance = { kind: 'settled', amount: 0n };

export function TeamPeople({ groupId }: { groupId: string }) {
  const view = useCompanyView(groupId);
  const marks = useAttendance(groupId);
  const allTasks = useWorkTasks(groupId);
  const [query, setQuery] = useState('');
  const [byName, setByName] = useState(true);
  const [admins, setAdmins] = useState(false);
  const [former, setFormer] = useState(false);
  const today = todayIso();

  const rows = useMemo(() => {
    const live = view.members.filter((m) => !m.left_at);
    const employeeRows = view.members.filter(
      (m) => m.id !== view.me?.id && (m.role === 'member' || (m.role === 'manager' && !!m.left_at)),
    );
    const managers = live.filter((m) => m.role === 'manager' && m.id !== view.me?.id);
    const owners = view.isOwner ? live.filter((m) => m.role === 'admin') : [];
    const balances = balancesByMember(view.entries, employeeRows.map((m) => m.id), today);
    const pools = managerBalances(
      view.entries,
      [...managers, ...employeeRows].filter((m) => m.role === 'manager').map((m) => m.id),
    );
    const tasks = openTasksToday(allTasks, today);
    return [
      ...employmentPeople(employeeRows, false),
      ...managers,
      ...owners,
      ...employmentPeople(employeeRows, true),
    ].map((m: CompanyMember): PeopleRow => {
      const owner = m.role === 'admin';
      const gone = isNotEmployed(m);
      return {
        id: m.id,
        name: memberName(m, 'Someone'),
        role: owner ? 'owner' : m.role === 'manager' ? 'manager' : 'employee',
        former: gone,
        mark: owner || gone ? null : attendanceToday(marks, m.id, today),
        tasks: tasks.get(m.id) ?? 0,
        balance: owner ? null : m.role === 'manager' ? (pools.get(m.id) ?? SETTLED) : (balances.get(m.id) ?? SETTLED),
      };
    });
  }, [view, marks, allTasks, today]);

  const shown = listPeople(rows, { byName, admins, notEmployed: former }, query);
  const balanceText = (b: Balance | null) =>
    !b || b.kind === 'settled'
      ? s.settled
      : `${b.kind === 'companyOwes' ? s.companyOwes : s.owesCompany} ${wholeMoney(b.amount, view.currency, 'en-IN')}`;

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={s.search}
          aria-label={s.search}
        />
        <label>
          <input type="checkbox" checked={byName} onChange={(e) => setByName(e.target.checked)} /> {s.sortName}
        </label>
        <label>
          <input type="checkbox" checked={admins} onChange={(e) => setAdmins(e.target.checked)} /> {s.showAdmins}
        </label>
        <button type="button" className={former ? 'btn brand' : 'btn soft'} onClick={() => setFormer(!former)}>
          {s.notEmployed}
        </button>
        {view.isOwner && !view.suspended ? (
          <>
            <Link className="btn soft" href={`/c/${groupId}/team/hierarchy`}>
              {s.hierarchy}
            </Link>
            <Link className="btn soft" href={`/g/${groupId}/invite`}>
              {s.invite}
            </Link>
          </>
        ) : null}
      </div>
      {shown.length === 0 ? (
        <p className="faint">{rows.some((r) => r.former === former) ? s.noMatch : s.none}</p>
      ) : (
        <div className="card">
          {shown.map((r) => (
            <Link
              key={r.id}
              href={`/c/${groupId}/statement/${r.id}`}
              style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '10px 0', color: 'inherit' }}
            >
              <span>
                <strong>{r.name}</strong>{' '}
                <span className="faint">
                  {r.role === 'owner' ? s.owner : r.role === 'manager' ? s.manager : ''}
                  {r.mark ? ` · ${r.mark === 'present' ? s.present : s.absent}` : ''}
                  {r.tasks ? ` · ${r.tasks} ${s.openTasks}` : ''}
                </span>
              </span>
              <span>{r.balance ? balanceText(r.balance) : ''}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
