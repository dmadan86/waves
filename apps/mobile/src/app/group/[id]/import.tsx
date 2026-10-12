/**
 * Import expenses into this group from a spreadsheet, a CSV or a Splitwise export.
 *
 * One route, a step machine (`lib/groupImport/machine`): Source, then Columns (a
 * plain spreadsheet only), People, Review, then the write and its Result. The
 * file is read and checked on the phone, so every step but the last works
 * offline, and nothing is written until the person has seen every row.
 *
 * The write goes through the background import store (`lib/importProgress`): a
 * small import stays on this screen and watches itself finish, a large one hands
 * over to the banner on the group screen. Either way it is idempotent: the batch
 * id and every row id are chosen once, so a retry is a replay.
 */

import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { randomUUID } from 'expo-crypto';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { ScrollView, View } from 'react-native';

import {
  buildTemplateCsv,
  detectLayout,
  draftFromTable,
  IMPORT_CHUNK_SIZE,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  type CurrencyCode,
  type ImportDraft,
} from '@waves/core';
import { Button, Screen, useTheme } from '@waves/ui';

import { ColumnMapper, type PreviewRow } from '@/components/import/ColumnMapper';
import { CommitPanel, ResultCard } from '@/components/import/CommitPanels';
import { ImportFooter, ImportHeader } from '@/components/import/ImportChrome';
import { PeopleMapper, type MemberChoice } from '@/components/import/PeopleMapper';
import { ReviewList } from '@/components/import/ReviewList';
import { RowEditSheet } from '@/components/import/RowEditSheet';
import { ExamplesSheet, UpsellSheet } from '@/components/import/ImportSheets';
import { ImportHero, SourcePicker, type SourceChoice } from '@/components/import/SourcePicker';
import { importIntoGroup, undoImport } from '@/data/api';
import { useGroup } from '@/data/hooks';
import { displayName, groupLabel, isViewer } from '@/data/types';
import { fill, plural, useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';
import { friendlyError } from '@/lib/errors';
import { layoutIsReadable } from '@/lib/groupImport/columns';
import { GroupImportFileError, tableFromBytes } from '@/lib/groupImport/file';
import { INITIAL_STATE, reduce, type SourceError } from '@/lib/groupImport/machine';
import { allMapped, matchByName, mergedGroups, type PersonOption } from '@/lib/groupImport/people';
import {
  buildPayload,
  buildReview,
  ensureIds,
  existingFromExpenses,
} from '@/lib/groupImport/review';
import { importSourceFor, rowTotal, runGroupImport } from '@/lib/groupImport/run';
import { undoErrorText } from '@/lib/groupImport/undoText';
import { useGuestGuard } from '@/lib/guestGuard';
import { beginImport, dismissImport, useImportProgress } from '@/lib/importProgress';
import { router } from '@/lib/navigation';
import { useToast } from '@/lib/toast';
import { useViewerId } from '@/lib/auth';
import { syncEngine } from '@/sync';

const CSV_TYPES = [
  'text/csv',
  'text/comma-separated-values',
  'text/tab-separated-values',
  'text/plain',
  'application/vnd.ms-excel',
  'application/octet-stream',
];
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Let React paint a stage label before the thread is tied up parsing. */
const nextFrame = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => resolve()));

/** Back out of this screen, or to the group when it was opened with nothing behind it. */
function leave(groupId: string): void {
  if (router.canGoBack()) router.back();
  else router.replace(`/group/${groupId}`);
}

export default function GroupImportScreen() {
  const theme = useTheme();
  const clearance = useBottomClearance();
  const { t, locale } = useStrings();
  const g = t.groupImport;
  const toast = useToast();
  const guard = useGuestGuard();
  const viewerId = useViewerId();
  const { id } = useLocalSearchParams<{ id: string }>();
  const groupId = id ?? '';
  const { group, members, expenses } = useGroup(groupId);
  const imp = useImportProgress();

  const [state, dispatch] = useReducer(reduce, INITIAL_STATE);
  const [editing, setEditing] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);

  const groupData = group.data;
  const groupCurrency = (groupData?.default_currency ?? 'INR') as CurrencyCode;
  const title = groupLabel(groupData, members.data ?? [], viewerId);

  // The people the file's names can be mapped to: everyone still in the group.
  const live = useMemo(
    () => (members.data ?? []).filter((member) => !member.left_at),
    [members.data],
  );
  const options = useMemo<PersonOption[]>(
    () =>
      live.map((member) => ({
        id: member.id,
        name: member.profile?.display_name ?? member.ghost_name ?? '',
        isYou: isViewer(member, viewerId),
      })),
    [live, viewerId],
  );
  const choices = useMemo<MemberChoice[]>(
    () =>
      live
        .map((member) => ({
          id: member.id,
          label: isViewer(member, viewerId)
            ? t.account.you
            : displayName(member, null, null, t.misc.someone),
          you: isViewer(member, viewerId),
        }))
        .sort((a, b) => Number(b.you) - Number(a.you))
        .map(({ id: memberId, label }) => ({ id: memberId, label })),
    [live, viewerId, t.account.you, t.misc.someone],
  );
  const myMemberId = options.find((option) => option.isYou)?.id ?? null;

  // The file as the reader sees it, redone whenever the person corrects a column.
  const draft = useMemo<ImportDraft | null>(() => {
    if (!state.table || !state.layout) return null;
    return draftFromTable(state.table, state.layout, {
      country: groupData?.country_code,
      defaultCurrency: groupCurrency,
    });
  }, [state.table, state.layout, groupData?.country_code, groupCurrency]);

  const review = useMemo(() => {
    if (!draft || (state.step !== 'review' && state.step !== 'commit' && state.step !== 'result'))
      return null;
    return buildReview({
      draft,
      edits: state.edits,
      mapping: state.mapping,
      members: options.map((option) => ({ id: option.id, name: option.name || t.misc.someone })),
      groupCurrency,
      importerMemberId: myMemberId,
      existing: existingFromExpenses(expenses.rows),
      ticks: state.ticks,
    });
  }, [
    draft,
    state.step,
    state.edits,
    state.mapping,
    state.ticks,
    options,
    groupCurrency,
    myMemberId,
    expenses.rows,
    t.misc.someone,
  ]);

  // ── reading a file ────────────────────────────────────────────────────────

  const fail = useCallback((error: SourceError) => dispatch({ type: 'readFailed', error }), []);

  const pick = async (choice: SourceChoice): Promise<void> => {
    if (choice === 'screenshot') {
      dispatch({ type: 'openSheet', sheet: 'upsell' });
      return;
    }
    if (guard.blockWrite()) return;
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: choice === 'splitwise' ? CSV_TYPES : [...CSV_TYPES, XLSX_TYPE],
        copyToCacheDirectory: true,
      });
      if (picked.canceled || !picked.assets[0]) return;
      const asset = picked.assets[0];

      dispatch({ type: 'readStage', stage: 'reading' });
      await nextFrame();
      if (asset.size !== undefined && asset.size > MAX_IMPORT_BYTES) {
        fail('too_large');
        return;
      }
      const file = new FileSystem.File(asset.uri);
      const bytes = await file.bytes();
      try {
        if (file.exists) file.delete();
      } catch {
        // Best-effort privacy cleanup; the bytes are already in memory.
      }

      dispatch({ type: 'readStage', stage: 'parsing' });
      await nextFrame();
      const { table, kind } = tableFromBytes(bytes, asset.name, asset.mimeType);
      const layout = detectLayout(table, {
        members: options.map((option) => option.name).filter(Boolean),
        country: groupData?.country_code,
      });
      if (layout.kind === 'generic' && layout.headerRow < 0) {
        fail('no_columns');
        return;
      }
      if (layout.kind !== 'generic' || layoutIsReadable(layout)) {
        const probe = draftFromTable(table, layout, {
          country: groupData?.country_code,
          defaultCurrency: groupCurrency,
        });
        if (probe.rows.length === 0) {
          fail('no_rows');
          return;
        }
        dispatch({ type: 'loaded', fileName: asset.name, fileKind: kind, table, layout });
        if (layout.kind !== 'generic') {
          dispatch({
            type: 'toPeople',
            people: probe.people,
            matches: matchByName(probe.people, options),
          });
        }
        return;
      }
      dispatch({ type: 'loaded', fileName: asset.name, fileKind: kind, table, layout });
    } catch (caught) {
      fail(caught instanceof GroupImportFileError ? caught.failure : 'unreadable');
    }
  };

  // ── the examples sheet ───────────────────────────────────────────────────

  const shareTemplate = async (): Promise<void> => {
    setSharing(true);
    try {
      const names = options.map((option) => option.name).filter(Boolean);
      // A BOM, so Excel opens a name in Tamil or Arabic as itself.
      const text = `﻿${buildTemplateCsv(names, groupCurrency)}`;
      const file = new FileSystem.File(FileSystem.Paths.cache, 'waves-import-template.csv');
      if (file.exists) file.delete();
      file.create();
      file.write(text);
      try {
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(file.uri, {
            mimeType: 'text/csv',
            dialogTitle: g.templateShareTitle,
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
    } finally {
      setSharing(false);
    }
  };

  const copyExample = (text: string): void => {
    void Clipboard.setStringAsync(text).then(() => toast.show(g.copied));
  };

  // ── writing ──────────────────────────────────────────────────────────────

  const startImport = (): void => {
    if (!review || !state.layout) return;
    const batchId = state.batchId ?? randomUUID();
    const ids = ensureIds(
      review.selected.map((row) => row.key),
      state.ids,
      randomUUID,
    );
    const payload = buildPayload(review, ids, randomUUID);
    const source = importSourceFor(state.layout.kind, state.fileKind ?? 'csv');
    dispatch({ type: 'commitStarted', batchId, ids });

    const scheduled = beginImport({
      name: title,
      groupId,
      run: async (report) => {
        try {
          const result = await runGroupImport(
            { groupId, batchId, source, payload },
            {
              write: importIntoGroup,
              pull: (target) => syncEngine.flush({ groupIds: [target] }),
              report,
            },
          );
          return result;
        } catch (caught) {
          throw new Error(friendlyError(caught, t.importLedger.importFailed, 'groupImport.commit'));
        }
      },
    });
    if (!scheduled) {
      dispatch({ type: 'commitAbandoned' });
      toast.show(t.importLedger.alreadyImporting, 'negative');
      return;
    }
    // A big one carries on under the banner on the group screen.
    if (rowTotal(payload) >= IMPORT_CHUNK_SIZE) leave(groupId);
  };

  const onImport = (): void => {
    if (guard.blockWrite()) return;
    startImport();
  };

  // A small import finishing while this screen watches: show what it did.
  useEffect(() => {
    if (
      state.step === 'commit' &&
      state.batchId &&
      imp.phase === 'success' &&
      imp.targetGroupId === groupId &&
      imp.summary?.batchId === state.batchId
    ) {
      dispatch({
        type: 'commitDone',
        outcome: {
          batchId: state.batchId,
          expenses: imp.summary.expenses,
          settlements: imp.summary.settlements,
          ghosts: imp.summary.ghosts,
        },
      });
    }
  }, [state.step, state.batchId, imp, groupId]);

  const onUndo = (): void => {
    if (!state.outcome) return;
    dispatch({ type: 'undoStarted' });
    undoImport(state.outcome.batchId).then(
      (result) => {
        dispatch({ type: 'undoDone', expenses: result.expenses });
        void syncEngine.flush({ groupIds: [groupId] });
      },
      (caught: unknown) => {
        const message = undoErrorText(caught, g);
        dispatch({ type: 'undoFailed', message });
      },
    );
  };

  // ── pieces of the current step ───────────────────────────────────────────

  const people = draft?.people ?? [];
  const header =
    state.table && state.layout ? (state.table.rows[state.layout.headerRow] ?? []) : [];
  const dataRows =
    state.table && state.layout ? state.table.rows.slice(state.layout.headerRow + 1) : [];
  const samples = header.map(
    (_, column) => dataRows.map((row) => row[column] ?? '').find((cell) => cell !== '') ?? '',
  );
  const dateColumn = state.layout?.columns.date;
  const dateSample = dateColumn === undefined ? null : samples[dateColumn] || null;
  const preview: PreviewRow[] = (draft?.rows ?? []).slice(0, 3).map((row) => ({
    key: row.key,
    description: row.description,
    date: row.date,
    amount: row.amount,
    currency: row.currency ?? groupCurrency,
    unreadable: row.issues.some((issue) => issue.severity === 'error'),
  }));
  const columnsOk = Boolean(
    state.layout && layoutIsReadable(state.layout) && draft && draft.rows.length > 0,
  );

  const editRow = editing && review ? review.rows.find((row) => row.key === editing) : undefined;
  const editSource = editing && draft ? draft.rows.find((row) => row.key === editing) : undefined;

  const subtitle =
    state.step === 'columns'
      ? g.columnsTitle
      : state.step === 'people'
        ? g.peopleTitle
        : state.step === 'review'
          ? g.reviewTitle
          : undefined;
  const canBack = state.step === 'columns' || state.step === 'people' || state.step === 'review';
  const onBack =
    state.step === 'commit'
      ? null
      : canBack
        ? () => dispatch({ type: 'back' })
        : () => leave(groupId);

  const selectedCount = review?.selected.length ?? 0;
  const hasSettlements = (review?.summary.settlements ?? 0) > 0;

  return (
    <Screen>
      {state.step === 'source' ? null : (
        <ImportHeader
          title={fill(g.titleNamed, { group: title })}
          subtitle={subtitle}
          onBack={onBack}
        />
      )}

      {state.step === 'review' && review ? (
        <View style={{ flex: 1 }}>
          <ReviewList
            model={review}
            filter={state.filter}
            groupCurrency={groupCurrency}
            note={state.layout?.kind === 'splitwise' ? t.importLedger.fromSplitwiseNote : null}
            nameOf={(name) => name}
            onFilter={(filter) => dispatch({ type: 'setFilter', filter })}
            onTick={(key, ticked) => dispatch({ type: 'tick', key, ticked })}
            onEdit={setEditing}
          />
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingHorizontal: theme.spacing.xl,
            paddingTop: state.step === 'source' ? 0 : theme.spacing.lg,
            paddingBottom: state.step === 'source' ? clearance : theme.spacing.xl,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {state.step === 'source' ? (
            <ImportHero groupName={title} onBack={() => leave(groupId)} />
          ) : null}
          {state.step === 'source' ? (
            <SourcePicker
              stage={state.stage}
              error={state.error}
              errorValues={{ mb: MAX_IMPORT_BYTES / (1024 * 1024), n: MAX_IMPORT_ROWS }}
              onChoose={(choice) => void pick(choice)}
              onExamples={() => dispatch({ type: 'openSheet', sheet: 'examples' })}
            />
          ) : null}
          {state.step === 'columns' && state.layout && state.detected ? (
            <ColumnMapper
              header={header}
              samples={samples}
              layout={state.layout}
              detected={state.detected}
              preview={preview}
              noAmount={!layoutIsReadable(state.layout)}
              dateSample={dateSample}
              onPick={(column, choice) => dispatch({ type: 'setColumn', column, choice })}
              onDateOrder={(order) => dispatch({ type: 'setDateOrder', order })}
              onDecimalStyle={(style) => dispatch({ type: 'setDecimalStyle', style })}
            />
          ) : null}
          {state.step === 'people' ? (
            <PeopleMapper
              people={people}
              mapping={state.mapping}
              matched={state.matched}
              members={choices}
              merged={mergedGroups(people, state.mapping)}
              onMap={(name, target) => dispatch({ type: 'mapPerson', name, target })}
              onRestAsNew={() => dispatch({ type: 'mapRestAsNew', people })}
            />
          ) : null}
          {state.step === 'commit' ? (
            <CommitPanel
              imp={imp.targetGroupId === groupId ? imp : { ...imp, phase: 'running' }}
              onCancel={() => {
                dismissImport();
                dispatch({ type: 'commitAbandoned' });
              }}
              onRetry={startImport}
            />
          ) : null}
          {state.step === 'result' && state.outcome ? (
            <ResultCard
              outcome={state.outcome}
              groupName={title}
              left={review?.summary.left ?? 0}
              undo={state.undo}
              undoAvailable
              onInvite={() => router.push(`/group/${groupId}/invite`)}
              onUndo={onUndo}
            />
          ) : null}
        </ScrollView>
      )}

      {state.step === 'columns' ? (
        <ImportFooter>
          <Button
            label={g.continueLabel}
            variant="brand"
            size="lg"
            fullWidth
            disabled={!columnsOk}
            onPress={() =>
              dispatch({ type: 'toPeople', people, matches: matchByName(people, options) })
            }
          />
        </ImportFooter>
      ) : null}
      {state.step === 'people' ? (
        <ImportFooter>
          <Button
            label={g.continueLabel}
            variant="brand"
            size="lg"
            fullWidth
            disabled={!allMapped(people, state.mapping)}
            onPress={() => dispatch({ type: 'toReview' })}
          />
        </ImportFooter>
      ) : null}
      {state.step === 'review' && review ? (
        <ImportFooter
          note={review.summary.left > 0 ? plural(locale, review.summary.left, g.summaryLeft) : null}
        >
          <Button
            label={
              selectedCount === 0
                ? g.ctaNothing
                : plural(locale, selectedCount, hasSettlements ? g.ctaItems : g.ctaExpenses)
            }
            variant="brand"
            size="lg"
            fullWidth
            disabled={selectedCount === 0}
            onPress={onImport}
          />
        </ImportFooter>
      ) : null}
      {state.step === 'result' ? (
        <ImportFooter>
          <Button
            label={g.openGroup}
            variant="brand"
            size="lg"
            fullWidth
            onPress={() => leave(groupId)}
          />
        </ImportFooter>
      ) : null}

      <ExamplesSheet
        visible={state.sheet === 'examples'}
        busy={sharing}
        onShare={() => void shareTemplate()}
        onCopy={copyExample}
        onClose={() => dispatch({ type: 'closeSheet' })}
      />
      <UpsellSheet
        visible={state.sheet === 'upsell'}
        onPlans={() => {
          dispatch({ type: 'closeSheet' });
          router.push('/settings/upgrade');
        }}
        onCsv={() => dispatch({ type: 'openSheet', sheet: 'examples' })}
        onClose={() => dispatch({ type: 'closeSheet' })}
      />
      {editRow && editSource ? (
        <RowEditSheet
          key={editRow.key}
          context={{
            row: editRow,
            people,
            category: state.edits[editRow.key]?.category ?? editSource.category,
            decimalStyle: state.layout?.decimalStyle ?? 'dot',
          }}
          edited={state.edits[editRow.key] !== undefined}
          nameOf={(name) => name}
          onSave={(edit) => {
            dispatch({ type: 'editRow', key: editRow.key, edit });
            setEditing(null);
          }}
          onReset={() => {
            dispatch({ type: 'clearEdit', key: editRow.key });
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </Screen>
  );
}
