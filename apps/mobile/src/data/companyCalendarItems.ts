import { useMemo } from 'react';
import type {
  MirrorEvent,
  MirrorHoliday,
  MirrorLeave,
  MirrorWorkTask,
  MoneyDate,
} from '@waves/core';
import { useCalendar } from '@/data/companyCalendar';
import { useWorkTasks } from '@/data/companyWorkday';
import { useMoneyDates } from '@/data/companyMoneyDates';
import { useCompanyEntries } from '@/data/companyEntries';
import { displayName } from '@/data/types';
import { todayIso } from '@/data/personal';
import { useStrings } from '@/i18n';

export type CalendarKind = 'leave' | 'money' | 'work' | 'birthday';
export interface CalendarItem {
  id: string;
  day: string;
  kind: CalendarKind;
  subKind:
    | 'holiday'
    | 'leave'
    | 'wage'
    | 'vendor_bill'
    | 'customer_bill'
    | 'advance'
    | 'recurring'
    | 'task'
    | 'event'
    | 'birthday'
    | 'anniversary';
  title: string;
  memberId: string | null;
  time: string | null;
  status?: string;
  overdue?: boolean;
  amountMinor?: bigint | null;
  currency?: string;
  ref: MirrorHoliday | MirrorLeave | MirrorEvent | MoneyDate | MirrorWorkTask | null;
  route: string | null;
  years?: number;
}
type Filter = 'all' | CalendarKind;
export function filterItems(
  items: readonly CalendarItem[],
  filter: Filter,
): readonly CalendarItem[] {
  return filter === 'all' ? items : items.filter((item) => item.kind === filter);
}
const dateKey = (year: number, month: number, day: number) =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

export function useCalendarItems(
  groupId: string,
  year: number,
  month: number,
): readonly CalendarItem[] {
  const cal = useCalendar(groupId);
  const tasks = useWorkTasks(groupId);
  const money = useMoneyDates(groupId);
  const company = useCompanyEntries(groupId);
  const { t } = useStrings();
  return useMemo(() => {
    const first = dateKey(year, month, 1);
    const last = dateKey(year, month, new Date(Date.UTC(year, month, 0)).getUTCDate());
    const people = new Map(company.members.map((member) => [member.id, displayName(member)]));
    const items: CalendarItem[] = [];
    for (const holiday of cal.holidays)
      for (
        let day = holiday.startDay > first ? holiday.startDay : first;
        day <= holiday.endDay && day <= last;
        day = dateKey(year, month, Number(day.slice(-2)) + 1)
      ) {
        items.push({
          id: `${holiday.id}:${day}`,
          day,
          kind: 'leave',
          subKind: 'holiday',
          title: holiday.name,
          memberId: null,
          time: null,
          ref: holiday,
          route: null,
        });
        if (day === last) break;
      }
    for (const leave of cal.leave) {
      if (leave.status === 'rejected') continue;
      const start = leave.startDay > first ? leave.startDay : first;
      const end = leave.endDay < last ? leave.endDay : last;
      for (let d = start; d <= end;) {
        items.push({
          id: `${leave.id}:${d}`,
          day: d,
          kind: 'leave',
          subKind: 'leave',
          title: people.get(leave.memberId) ?? '',
          memberId: leave.memberId,
          time: null,
          status: leave.status,
          ref: leave,
          route: null,
        });
        const next = new Date(`${d}T00:00:00Z`);
        next.setUTCDate(next.getUTCDate() + 1);
        d = next.toISOString().slice(0, 10);
      }
    }
    for (const event of cal.events)
      if (event.day >= first && event.day <= last)
        items.push({
          id: event.id,
          day: event.day,
          kind: 'work',
          subKind: 'event',
          title: event.title,
          memberId: event.people[0] ?? null,
          time: event.time,
          ref: event,
          route: null,
        });
    for (const task of tasks)
      if (task.day >= first && task.day <= last)
        items.push({
          id: task.id,
          day: task.day,
          kind: 'work',
          subKind: 'task',
          title: task.title,
          memberId: task.memberId,
          time: null,
          status: task.status,
          ref: task,
          route: 'company-work',
        });
    for (const date of money)
      if (
        (date.day >= first && date.day <= last) ||
        (date.overdue && todayIso() >= first && todayIso() <= last)
      )
        items.push({
          id: date.id,
          day: date.overdue ? todayIso() : date.day,
          kind: 'money',
          subKind: date.kind,
          title: date.title,
          memberId: date.memberId,
          time: null,
          overdue: date.overdue,
          amountMinor: date.amountMinor,
          currency: date.currency,
          ref: date,
          route: date.route,
        });
    for (const [memberId, dates] of cal.dates) {
      const name = people.get(memberId) ?? '';
      if (dates.showBirthday && dates.birthDay && dates.birthMonth) {
        const day =
          dates.birthDay === 29 &&
          month === 2 &&
          new Date(Date.UTC(year, 1, 29)).getUTCDate() !== 29
            ? 28
            : dates.birthDay;
        const birthday = dateKey(year, dates.birthMonth, day);
        if (birthday >= first && birthday <= last)
          items.push({
            id: `birthday:${memberId}:${year}`,
            day: birthday,
            kind: 'birthday',
            subKind: 'birthday',
            title: t.calendar.birthdayOf.replace('{name}', name),
            memberId,
            time: null,
            ref: null,
            route: null,
          });
      }
      if (dates.joinedOn) {
        const joined = new Date(`${dates.joinedOn}T00:00:00Z`);
        const years = year - joined.getUTCFullYear();
        if (
          years >= 1 &&
          joined.getUTCDate() <= new Date(Date.UTC(year, joined.getUTCMonth() + 1, 0)).getUTCDate()
        ) {
          const anniversary = dateKey(year, joined.getUTCMonth() + 1, joined.getUTCDate());
          if (anniversary >= first && anniversary <= last)
            items.push({
              id: `anniversary:${memberId}:${year}`,
              day: anniversary,
              kind: 'birthday',
              subKind: 'anniversary',
              title: t.calendar.anniversaryOf.replace('{name}', name).replace('{n}', String(years)),
              memberId,
              time: null,
              ref: null,
              route: null,
              years,
            });
        }
      }
    }
    return items.sort((a, b) => a.day.localeCompare(b.day) || a.title.localeCompare(b.title));
  }, [
    cal,
    tasks,
    money,
    company.members,
    t.calendar.birthdayOf,
    t.calendar.anniversaryOf,
    year,
    month,
  ]);
}

export function useUpcomingItems(groupId: string, limit: number): readonly CalendarItem[] {
  const today = todayIso();
  const date = new Date(`${today}T00:00:00Z`);
  const month0 = new Date(date);
  month0.setUTCDate(1);
  const month1 = new Date(month0);
  month1.setUTCMonth(month1.getUTCMonth() + 1);
  const month2 = new Date(month0);
  month2.setUTCMonth(month2.getUTCMonth() + 2);
  const month3 = new Date(month0);
  month3.setUTCMonth(month3.getUTCMonth() + 3);
  const month4 = new Date(month0);
  month4.setUTCMonth(month4.getUTCMonth() + 4);
  const items0 = useCalendarItems(groupId, month0.getUTCFullYear(), month0.getUTCMonth() + 1);
  const items1 = useCalendarItems(groupId, month1.getUTCFullYear(), month1.getUTCMonth() + 1);
  const items2 = useCalendarItems(groupId, month2.getUTCFullYear(), month2.getUTCMonth() + 1);
  const items3 = useCalendarItems(groupId, month3.getUTCFullYear(), month3.getUTCMonth() + 1);
  const items4 = useCalendarItems(groupId, month4.getUTCFullYear(), month4.getUTCMonth() + 1);
  return [...items0, ...items1, ...items2, ...items3, ...items4]
    .filter((item) => item.day >= today)
    .sort((a, b) => a.day.localeCompare(b.day))
    .slice(0, limit);
}
