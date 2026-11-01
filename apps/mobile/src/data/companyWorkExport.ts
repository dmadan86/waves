/**
 * Team › Tasks reports as a document. Four reports built from the tasks the viewer can already
 * read, handed to the same HTML / Excel renderers the company statement uses (companyExport.ts).
 * Pure: no photos, no ids, only what is printed.
 */

import type { CompanyExportModel, CompanyCell } from '@/data/companyExport';
import { isRtlLocale } from '@/data/groupExport';
import type { MirrorWorkTask } from '@/data/companyWorkday';

export type WorkReport = 'list' | 'person' | 'site' | 'overdue';

export interface WorkReportLabels {
  readonly titles: Readonly<Record<WorkReport, string>>;
  readonly number: string;
  readonly task: string;
  readonly person: string;
  readonly site: string;
  readonly date: string;
  readonly status: string;
  readonly open: string;
  readonly done: string;
  readonly overdue: string;
  readonly total: string;
  readonly completion: string;
  readonly daysLate: string;
  readonly noSite: string;
  readonly statuses: Readonly<Record<MirrorWorkTask['status'], string>>;
}

const text = (value: string): CompanyCell => ({ text: value });
const num = (value: number): CompanyCell => ({ text: String(value), value });
const dayNumber = (iso: string): number => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;

/** Monday to Sunday around `today`, or the calendar month of it. */
export function workRange(preset: 'week' | 'month', today: string): { from: string; to: string } {
  const date = new Date(`${today}T00:00:00Z`);
  if (preset === 'month') {
    const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
    return { from: `${today.slice(0, 8)}01`, to: last.toISOString().slice(0, 10) };
  }
  const back = (date.getUTCDay() + 6) % 7;
  const start = new Date(date.getTime() - back * 86_400_000);
  return {
    from: start.toISOString().slice(0, 10),
    to: new Date(start.getTime() + 6 * 86_400_000).toISOString().slice(0, 10),
  };
}

export function buildWorkReport(input: {
  report: WorkReport;
  tasks: readonly MirrorWorkTask[];
  from: string;
  to: string;
  today: string;
  company: string;
  generatedOn: string;
  locale: string;
  personName: (memberId: string) => string;
  siteName: (projectId: string | null) => string;
  labels: WorkReportLabels;
}): CompanyExportModel {
  const { labels: l, today } = input;
  const tasks = input.tasks.filter((t) => t.day >= input.from && t.day <= input.to);
  const late = (t: MirrorWorkTask) => t.status !== 'done' && t.day < today;
  const site = (t: MirrorWorkTask) => (t.projectId ? input.siteName(t.projectId) : '') || l.noSite;
  const numberText = (t: MirrorWorkTask) => `#${t.number ?? '—'}`;
  const byDay = [...tasks].sort(
    (a, b) => a.day.localeCompare(b.day) || a.title.localeCompare(b.title),
  );
  const open = tasks.filter((t) => t.status !== 'done').length;
  const overdue = tasks.filter(late).length;
  const rate = tasks.length ? Math.round(((tasks.length - open) / tasks.length) * 100) : 0;

  const grouped = (keyOf: (t: MirrorWorkTask) => string, header: string) => {
    const groups = new Map<string, MirrorWorkTask[]>();
    for (const t of tasks) groups.set(keyOf(t), [...(groups.get(keyOf(t)) ?? []), t]);
    return {
      heading: l.titles[input.report],
      columns: [header, l.open, l.done, l.overdue, l.total],
      rows: [...groups.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, list]) => [
          text(name),
          num(list.filter((t) => t.status !== 'done').length),
          num(list.filter((t) => t.status === 'done').length),
          num(list.filter(late).length),
          num(list.length),
        ]),
    };
  };

  const headline: [string, string][] = [
    [l.total, String(tasks.length)],
    [l.open, String(open)],
    [l.overdue, String(overdue)],
  ];
  let section;
  if (input.report === 'list')
    section = {
      heading: l.titles.list,
      columns: [l.number, l.task, l.person, l.site, l.date, l.status],
      rows: byDay.map((t) => [
        text(numberText(t)),
        text(t.title),
        text(input.personName(t.memberId)),
        text(site(t)),
        text(t.day),
        text(l.statuses[t.status]),
      ]),
    };
  else if (input.report === 'person')
    section = grouped((t) => input.personName(t.memberId), l.person);
  else if (input.report === 'site') section = grouped(site, l.site);
  else {
    headline.splice(2, 0, [l.done, String(tasks.length - open)]);
    headline.push([l.completion, `${rate}%`]);
    section = {
      heading: l.titles.overdue,
      columns: [l.number, l.task, l.person, l.site, l.date, l.daysLate],
      rows: byDay
        .filter(late)
        .map((t) => [
          text(numberText(t)),
          text(t.title),
          text(input.personName(t.memberId)),
          text(site(t)),
          text(t.day),
          num(Math.round(dayNumber(today) - dayNumber(t.day))),
        ]),
    };
  }
  return {
    title: l.titles[input.report],
    subtitle: `${input.company} · ${input.from} – ${input.to}`,
    generatedOn: input.generatedOn,
    headline,
    sections: [section],
    isRtl: isRtlLocale(input.locale),
    footer: '',
  };
}
