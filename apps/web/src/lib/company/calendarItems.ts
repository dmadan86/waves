'use client';

import { useMemo } from 'react';
import type {
  MirrorEvent,
  MirrorHoliday,
  MirrorLeave,
  MirrorWorkTask,
  MoneyDate,
} from '@waves/core';
import { useCalendar } from './calendar';
import { useWorkTasks } from './workday';
import { memberName, todayIso, useCompanyView } from './view';

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

/** Money dates (bills, wages due) come from vendors/documents, owned by other slices: pass them in when available. */
export function useCalendarItems(
  groupId: string,
  year: number,
  month: number,
  labels: { birthdayOf: string; anniversaryOf: string },
  money: readonly MoneyDate[] = [],
): readonly CalendarItem[] {
  const cal = useCalendar(groupId);
  const tasks = useWorkTasks(groupId);
  const company = useCompanyView(groupId);
  return useMemo(() => {
    const first = dateKey(year, month, 1);
    const last = dateKey(year, month, new Date(Date.UTC(year, month, 0)).getUTCDate());
    const people = new Map(company.members.map((member) => [member.id, memberName(member, '')]));
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
          route: 'work',
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
            title: labels.birthdayOf.replace('{name}', name),
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
              title: labels.anniversaryOf.replace('{name}', name).replace('{n}', String(years)),
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
  }, [cal, tasks, money, company.members, labels.birthdayOf, labels.anniversaryOf, year, month]);
}
