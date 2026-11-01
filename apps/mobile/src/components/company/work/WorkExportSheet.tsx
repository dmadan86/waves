/**
 * Team › Tasks › ⋮ › Export: a period, one of four reports and PDF or Excel, shared from the device.
 * Same pipeline as the company export (print, workbook, ad gate for Free). While the
 * `task_reports_pro` flag is on, reports 2-4 are Pro and send Free users to the plans.
 */
import { useState, type ComponentProps } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { decode } from 'base64-arraybuffer';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  useWindowDimensions,
  View,
} from 'react-native';
import { Button, iconSize, Sheet, Text, useTheme } from '@waves/ui';

import { SectionHeader } from '@/components/standard';
import { buildCompanyExportWorkbook, renderCompanyExportHtml } from '@/data/companyExport';
import {
  buildWorkReport,
  workRange,
  type WorkReport,
  type WorkReportLabels,
} from '@/data/companyWorkExport';
import type { MirrorWorkTask } from '@/data/companyWorkday';
import { workbookToBase64 } from '@/data/groupExportXlsx';
import { useStrings } from '@/i18n';
import { friendlyError } from '@/lib/errors';
import { useFlagEnabled } from '@/lib/flags';
import { router } from '@/lib/navigation';
import { printAvailable, printHtmlToFile } from '@/lib/print';
import { useAdGate } from '@/lib/useAdGate';
import { useEntitlement } from '@/lib/useEntitlement';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const XLSX_UTI = 'org.openxmlformats.spreadsheetml.sheet';
type Preset = 'week' | 'month' | 'custom';
type Format = 'pdf' | 'excel';
const REPORTS: readonly WorkReport[] = ['list', 'person', 'site', 'overdue'];
const REPORT_ICON: Record<WorkReport, ComponentProps<typeof Ionicons>['name']> = {
  list: 'list-outline',
  person: 'person-outline',
  site: 'location-outline',
  overdue: 'stats-chart-outline',
};

function localIso(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function WorkExportSheet({
  visible,
  onClose,
  tasks,
  today,
  company,
  personName,
  siteName,
}: {
  visible: boolean;
  onClose: () => void;
  /** What the viewer may already see. */
  tasks: readonly MirrorWorkTask[];
  today: string;
  company: string;
  personName: (memberId: string) => string;
  siteName: (projectId: string | null) => string;
}) {
  const theme = useTheme();
  const { height } = useWindowDimensions();
  const { t, locale } = useStrings();
  const c = t.company;
  const adGate = useAdGate();
  const { isPaid } = useEntitlement();
  const proReports = useFlagEnabled('task_reports_pro');
  const [preset, setPreset] = useState<Preset>('week');
  const [custom, setCustom] = useState({ from: today, to: today });
  const [picking, setPicking] = useState<'from' | 'to' | null>(null);
  const [report, setReport] = useState<WorkReport>('list');
  const [format, setFormat] = useState<Format>('pdf');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const names: Record<WorkReport, string> = {
    list: c.workRepList,
    person: c.workRepPerson,
    site: c.workRepSite,
    overdue: c.workRepOverdue,
  };
  const subs: Record<WorkReport, string> = {
    list: c.workRepListSub,
    person: c.workRepPersonSub,
    site: c.workRepSiteSub,
    overdue: c.workRepOverdueSub,
  };
  const locked = (r: WorkReport) => proReports && r !== 'list' && !isPaid;
  const picked = preset === 'custom' ? custom : workRange(preset, today);
  // A reversed custom range reads as the same days the other way round.
  const range = picked.from <= picked.to ? picked : { from: picked.to, to: picked.from };
  const labels: WorkReportLabels = {
    titles: names,
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
    statuses: { todo: c.workTodo, doing: c.workDoing, done: c.workDone, blocked: c.workBlocked },
  };
  const upgrade = () => {
    onClose();
    router.push('/settings/upgrade');
  };

  const run = async (): Promise<void> => {
    if (busy) return;
    if (locked(report)) return upgrade();
    setError(null);
    if (format === 'pdf' && !printAvailable()) return setError(t.groupExport.updateNeeded);
    setBusy(true);
    try {
      if (!(await adGate.requireAd('export_rewarded'))) return;
      const model = buildWorkReport({
        report,
        tasks,
        ...range,
        today,
        company,
        generatedOn: today,
        locale,
        personName,
        siteName,
        labels,
      });
      const slug = `waves-tasks-${report}`;
      if (format === 'pdf') {
        const uri = await printHtmlToFile(renderCompanyExportHtml(model, ''));
        if (!uri) return setError(t.groupExport.updateNeeded);
        const pdf = new FileSystem.File(uri);
        try {
          if (await Sharing.isAvailableAsync())
            await Sharing.shareAsync(uri, {
              mimeType: 'application/pdf',
              dialogTitle: t.groupExport.shareTitle,
              UTI: 'com.adobe.pdf',
            });
        } finally {
          try {
            if (pdf.exists) pdf.delete();
          } catch {
            // Best-effort privacy cleanup.
          }
        }
      } else {
        const bytes = new Uint8Array(decode(workbookToBase64(buildCompanyExportWorkbook(model))));
        const file = new FileSystem.File(FileSystem.Paths.cache, `${slug}.xlsx`);
        if (file.exists) file.delete();
        file.create();
        file.write(bytes);
        try {
          if (await Sharing.isAvailableAsync())
            await Sharing.shareAsync(file.uri, {
              mimeType: XLSX_MIME,
              dialogTitle: t.groupExport.shareTitle,
              UTI: XLSX_UTI,
            });
        } finally {
          try {
            if (file.exists) file.delete();
          } catch {
            // Best-effort privacy cleanup.
          }
        }
      }
      onClose();
    } catch (caught) {
      setError(friendlyError(caught, t.groupExport.exportFailed, 'workExport.run'));
    } finally {
      setBusy(false);
    }
  };

  // Selected = brand outline + soft fill; the check circle marks it.
  const selectable = (on: boolean, borderRadius: number) => ({
    borderRadius,
    borderWidth: on ? 1.5 : 1,
    borderColor: on ? theme.color.brand : theme.color.border,
    backgroundColor: on ? theme.color.brandSoft : theme.color.surface,
  });
  const check = <Ionicons name="checkmark-circle" size={iconSize.base} color={theme.color.brand} />;
  const heading = (icon: ComponentProps<typeof Ionicons>['name'], label: string) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs }}>
      <Ionicons name={icon} size={iconSize.base} color={theme.color.textMuted} />
      <Text variant="subheading">{label}</Text>
    </View>
  );
  const pill = (
    on: boolean,
    label: string,
    onPress: () => void,
    icon?: ComponentProps<typeof Ionicons>['name'],
    iconColor?: string,
  ) => (
    <Pressable
      key={label}
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={[
        selectable(on, theme.radius.pill),
        {
          flex: 1,
          height: 40,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
        },
      ]}
    >
      {on ? (
        check
      ) : icon ? (
        <Ionicons name={icon} size={iconSize.base} color={iconColor ?? theme.color.textMuted} />
      ) : null}
      <Text variant="caption" style={{ fontWeight: '700' }}>
        {label}
      </Text>
    </Pressable>
  );

  const dateRow = (which: 'from' | 'to') => (
    <Pressable
      accessibilityRole="button"
      onPress={() => setPicking(which)}
      style={{
        flex: 1,
        height: 44,
        borderRadius: theme.radius.lg,
        borderWidth: 1,
        borderColor: theme.color.border,
        backgroundColor: theme.color.surface,
        justifyContent: 'center',
        paddingHorizontal: theme.spacing.md,
      }}
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
    <>
      <Sheet visible={visible} onClose={onClose} closeLabel={t.common.close}>
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
        ) : (
          <ScrollView
            style={{ maxHeight: height * 0.8 }}
            contentContainerStyle={{ gap: theme.spacing.sm }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.color.brandSoft,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="download-outline" size={iconSize.lg} color={theme.color.brand} />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="heading">{c.workExport}</Text>
                <Text variant="caption" tone="muted">
                  {c.workExportSub}
                </Text>
              </View>
            </View>
            {heading('calendar-outline', c.workExportRange)}
            <View style={{ flexDirection: 'row', gap: theme.spacing.xs }}>
              {(
                [
                  ['week', c.workThisWeek],
                  ['month', c.workThisMonth],
                  ['custom', c.workCustom],
                ] as const
              ).map(([value, label]) => pill(preset === value, label, () => setPreset(value)))}
            </View>
            {preset === 'custom' ? (
              <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
                {dateRow('from')}
                {dateRow('to')}
              </View>
            ) : null}
            {heading('layers-outline', c.workReportType)}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }}>
              {REPORTS.map((r) => (
                <Pressable
                  key={r}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: report === r }}
                  onPress={() => (locked(r) ? upgrade() : setReport(r))}
                  style={[
                    selectable(report === r, theme.radius.md),
                    { width: '49%', flexGrow: 1, padding: theme.spacing.sm, gap: 2 },
                  ]}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Ionicons
                      name={REPORT_ICON[r]}
                      size={iconSize.base}
                      color={theme.color.brand}
                    />
                    <View style={{ flex: 1 }} />
                    {locked(r) ? (
                      <Text variant="micro" tone="brand" style={{ fontWeight: '700' }}>
                        {c.workProBadge}
                      </Text>
                    ) : report === r ? (
                      check
                    ) : null}
                  </View>
                  <Text variant="caption" style={{ fontWeight: '700' }}>
                    {names[r]}
                  </Text>
                  <Text variant="micro" tone="muted" numberOfLines={2}>
                    {subs[r]}
                  </Text>
                </Pressable>
              ))}
            </View>
            {heading('document-text-outline', c.workFileFormat)}
            <View style={{ flexDirection: 'row', gap: theme.spacing.xs }}>
              {pill(
                format === 'pdf',
                t.groupExport.pdf,
                () => setFormat('pdf'),
                'document-text-outline',
              )}
              {pill(
                format === 'excel',
                t.groupExport.excel,
                () => setFormat('excel'),
                'grid-outline',
                '#1D8A4B',
              )}
            </View>
            {error ? <Text tone="negative">{error}</Text> : null}
            <Button
              label={busy ? t.groupExport.preparing : c.workGenerate}
              variant="brand"
              disabled={busy}
              onPress={() => void run()}
              icon={
                busy ? (
                  <ActivityIndicator color={theme.color.onBrand} />
                ) : (
                  <Ionicons
                    name="download-outline"
                    size={iconSize.base}
                    color={theme.color.onBrand}
                  />
                )
              }
            />
          </ScrollView>
        )}
      </Sheet>
      {adGate.sheet}
    </>
  );
}
