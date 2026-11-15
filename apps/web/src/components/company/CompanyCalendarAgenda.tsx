'use client';

import Link from 'next/link';

import { money } from '@/lib/money';
import { useCalendarAccess, useCalendarActions } from '@/lib/company/calendar';
import type { MirrorEvent, MirrorHoliday, MirrorLeave } from '@/lib/company/calendar';
import type { CalendarItem } from '@/lib/company/calendarItems';
import { calendarStrings as s } from '@/lib/company/calendarStrings';
import { memberName, todayIso, useCompanyView } from '@/lib/company/view';

const KIND: Record<CalendarItem['subKind'], string> = {
  holiday: s.kindHoliday,
  leave: s.kindLeave,
  wage: s.kindWage,
  vendor_bill: s.kindVendorBill,
  customer_bill: s.kindCustomerBill,
  advance: s.kindAdvance,
  recurring: s.kindWage,
  task: s.kindTask,
  event: s.kindEvent,
  birthday: s.kindBirthday,
  anniversary: s.kindAnniversary,
};

export function CompanyCalendarAgenda({
  groupId,
  items,
  selectedDay,
  onOpenLeave,
  onOpenEvent,
  onOpenHoliday,
  onError,
}: {
  groupId: string;
  items: readonly CalendarItem[];
  selectedDay: string | null;
  onOpenLeave: (leave: MirrorLeave) => void;
  onOpenEvent: (event: MirrorEvent) => void;
  onOpenHoliday: (holiday: MirrorHoliday) => void;
  onError: (message: string) => void;
}) {
  const access = useCalendarAccess(groupId);
  const company = useCompanyView(groupId);
  const act = useCalendarActions(groupId);
  const today = todayIso();
  const visible = items.filter((it) => (selectedDay ? it.day === selectedDay : it.day >= today));
  const run = (p: Promise<void>) =>
    p.catch((e: unknown) => onError(e instanceof Error ? e.message : String(e)));

  const open = (item: CalendarItem) => {
    const ref = item.ref as { startDay?: string; day?: string; people?: unknown } | null;
    if (item.subKind === 'leave' && ref && 'startDay' in ref) onOpenLeave(item.ref as MirrorLeave);
    else if (item.subKind === 'holiday' && ref && 'startDay' in ref)
      onOpenHoliday(item.ref as MirrorHoliday);
    else if (item.subKind === 'event' && ref && 'people' in ref)
      onOpenEvent(item.ref as MirrorEvent);
  };
  const removeButton = (item: CalendarItem) => {
    const ref = item.ref as {
      id: string;
      status?: string;
      memberId?: string;
      startDay?: string;
      people?: unknown;
    } | null;
    if (!ref) return null;
    if (item.subKind === 'leave' && ref.status && ref.memberId) {
      const mine = ref.status === 'pending' && ref.memberId === access.meId;
      if (!mine && !access.canDecide({ memberId: ref.memberId })) return null;
      return {
        label: mine ? s.withdraw : s.remove,
        go: () => run(act.removeLeave({ id: ref.id })),
      };
    }
    if (item.subKind === 'holiday' && access.isOwner)
      return { label: s.remove, go: () => run(act.removeHoliday({ id: ref.id })) };
    if (item.subKind === 'event' && access.isOwner)
      return { label: s.remove, go: () => run(act.removeEvent({ id: ref.id })) };
    return null;
  };

  const title = selectedDay
    ? s.agendaFor.replace(
        '{date}',
        new Date(`${selectedDay}T00:00:00Z`).toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
          timeZone: 'UTC',
        }),
      )
    : s.upcoming;
  return (
    <div className="card">
      <h2>{title}</h2>
      {visible.length === 0 ? <p className="faint">{s.nothingPlanned}</p> : null}
      {visible.map((item) => {
        const person = item.memberId
          ? company.members.find((m) => m.id === item.memberId)
          : undefined;
        const sub = [
          KIND[item.subKind],
          item.day,
          item.time,
          person ? memberName(person, s.someone) : null,
          item.status === 'pending'
            ? s.statusPending
            : item.status === 'approved'
              ? s.statusApproved
              : null,
          item.overdue ? s.overdue : null,
        ]
          .filter(Boolean)
          .join(' · ');
        const rm = removeButton(item);
        const clickable =
          item.subKind === 'leave' || item.subKind === 'holiday' || item.subKind === 'event';
        return (
          <div
            key={item.id}
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div>
              {item.route ? (
                <Link href={`/c/${groupId}/${item.route}`}>{item.title}</Link>
              ) : clickable ? (
                <button type="button" className="btn soft" onClick={() => open(item)}>
                  {item.title}
                </button>
              ) : (
                <strong>{item.title}</strong>
              )}
              <div className="faint">
                {sub}
                {item.amountMinor != null && item.currency
                  ? ` · ${money(item.amountMinor, item.currency)}`
                  : ''}
              </div>
            </div>
            {rm ? (
              <button type="button" className="btn soft" onClick={rm.go}>
                {rm.label}
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
