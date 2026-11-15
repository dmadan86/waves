'use client';

/** Inline panels for the calendar's forms (the phone's sheets). Each remounts per open via `key`. */
import { useState } from 'react';

import type { MirrorEvent, MirrorHoliday, MirrorLeave } from '@/lib/company/calendar';
import { useCalendar, useCalendarAccess, useCalendarActions } from '@/lib/company/calendar';
import { calendarStrings as s } from '@/lib/company/calendarStrings';
import { memberName, todayIso, useCompanyView } from '@/lib/company/view';
import { daysText, useLeaveBalances, useLeaveCheck, useLeaveTypes } from '@/lib/company/leave';
import { useProjects } from '@/lib/company/calendarProjects';

const iso = (v: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const days = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000) + 1;
function shift(day: string, n: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'grid', gap: 4 }}>
      <span className="faint">{label}</span>
      {children}
    </label>
  );
}

/** Shared frame: save/cancel/remove row, validation error, save failure. */
function Panel({
  title,
  error,
  onClose,
  onSave,
  onRemove,
  saveLabel = s.save,
  disabled,
  children,
}: {
  title: string;
  error: string | null;
  onClose: () => void;
  onSave: () => Promise<void>;
  onRemove?: () => Promise<void>;
  saveLabel?: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<string | null>(null);
  const run = (fn: () => Promise<void>) => {
    setBusy(true);
    setFail(null);
    fn()
      .then(onClose)
      .catch((e: unknown) => setFail(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };
  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        run(onSave);
      }}
      style={{ display: 'grid', gap: 8 }}
    >
      <h2>{title}</h2>
      {children}
      {error || fail ? <p role="alert">{error ?? fail}</p> : null}
      <div style={{ display: 'flex', gap: 8 }}>
        {onRemove ? (
          <button type="button" className="btn soft" disabled={busy} onClick={() => run(onRemove)}>
            {s.remove}
          </button>
        ) : null}
        <button type="button" className="btn soft" onClick={onClose}>
          {s.cancel}
        </button>
        <button type="submit" className="btn brand" disabled={!!error || busy || disabled}>
          {saveLabel}
        </button>
      </div>
    </form>
  );
}

export type ChooserKind = 'holiday' | 'event' | 'leave-request' | 'leave-record' | 'dates';
export function CalendarChooser({
  groupId,
  onPick,
  onClose,
}: {
  groupId: string;
  onPick: (kind: ChooserKind) => void;
  onClose: () => void;
}) {
  const access = useCalendarAccess(groupId);
  const choices: [ChooserKind, string][] = access.isOwner
    ? [
        ['holiday', s.addHoliday],
        ['event', s.addEvent],
        ['leave-record', s.recordLeave],
        ['dates', s.myDates],
      ]
    : access.canManage
      ? [
          ['event', s.addEvent],
          ['leave-record', s.recordLeave],
          ['dates', s.myDates],
        ]
      : [
          ['leave-request', s.requestLeave],
          ['dates', s.myDates],
        ];
  return (
    <div className="card" style={{ display: 'grid', gap: 8 }}>
      {choices.map(([key, label]) => (
        <button key={key} type="button" className="btn soft" onClick={() => onPick(key)}>
          {label}
        </button>
      ))}
      <button type="button" className="btn soft" onClick={onClose}>
        {s.cancel}
      </button>
    </div>
  );
}

export function HolidayForm({
  groupId,
  day,
  holiday,
  onClose,
}: {
  groupId: string;
  day?: string;
  holiday?: MirrorHoliday;
  onClose: () => void;
}) {
  const act = useCalendarActions(groupId);
  const { suspended } = useCompanyView(groupId);
  const today = todayIso();
  const [name, setName] = useState(holiday?.name ?? '');
  const [start, setStart] = useState(holiday?.startDay ?? day ?? today);
  const [end, setEnd] = useState(holiday?.endDay ?? day ?? today);
  const error = !name.trim()
    ? s.errName
    : !iso(start) || !iso(end) || end < start || days(start, end) > 31
      ? s.errRange
      : start < shift(today, -400) || end > shift(today, 730)
        ? s.errWindow
        : null;
  return (
    <Panel
      title={holiday ? s.holidayName : s.addHoliday}
      error={error}
      disabled={suspended}
      onClose={onClose}
      onSave={() =>
        act.setHoliday({
          id: holiday?.id ?? crypto.randomUUID(),
          name: name.trim(),
          startDay: start,
          endDay: end,
        })
      }
      onRemove={holiday ? () => act.removeHoliday({ id: holiday.id }) : undefined}
    >
      <Field label={s.holidayName}>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label={s.startDate}>
        <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
      </Field>
      <Field label={s.endDate}>
        <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
      </Field>
    </Panel>
  );
}

export function EventForm({
  groupId,
  day,
  event,
  onClose,
}: {
  groupId: string;
  day?: string;
  event?: MirrorEvent;
  onClose: () => void;
}) {
  const act = useCalendarActions(groupId);
  const view = useCompanyView(groupId);
  const projects = useProjects(groupId);
  const today = todayIso();
  const [title, setTitle] = useState(event?.title ?? '');
  const [date, setDate] = useState(event?.day ?? day ?? today);
  const [time, setTime] = useState(event?.time ?? '');
  const [site, setSite] = useState(event?.projectId ?? '');
  const [people, setPeople] = useState<string[]>(event?.people ? [...event.people] : []);
  const eligible = view.members.filter(
    (p) => !p.left_at && p.role !== 'vendor' && (view.isOwner || view.manageableIds.has(p.id)),
  );
  const error = !title.trim()
    ? s.errTitle
    : !iso(date) || date < shift(today, -400) || date > shift(today, 730)
      ? s.errWindow
      : time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)
        ? s.errTime
        : !view.isOwner && people.length === 0
          ? s.errPeople
          : null;
  const toggle = (id: string) =>
    setPeople((x) => (x.includes(id) ? x.filter((v) => v !== id) : [...x, id]));
  return (
    <Panel
      title={s.eventTitle}
      error={error}
      disabled={view.suspended}
      onClose={onClose}
      onSave={() =>
        act.setEvent({
          id: event?.id ?? crypto.randomUUID(),
          title: title.trim(),
          day: date,
          time: time || null,
          projectId: site || null,
          people,
        })
      }
      onRemove={event ? () => act.removeEvent({ id: event.id }) : undefined}
    >
      <Field label={s.eventTitle}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label={s.startDate}>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <Field label={s.eventTime}>
        <input value={time} placeholder="HH:MM" onChange={(e) => setTime(e.target.value)} />
      </Field>
      <Field label={s.eventSite}>
        <select value={site} onChange={(e) => setSite(e.target.value)}>
          <option value="" />
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
      <span className="faint">{s.eventPeople}</span>
      {view.isOwner ? (
        <label>
          <input type="checkbox" checked={people.length === 0} onChange={() => setPeople([])} />{' '}
          {s.eventEveryone}
        </label>
      ) : null}
      {eligible.map((p) => (
        <label key={p.id}>
          <input type="checkbox" checked={people.includes(p.id)} onChange={() => toggle(p.id)} />{' '}
          {memberName(p, s.someone)}
        </label>
      ))}
    </Panel>
  );
}

export function LeaveForm({
  groupId,
  day,
  mode,
  onClose,
}: {
  groupId: string;
  day?: string;
  mode: 'request' | 'record';
  onClose: () => void;
}) {
  const act = useCalendarActions(groupId);
  const access = useCalendarAccess(groupId);
  const view = useCompanyView(groupId);
  const cal = useCalendar(groupId);
  const today = todayIso();
  const [memberId, setMember] = useState(access.meId ?? '');
  const [start, setStart] = useState(day ?? today);
  const [end, setEnd] = useState(day ?? today);
  const [half, setHalf] = useState(false);
  const types = useLeaveTypes(groupId, true);
  const [pickedType, setType] = useState<string | null | undefined>(undefined);
  // First type by default; null = "Other (not counted)" for leave that fits no policy.
  const typeId = pickedType === undefined ? (types[0]?.id ?? null) : pickedType;
  const balances = useLeaveBalances(groupId, memberId || null);
  const kind = types.find((x) => x.id === typeId)?.kind ?? 'other';
  const [reason, setReason] = useState('');
  const persons = view.members.filter(
    (p) =>
      !p.left_at &&
      p.role !== 'admin' &&
      (view.isOwner ? p.id !== access.meId : view.manageableIds.has(p.id)),
  );
  const overlap = cal.leave.some(
    (l) =>
      l.memberId === memberId && l.status !== 'rejected' && l.startDay <= end && l.endDay >= start,
  );
  const check = useLeaveCheck(groupId, {
    memberId,
    typeId,
    startDay: start,
    endDay: end,
    halfDay: half && start === end,
  });
  const count =
    iso(start) && iso(end) && end >= start ? (half && start === end ? 0.5 : days(start, end)) : 0;
  const error =
    !iso(start) || !iso(end) || end < start || days(start, end) > 60
      ? s.errRange
      : half && start !== end
        ? s.errHalfDay
        : start < shift(today, -60) || end > shift(today, 365)
          ? s.errWindow
          : overlap
            ? s.errOverlap
            : check && !check.ok
              ? s.leaveOverBalance
                  .replace('{n}', daysText(Math.max(0, check.available)))
                  .replace('{type}', check.type.name)
              : null;
  return (
    <Panel
      title={mode === 'request' ? s.requestLeave : s.recordLeave}
      error={error}
      disabled={!memberId || view.suspended}
      onClose={onClose}
      onSave={() =>
        act.setLeave({
          id: crypto.randomUUID(),
          memberId,
          startDay: start,
          endDay: end,
          halfDay: half,
          kind,
          reason: reason.trim() || null,
          leaveTypeId: typeId,
        })
      }
    >
      {mode === 'record' ? (
        <Field label={s.person}>
          <select value={memberId} onChange={(e) => setMember(e.target.value)}>
            <option value="" />
            {persons.map((p) => (
              <option key={p.id} value={p.id}>
                {memberName(p, s.someone)}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      <Field label={s.startDate}>
        <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
      </Field>
      <Field label={s.endDate}>
        <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
      </Field>
      {start === end ? (
        <label>
          <input type="checkbox" checked={half} onChange={() => setHalf(!half)} /> {s.halfDay}
        </label>
      ) : null}
      <Field label={s.leaveType}>
        <select value={typeId ?? ''} onChange={(e) => setType(e.target.value || null)}>
          {types.map((x) => {
            const left = balances.find((b) => b.type.id === x.id)?.balance.balance;
            return (
              <option key={x.id} value={x.id}>
                {left === undefined
                  ? x.name
                  : `${x.name} · ${s.leaveLeft.replace('{n}', daysText(left))}`}
              </option>
            );
          })}
          <option value="">{s.leaveTypeNone}</option>
        </select>
      </Field>
      {count > 0 ? (
        <span className="faint">
          {s.leaveDaysSelected.replace('{n}', daysText(count))}
          {check && check.ok
            ? ` · ${s.leaveAfter.replace('{n}', daysText(check.available - check.days))}`
            : ''}
        </span>
      ) : null}
      <Field label={s.reason}>
        <input value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </Panel>
  );
}

export function LeaveDecision({
  groupId,
  leave,
  onClose,
}: {
  groupId: string;
  leave: MirrorLeave;
  onClose: () => void;
}) {
  const act = useCalendarActions(groupId);
  const view = useCompanyView(groupId);
  const [note, setNote] = useState('');
  const [fail, setFail] = useState<string | null>(null);
  const person = view.members.find((p) => p.id === leave.memberId);
  const decide = (approve: boolean) =>
    act
      .decideLeave({ id: leave.id, approve, note: note.trim() || null })
      .then(onClose)
      .catch((e: unknown) => setFail(e instanceof Error ? e.message : String(e)));
  return (
    <div className="card" style={{ display: 'grid', gap: 8 }}>
      <h2>{s.decisionTitle}</h2>
      {person ? <strong>{memberName(person, s.someone)}</strong> : null}
      <span>
        {leave.startDay} – {leave.endDay}
      </span>
      <span>
        {leave.kind === 'casual'
          ? s.leaveCasual
          : leave.kind === 'sick'
            ? s.leaveSick
            : s.leaveOther}
        {leave.halfDay ? ` · ${s.halfDay}` : ''}
      </span>
      {leave.reason ? <span>{leave.reason}</span> : null}
      <Field label={s.decisionNote}>
        <input value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {fail ? <p role="alert">{fail}</p> : null}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="btn soft" onClick={onClose}>
          {s.cancel}
        </button>
        <button type="button" className="btn soft" onClick={() => void decide(false)}>
          {s.reject}
        </button>
        <button type="button" className="btn brand" onClick={() => void decide(true)}>
          {s.approve}
        </button>
      </div>
    </div>
  );
}

export function MyDatesForm({
  groupId,
  memberId,
  onClose,
}: {
  groupId: string;
  memberId?: string;
  onClose: () => void;
}) {
  const access = useCalendarAccess(groupId);
  const cal = useCalendar(groupId);
  const act = useCalendarActions(groupId);
  const view = useCompanyView(groupId);
  const id = memberId ?? access.meId ?? '';
  const own = !memberId || memberId === access.meId;
  const current = cal.dates.get(id);
  const [birth, setBirth] = useState(current?.birthDay ? String(current.birthDay) : '');
  const [month, setMonth] = useState(current?.birthMonth ? String(current.birthMonth) : '');
  const [joined, setJoined] = useState(current?.joinedOn ?? '');
  const [show, setShow] = useState(current?.showBirthday ?? false);
  const today = todayIso();
  const birthdayValid =
    (!birth && !month) ||
    (Number.isInteger(+birth) &&
      +birth >= 1 &&
      +birth <= 31 &&
      Number.isInteger(+month) &&
      +month >= 1 &&
      +month <= 12);
  const error = !birthdayValid
    ? s.errBirthday
    : joined && (!iso(joined) || joined > today || joined < '1980-01-01')
      ? s.errDate
      : null;
  const write = (clear: boolean) =>
    act.setDates({
      memberId: id,
      birthDay: clear || !birth ? null : Number(birth),
      birthMonth: clear || !month ? null : Number(month),
      joinedOn: clear || !joined ? null : joined,
      showBirthday: own && !clear && show,
    });
  return (
    <Panel
      title={s.myDates}
      error={error}
      disabled={view.suspended || !id}
      onClose={onClose}
      onSave={() => write(false)}
      onRemove={undefined}
    >
      <Field label={s.birthDay}>
        <input inputMode="numeric" value={birth} onChange={(e) => setBirth(e.target.value)} />
      </Field>
      <Field label={s.birthMonth}>
        <input inputMode="numeric" value={month} onChange={(e) => setMonth(e.target.value)} />
      </Field>
      <Field label={s.joinedOn}>
        <input type="date" value={joined} onChange={(e) => setJoined(e.target.value)} />
      </Field>
      {own ? (
        <label>
          <input type="checkbox" checked={show} onChange={() => setShow(!show)} /> {s.showBirthday}
          <span className="faint"> {s.showBirthdayHint}</span>
        </label>
      ) : null}
      <button
        type="button"
        className="btn soft"
        disabled={view.suspended || !id}
        onClick={() => void write(true).then(onClose)}
      >
        {s.clear}
      </button>
    </Panel>
  );
}
