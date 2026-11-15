'use client';

/** The owner/manager Home body, as on the phone: stat tiles, quick actions, task filter chips and cards, coming up. */

import { useMemo, useState } from 'react';
import Link from 'next/link';

import { useMoney } from '@/components/company/Bits';
import { fill } from '@/i18n';
import { useStrings } from '@/i18n-context';
import { useCalendarItems } from '@/lib/company/calendarItems';
import { calendarStrings } from '@/lib/company/calendarStrings';
import { useVendorsData } from '@/lib/company/useVendors';
import { memberName, todayIso, useCompanyView } from '@/lib/company/view';
import {
  useWorkdayAccess,
  useWorkdayActions,
  useWorkTasks,
  type MirrorWorkTask,
} from '@/lib/company/workday';
import { workStrings } from '@/lib/company/workStrings';
import { taskPayload } from '@/lib/company/workTasks';

type Bucket = 'overdue' | 'today' | 'week' | 'later';
type Chip = 'all' | 'overdue' | 'today' | 'upcoming';
const SHOWN: Record<Chip, readonly Bucket[]> = {
  all: ['overdue', 'today', 'week', 'later'],
  overdue: ['overdue'],
  today: ['today'],
  upcoming: ['week', 'later'],
};

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Open tasks of the viewer's people, in the phone's four buckets. */
function bucketTasks(tasks: readonly MirrorWorkTask[], today: string) {
  const end = addDays(today, 7);
  const open = tasks
    .filter((x) => x.status !== 'done')
    .sort((a, b) => a.day.localeCompare(b.day) || (a.dueTime ?? '').localeCompare(b.dueTime ?? ''));
  return {
    overdue: open.filter((x) => x.day < today),
    today: open.filter((x) => x.day === today),
    week: open.filter((x) => x.day > today && x.day <= end),
    later: open.filter((x) => x.day > end),
  };
}

export function HomeTop({
  groupId,
  advances,
  owes,
}: {
  groupId: string;
  advances: bigint;
  owes: bigint;
}) {
  const { t } = useStrings();
  const h = t.company.home;
  const view = useCompanyView(groupId);
  const fmt = useMoney(view.currency);
  const vendors = useVendorsData(groupId);
  const access = useWorkdayAccess(groupId);
  const tasks = useWorkTasks(groupId);
  let toVendors = 0n;
  if (view.isOwner) for (const v of vendors.vendors.balances.values()) if (v > 0n) toVendors += v;
  const ids = new Set(access.assignees.map((m) => m.id));
  const open = tasks.filter((x) => ids.has(x.memberId) && x.status !== 'done').length;
  const hour = new Date().getHours();
  const greet = hour < 12 ? h.greetMorning : hour < 17 ? h.greetAfternoon : h.greetEvening;
  const members = view.members.filter((m) => !m.left_at).length;
  const base = `/c/${groupId}`;
  const tiles = [
    { label: h.tilePayments, value: fmt(owes + toVendors), href: `${base}/payments` },
    { label: h.tileTasks, value: String(open), href: `${base}/team?seg=work` },
    { label: h.tileAdvances, value: fmt(advances), href: `${base}/team?seg=people` },
  ];
  return (
    <>
      <p className="home-greet">
        <strong>{greet}</strong>
        <span className="pill-badge">{fill(h.members, { n: members })}</span>
      </p>
      <div className="stat-strip">
        {tiles.map((x) => (
          <Link key={x.label} href={x.href} className="stat-cell">
            <span className="faint">{x.label}</span>
            <strong>{x.value}</strong>
          </Link>
        ))}
      </div>
    </>
  );
}

export function QuickActions({ groupId }: { groupId: string }) {
  const { t } = useStrings();
  const h = t.company.home;
  const base = `/c/${groupId}`;
  // Only routes that exist on the web; the phone's other shortcuts have no web screen.
  const actions = [
    [h.qaRecord, `${base}/payments`],
    [h.qaBill, `${base}/vendors`],
    [h.qaInvoice, `${base}/bills/new?type=bill`],
    [h.qaTask, `${base}/team?seg=work`],
    [h.qaClient, `${base}/clients/new`],
    [h.qaVendor, `${base}/vendors/new`],
    [h.qaUpload, `${base}/storage`],
    [h.qaReminder, `${base}/calendar`],
  ] as const;
  return (
    <section className="panel">
      <h2>{h.quick}</h2>
      <div className="quick-row">
        {actions.map(([label, href]) => (
          <Link key={label} href={href} className="chip">
            {label}
          </Link>
        ))}
      </div>
    </section>
  );
}

export function TaskBoard({ groupId }: { groupId: string }) {
  const { t, locale } = useStrings();
  const h = t.company.home;
  const view = useCompanyView(groupId);
  const access = useWorkdayAccess(groupId);
  const tasks = useWorkTasks(groupId);
  const { setTask } = useWorkdayActions(groupId);
  const [chip, setChip] = useState<Chip>('all');
  const today = todayIso();
  const ids = new Set(access.assignees.map((m) => m.id));
  const buckets = bucketTasks(
    tasks.filter((x) => ids.has(x.memberId)),
    today,
  );
  const n = (b: Bucket) => buckets[b].length;
  const upcoming = n('week') + n('later');
  const chips: [Chip, string, number][] = [
    ['all', h.filterAll, n('overdue') + n('today') + upcoming],
    ['overdue', h.overdue, n('overdue')],
    ['today', h.today, n('today')],
    ['upcoming', h.upcoming, upcoming],
  ];
  const sections: [Bucket, string][] = [
    ['overdue', h.overdue],
    ['today', h.today],
    ['week', h.thisWeek],
    ['later', h.later],
  ];
  const visible = sections.filter(([b]) => SHOWN[chip].includes(b) && n(b) > 0);
  const may = (x: MirrorWorkTask) =>
    !view.suspended && access.canManage && access.people.some((p) => p.id === x.memberId);
  const status = (x: MirrorWorkTask) =>
    x.day < today
      ? { label: h.overdue, cls: 'warn' }
      : x.status === 'blocked'
        ? { label: workStrings.blocked, cls: 'warn' }
        : x.status === 'doing'
          ? { label: workStrings.doing, cls: '' }
          : x.day > today
            ? { label: h.scheduled, cls: '' }
            : { label: workStrings.todo, cls: '' };
  const when = (x: MirrorWorkTask) =>
    x.day === today
      ? [h.today, x.dueTime?.slice(0, 5)].filter(Boolean).join(', ')
      : new Date(`${x.day}T00:00:00Z`).toLocaleDateString(locale, {
          month: 'short',
          day: 'numeric',
          timeZone: 'UTC',
        });
  const who = (id: string) =>
    memberName(
      view.members.find((m) => m.id === id),
      t.company.common.someone,
    );
  return (
    <>
      <div className="home-chips" role="group" aria-label={h.tileTasks}>
        {chips.map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            className="chip"
            aria-pressed={chip === key}
            onClick={() => setChip(key)}
          >
            {`${label} (${count})`}
          </button>
        ))}
      </div>
      {visible.length === 0 ? (
        <section className="panel">
          <p>{h.allClear}</p>
        </section>
      ) : (
        visible.map(([b, title]) => (
          <section key={b} className="panel">
            <div className="panel-head">
              <h2>{`${title} (${n(b)})`}</h2>
              <Link className="link" href={`/c/${groupId}/team?seg=work`}>
                {h.viewAll}
              </Link>
            </div>
            {buckets[b].slice(0, 2).map((x) => {
              const st = status(x);
              return (
                <div key={x.id} className="home-task">
                  <input
                    type="checkbox"
                    checked={false}
                    disabled={!may(x)}
                    aria-label={fill(h.taskDone, { title: x.title })}
                    onChange={() => void setTask({ ...taskPayload(x), status: 'done' })}
                  />
                  <span className="grow">
                    <span className="title">{x.title}</span>
                    <span className="meta">{who(x.memberId)}</span>
                  </span>
                  <span className="home-task-end">
                    <span className={`pill-badge ${st.cls}`}>{st.label}</span>
                    <span className="meta">{when(x)}</span>
                  </span>
                </div>
              );
            })}
          </section>
        ))
      )}
    </>
  );
}

const LABELS = {
  birthdayOf: calendarStrings.birthdayOf,
  anniversaryOf: calendarStrings.anniversaryOf,
};

export function ComingUp({ groupId }: { groupId: string }) {
  const { t, locale } = useStrings();
  const h = t.company.home;
  const view = useCompanyView(groupId);
  const today = todayIso();
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const thisMonth = useCalendarItems(groupId, y, m, LABELS);
  const nextMonth = useCalendarItems(groupId, m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, LABELS);
  const items = useMemo(
    () =>
      [...thisMonth, ...nextMonth]
        // Tasks are shown above; wages are the owner's alone.
        .filter(
          (it) =>
            it.day >= today && it.subKind !== 'task' && (it.subKind !== 'wage' || view.isOwner),
        )
        .sort((a, b) => a.day.localeCompare(b.day) || (a.time ?? '').localeCompare(b.time ?? ''))
        .slice(0, 4),
    [thisMonth, nextMonth, today, view.isOwner],
  );
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{h.comingUp}</h2>
        <Link className="link" href={`/c/${groupId}/calendar`}>
          {h.viewAll}
        </Link>
      </div>
      {items.length === 0 ? <p className="faint">{h.nothingComing}</p> : null}
      {items.map((it) => (
        <Link key={it.id} href={`/c/${groupId}/calendar`} className="item">
          <span className="grow">
            <span className="title">{it.title}</span>
            <span className="meta">
              {new Date(`${it.day}T00:00:00Z`).toLocaleDateString(locale, {
                month: 'short',
                day: 'numeric',
                timeZone: 'UTC',
              })}
              {it.time ? `, ${it.time.slice(0, 5)}` : ''}
            </span>
          </span>
        </Link>
      ))}
    </section>
  );
}
