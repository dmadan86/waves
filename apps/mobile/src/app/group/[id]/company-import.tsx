/**
 * Import a company's employees, clients or vendors: one screen, steps in place.
 *
 * What -> Source (file, phone contacts, Google Sheet link) -> Columns (not for
 * contacts) -> Preview -> Result. A source only has to produce rows of text; the
 * matching, checking and de-duplicating are pure (`@waves/core` companyImport),
 * and the write goes through the same mutations as the add screens, into the
 * sync queue, with ids derived from the person so a second run adds nobody twice.
 */

import { useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native';

import {
  buildImportRows,
  countRows,
  ENTITY_FIELDS,
  matchColumns,
  MAX_IMPORT_BYTES,
  templateCsv,
  toCsv,
  type ColumnMapping,
  type ImportEntity,
  type ImportFieldKey,
  type ImportRow,
  type TableRead,
} from '@waves/core';
import { Screen, Text, useTheme } from '@waves/ui';

import { SaveButton } from '@/components/company/EntryForm';
import { ListRow, RowTile, ScenicBody, ScenicHeader, StandardCard } from '@/components/standard';
import { useCompanyClients } from '@/data/companyClients';
import { useDepartments } from '@/data/companyDepartments';
import { useCompanyImportWriter } from '@/data/companyImport';
import { useCompanyEntries } from '@/data/companyEntries';
import { useCompanyVendors } from '@/data/companyVendors';
import { fill, useStrings } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { requestContacts } from '@/lib/contactPickerBridge';
import { fetchSheetTable, SheetError } from '@/lib/companyImport/sheet';
import { GroupImportFileError, IMPORT_PICKER_TYPES, tableFromBytes } from '@/lib/groupImport/file';
import { useGuestGuard } from '@/lib/guestGuard';
import { router } from '@/lib/navigation';
import { regionDialCode } from '@/lib/phone';
import { useToast } from '@/lib/toast';

type Step = 'what' | 'source' | 'columns' | 'preview' | 'done';

const nextFrame = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => resolve()));

export default function CompanyImportScreen() {
  const theme = useTheme();
  const { t } = useStrings();
  const g = t.companyImport;
  const toast = useToast();
  const guard = useGuestGuard();
  const { profile } = useAuth();
  const { id, entity: entityParam } = useLocalSearchParams<{ id: string; entity?: string }>();
  const groupId = id ?? '';
  const view = useCompanyEntries(groupId);
  const clients = useCompanyClients(groupId);
  const vendors = useCompanyVendors(groupId);
  const departments = useDepartments(groupId);
  const write = useCompanyImportWriter(groupId, {
    owner: view.isOwner,
    myMemberId: view.me?.id ?? null,
  });

  const preset =
    entityParam === 'employee' || entityParam === 'client' || entityParam === 'vendor'
      ? entityParam
      : null;
  const [step, setStep] = useState<Step>(preset ? 'source' : 'what');
  const [entity, setEntity] = useState<ImportEntity>(preset ?? 'employee');
  const [table, setTable] = useState<TableRead | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [sheetLink, setSheetLink] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [failedLines, setFailedLines] = useState<ReadonlySet<number>>(new Set());

  const allowed = view.isAdmin && !view.suspended;
  const fields = ENTITY_FIELDS[entity].filter(
    // Managers and rates are owner actions; a manager's import has no use for them.
    (f) => view.isOwner || (f !== 'manager' && f !== 'dailyRate'),
  );
  const label: Record<ImportFieldKey, string> = {
    name: g.fName,
    phone: g.fPhone,
    employeeId: g.fEmployeeId,
    department: g.fDepartment,
    manager: g.fManager,
    joinedOn: g.fJoinedOn,
    dailyRate: g.fDailyRate,
    need: g.fNeed,
    source: g.fSource,
    address: g.fAddress,
    expectedValue: g.fExpectedValue,
    stage: g.fStage,
    category: g.fCategory,
    openingBalance: g.fOpeningBalance,
  };

  const rows = useMemo<ImportRow[]>(() => {
    if (!table || mapping.name === undefined) return [];
    const live = view.members.filter((m) => !m.left_at);
    const nameOf = (m: (typeof live)[number]): string =>
      m.profile?.display_name ?? m.ghost_name ?? '';
    const existing =
      entity === 'employee'
        ? live.map((m) => ({ name: nameOf(m), phone: m.invite_phone ?? null }))
        : entity === 'client'
          ? clients.clients.map((c) => ({ name: c.name, phone: c.phone }))
          : vendors.vendors.map((v) => ({ name: v.name, phone: v.phone }));
    return buildImportRows(table.rows.slice(1), table.lines.slice(1), mapping, {
      entity,
      groupId,
      currency: view.currency as 'INR',
      dialCode: regionDialCode(profile?.country_code) ?? '+91',
      existing: existing.filter((e) => e.name),
      existingEmployeeIds: live.flatMap((m) => (m.employee_id ? [m.employee_id] : [])),
      departments,
      people: live.map((m) => ({ id: m.id, name: nameOf(m) })).filter((p) => p.name),
    });
  }, [
    table,
    mapping,
    entity,
    groupId,
    view.members,
    view.currency,
    clients.clients,
    vendors.vendors,
    departments,
    profile?.country_code,
  ]);
  const counts = countRows(rows);
  const warned = rows.filter((r) => r.status === 'new' && r.warnings.length > 0).length;

  const problemText = (r: ImportRow): string => {
    if (failedLines.has(r.line)) return g.pFailed;
    switch (r.problem) {
      case 'name_missing':
        return g.pName;
      case 'phone_invalid':
        return g.pPhone;
      case 'date_invalid':
        return g.pDate;
      case 'amount_invalid':
        return g.pAmount;
      case 'amount_negative':
        return g.pNegative;
      case 'duplicate_in_file':
        return g.pDupFile;
      default:
        return g.pDupExisting;
    }
  };

  // ── sources ────────────────────────────────────────────────────────────────

  const loaded = (next: TableRead): void => {
    if (next.rows.length < 2) {
      setMessage(g.noRows);
      return;
    }
    const matched = matchColumns(next.rows[0] ?? [], entity);
    setTable(next);
    setMapping(matched);
    setMessage(null);
    setStep('columns');
  };

  const fileMessage = (failure: string): string =>
    failure === 'too_large'
      ? g.fileTooLarge
      : failure === 'too_many_rows'
        ? g.fileTooMany
        : failure === 'empty'
          ? g.fileEmpty
          : failure === 'encoding'
            ? g.fileEncoding
            : g.fileUnreadable;

  const pickFile = async (): Promise<void> => {
    if (guard.blockWrite()) return;
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: IMPORT_PICKER_TYPES,
        copyToCacheDirectory: true,
      });
      const asset = picked.canceled ? null : picked.assets[0];
      if (!asset) return;
      setBusy(true);
      await nextFrame();
      if (asset.size !== undefined && asset.size > MAX_IMPORT_BYTES) {
        setMessage(g.fileTooLarge);
        return;
      }
      const file = new FileSystem.File(asset.uri);
      const bytes = await file.bytes();
      try {
        if (file.exists) file.delete();
      } catch {
        // Best-effort privacy cleanup; the bytes are already in memory.
      }
      loaded(tableFromBytes(bytes, asset.name, asset.mimeType).table);
    } catch (caught) {
      setMessage(
        fileMessage(caught instanceof GroupImportFileError ? caught.failure : 'unreadable'),
      );
    } finally {
      setBusy(false);
    }
  };

  const readSheet = async (): Promise<void> => {
    if (guard.blockWrite()) return;
    setBusy(true);
    setMessage(null);
    try {
      loaded(await fetchSheetTable(sheetLink));
    } catch (caught) {
      const failure = caught instanceof SheetError ? caught.failure : 'network';
      setMessage(
        failure === 'bad_link'
          ? g.sheetBad
          : failure === 'private'
            ? g.sheetPrivate
            : failure === 'too_large'
              ? g.sheetTooBig
              : failure === 'network'
                ? g.sheetNetwork
                : fileMessage(failure),
      );
    } finally {
      setBusy(false);
    }
  };

  const pickContacts = (): void => {
    if (guard.blockWrite()) return;
    requestContacts({
      initial: [],
      onPicked: (people) => {
        if (people.length === 0) return;
        const next: TableRead = {
          rows: [['Name', 'Phone'], ...people.map((p) => [p.name, p.phone ?? ''])],
          lines: [1, ...people.map((_, i) => i + 2)],
          delimiter: ',',
        };
        setTable(next);
        setMapping(matchColumns(next.rows[0] ?? [], entity));
        setMessage(null);
        setStep('preview');
      },
    });
    router.push('/contact-picker');
  };

  const shareCsv = async (name: string, text: string): Promise<void> => {
    try {
      // A BOM, so Excel opens a name in Tamil or Arabic as itself.
      const file = new FileSystem.File(FileSystem.Paths.cache, name);
      if (file.exists) file.delete();
      file.create();
      file.write(`﻿${text}`);
      try {
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(file.uri, {
            mimeType: 'text/csv',
            UTI: 'public.comma-separated-values-text',
          });
        }
      } finally {
        try {
          if (file.exists) file.delete();
        } catch {
          // Best-effort cleanup.
        }
      }
    } catch {
      toast.show(g.templateFailed, 'negative');
    }
  };

  // ── writing ────────────────────────────────────────────────────────────────

  const run = async (): Promise<void> => {
    if (busy || guard.blockWrite()) return;
    setBusy(true);
    setProgress(0);
    const todo = rows.filter((r) => r.status === 'new');
    const failed = new Set<number>();
    for (let i = 0; i < todo.length; i += 1) {
      const row = todo[i]!;
      try {
        await write(entity, row);
      } catch {
        failed.add(row.line);
      }
      setProgress(i + 1);
      if (i % 20 === 19) await nextFrame();
    }
    setFailedLines(failed);
    setBusy(false);
    setStep('done');
  };

  const errorRows = rows.filter((r) => r.status === 'error' || failedLines.has(r.line));
  const downloadErrors = (): void => {
    const header = table?.rows[0] ?? [];
    void shareCsv(
      'waves-import-errors.csv',
      toCsv([
        [g.errCsvRow, g.errCsvProblem, ...header],
        ...errorRows.map((r) => [String(r.line), problemText(r), ...r.cells]),
      ]),
    );
  };

  // ── view ───────────────────────────────────────────────────────────────────

  const back = (): void => {
    if (busy) return;
    setMessage(null);
    if (step === 'what' || (step === 'source' && preset)) router.back();
    else if (step === 'source') setStep('what');
    else if (step === 'columns') setStep('source');
    else if (step === 'preview') setStep(mappingFromContacts ? 'source' : 'columns');
    else router.back();
  };
  const mappingFromContacts = table?.rows[0]?.join() === 'Name,Phone';

  const entityName = { employee: g.employees, client: g.clients, vendor: g.vendors }[entity];

  if (!allowed && view.ready) {
    return (
      <Screen edges={[]}>
        <ScenicHeader
          title={g.title}
          circleBack
          wash
          titleAlign="start"
          onBack={() => router.back()}
        />
        <ScenicBody>
          <Text tone="muted">{g.noAccess}</Text>
        </ScenicBody>
      </Screen>
    );
  }

  return (
    <Screen edges={[]}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: theme.spacing.lg }}
      >
        <ScenicHeader
          title={g.title}
          subtitle={step === 'what' ? undefined : entityName}
          titleAlign="start"
          circleBack
          wash
          onBack={back}
        />
        <ScenicBody>
          {step === 'what' ? (
            <>
              <Text style={{ fontWeight: '700' }}>{g.whatTitle}</Text>
              <StandardCard>
                <Row
                  icon="people-outline"
                  title={g.employees}
                  subtitle={g.employeesSub}
                  onPress={() => {
                    setEntity('employee');
                    setStep('source');
                  }}
                />
                <Row
                  icon="briefcase-outline"
                  title={g.clients}
                  subtitle={g.clientsSub}
                  onPress={() => {
                    setEntity('client');
                    setStep('source');
                  }}
                />
                <Row
                  icon="storefront-outline"
                  title={g.vendors}
                  subtitle={g.vendorsSub}
                  last
                  onPress={() => {
                    setEntity('vendor');
                    setStep('source');
                  }}
                />
              </StandardCard>
            </>
          ) : null}

          {step === 'source' ? (
            <>
              <Text style={{ fontWeight: '700' }}>{g.sourceTitle}</Text>
              <StandardCard>
                <Row
                  icon="document-text-outline"
                  title={g.srcFile}
                  subtitle={g.srcFileSub}
                  onPress={() => void pickFile()}
                />
                <Row
                  icon="call-outline"
                  title={g.srcContacts}
                  subtitle={g.srcContactsSub}
                  onPress={pickContacts}
                />
                <Row
                  icon="grid-outline"
                  title={g.srcSheet}
                  subtitle={g.srcSheetSub}
                  last
                  onPress={() => setSheetOpen(!sheetOpen)}
                />
              </StandardCard>
              {sheetOpen ? (
                <StandardCard>
                  <TextInput
                    value={sheetLink}
                    onChangeText={setSheetLink}
                    placeholder={g.sheetPlaceholder}
                    placeholderTextColor={theme.color.textFaint}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    maxLength={300}
                    style={{ color: theme.color.text, fontSize: 16, minHeight: 44 }}
                  />
                </StandardCard>
              ) : null}
              <Pressable
                accessibilityRole="button"
                onPress={() => void shareCsv(`waves-${entity}-template.csv`, templateCsv(entity))}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.spacing.sm,
                  minHeight: 44,
                }}
              >
                <Ionicons name="download-outline" size={18} color={theme.color.brand} />
                <Text style={{ color: theme.color.brand, fontWeight: '600' }}>{g.template}</Text>
              </Pressable>
            </>
          ) : null}

          {step === 'columns' ? (
            <>
              <Text style={{ fontWeight: '700' }}>{g.columnsTitle}</Text>
              <Text variant="caption" tone="muted">
                {g.columnsHint}
              </Text>
              {fields.map((field) => (
                <View key={field} style={{ gap: theme.spacing.xs }}>
                  <Text variant="caption" tone="muted">
                    {label[field]}
                    {field === 'name' ? ' *' : ''}
                  </Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ gap: theme.spacing.sm }}
                  >
                    {[undefined, ...(table?.rows[0] ?? []).map((_, i) => i)].map((col) => {
                      if (col === undefined && field === 'name') return null;
                      const on = mapping[field] === col;
                      const text =
                        col === undefined ? g.none : (table?.rows[0]?.[col] ?? '') || `#${col + 1}`;
                      return (
                        <Pressable
                          key={col ?? 'none'}
                          accessibilityRole="button"
                          accessibilityState={{ selected: on }}
                          onPress={() =>
                            setMapping((m) => {
                              const next = { ...m };
                              if (col === undefined) delete next[field];
                              else next[field] = col;
                              return next;
                            })
                          }
                          style={{
                            paddingHorizontal: theme.spacing.md,
                            minHeight: 36,
                            justifyContent: 'center',
                            borderRadius: theme.radius.pill,
                            borderWidth: 1.5,
                            borderColor: on ? theme.color.brand : 'transparent',
                            backgroundColor: on ? theme.color.brandSoft : theme.color.surface,
                          }}
                        >
                          <Text style={{ fontWeight: on ? '700' : '400' }}>{text}</Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>
              ))}
            </>
          ) : null}

          {step === 'preview' ? (
            <>
              <Text style={{ fontWeight: '700' }}>{g.previewTitle}</Text>
              <StandardCard>
                <ListRow
                  title={fill(g.cNew, { n: String(counts.added) })}
                  leading={
                    <Ionicons name="checkmark-circle" size={22} color={theme.color.positive} />
                  }
                  divider
                />
                <ListRow
                  title={fill(g.cDup, { n: String(counts.duplicates) })}
                  leading={<Ionicons name="copy-outline" size={22} color={theme.color.textMuted} />}
                  divider
                />
                <ListRow
                  title={fill(g.cErr, { n: String(counts.errors) })}
                  leading={<Ionicons name="alert-circle" size={22} color={theme.color.negative} />}
                />
              </StandardCard>
              {warned > 0 ? (
                <Text variant="caption" tone="muted">
                  {fill(g.warnLine, { n: String(warned) })}
                </Text>
              ) : null}
              {rows
                .filter((r) => r.status !== 'new')
                .slice(0, 40)
                .map((r) => (
                  <Text key={r.line} variant="caption" tone="muted" numberOfLines={1}>
                    {r.line}: {r.cells[mapping.name ?? 0] || '-'} - {problemText(r)}
                  </Text>
                ))}
              {busy ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                  <ActivityIndicator />
                  <Text>
                    {fill(g.progress, { done: String(progress), total: String(counts.added) })}
                  </Text>
                </View>
              ) : null}
            </>
          ) : null}

          {step === 'done' ? (
            <>
              <Text style={{ fontWeight: '700' }}>{g.resultTitle}</Text>
              <StandardCard>
                <Text>
                  {fill(g.resultLine, {
                    added: String(counts.added - failedLines.size),
                    dups: String(counts.duplicates),
                    errors: String(counts.errors + failedLines.size),
                  })}
                </Text>
              </StandardCard>
              {errorRows.length > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={downloadErrors}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.spacing.sm,
                    minHeight: 44,
                  }}
                >
                  <Ionicons name="download-outline" size={18} color={theme.color.brand} />
                  <Text style={{ color: theme.color.brand, fontWeight: '600' }}>
                    {g.downloadErrors}
                  </Text>
                </Pressable>
              ) : null}
            </>
          ) : null}

          {busy && step !== 'preview' ? <ActivityIndicator /> : null}
          {message ? <Text style={{ color: theme.color.negative }}>{message}</Text> : null}
        </ScenicBody>
      </ScrollView>

      {step === 'source' && sheetOpen ? (
        <Footer>
          <SaveButton
            label={g.sheetGo}
            disabled={busy || sheetLink.trim() === ''}
            onPress={() => void readSheet()}
          />
        </Footer>
      ) : null}
      {step === 'columns' ? (
        <Footer>
          <SaveButton
            label={g.next}
            disabled={mapping.name === undefined}
            onPress={() => setStep('preview')}
          />
        </Footer>
      ) : null}
      {step === 'preview' ? (
        <Footer>
          <SaveButton
            label={fill(g.importN, { n: String(counts.added) })}
            disabled={busy || counts.added === 0}
            onPress={() => void run()}
          />
        </Footer>
      ) : null}
      {step === 'done' ? (
        <Footer>
          <SaveButton label={g.done} disabled={false} onPress={() => router.back()} />
        </Footer>
      ) : null}
    </Screen>
  );
}

function Row({
  icon,
  title,
  subtitle,
  onPress,
  last,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  onPress: () => void;
  last?: boolean;
}) {
  const theme = useTheme();
  return (
    <ListRow
      leading={
        <RowTile tint={theme.color.brandSoft}>
          <Ionicons name={icon} size={20} color={theme.color.brand} />
        </RowTile>
      }
      title={title}
      subtitle={subtitle}
      onPress={onPress}
      divider={!last}
    />
  );
}

function Footer({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.sm }}>
      {children}
    </View>
  );
}
