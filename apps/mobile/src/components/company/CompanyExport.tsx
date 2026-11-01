/**
 * Company export: the employee's own statement, or the admin's summary, as a PDF
 * or an Excel file. Shown by the group export screen for a Company group, so the
 * same entry point, ad gate and share path serve both. What is exported is what
 * this viewer can already read: an employee only ever has their own entries, and
 * the builder filters to their member id again. No photos are ever included.
 */

import { useState, type ComponentProps } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { decode } from 'base64-arraybuffer';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { ActivityIndicator, Platform, Pressable, ScrollView, View } from 'react-native';

import { reimbursedOn } from '@waves/core';
import { Button, Callout, iconSize, Screen, Sheet, Text, useTheme } from '@waves/ui';

import { kindLabel } from '@/components/company/CompanyStatementView';
import { PlainHeader, SectionHeader, StandardCard } from '@/components/standard';
import { useCompanyTags } from '@/data/companyTags';
import { useCompanyEntries, useCompanyProjects } from '@/data/companyEntries';
import {
  buildCompanyExport,
  buildCompanyExportWorkbook,
  renderCompanyExportHtml,
  type CompanyExportLabels,
} from '@/data/companyExport';
import { buildAttendanceReport, buildWorkReport } from '@/data/companyWorkExport';
import { useAttendance, useWorkTasks } from '@/data/companyWorkday';
import { workbookToBase64 } from '@/data/groupExportXlsx';
import { todayIso } from '@/data/personal';
import { displayName } from '@/data/types';
import { fill, useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';
import { periodRange, type CompanyPeriod } from '@/lib/companyPeriod';
import { friendlyError } from '@/lib/errors';
import { printAvailable, printHtmlToFile } from '@/lib/print';
import { useAdGate } from '@/lib/useAdGate';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const XLSX_UTI = 'org.openxmlformats.spreadsheetml.sheet';

type Format = 'pdf' | 'excel';
type Report = 'summary' | 'attendance' | 'payments' | 'tasks';
type Range = CompanyPeriod | 'custom';
type IconName = ComponentProps<typeof Ionicons>['name'];

const REPORT_ICON: Record<Report, IconName> = {
  summary: 'stats-chart',
  attendance: 'people-outline',
  payments: 'wallet-outline',
  tasks: 'clipboard-outline',
};
const PAYMENT_KINDS = ['advance', 'wages', 'wage_payment', 'reimbursement'];

function localIso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function CompanyExport({ groupId }: { groupId: string }) {
  const theme = useTheme();
  const clearance = useBottomClearance();
  const { t, locale } = useStrings();
  const adGate = useAdGate();
  const view = useCompanyEntries(groupId);
  const tagLabel = useCompanyTags(groupId, view).label;
  const [format, setFormat] = useState<Format>('pdf');
  const projects = useCompanyProjects(groupId);
  const marks = useAttendance(groupId);
  const tasks = useWorkTasks(groupId);
  const [report, setReport] = useState<Report>('summary');
  const [period, setPeriod] = useState<Range>('month');
  const [custom, setCustom] = useState(() => ({ from: todayIso(), to: todayIso() }));
  const [picking, setPicking] = useState<'from' | 'to' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const c = t.company;
  const labels: CompanyExportLabels = {
    statement: c.myStatement,
    summary: c.summary,
    generatedOn: t.groupExport.generatedOn,
    balance: c.balance,
    companyOwesAll: c.companyOwesAll,
    employeesOweAll: (amount) => fill(c.employeesOweAll, { amount }),
    companyOwesYou: c.companyOwesYou,
    youOweCompany: c.youOweCompany,
    settled: c.settled,
    totals: c.entries,
    byCategory: c.byCategory,
    employees: c.employees,
    entries: c.entries,
    pending: c.pending,
    brought: c.brought,
    colDate: t.groupExport.colDate,
    colType: c.colType,
    colMember: t.groupExport.colMember,
    colEmployeeId: c.employeeId,
    colPaidBy: c.paidBy,
    companyPayer: c.companyPayer,
    colStatus: t.groupExport.colStatus,
    colAmount: t.groupExport.colAmount,
    colBalance: t.groupExport.colBalance,
    colNote: c.formNote,
    colReview: c.colReview,
    colVendor: c.vendor,
    colGstin: c.gstin,
    colInvoice: c.invoiceNo,
    colGst: c.gstAmount,
    detail: (entry, all) =>
      [
        entry.calcMode === 'distance_rate' && entry.distanceKm && entry.rateMinor !== null
          ? `${entry.distanceKm} km${entry.fromText || entry.toText ? ` (${entry.fromText ?? ''} - ${entry.toText ?? ''})` : ''}`
          : null,
        reimbursedOn(entry, all)
          ? fill(c.reimbursedOn, { date: reimbursedOn(entry, all) ?? '' })
          : null,
      ]
        .filter(Boolean)
        .join('; '),
    none: c.none,
    footer: t.groupExport.footer,
    kind: (entry) => kindLabel(t, entry, tagLabel),
    category: tagLabel,
    status: (entry) =>
      entry.status === 'submitted'
        ? c.awaiting
        : entry.status === 'rejected'
          ? c.rejected
          : c.statusApproved,
    totalRows: (totals) => [
      [c.expenses, totals.expenses],
      [c.bata, totals.allowance],
      [c.advances, totals.advances],
      [c.wages, totals.wages],
      [c.paidOut, totals.paidOut],
      [c.returned, totals.returned],
      [c.gstTotal, totals.gst],
    ],
  };

  const run = async (): Promise<void> => {
    if (!view.me || !view.ready) return;
    setBusy(true);
    setError(null);
    setDone(null);
    if (format === 'pdf' && !printAvailable()) {
      setError(t.groupExport.updateNeeded);
      setBusy(false);
      return;
    }
    try {
      if (!(await adGate.requireAd('export_rewarded'))) return;
      // A reversed custom range reads as the same days the other way round.
      const { from, to } =
        period !== 'custom'
          ? periodRange(period, todayIso())
          : custom.from <= custom.to
            ? custom
            : { from: custom.to, to: custom.from };
      const periodLabel =
        period === 'month'
          ? c.periodMonth
          : period === 'last'
            ? c.periodLast
            : period === 'all'
              ? c.periodAll
              : `${from} - ${to}`;
      const base = {
        entries: view.entries,
        company: view.name,
        currency: view.currency,
        locale,
        from,
        to,
        generatedOn: new Date().toISOString().slice(0, 10),
        periodLabel,
        labels,
      };
      const personName = (memberId: string) => {
        const m = view.members.find((member) => member.id === memberId);
        return m ? displayName(m, null, null, t.misc.someone) : '';
      };
      // The server already limits what an owner or manager can read, so former employees stay in history.
      const visible = (memberId: string) => view.isAdmin || memberId === view.me?.id;
      const slug = (view.name || 'company')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, '-')
        .slice(0, 40);
      const day = base.generatedOn;
      const companyModel = view.isAdmin
        ? buildCompanyExport({
            ...base,
            entries:
              report === 'payments'
                ? view.entries.filter((e) => PAYMENT_KINDS.includes(e.kind))
                : view.entries,
            scope: 'admin',
            employeeIds: new Map(view.members.map((m) => [m.id, m.employee_id])),
            names: new Map(
              view.members.map((m) => [m.id, displayName(m, null, null, t.misc.someone)]),
            ),
          })
        : buildCompanyExport({
            ...base,
            entries:
              report === 'payments'
                ? view.entries.filter((e) => PAYMENT_KINDS.includes(e.kind))
                : view.entries,
            scope: 'employee',
            memberId: view.me.id,
            employeeName: displayName(view.me, null, null, t.misc.someone),
          });
      // Only the entries list: balances over some kinds alone would mislead.
      const paymentsModel = (m: typeof companyModel) => {
        const sec = m.sections.find((x) => x.heading === c.entries);
        const drop = sec ? sec.columns.indexOf(t.groupExport.colBalance) : -1;
        return {
          ...m,
          headline: [],
          title: `${c.exportPayments} · ${view.name}`,
          sections: sec
            ? [
                {
                  ...sec,
                  columns: sec.columns.filter((_, i) => i !== drop),
                  rows: sec.rows.map((row) => row.filter((_, i) => i !== drop)),
                },
              ]
            : [],
        };
      };
      const model =
        report === 'payments'
          ? paymentsModel(companyModel)
          : report === 'attendance'
            ? buildAttendanceReport({
                marks: [...marks.values()].filter((m) => visible(m.memberId)),
                from,
                to,
                company: view.name,
                generatedOn: day,
                locale,
                personName,
                labels: {
                  title: c.attendanceTitle,
                  date: c.workColDate,
                  person: c.workPerson,
                  status: c.workColStatus,
                  note: c.formNote,
                  present: c.attendancePresent,
                  half: c.attendanceHalf,
                  absent: c.attendanceAbsent,
                },
              })
            : report === 'tasks'
              ? buildWorkReport({
                  report: 'list',
                  tasks: tasks.filter((task) => visible(task.memberId)),
                  from,
                  to,
                  today: todayIso(),
                  company: view.name,
                  generatedOn: day,
                  locale,
                  personName,
                  siteName: (id) => projects.find((project) => project.id === id)?.name ?? '',
                  labels: {
                    titles: {
                      list: c.exportTasks,
                      person: c.workRepPerson,
                      site: c.workRepSite,
                      overdue: c.workRepOverdue,
                    },
                    number: c.workColNumber,
                    task: c.workColTitle,
                    person: c.workPerson,
                    site: c.workSite,
                    date: c.workColDate,
                    status: c.workColStatus,
                    open: c.workColOpen,
                    done: c.workDone,
                    overdue: c.workOverdue,
                    total: c.workColTotal,
                    completion: c.workCompletion,
                    daysLate: c.workDaysLate,
                    noSite: c.workNoSite,
                    statuses: {
                      todo: c.workTodo,
                      doing: c.workDoing,
                      done: c.workDone,
                      blocked: c.workBlocked,
                    },
                  },
                })
              : companyModel;
      if (format === 'pdf') {
        const uri = await printHtmlToFile(renderCompanyExportHtml(model, c.none));
        if (!uri) {
          setError(t.groupExport.updateNeeded);
          return;
        }
        const pdf = new FileSystem.File(uri);
        try {
          if (await Sharing.isAvailableAsync()) {
            await Sharing.shareAsync(uri, {
              mimeType: 'application/pdf',
              dialogTitle: t.groupExport.shareTitle,
              UTI: 'com.adobe.pdf',
            });
          }
        } finally {
          try {
            if (pdf.exists) pdf.delete();
          } catch {
            // Best-effort privacy cleanup.
          }
        }
        setDone(`waves-${slug}-${report}.pdf`);
      } else {
        const bytes = new Uint8Array(decode(workbookToBase64(buildCompanyExportWorkbook(model))));
        const filename = `waves-${slug}-${report}.xlsx`;
        const file = new FileSystem.File(FileSystem.Paths.cache, filename);
        if (file.exists) file.delete();
        file.create();
        file.write(bytes);
        try {
          if (await Sharing.isAvailableAsync()) {
            await Sharing.shareAsync(file.uri, {
              mimeType: XLSX_MIME,
              dialogTitle: t.groupExport.shareTitle,
              UTI: XLSX_UTI,
            });
          }
        } finally {
          try {
            if (file.exists) file.delete();
          } catch {
            // Best-effort privacy cleanup.
          }
        }
        setDone(filename);
      }
    } catch (caught) {
      setError(friendlyError(caught, t.groupExport.exportFailed, 'companyExport.run'));
    } finally {
      setBusy(false);
    }
  };

  const names: Record<Report, string> = {
    summary: c.summary,
    attendance: c.attendanceTitle,
    payments: c.exportPayments,
    tasks: c.exportTasks,
  };
  const selectable = (on: boolean, borderRadius: number) => ({
    borderRadius,
    borderWidth: on ? 1.5 : 1,
    borderColor: on ? theme.color.brand : theme.color.border,
    backgroundColor: on ? theme.color.brandSoft : theme.color.surface,
  });
  const tile = (on: boolean) => ({ ...selectable(on, theme.radius.lg), padding: theme.spacing.sm });
  const iconBox = (name: IconName) => (
    <View
      style={{
        width: 40,
        height: 40,
        borderRadius: theme.radius.md,
        backgroundColor: theme.color.brandSoft,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Ionicons name={name} size={iconSize.lg} color={theme.color.brand} />
    </View>
  );
  const ranges: [Range, string, IconName | null][] = [
    ['month', c.periodMonth, 'calendar-outline'],
    ['last', c.periodLast, null],
    ['custom', c.workCustom, 'calendar-outline'],
    ['all', c.periodAll, 'infinite-outline'],
  ];
  const dateRow = (which: 'from' | 'to') => (
    <Pressable
      accessibilityRole="button"
      onPress={() => setPicking(which)}
      style={{ flex: 1, ...tile(false), paddingVertical: theme.spacing.xs }}
    >
      <Text variant="caption" tone="muted">
        {which === 'from' ? c.workFrom : c.workTo}
      </Text>
      <Text variant="caption" style={{ fontWeight: '700' }}>
        {custom[which]}
      </Text>
    </Pressable>
  );

  return (
    <Screen>
      {adGate.sheet}
      <PlainHeader title={c.workExport} />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingTop: theme.spacing.sm,
          paddingBottom: theme.spacing.lg,
          gap: theme.spacing.md,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Text variant="caption" tone="muted">
          {t.groupExport.subtitle}
        </Text>
        <StandardCard style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
          {iconBox('business-outline')}
          <View style={{ flex: 1 }}>
            <Text variant="subheading" numberOfLines={1}>
              {view.name}
            </Text>
            <Text variant="caption" tone="muted">
              {view.isAdmin ? c.summary : c.myStatement}
            </Text>
          </View>
        </StandardCard>
        <View style={{ gap: theme.spacing.sm }}>
          <SectionHeader title={c.workReportType} />
          <View style={{ flexDirection: 'row', gap: theme.spacing.xs }}>
            {(Object.keys(names) as Report[]).map((key) => (
              <Pressable
                key={key}
                accessibilityRole="radio"
                accessibilityState={{ selected: report === key }}
                onPress={() => setReport(key)}
                style={{
                  flex: 1,
                  alignItems: 'center',
                  gap: theme.spacing.xs,
                  ...tile(report === key),
                }}
              >
                <Ionicons
                  name={REPORT_ICON[key]}
                  size={iconSize.lg}
                  color={report === key ? theme.color.brand : theme.color.textMuted}
                />
                <Text
                  variant="micro"
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  style={{ fontWeight: report === key ? '700' : '500' }}
                >
                  {names[key]}
                </Text>
                {report === key ? (
                  <Ionicons
                    name="checkmark-circle"
                    size={iconSize.base}
                    color={theme.color.brand}
                    style={{ position: 'absolute', top: 4, right: 4 }}
                  />
                ) : null}
              </Pressable>
            ))}
          </View>
        </View>
        <View style={{ gap: theme.spacing.sm }}>
          <SectionHeader title={t.groupExport.formatLabel} />
          <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
            {(
              [
                ['pdf', t.groupExport.pdf, t.groupExport.pdfHint, 'document-text-outline'],
                ['excel', t.groupExport.excel, t.groupExport.excelHint, 'grid-outline'],
              ] as const
            ).map(([key, label, hint, icon]) => (
              <Pressable
                key={key}
                accessibilityRole="radio"
                accessibilityState={{ selected: format === key }}
                onPress={() => setFormat(key)}
                style={{
                  flex: 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.spacing.sm,
                  ...tile(format === key),
                }}
              >
                {iconBox(icon)}
                <View style={{ flex: 1 }}>
                  <Text variant="caption" style={{ fontWeight: '700' }}>
                    {label}
                  </Text>
                  <Text variant="micro" tone="muted" numberOfLines={2}>
                    {hint}
                  </Text>
                </View>
                <Ionicons
                  name={format === key ? 'radio-button-on' : 'radio-button-off'}
                  size={iconSize.lg}
                  color={format === key ? theme.color.brand : theme.color.textFaint}
                />
              </Pressable>
            ))}
          </View>
        </View>
        <View style={{ gap: theme.spacing.sm }}>
          <SectionHeader title={c.workExportRange} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }}>
            {ranges.map(([key, label, icon]) => {
              const on = period === key;
              const ink = on ? theme.color.onBrand : theme.color.text;
              return (
                <Pressable
                  key={key}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  onPress={() => setPeriod(key)}
                  style={{
                    height: 36,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.spacing.xs,
                    paddingHorizontal: theme.spacing.md,
                    borderRadius: theme.radius.pill,
                    borderWidth: 1,
                    borderColor: on ? theme.color.brand : theme.color.border,
                    backgroundColor: on ? theme.color.brand : theme.color.surface,
                  }}
                >
                  {icon ? <Ionicons name={icon} size={iconSize.sm} color={ink} /> : null}
                  <Text variant="caption" style={{ color: ink, fontWeight: '600' }}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {period === 'custom' ? (
            <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
              {dateRow('from')}
              {dateRow('to')}
            </View>
          ) : null}
        </View>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.sm,
            padding: theme.spacing.sm,
            borderRadius: theme.radius.md,
            backgroundColor: theme.color.brandSoft,
          }}
        >
          <Ionicons
            name="information-circle-outline"
            size={iconSize.base}
            color={theme.color.textMuted}
          />
          <Text variant="caption" tone="muted" style={{ flex: 1 }}>
            {view.isAdmin ? c.privacyAdmin : c.privacyEmployee}
          </Text>
        </View>
        {done ? (
          <StandardCard>
            <Text variant="subheading" tone="positive">
              {t.groupExport.ready}
            </Text>
            <Text variant="caption" tone="muted">
              {done}
            </Text>
          </StandardCard>
        ) : null}
        {error ? <Callout tone="negative">{error}</Callout> : null}
      </ScrollView>
      <View
        style={{
          paddingHorizontal: theme.spacing.lg,
          paddingTop: theme.spacing.sm,
          paddingBottom: clearance,
          borderTopWidth: 1,
          borderTopColor: theme.color.border,
          backgroundColor: theme.color.surface,
        }}
      >
        <Button
          label={busy ? t.groupExport.preparing : t.groupExport.generate}
          variant="brand"
          fullWidth
          disabled={busy || !view.ready || !view.me}
          onPress={() => void run()}
          icon={
            busy ? (
              <ActivityIndicator color={theme.color.onBrand} />
            ) : (
              <Ionicons name="download-outline" size={iconSize.lg} color={theme.color.onBrand} />
            )
          }
        />
      </View>
      <Sheet
        visible={picking !== null}
        onClose={() => setPicking(null)}
        closeLabel={t.common.close}
      >
        {picking ? (
          <View style={{ gap: theme.spacing.md }}>
            <SectionHeader title={picking === 'from' ? c.workFrom : c.workTo} />
            <DateTimePicker
              value={new Date(`${custom[picking]}T12:00:00`)}
              mode="date"
              onChange={(event, chosen) => {
                if (Platform.OS !== 'ios') setPicking(null);
                if (event.type === 'set' && chosen)
                  setCustom((prev) => ({ ...prev, [picking]: localIso(chosen) }));
              }}
            />
            {Platform.OS === 'ios' ? (
              <Button label={t.common.done} onPress={() => setPicking(null)} />
            ) : null}
          </View>
        ) : null}
      </Sheet>
    </Screen>
  );
}
