'use client';

/** One employee, minus the ledger: identity, edits, team, employment, removal, dates and attendance. */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  EMPLOYEE_ID_MAX,
  format,
  materialiseCompanyProjects,
  materialiseProjectMembers,
  money,
  normaliseEmployeeId,
  type CurrencyCode,
} from '@waves/core';

import { useStrings } from '@/i18n-context';
import { departmentName, useDepartmentEditor } from '@/lib/company/departments';
import { useEmployeeActions } from '@/lib/company/employeeDetail';
import { hasHistory } from '@/lib/company/employeeHistory';
import { employeeStrings as s } from '@/lib/company/employeeStrings';
import {
  canSetEmployment,
  employeeIdHolder,
  employmentErrorKey,
  isEmploymentDate,
  isNotEmployed,
} from '@/lib/company/employment';
import { useCalendar, useCalendarActions } from '@/lib/company/calendar';
import {
  asEmploymentType,
  canSetEmploymentType,
  EMPLOYMENT_TYPES,
} from '@/lib/company/people';
import { memberName, todayIso, useCompanyView, type CompanyMember } from '@/lib/company/view';
import { useAttendance, useWorkTasks } from '@/lib/company/workday';
import { NO_QUEUE, useSync } from '@/lib/sync';
import { supabase } from '@/lib/waves';

const TYPE_LABEL: Record<string, string> = {
  full_time: s.typeFullTime,
  part_time: s.typePartTime,
  contractor: s.typeContractor,
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="item">
      <span className="grow faint">{label}</span>
      <span>{children}</span>
    </div>
  );
}

export function CompanyEmployeePanel({ groupId, memberId }: { groupId: string; memberId: string }) {
  const { locale } = useStrings();
  const router = useRouter();
  const view = useCompanyView(groupId);
  const marks = useAttendance(groupId);
  const tasks = useWorkTasks(groupId);
  const calendar = useCalendar(groupId);
  const departments = useDepartmentEditor(groupId);
  const actions = useEmployeeActions(groupId);
  const { refresh } = useSync();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const member = view.members.find((m) => m.id === memberId) ?? null;
  if (!member) return <p className="faint">{s.notFound}</p>;

  const own = member.id === view.me?.id;
  const detail = view.isAdmin && !own;
  const employee = member.role === 'member';
  const canEdit = detail && view.manageableIds.has(member.id) && !view.suspended;
  const canType = detail && employee && canSetEmploymentType(view.me, member, view.suspended);
  const canEmployment = detail && canSetEmployment(view.me, member, view.suspended);
  const canDelete = canEmployment && employee && !member.left_at;
  const canDates = (canEdit || own) && !!member.profile_id && !view.suspended;
  const history = hasHistory(member.id, view.entries, marks, tasks);
  const dates = calendar.dates.get(member.id);
  const name = memberName(member, 'Someone');
  const manager = member.manager_id ? view.members.find((m) => m.id === member.manager_id) : undefined;
  const rate = (minor: string | null | undefined, fallback: string | null | undefined): string => {
    const v = minor ?? fallback;
    return v ? format(money(BigInt(v), view.currency as CurrencyCode), { locale }) : s.notSet;
  };

  const run = async (work: () => Promise<unknown>, onError?: (e: unknown) => string): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      await work();
      return true;
    } catch (caught) {
      setError(onError ? onError(caught) : s.failed);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (!window.confirm(s.removeConfirm.replace('{name}', name))) return;
    const done = await run(async () => {
      const { error: rpcError } = await supabase.rpc('waves_remove_member', { p_member_id: member.id });
      if (rpcError) throw new Error(rpcError.message);
      await refresh();
    });
    if (done) router.push(`/c/${groupId}/team`);
  };

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="title">{name}</span>
        <span className="chip">
          {member.role === 'admin' ? s.owner : member.role === 'manager' ? s.manager : s.employee}
        </span>
      </div>
      {error ? <p className="error">{error}</p> : null}
      {view.suspended ? <p className="faint">This company is read-only right now.</p> : null}

      <div className="list">
        <Row label={s.employeeId}>
          {editingId === null ? (
            <>
              {member.employee_id || <span className="faint">{s.notSet}</span>}{' '}
              {canEdit ? (
                <button type="button" className="linklike" onClick={() => setEditingId(member.employee_id ?? '')}>
                  {s.edit}
                </button>
              ) : null}
            </>
          ) : (
            <IdEditor
              initial={editingId}
              busy={busy}
              onCancel={() => setEditingId(null)}
              onSave={async (raw) => {
                const id = normaliseEmployeeId(raw);
                const ok = await run(async () => {
                  if (id && (await actions.isEmployeeIdTaken(view.members, id, member.id)))
                    throw new Error('TAKEN');
                  await actions.setEmployeeId({ memberId: member.id, employeeId: id || null });
                }, (e) => (e instanceof Error && e.message === 'TAKEN' ? s.employeeIdTaken : s.failed));
                if (ok) setEditingId(null);
              }}
            />
          )}
        </Row>
        {employee ? (
          <>
            <Row label={s.employmentType}>
              {canType ? (
                <select
                  value={asEmploymentType(member.employment_type) ?? ''}
                  disabled={busy}
                  aria-label={s.employmentType}
                  onChange={(e) =>
                    void run(
                      () => actions.setEmploymentType({ memberId: member.id, employmentType: e.target.value || null }),
                      (err) => s[employmentErrorKey(err)],
                    )
                  }
                  style={{ width: 'auto' }}
                >
                  <option value="">{s.typeNone}</option>
                  {EMPLOYMENT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {TYPE_LABEL[type]}
                    </option>
                  ))}
                </select>
              ) : (
                TYPE_LABEL[member.employment_type ?? ''] ?? s.typeNone
              )}
            </Row>
            <Row label={s.department}>
              {canEdit ? (
                <select
                  value={member.department_id ?? ''}
                  disabled={busy}
                  aria-label={s.department}
                  onChange={(e) =>
                    void run(() =>
                      departments.setMemberDepartment({ memberId: member.id, departmentId: e.target.value || null }),
                    )
                  }
                  style={{ width: 'auto' }}
                >
                  <option value="">{s.departmentNone}</option>
                  {departments.list.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              ) : (
                departmentName(departments.list, member.department_id) ?? s.departmentNone
              )}
            </Row>
            <Row label={s.reportsTo}>{manager ? memberName(manager, 'Someone') : s.owners}</Row>
            <Row label={s.dailyRate}>{rate(member.daily_rate_minor, view.group?.company_default_daily_rate_minor)}</Row>
            <Row label={s.mileageRate}>
              {rate(
                (member as { mileage_rate_minor?: string | null }).mileage_rate_minor,
                view.group?.company_default_mileage_rate_minor,
              )}
            </Row>
          </>
        ) : null}
        <Row label={s.employed}>
          {isNotEmployed(member)
            ? `${s.notEmployed}${member.employment_ended_on ? ` ${s.since} ${member.employment_ended_on}` : ''}`
            : s.employed}
        </Row>
        <Row label={s.joining}>{dates?.joinedOn ?? s.notSet}</Row>
        <Row label={s.birthday}>
          {dates?.birthDay && dates.birthMonth ? `${dates.birthDay}/${dates.birthMonth}` : s.notSet}
        </Row>
      </div>

      {canDates ? <DatesForm key={`${calendar.dates.size}:${calendar.dates.get(member.id)?.birthDay ?? ''}:${calendar.dates.get(member.id)?.joinedOn ?? ''}`} groupId={groupId} memberId={member.id} own={own} /> : null}
      <TeamCard groupId={groupId} member={member} />
      {canEmployment ? <EmploymentControl groupId={groupId} member={member} /> : null}
      {canDelete ? (
        <div>
          <button type="button" className="btn soft" disabled={busy || history} onClick={() => void remove()}>
            {s.remove}
          </button>
          {history ? <p className="faint">{s.removeHasHistory}</p> : null}
        </div>
      ) : null}
      {employee ? <AttendanceMonth groupId={groupId} memberId={member.id} /> : null}
    </div>
  );
}

function IdEditor({
  initial,
  busy,
  onSave,
  onCancel,
}: {
  initial: string;
  busy: boolean;
  onSave: (raw: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <span>
      <input value={value} maxLength={EMPLOYEE_ID_MAX} aria-label={s.employeeId} onChange={(e) => setValue(e.target.value)} />{' '}
      <button type="button" className="btn brand" disabled={busy} onClick={() => onSave(value)}>
        {s.save}
      </button>{' '}
      <button type="button" className="btn soft" onClick={onCancel}>
        {s.cancel}
      </button>
    </span>
  );
}

/** My dates: birthday and joining date (own row, or an owner/manager editing a report). */
function DatesForm({ groupId, memberId, own }: { groupId: string; memberId: string; own: boolean }) {
  const calendar = useCalendar(groupId);
  const { setDates } = useCalendarActions(groupId);
  const cur = calendar.dates.get(memberId);
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState(cur?.birthDay ? String(cur.birthDay) : '');
  const [month, setMonth] = useState(cur?.birthMonth ? String(cur.birthMonth) : '');
  const [joined, setJoined] = useState(cur?.joinedOn ?? '');
  const [show, setShow] = useState(cur?.showBirthday ?? false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async (clear: boolean): Promise<void> => {
    const bad =
      !clear &&
      ((!!day !== !!month ||
        (day !== '' && !(+day >= 1 && +day <= 31 && Number.isInteger(+day))) ||
        (month !== '' && !(+month >= 1 && +month <= 12 && Number.isInteger(+month)))) &&
        s.errBirthday);
    const badJoin =
      !clear && joined && (!isEmploymentDate(joined) || joined > todayIso() || joined < '1980-01-01') && s.errDate;
    if (bad || badJoin) return setErr((bad || badJoin) as string);
    setBusy(true);
    setErr(null);
    try {
      await setDates({
        memberId,
        birthDay: clear || !day ? null : Number(day),
        birthMonth: clear || !month ? null : Number(month),
        joinedOn: clear || !joined ? null : joined,
        showBirthday: own && !clear && show,
      });
      setOpen(false);
    } catch {
      setErr(s.failed);
    } finally {
      setBusy(false);
    }
  };

  if (!open)
    return (
      <button type="button" className="btn soft" onClick={() => setOpen(true)}>
        {own ? s.myDates : `${s.edit} ${s.birthday} / ${s.joining}`}
      </button>
    );
  return (
    <div className="field">
      <input inputMode="numeric" placeholder={s.birthDay} aria-label={s.birthDay} value={day} onChange={(e) => setDay(e.target.value)} />
      <input inputMode="numeric" placeholder={s.birthMonth} aria-label={s.birthMonth} value={month} onChange={(e) => setMonth(e.target.value)} />
      <input placeholder={s.joinedOn} aria-label={s.joinedOn} value={joined} onChange={(e) => setJoined(e.target.value)} />
      {own ? (
        <label>
          <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> {s.showBirthday}
        </label>
      ) : null}
      {err ? <p className="error">{err}</p> : null}
      <div>
        <button type="button" className="btn brand" disabled={busy} onClick={() => void save(false)}>
          {s.save}
        </button>{' '}
        <button type="button" className="btn soft" disabled={busy} onClick={() => void save(true)}>
          {s.clear}
        </button>{' '}
        <button type="button" className="btn soft" onClick={() => setOpen(false)}>
          {s.cancel}
        </button>
      </div>
    </div>
  );
}

/** Owner-only: make a manager, choose who they report to (with a reason), and their sites. */
function TeamCard({ groupId, member }: { groupId: string; member: CompanyMember }) {
  const view = useCompanyView(groupId);
  const actions = useEmployeeActions(groupId);
  const { mirror, refresh } = useSync();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const projects = useMemo(
    () => materialiseCompanyProjects(mirror, NO_QUEUE, { groupId }).filter((p) => !p.deleted_at && !p.archived_at),
    [mirror, groupId],
  );
  const onSites = useMemo(
    () => materialiseProjectMembers(mirror, NO_QUEUE, { groupId }).get(member.id) ?? [],
    [mirror, groupId, member.id],
  );
  if (!view.isOwner || view.suspended || member.id === view.me?.id || member.role === 'admin') return null;

  const managers = view.members.filter((m) => m.role === 'manager' && !m.left_at);
  const isManager = member.role === 'manager';
  const hasTeam = view.members.some((m) => m.manager_id === member.id && !m.left_at);
  const go = async (work: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch {
      setError(s.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <p className="title">{s.permissions}</p>
      <label>
        <input
          type="checkbox"
          checked={isManager}
          disabled={busy || (isManager && hasTeam)}
          onChange={(e) =>
            void go(async () => {
              const { error: rpcError } = await supabase.rpc('waves_set_member_role', {
                p_member_id: member.id,
                p_role: e.target.checked ? 'manager' : 'member',
              });
              if (rpcError) throw new Error(rpcError.message);
              await refresh();
            })
          }
        />{' '}
        {s.canPayPeople}
      </label>
      <p className="faint">{isManager && hasTeam ? s.moveTeamFirst : s.canPayPeopleHint}</p>
      {!isManager && managers.length > 0 ? (
        <div>
          <p className="field-label">{s.reportsTo}</p>
          <input placeholder={s.reason} aria-label={s.reason} value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
          <div className="people">
            {[{ id: '', label: s.owners }, ...managers.map((m) => ({ id: m.id, label: memberName(m, 'Someone') }))].map((o) => (
              <button
                key={o.id}
                type="button"
                className={o.id === (member.manager_id ?? '') ? 'chip brand' : 'chip'}
                disabled={busy}
                onClick={() =>
                  o.id !== (member.manager_id ?? '') &&
                  void go(() => actions.assign({ memberId: member.id, managerId: o.id || null, reason: reason.trim() }))
                }
              >
                {o.label}
              </button>
            ))}
          </div>
          <p className="faint">{s.historyMoves}</p>
        </div>
      ) : null}
      {!isManager && projects.length > 0 ? (
        <div>
          <p className="field-label">{s.sites}</p>
          <div className="people">
            {projects.map((p) => {
              const on = onSites.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  className={on ? 'chip brand' : 'chip'}
                  disabled={busy}
                  onClick={() =>
                    void go(() =>
                      actions.setProjects({
                        memberId: member.id,
                        projectIds: on ? onSites.filter((id) => id !== p.id) : [...onSites, p.id],
                      }),
                    )
                  }
                >
                  {p.name}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}

/** Mark not employed (with last day and note) or re-employ, handling an employee ID that was reused meanwhile. */
function EmploymentControl({ groupId, member }: { groupId: string; member: CompanyMember }) {
  const view = useCompanyView(groupId);
  const actions = useEmployeeActions(groupId);
  const employed = !member.left_at;
  const [open, setOpen] = useState(false);
  const [endedOn, setEndedOn] = useState(todayIso());
  const [note, setNote] = useState('');
  const [conflict, setConflict] = useState(false);
  const [newId, setNewId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const holder = member.employee_id ? employeeIdHolder(view.members, member.employee_id, member.id) : undefined;
  const send = async (input: Parameters<typeof actions.setEmployment>[0]): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      if (input.employed && input.newEmployeeId && (await actions.isEmployeeIdTaken(view.members, input.newEmployeeId, member.id)))
        throw new Error('EMPLOYEE_ID_TAKEN');
      await actions.setEmployment(input);
      setOpen(false);
      setConflict(false);
    } catch (caught) {
      const key = employmentErrorKey(caught);
      if (key === 'employmentIdTaken' && !employed) setConflict(true);
      setError(s[key]);
    } finally {
      setBusy(false);
    }
  };

  const markOut = (): void => {
    const date = endedOn.trim();
    if (date && !isEmploymentDate(date)) return setError(s.invalidDate);
    if (!window.confirm(s.confirmNotEmployed)) return;
    void send({ memberId: member.id, employed: false, endedOn: date || null, note });
  };
  const markIn = async (): Promise<void> => {
    if (member.employee_id && (holder || (await actions.isEmployeeIdTaken(view.members, member.employee_id, member.id)))) {
      setConflict(true);
      setOpen(true);
      return;
    }
    if (window.confirm(s.confirmEmployed)) void send({ memberId: member.id, employed: true });
  };

  return (
    <div className="card">
      {!open ? (
        <button type="button" className="btn soft" disabled={busy} onClick={() => (employed ? setOpen(true) : void markIn())}>
          {employed ? s.markNotEmployed : s.markEmployed}
        </button>
      ) : employed ? (
        <div className="field">
          <p className="faint">{s.employmentHint}</p>
          <input placeholder={s.endedOn} aria-label={s.endedOn} value={endedOn} onChange={(e) => setEndedOn(e.target.value)} />
          <input placeholder={s.note} aria-label={s.note} value={note} maxLength={200} onChange={(e) => setNote(e.target.value.slice(0, 200))} />
          <div>
            <button type="button" className="btn brand" disabled={busy} onClick={markOut}>
              {s.markNotEmployed}
            </button>{' '}
            <button type="button" className="btn soft" onClick={() => setOpen(false)}>
              {s.cancel}
            </button>
          </div>
        </div>
      ) : conflict ? (
        <div className="field">
          <p>
            {s.idInUse
              .replace('{id}', member.employee_id ?? '')
              .replace('{name}', holder ? memberName(holder, 'Someone') : 'someone')}
          </p>
          <button type="button" className="btn soft" disabled={busy} onClick={() => void send({ memberId: member.id, employed: true, clearEmployeeId: true })}>
            {s.restoreWithoutId}
          </button>
          <input placeholder={s.newEmployeeId} aria-label={s.newEmployeeId} value={newId} onChange={(e) => setNewId(e.target.value)} />
          <button
            type="button"
            className="btn brand"
            disabled={busy || !newId.trim()}
            onClick={() => void send({ memberId: member.id, employed: true, newEmployeeId: newId.trim() })}
          >
            {s.pickNewId}
          </button>{' '}
          <button type="button" className="btn soft" onClick={() => setOpen(false)}>
            {s.cancel}
          </button>
        </div>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}

function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1 + n, 1)).toISOString().slice(0, 7);
}

/** A month list of one person's attendance marks. */
function AttendanceMonth({ groupId, memberId }: { groupId: string; memberId: string }) {
  const { locale } = useStrings();
  const marks = useAttendance(groupId);
  const thisMonth = todayIso().slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [y, m] = month.split('-').map(Number);
  const days = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  const label = { present: s.present, half: s.half, absent: s.absent } as const;
  const rows = Array.from({ length: days }, (_, i) => {
    const day = `${month}-${String(i + 1).padStart(2, '0')}`;
    return { day, status: marks.get(`${memberId}|${day}`)?.status };
  }).filter((r) => r.status);
  const present = rows.filter((r) => r.status === 'present').length + rows.filter((r) => r.status === 'half').length / 2;
  const monthName = new Date(`${month}-01T00:00:00Z`).toLocaleDateString(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' });

  return (
    <div className="card">
      <div className="panel-head">
        <span className="title grow">{s.attendance}</span>
        <button type="button" className="icon-btn" aria-label={s.prevMonth} onClick={() => setMonth(shiftMonth(month, -1))}>
          ‹
        </button>
        <span>{monthName}</span>
        <button type="button" className="icon-btn" aria-label={s.nextMonth} disabled={month >= thisMonth} onClick={() => setMonth(shiftMonth(month, 1))}>
          ›
        </button>
      </div>
      <p className="faint">{s.daysPresent.replace('{n}', String(present)).replace('{month}', monthName)}</p>
      {rows.length === 0 ? (
        <p className="faint">{s.noMarks}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th align="left">{s.date}</th>
              <th align="left">{s.status}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.day}>
                <td>{new Date(`${r.day}T00:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short', weekday: 'short', timeZone: 'UTC' })}</td>
                <td>{label[r.status!]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
