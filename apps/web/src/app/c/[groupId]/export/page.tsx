'use client';

import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';

import {
  companyTagLabel,
  materialiseAttendance,
  materialiseCompanyProjects,
  materialiseWorkTasks,
  reimbursedOn,
  type CompanyEntry,
} from '@waves/core';

import { CompanyPage, useCompanyText } from '@/components/CompanyPage';
import { fill } from '@/i18n';
import {
  buildCompanyExport,
  buildCompanyExportCsv,
  renderCompanyExportHtml,
  type CompanyExportLabels,
} from '@/lib/company/export';
import { printHtml, downloadText } from '@/lib/company/print';
import { periodRange, type CompanyPeriod } from '@/lib/company/period';
import { parseCompanyTags } from '@/lib/company/settings';
import { buildAttendanceReport, buildWorkReport } from '@/lib/company/workExport';
import { memberName, todayIso, useCompanyView } from '@/lib/company/view';
import { NO_QUEUE, useSync } from '@/lib/sync';

type Report = 'summary' | 'attendance' | 'payments' | 'tasks';
type Range = CompanyPeriod | 'custom';
type Format = 'pdf' | 'csv';
const PAYMENT_KINDS = ['advance', 'wages', 'wage_payment', 'reimbursement'];

export default function CompanyExportPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const view = useCompanyView(groupId);
  const { mirror } = useSync();
  const { t, locale } = useCompanyText(view.currency);
  const e = t.company.docs.export;
  const [report, setReport] = useState<Report>('summary');
  const [period, setPeriod] = useState<Range>('month');
  const [format, setFormat] = useState<Format>('pdf');
  const [custom, setCustom] = useState(() => ({ from: todayIso(), to: todayIso() }));
  const [error, setError] = useState<string | null>(null);

  const tags = useMemo(
    () => parseCompanyTags((view.group as { company_tags?: unknown } | null)?.company_tags),
    [view.group],
  );
  const builtin = (key: string): string | undefined =>
    (e as Record<string, string>)[
      `cat${key.charAt(0).toUpperCase()}${key.slice(1)}`.replace('Repair', 'Repairs')
    ];
  const tagLabel = (key: string) => companyTagLabel(key, tags, builtin);

  const labels: CompanyExportLabels = {
    statement: e.myStatement,
    summary: e.summary,
    generatedOn: e.g_generatedOn,
    balance: e.balance,
    companyOwesAll: e.companyOwesAll,
    employeesOweAll: (amount) => fill(e.employeesOweAll, { amount }),
    companyOwesYou: e.companyOwesYou,
    youOweCompany: e.youOweCompany,
    settled: e.settled,
    totals: e.entries,
    byCategory: e.byCategory,
    employees: e.employees,
    entries: e.entries,
    pending: e.pending,
    brought: e.brought,
    colDate: e.g_colDate,
    colType: e.colType,
    colMember: e.g_colMember,
    colEmployeeId: e.employeeId,
    colPaidBy: e.paidBy,
    companyPayer: e.companyPayer,
    colStatus: e.g_colStatus,
    colAmount: e.g_colAmount,
    colBalance: e.g_colBalance,
    colNote: e.formNote,
    colReview: e.colReview,
    colVendor: e.vendor,
    colGstin: e.gstin,
    colInvoice: e.invoiceNo,
    colGst: e.gstAmount,
    detail: (entry, all) =>
      [
        entry.calcMode === 'distance_rate' && entry.distanceKm && entry.rateMinor !== null
          ? `${entry.distanceKm} km${entry.fromText || entry.toText ? ` (${entry.fromText ?? ''} - ${entry.toText ?? ''})` : ''}`
          : null,
        reimbursedOn(entry, all) ? fill(e.reimbursedOn, { date: reimbursedOn(entry, all) ?? '' }) : null,
      ]
        .filter(Boolean)
        .join('; '),
    none: e.none,
    footer: e.g_footer,
    kind: (entry: CompanyEntry) => {
      switch (entry.kind) {
        case 'expense':
          return entry.category ? tagLabel(entry.category) : e.catOther;
        case 'allowance':
          return e.bata;
        case 'advance':
          return e.kAdvance;
        case 'wages':
        case 'wage_payment':
          return e.kWages;
        case 'allocation':
          return e.kAllocation;
        case 'pool_return':
          return e.kPoolReturn;
        case 'pool_adjustment':
          return e.kPoolAdjustment;
        case 'pool_request':
          return e.askTitle;
        case 'reimbursement':
          return entry.direction === 'employee_to_company' ? e.kCashReturned : e.kReimbursement;
      }
    },
    category: tagLabel,
    status: (entry) =>
      entry.status === 'submitted' ? e.awaiting : entry.status === 'rejected' ? e.rejected : e.statusApproved,
    totalRows: (totals) => [
      [e.expenses, totals.expenses],
      [e.bata, totals.allowance],
      [e.advances, totals.advances],
      [e.wages, totals.wages],
      [e.paidOut, totals.paidOut],
      [e.returned, totals.returned],
      [e.gstTotal, totals.gst],
    ],
  };

  const run = () => {
    if (!view.me || !view.ready) return;
    setError(null);
    try {
      const { from, to } =
        period !== 'custom'
          ? periodRange(period, todayIso())
          : custom.from <= custom.to
            ? custom
            : { from: custom.to, to: custom.from };
      const periodLabel =
        period === 'month' ? e.periodMonth : period === 'last' ? e.periodLast : period === 'all' ? e.periodAll : `${from} - ${to}`;
      const day = todayIso();
      const entries = report === 'payments' ? view.entries.filter((x) => PAYMENT_KINDS.includes(x.kind)) : view.entries;
      const base = { entries, company: view.name, currency: view.currency, locale, from, to, generatedOn: day, periodLabel, labels };
      const nameOfId = (id: string) => memberName(view.members.find((m) => m.id === id), t.company.common.someone);
      const visible = (memberId: string) => view.isAdmin || memberId === view.me?.id;
      const companyModel = view.isAdmin
        ? buildCompanyExport({
            ...base,
            scope: 'admin',
            employeeIds: new Map(view.members.map((m) => [m.id, (m as { employee_id?: string | null }).employee_id])),
            names: new Map(view.members.map((m) => [m.id, nameOfId(m.id)])),
          })
        : buildCompanyExport({ ...base, scope: 'employee', memberId: view.me.id, employeeName: nameOfId(view.me.id) });

      let model = companyModel;
      if (report === 'payments') {
        const sec = companyModel.sections.find((x) => x.heading === e.entries);
        const drop = sec ? sec.columns.indexOf(e.g_colBalance) : -1;
        model = {
          ...companyModel,
          headline: [],
          title: `${e.exportPayments} · ${view.name}`,
          sections: sec
            ? [{ ...sec, columns: sec.columns.filter((_, i) => i !== drop), rows: sec.rows.map((r) => r.filter((_, i) => i !== drop)) }]
            : [],
        };
      } else if (report === 'attendance') {
        const marks = [...materialiseAttendance(mirror, NO_QUEUE, { groupId }).values()];
        model = buildAttendanceReport({
          marks: marks.filter((m) => visible(m.memberId)),
          from,
          to,
          company: view.name,
          generatedOn: day,
          locale,
          personName: nameOfId,
          labels: {
            title: e.attendanceTitle,
            date: e.workColDate,
            person: e.workPerson,
            status: e.workColStatus,
            note: e.formNote,
            present: e.attendancePresent,
            half: e.attendanceHalf,
            absent: e.attendanceAbsent,
          },
        });
      } else if (report === 'tasks') {
        const projects = materialiseCompanyProjects(mirror, NO_QUEUE, { groupId });
        model = buildWorkReport({
          report: 'list',
          tasks: materialiseWorkTasks(mirror, NO_QUEUE, { groupId }).filter((x) => visible(x.memberId)),
          from,
          to,
          today: day,
          company: view.name,
          generatedOn: day,
          locale,
          personName: nameOfId,
          siteName: (id) => projects.find((p) => p.id === id)?.name ?? '',
          labels: {
            titles: { list: e.exportTasks, person: e.workRepPerson, site: e.workRepSite, overdue: e.workRepOverdue },
            number: e.workColNumber,
            task: e.workColTitle,
            person: e.workPerson,
            site: e.workSite,
            date: e.workColDate,
            status: e.workColStatus,
            open: e.workColOpen,
            done: e.workDone,
            overdue: e.workOverdue,
            total: e.workColTotal,
            completion: e.workCompletion,
            daysLate: e.workDaysLate,
            noSite: e.workNoSite,
            statuses: { todo: e.workTodo, doing: e.workDoing, done: e.workDone, blocked: e.workBlocked },
          },
        });
      }
      if (format === 'pdf') printHtml(renderCompanyExportHtml(model, e.none));
      else {
        const slug = (view.name || 'company').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 40);
        downloadText(`waves-${slug}-${report}.csv`, buildCompanyExportCsv(model), 'text/csv');
      }
    } catch {
      setError(e.g_exportFailed);
    }
  };

  const reports: [Report, string][] = [
    ['summary', e.summary],
    ['attendance', e.attendanceTitle],
    ['payments', e.exportPayments],
    ['tasks', e.exportTasks],
  ];
  const ranges: [Range, string][] = [
    ['month', e.periodMonth],
    ['last', e.periodLast],
    ['custom', e.workCustom],
    ['all', e.periodAll],
  ];
  const choice = <T extends string>(items: [T, string][], value: T, set: (v: T) => void, name: string) => (
    <div role="radiogroup" aria-label={name} style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {items.map(([k, label]) => (
        <button key={k} type="button" role="radio" aria-checked={value === k} className={value === k ? 'btn brand' : 'btn soft'} onClick={() => set(k)}>
          {label}
        </button>
      ))}
    </div>
  );

  return (
    <CompanyPage groupId={groupId} title={e.workExport}>
      {!view.ready ? null : !view.me ? (
        <p className="muted">{e.noAccess}</p>
      ) : (
        <section className="panel">
          <p className="muted">{e.g_subtitle}</p>
          <p>
            <b>{view.name}</b> · {view.isAdmin ? e.summary : e.myStatement}
          </p>
          <span className="field-label">{e.workReportType}</span>
          {choice(reports, report, setReport, e.workReportType)}
          <span className="field-label">{e.g_formatLabel}</span>
          {choice<Format>([['pdf', e.print], ['csv', 'CSV']], format, setFormat, e.g_formatLabel)}
          {format === 'csv' ? <p className="faint">{e.csvNote}</p> : null}
          <span className="field-label">{e.workExportRange}</span>
          {choice(ranges, period, setPeriod, e.workExportRange)}
          {period === 'custom' ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <label className="field">
                <span className="field-label">{e.workFrom}</span>
                <input type="date" value={custom.from} onChange={(ev) => setCustom({ ...custom, from: ev.target.value })} />
              </label>
              <label className="field">
                <span className="field-label">{e.workTo}</span>
                <input type="date" value={custom.to} onChange={(ev) => setCustom({ ...custom, to: ev.target.value })} />
              </label>
            </div>
          ) : null}
          <p className="faint">{view.isAdmin ? e.privacyAdmin : e.privacyEmployee}</p>
          {error ? <p className="error" role="alert">{error}</p> : null}
          <button type="button" className="btn brand" onClick={run}>
            {format === 'pdf' ? e.print : e.download}
          </button>
        </section>
      )}
    </CompanyPage>
  );
}
