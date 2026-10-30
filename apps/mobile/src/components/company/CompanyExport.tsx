/**
 * Company export: the employee's own statement, or the admin's summary, as a PDF
 * or an Excel file. Shown by the group export screen for a Company group, so the
 * same entry point, ad gate and share path serve both. What is exported is what
 * this viewer can already read: an employee only ever has their own entries, and
 * the builder filters to their member id again. No photos are ever included.
 */

import { useState } from 'react';
import { decode } from 'base64-arraybuffer';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { ActivityIndicator, ScrollView, View } from 'react-native';

import { reimbursedOn } from '@waves/core';
import { Button, Callout, Row, Screen, Text, useTheme } from '@waves/ui';

import { CompanyPeriodPills, kindLabel } from '@/components/company/CompanyStatementView';
import { PlainHeader, SectionHeader, SegmentedPills, StandardCard } from '@/components/standard';
import { useCompanyTags } from '@/data/companyTags';
import { useCompanyEntries } from '@/data/companyEntries';
import {
  buildCompanyExport,
  buildCompanyExportWorkbook,
  renderCompanyExportHtml,
  type CompanyExportLabels,
} from '@/data/companyExport';
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

export function CompanyExport({ groupId }: { groupId: string }) {
  const theme = useTheme();
  const clearance = useBottomClearance();
  const { t, locale } = useStrings();
  const adGate = useAdGate();
  const view = useCompanyEntries(groupId);
  const tagLabel = useCompanyTags(groupId, view).label;
  const [format, setFormat] = useState<Format>('pdf');
  const [period, setPeriod] = useState<CompanyPeriod>('month');
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
      const { from, to } = periodRange(period, todayIso());
      const periodLabel =
        period === 'month' ? c.periodMonth : period === 'last' ? c.periodLast : c.periodAll;
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
      const model = view.isAdmin
        ? buildCompanyExport({
            ...base,
            scope: 'admin',
            employeeIds: new Map(view.members.map((m) => [m.id, m.employee_id])),
            names: new Map(
              view.members.map((m) => [m.id, displayName(m, null, null, t.misc.someone)]),
            ),
          })
        : buildCompanyExport({
            ...base,
            scope: 'employee',
            memberId: view.me.id,
            employeeName: displayName(view.me, null, null, t.misc.someone),
          });
      const slug = (view.name || 'company')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, '-')
        .slice(0, 40);
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
        setDone(`waves-${slug}.pdf`);
      } else {
        const bytes = new Uint8Array(decode(workbookToBase64(buildCompanyExportWorkbook(model))));
        const filename = `waves-${slug}.xlsx`;
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

  return (
    <Screen>
      {adGate.sheet}
      <PlainHeader title={t.groupExport.title} />
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
        <StandardCard>
          <Text variant="subheading" numberOfLines={1}>
            {view.name}
          </Text>
          <Text variant="caption" tone="muted">
            {view.isAdmin ? c.summary : c.myStatement}
          </Text>
        </StandardCard>
        <View style={{ gap: theme.spacing.sm }}>
          <SectionHeader title={t.groupExport.formatLabel} />
          <Row style={{ gap: theme.spacing.sm }}>
            <SegmentedPills
              options={[
                { value: 'pdf' as Format, label: t.groupExport.pdf },
                { value: 'excel' as Format, label: t.groupExport.excel },
              ]}
              value={format}
              onChange={setFormat}
            />
          </Row>
        </View>
        <CompanyPeriodPills value={period} onChange={setPeriod} />
        <Text variant="micro" tone="muted">
          {view.isAdmin ? c.privacyAdmin : c.privacyEmployee}
        </Text>
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
          icon={busy ? <ActivityIndicator color={theme.color.onBrand} /> : undefined}
        />
      </View>
    </Screen>
  );
}
