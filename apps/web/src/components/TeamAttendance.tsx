'use client';

/** Team attendance (web): mark people for a day, see week/month grids; an employee sees their own month. */
import { useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { AttendanceStatus } from '@waves/core';

import { useCalendar, useCalendarAccess, useCalendarActions } from '@/lib/company/calendar';
import { useDepartments, departmentName } from '@/lib/company/departments';
import { attendanceStrings as S } from '@/lib/company/attendanceStrings';
import { useAttendanceSites } from '@/lib/company/attendanceSites';
import { useAttendance, useWorkdayAccess, useWorkdayActions } from '@/lib/company/workday';
import { memberName, todayIso, useCompanyView, type CompanyMember } from '@/lib/company/view';

type Period = 'daily' | 'weekly' | 'monthly';
type StatusFilter = AttendanceStatus | 'unmarked';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const shift = (day: string, days: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return iso(d);
};
const shiftMonth = (day: string, by: number) => {
  const d = new Date(`${day.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + by);
  return iso(d);
};
const weekDays = (day: string) => {
  const d = new Date(`${day}T00:00:00Z`);
  const monday = shift(day, -((d.getUTCDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => shift(monday, i));
};
const monthDays = (day: string) => {
  const m = day.slice(0, 7);
  const n = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5), 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${m}-${String(i + 1).padStart(2, '0')}`);
};
/** Present covers half days, as the Overview counts them. */
const matches = (mark: AttendanceStatus | undefined, f: StatusFilter) =>
  f === 'unmarked' ? !mark : f === 'present' ? mark === 'present' || mark === 'half' : mark === f;

export function TeamAttendance({ groupId }: { groupId: string }) {
  const view = useCompanyView(groupId);
  const access = useWorkdayAccess(groupId);
  const marks = useAttendance(groupId);
  const actions = useWorkdayActions(groupId);
  const { leave, holidays } = useCalendar(groupId);
  const { isOwner } = useCalendarAccess(groupId);
  const calActions = useCalendarActions(groupId);
  const departments = useDepartments(groupId);
  const { sites, siteMembers } = useAttendanceSites(groupId);

  const today = todayIso();
  const [period, setPeriod] = useState<Period>('daily');
  const [date, setDate] = useState(today);
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('');
  const [manager, setManager] = useState('');
  const [site, setSite] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter | ''>('');
  const [pickFor, setPickFor] = useState<string | null>(null);
  const [draftStatus, setDraftStatus] = useState<AttendanceStatus | null>(null);
  const [draftNote, setDraftNote] = useState('');
  const [holidayName, setHolidayName] = useState<string | null>(null);
  const [inFlight, setInFlight] = useState(0);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const holidayOn = holidays.find((h) => h.startDay <= date && date <= h.endDay);
  const leaveOf = (memberId: string, day = date) => {
    const on = leave.filter((l) => l.memberId === memberId && l.startDay <= day && day <= l.endDay);
    return on.some((l) => l.status === 'approved')
      ? ('approved' as const)
      : on.some((l) => l.status === 'pending')
        ? ('pending' as const)
        : null;
  };

  const people = useMemo(() => {
    const q = search.trim().toLowerCase();
    return access.people.filter((p) => {
      const mark = marks.get(`${p.id}|${date}`)?.status;
      return (
        (!q || memberName(p, '').toLowerCase().includes(q) || (p.employee_id ?? '').toLowerCase().includes(q)) &&
        (!department || p.department_id === department) &&
        (!manager || p.manager_id === manager) &&
        (!site || (siteMembers.get(site) ?? []).includes(p.id)) &&
        (!statusFilter ||
          (matches(mark, statusFilter) &&
            // Someone on approved leave is not "pending".
            !(
              statusFilter === 'unmarked' &&
              leave.some(
                (l) => l.status === 'approved' && l.memberId === p.id && l.startDay <= date && date <= l.endDay,
              )
            )))
      );
    });
  }, [access.people, search, department, manager, site, siteMembers, statusFilter, marks, date, leave]);

  const busy = inFlight > 0;
  const write = async (memberId: string, status: AttendanceStatus | null, note: string | null) => {
    if (!access.enabled || !access.canManage || date > today || leaveOf(memberId) === 'approved') return false;
    if (!access.people.some((p) => p.id === memberId)) return false;
    setError(null);
    setInFlight((n) => n + 1);
    try {
      await actions.setAttendance({ memberId, day: date, status, note });
      setSaved(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 2000);
      return true;
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : S.saveError);
      return false;
    } finally {
      setInFlight((n) => n - 1);
    }
  };

  const markAll = async (status: 'present' | 'absent') => {
    // People on approved leave are locked, so a bulk mark leaves them alone.
    const change = people.filter(
      (p) => leaveOf(p.id) !== 'approved' && marks.get(`${p.id}|${date}`)?.status !== status,
    );
    const replacing = change.filter((p) => marks.has(`${p.id}|${date}`)).length;
    if (replacing && !window.confirm(`${S.overwriteTitle}\n${S.overwriteBody(replacing)}`)) return;
    for (const p of change) await write(p.id, status, marks.get(`${p.id}|${date}`)?.note ?? null);
  };

  const openPick = (memberId: string) => {
    const m = marks.get(`${memberId}|${date}`);
    setDraftStatus(m?.status ?? null);
    setDraftNote(m?.note ?? '');
    setPickFor(memberId);
  };
  const pickMark = pickFor ? marks.get(`${pickFor}|${date}`) : undefined;
  const locked = !!pickFor && (date > today || leaveOf(pickFor) === 'approved');
  const changed =
    draftStatus !== (pickMark?.status ?? null) || (!!draftStatus && draftNote.trim() !== (pickMark?.note ?? ''));
  const saveDraft = async () => {
    if (!pickFor) return;
    // Stay open on failure so the draft survives for a retry.
    if (await write(pickFor, draftStatus, draftStatus ? draftNote.trim() || null : null)) setPickFor(null);
  };

  const markHoliday = async () => {
    const name = (holidayName ?? '').trim();
    if (!name) return;
    setError(null);
    try {
      await calActions.setHoliday({ id: crypto.randomUUID(), startDay: date, endDay: date, name });
      setHolidayName(null);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : S.saveError);
    }
  };
  const removeHoliday = async () => {
    if (!holidayOn) return;
    setError(null);
    try {
      await calActions.removeHoliday({ id: holidayOn.id });
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : S.saveError);
    }
  };

  if (!access.enabled) return <p className="muted">{S.empty}</p>;

  const live = view.members.filter((m) => !m.left_at);
  const managers = live.filter((m) => m.role === 'manager');
  const statusText = (s: AttendanceStatus | undefined) =>
    s === 'present' ? S.present : s === 'half' ? S.half : s === 'absent' ? S.absent : S.mark;
  const go = (d: string) => setDate(d > today ? today : d);

  if (!access.canManage) {
    if (!(access.isEmployee && access.me)) return null;
    return (
      <div>
        <h3>{S.mine}</h3>
        <Grid
          period="monthly"
          date={date}
          people={[access.me]}
          marks={marks}
          leaveOf={leaveOf}
          holidays={holidays}
          departments={departments}
          today={today}
          onDate={go}
        />
      </div>
    );
  }

  const dayLabel =
    period === 'monthly'
      ? new Date(`${date.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString(undefined, {
          month: 'long',
          year: 'numeric',
          timeZone: 'UTC',
        })
      : new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          timeZone: 'UTC',
        });
  const pickPerson = access.people.find((p) => p.id === pickFor);

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <div className="tabs">
          {(['daily', 'weekly', 'monthly'] as const).map((p) => (
            <button key={p} type="button" className={`tab${period === p ? ' on' : ''}`} onClick={() => setPeriod(p)}>
              {S[p]}
            </button>
          ))}
        </div>
        <input type="date" value={date} max={today} onChange={(e) => e.target.value && go(e.target.value)} />
        <strong>{dayLabel}</strong>
        <span role="status" className="muted">
          {busy ? S.saving : saved ? S.saved : ''}
        </span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <input type="search" value={search} placeholder={S.search} onChange={(e) => setSearch(e.target.value)} />
        <select aria-label={S.department} value={department} onChange={(e) => setDepartment(e.target.value)}>
          <option value="">{S.department}: {S.all}</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
        <select aria-label={S.managers} value={manager} onChange={(e) => setManager(e.target.value)}>
          <option value="">{S.managers}: {S.all}</option>
          {managers.map((m) => (
            <option key={m.id} value={m.id}>{memberName(m, '')}</option>
          ))}
        </select>
        <select aria-label={S.site} value={site} onChange={(e) => setSite(e.target.value)}>
          <option value="">{S.site}: {S.all}</option>
          {sites.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <select
          aria-label={S.status}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter | '')}
        >
          <option value="">{S.status}: {S.all}</option>
          <option value="present">{S.present}</option>
          <option value="half">{S.half}</option>
          <option value="absent">{S.absent}</option>
          <option value="unmarked">{S.notMarked}</option>
        </select>
      </div>
      {holidayOn ? <p className="muted">{S.holiday(holidayOn.name)}</p> : null}
      {isOwner ? (
        holidayName === null ? (
          <div style={{ display: 'flex', gap: 8 }}>
            {holidayOn ? (
              <button type="button" className="btn soft" onClick={() => void removeHoliday()}>
                {S.removeHoliday}
              </button>
            ) : (
              <button type="button" className="btn soft" onClick={() => setHolidayName('')}>
                {S.markHoliday}
              </button>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={holidayName} placeholder={S.holidayName} onChange={(e) => setHolidayName(e.target.value)} />
            <button type="button" className="btn brand" disabled={!holidayName.trim()} onClick={() => void markHoliday()}>
              {S.save}
            </button>
            <button type="button" className="btn soft" onClick={() => setHolidayName(null)}>
              {S.cancel}
            </button>
          </div>
        )
      ) : null}
      {error ? <p role="alert">{error}</p> : null}

      {period === 'daily' ? (
        <>
          {date > today ? <p className="muted">{S.futureDay}</p> : null}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn soft"
              disabled={busy || date > today}
              onClick={() => void markAll('present')}
            >
              {S.markAllPresent}
            </button>
            <button
              type="button"
              className="btn soft"
              disabled={busy || date > today}
              onClick={() => void markAll('absent')}
            >
              {S.markAllAbsent}
            </button>
          </div>
          {people.length === 0 ? <p className="muted">{S.noOne}</p> : null}
          <div className="card">
            {people.map((p) => {
              const mark = marks.get(`${p.id}|${date}`);
              const lv = leaveOf(p.id);
              const can = !busy && date <= today && lv !== 'approved';
              return (
                <div
                  key={p.id}
                  style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', padding: 8 }}
                >
                  <div style={{ flex: 1, minWidth: 140 }}>
                    <div>{memberName(p, '')}</div>
                    <div className="muted">{p.employee_id ?? ''}</div>
                  </div>
                  {lv ? <span className="muted">{lv === 'approved' ? S.onLeave : S.leaveApplied}</span> : null}
                  {mark?.status === 'half' ? <span className="muted">{S.half}</span> : null}
                  {mark?.note ? <span className="muted" title={mark.note}>note</span> : null}
                  <button
                    type="button"
                    className={`btn ${mark?.status === 'present' ? 'brand' : 'soft'}`}
                    disabled={!can}
                    onClick={() => void write(p.id, 'present', mark?.note ?? null)}
                  >
                    {S.present}
                  </button>
                  <button
                    type="button"
                    className={`btn ${mark?.status === 'absent' ? 'brand' : 'soft'}`}
                    disabled={!can}
                    onClick={() => void write(p.id, 'absent', mark?.note ?? null)}
                  >
                    {S.absent}
                  </button>
                  <button type="button" className="btn soft" onClick={() => openPick(p.id)}>
                    {statusText(mark?.status)}...
                  </button>
                  {pickFor === p.id && pickPerson ? (
                    <div style={{ flexBasis: '100%', display: 'grid', gap: 8 }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {([['present', S.present], ['half', S.half], ['absent', S.absent], [null, S.clear]] as const).map(
                          ([s, label]) => (
                            <button
                              key={s ?? 'clear'}
                              type="button"
                              aria-pressed={draftStatus === s}
                              className={`btn ${draftStatus === s ? 'brand' : 'soft'}`}
                              disabled={locked}
                              onClick={() => setDraftStatus(s)}
                            >
                              {label}
                            </button>
                          ),
                        )}
                      </div>
                      {draftStatus ? (
                        <input
                          value={draftNote}
                          disabled={locked}
                          placeholder={S.notePlaceholder}
                          onChange={(e) => setDraftNote(e.target.value)}
                        />
                      ) : null}
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          type="button"
                          className="btn brand"
                          disabled={locked || !changed || busy}
                          onClick={() => void saveDraft()}
                        >
                          {S.save}
                        </button>
                        <button type="button" className="btn soft" onClick={() => setPickFor(null)}>
                          {S.cancel}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <Grid
          period={period}
          date={date}
          people={people}
          marks={marks}
          leaveOf={leaveOf}
          holidays={holidays}
          departments={departments}
          today={today}
          onDate={go}
        />
      )}
    </div>
  );
}

/** Week (7 cells) or month grid: member on the left, one cell per day. Read-only. */
function Grid({
  period,
  date,
  people,
  marks,
  leaveOf,
  holidays,
  departments,
  today,
  onDate,
}: {
  period: Period;
  date: string;
  people: readonly CompanyMember[];
  marks: ReadonlyMap<string, { status: AttendanceStatus }>;
  leaveOf: (memberId: string, day: string) => 'approved' | 'pending' | null;
  holidays: readonly { startDay: string; endDay: string }[];
  departments: Parameters<typeof departmentName>[0];
  today: string;
  onDate: (d: string) => void;
}) {
  const weekly = period === 'weekly';
  const cols = weekly ? weekDays(date) : monthDays(date);
  const prev = weekly ? shift(cols[0]!, -7) : shiftMonth(date, -1);
  const next = weekly ? shift(cols[0]!, 7) : shiftMonth(date, 1);
  const show = (d: string, o: Intl.DateTimeFormatOptions) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { ...o, timeZone: 'UTC' });
  const title = weekly
    ? `${show(cols[0]!, { month: 'short', day: 'numeric' })} - ${show(cols[6]!, { month: 'short', day: 'numeric', year: 'numeric' })}`
    : show(date, { month: 'long', year: 'numeric' });
  const cell = (memberId: string, day: string) => {
    const s = marks.get(`${memberId}|${day}`)?.status;
    return s === 'present'
      ? 'P'
      : s === 'half'
        ? '½'
        : s === 'absent'
          ? 'A'
          : leaveOf(memberId, day) === 'approved'
            ? 'L'
            : holidays.some((h) => h.startDay <= day && day <= h.endDay)
              ? 'H'
              : '';
  };
  return (
    <div className="card" style={{ overflowX: 'auto' }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'center', padding: 8 }}>
        <button type="button" className="btn soft" aria-label={S.previous} onClick={() => onDate(prev)}>
          <ChevronLeft size={16} />
        </button>
        <strong>{title}</strong>
        <button type="button" className="btn soft" aria-label={S.next} disabled={next > today} onClick={() => onDate(next)}>
          <ChevronRight size={16} />
        </button>
      </div>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: 4 }}>{S.member}</th>
            {cols.map((d) => (
              <th key={d} style={{ padding: 4, fontWeight: d === today ? 700 : 400 }}>
                {Number(d.slice(8))}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {people.map((p) => (
            <tr key={p.id}>
              <td style={{ padding: 4 }}>
                {memberName(p, '')}
                <div className="muted">{p.employee_id ?? departmentName(departments, p.department_id) ?? ''}</div>
              </td>
              {cols.map((d) => (
                <td key={d} style={{ padding: 4, textAlign: 'center' }}>
                  {cell(p.id, d)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted" style={{ padding: 8 }}>
        P {S.present} · ½ {S.half} · A {S.absent} · L {S.leave} · H {S.holiday('').replace(': ', '')}
      </p>
    </div>
  );
}
