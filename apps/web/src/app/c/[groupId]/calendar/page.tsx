'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';

import { CompanyFrame } from '@/components/CompanyFrame';
import { CompanyCalendarAgenda } from '@/components/company/CompanyCalendarAgenda';
import { CompanyCalendarGrid } from '@/components/company/CompanyCalendarGrid';
import {
  CalendarChooser,
  EventForm,
  HolidayForm,
  LeaveDecision,
  LeaveForm,
  MyDatesForm,
  type ChooserKind,
} from '@/components/company/CompanyCalendarSheets';
import { SegmentedTabs } from '@/components/SegmentedTabs';
import {
  useCalendar,
  useCalendarAccess,
  useCalendarActions,
  useCalendarSettings,
  type MirrorEvent,
  type MirrorHoliday,
  type MirrorLeave,
} from '@/lib/company/calendar';
import { filterItems, useCalendarItems, type CalendarKind } from '@/lib/company/calendarItems';
import { calendarStrings as s } from '@/lib/company/calendarStrings';
import { todayIso, useCompanyView } from '@/lib/company/view';

type Filter = 'all' | CalendarKind;
type Panel =
  | { t: 'chooser' }
  | { t: 'holiday'; holiday?: MirrorHoliday }
  | { t: 'event'; event?: MirrorEvent }
  | { t: 'leave'; mode: 'request' | 'record' }
  | { t: 'decide'; leave: MirrorLeave }
  | { t: 'dates' };

const LABELS = { birthdayOf: s.birthdayOf, anniversaryOf: s.anniversaryOf };

export default function CompanyCalendarPage() {
  const { groupId } = useParams<{ groupId: string }>();
  return (
    <CompanyFrame groupId={groupId}>
      <div className="app-body">
        <div className="app-main">
          <div className="page-head">
            <h1>{s.title}</h1>
          </div>
          <CalendarBody groupId={groupId} />
        </div>
      </div>
    </CompanyFrame>
  );
}

function CalendarBody({ groupId }: { groupId: string }) {
  const today = todayIso();
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const [month, setMonth] = useState(Number(today.slice(5, 7)));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [panel, setPanel] = useState<Panel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { suspended } = useCompanyView(groupId);
  const access = useCalendarAccess(groupId);
  const cal = useCalendar(groupId);
  const act = useCalendarActions(groupId);
  const sw = useCalendarSettings(groupId);
  const items = filterItems(useCalendarItems(groupId, year, month, LABELS), filter);
  const close = () => setPanel(null);
  const pick = (kind: ChooserKind) =>
    setPanel(
      kind === 'holiday'
        ? { t: 'holiday' }
        : kind === 'event'
          ? { t: 'event' }
          : kind === 'dates'
            ? { t: 'dates' }
            : { t: 'leave', mode: kind === 'leave-request' ? 'request' : 'record' },
    );
  const setSwitch = (next: { paidHolidays: boolean; paidLeave: boolean }) =>
    act
      .setSettings(next)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  const day = selectedDay ?? undefined;
  return (
    <>
      {suspended ? <p role="status">{s.suspendedNote}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <SegmentedTabs<Filter>
        label={s.filters}
        value={filter}
        onChange={setFilter}
        tabs={[
          { value: 'all', label: s.filterAll },
          { value: 'leave', label: s.filterLeave },
          { value: 'money', label: s.filterMoney },
          { value: 'work', label: s.filterWork },
          { value: 'birthday', label: s.filterBirthdays },
        ]}
      />
      {access.isOwner ? (
        <div className="card">
          <label>
            <input
              type="checkbox"
              checked={sw.paidHolidays}
              disabled={suspended}
              onChange={(e) =>
                void setSwitch({ paidHolidays: e.target.checked, paidLeave: sw.paidLeave })
              }
            />{' '}
            {s.paidHolidays} <span className="faint">{s.paidHolidaysHint}</span>
          </label>
          <br />
          <label>
            <input
              type="checkbox"
              checked={sw.paidLeave}
              disabled={suspended}
              onChange={(e) =>
                void setSwitch({ paidHolidays: sw.paidHolidays, paidLeave: e.target.checked })
              }
            />{' '}
            {s.paidLeave} <span className="faint">{s.paidLeaveHint}</span>
          </label>
        </div>
      ) : null}
      {!suspended && !panel ? (
        <button type="button" className="btn brand" onClick={() => setPanel({ t: 'chooser' })}>
          {s.add}
        </button>
      ) : null}
      {panel?.t === 'chooser' ? (
        <CalendarChooser groupId={groupId} onPick={pick} onClose={close} />
      ) : null}
      {panel?.t === 'holiday' ? (
        <HolidayForm
          key={panel.holiday?.id ?? 'new'}
          groupId={groupId}
          day={day}
          holiday={panel.holiday}
          onClose={close}
        />
      ) : null}
      {panel?.t === 'event' ? (
        <EventForm
          key={panel.event?.id ?? 'new'}
          groupId={groupId}
          day={day}
          event={panel.event}
          onClose={close}
        />
      ) : null}
      {panel?.t === 'leave' ? (
        <LeaveForm groupId={groupId} day={day} mode={panel.mode} onClose={close} />
      ) : null}
      {panel?.t === 'decide' ? (
        <LeaveDecision key={panel.leave.id} groupId={groupId} leave={panel.leave} onClose={close} />
      ) : null}
      {panel?.t === 'dates' ? (
        <MyDatesForm groupId={groupId} memberId={access.meId ?? undefined} onClose={close} />
      ) : null}
      <CompanyCalendarGrid
        year={year}
        month={month}
        items={items}
        selectedDay={selectedDay}
        onSelect={(d) => setSelectedDay(selectedDay === d ? null : d)}
        onMonthChange={(y, m) => {
          setYear(y);
          setMonth(m);
          setSelectedDay(null);
        }}
      />
      <CompanyCalendarAgenda
        groupId={groupId}
        items={items}
        selectedDay={selectedDay}
        onError={setError}
        onOpenLeave={(leave) => {
          const live = cal.leave.find((l) => l.id === leave.id);
          if (live && live.status === 'pending' && access.canDecide(live))
            setPanel({ t: 'decide', leave: live });
        }}
        onOpenEvent={(event) => access.isOwner && setPanel({ t: 'event', event })}
        onOpenHoliday={(holiday) => access.isOwner && setPanel({ t: 'holiday', holiday })}
      />
    </>
  );
}
