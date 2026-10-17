/**
 * Import a bank statement.
 *
 * Pick a file (or a screenshot of a page), see what it holds, tick what to add,
 * and the ticked rows land in Review as drafts on this phone. Nothing is posted
 * here: Review's own confirm flow is the only way a row becomes an expense.
 *
 *   Pro   a spreadsheet of one of the five big banks is read on the phone; a
 *         screenshot (and, once the app can open them, a PDF) is read by AI
 *         after account numbers are hidden. Nothing is kept.
 *   Free  a spreadsheet is read on the phone and previewed: how many
 *         transactions, how much spent, the first three rows. Then the paywall.
 *
 * The password of a protected PDF would be typed and used on this phone only;
 * see `lib/statementImport/pdfReader.ts` for why PDFs are not offered yet.
 */

import { useCallback, useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { FlashList } from '@shopify/flash-list';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { ActivityIndicator, Pressable, View } from 'react-native';

import {
  format,
  money,
  parseStatementTable,
  planStatementImport,
  previewStatement,
  STATEMENT_MAX_FILE_BYTES,
  STATEMENT_MAX_PAGES,
  type ExistingExpense,
  type StatementItem,
  type StatementPlan,
  type StatementRow,
} from '@waves/core';
import { Button, Callout, Card, iconSize, MoneyText, Row, Screen, Text, useTheme } from '@waves/ui';

import { SignInWall } from '@/components/SignInWall';
import { usePersonalLedger } from '@/data/personal';
import { fill, useStrings, type UiStrings } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { useBottomClearance } from '@/lib/clearance';
import { tableFromBytes, GroupImportFileError } from '@/lib/groupImport/file';
import { pickReceiptImage } from '@/lib/image';
import { router } from '@/lib/navigation';
import { smsCaptureId } from '@/lib/smsCaptureId';
import { smsDrafts } from '@/lib/smsDraftStore';
import { dedupeKeyOf } from '@/lib/smsLocalDrafts';
import { useEntitlement } from '@/lib/useEntitlement';
import { callParseStatement } from '@/lib/statementImport/client';
import { applyStatementPlan, draftDescription } from '@/lib/statementImport/drafts';
import { statementFileKind } from '@/lib/statementImport/fileKind';
import { PDF_READING_AVAILABLE } from '@/lib/statementImport/pdfReader';
import { statementPreviewsLeft, spendStatementPreview } from '@/lib/statementImport/previews';
import {
  readStatementPages,
  type ReadFailure,
  type StatementPageInput,
} from '@/lib/statementImport/run';
import { tableToPages } from '@/lib/statementImport/tablePages';

type Stage =
  | { name: 'pick' }
  | { name: 'working'; label: string }
  | { name: 'preview'; count: number; spent: bigint; first: StatementRow[]; left: number }
  | { name: 'review' }
  | { name: 'saving' }
  | {
      name: 'done';
      added: number;
      enriched: number;
      skipped: number;
    };

function randomId(): string {
  const bytes = new Uint8Array(12);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function failureText(reason: ReadFailure, s: UiStrings['statementImport'], limit = 30): string {
  switch (reason) {
    case 'quota':
      return fill(s.errQuota, { limit });
    case 'unavailable':
      return s.errUnavailable;
    case 'rate':
      return s.errRate;
    case 'dense':
      return s.errDense;
    case 'refused':
      return s.errRefused;
    case 'expired':
      return s.errExpired;
    default:
      return s.errGeneric;
  }
}

export default function StatementImportScreen(): React.JSX.Element {
  const { isGuest } = useAuth();
  if (isGuest) return <SignInWall area="sms" />;
  return <StatementImport />;
}

function StatementImport(): React.JSX.Element {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const s = t.statementImport;
  const { session } = useAuth();
  const ownerId = session?.user?.id ?? '';
  const { isPaid } = useEntitlement();
  const ledger = usePersonalLedger();
  const clearance = useBottomClearance(theme.spacing.xl);

  const [stage, setStage] = useState<Stage>({ name: 'pick' });
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<StatementPlan | null>(null);
  const [currency, setCurrency] = useState('INR');
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());

  const today = new Date().toISOString().slice(0, 10);

  const existing = useMemo<ExistingExpense[]>(
    () =>
      ledger.txns
        .filter((txn) => txn.kind === 'expense')
        .map((txn) => ({
          id: txn.id,
          date: txn.date,
          currency: txn.currency,
          amount: txn.amount,
          description: txn.note ?? txn.category ?? '',
        })),
    [ledger.txns],
  );

  const reset = useCallback(() => {
    setStage({ name: 'pick' });
    setError(null);
    setPlan(null);
    setTicked(new Set());
  }, []);

  /** Rows to the review step: merge with what Review already holds, then show. */
  const showPlan = useCallback(
    async (rows: StatementRow[], rowsCurrency: string | null) => {
      if (rows.length === 0) {
        setError(s.errNothingFound);
        setStage({ name: 'pick' });
        return;
      }
      await smsDrafts.ensureLoaded(ownerId);
      const draftKeys = new Set<string>();
      for (const draft of smsDrafts.openDrafts(ownerId)) {
        const key = dedupeKeyOf(draft.parsed);
        if (key) draftKeys.add(key);
      }
      const cur = rowsCurrency ?? 'INR';
      const next = planStatementImport(rows, { currency: cur, draftKeys, existing });
      setCurrency(cur);
      setPlan(next);
      setTicked(new Set(next.items.filter((i) => i.ticked).map((i) => i.key)));
      setStage({ name: 'review' });
    },
    [existing, ownerId, s.errNothingFound],
  );

  const readWithAi = useCallback(
    async (pages: StatementPageInput[]) => {
      setStage({ name: 'working', label: s.reading });
      const outcome = await readStatementPages({
        pages,
        importId: randomId(),
        hints: {
          currency: 'INR',
          today,
          locale,
          country: null,
          bank: null,
        },
        call: callParseStatement,
        onProgress: (done, total) =>
          setStage({
            name: 'working',
            label: fill(s.readingPage, { done, total }),
          }),
      });
      if (!outcome.ok) {
        if (outcome.reason === 'paid') {
          router.push('/paywall');
          setStage({ name: 'pick' });
          return;
        }
        setError(failureText(outcome.reason, s));
        setStage({ name: 'pick' });
        return;
      }
      await showPlan(outcome.rows, outcome.currency);
    },
    [locale, s, showPlan, today],
  );

  const pickFile = useCallback(async () => {
    setError(null);
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: [
          'text/csv',
          'text/comma-separated-values',
          'text/plain',
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/octet-stream',
          ...(PDF_READING_AVAILABLE ? ['application/pdf'] : []),
        ],
        copyToCacheDirectory: true,
      });
      if (picked.canceled) return;
      const asset = picked.assets[0];
      if (!asset) return;

      const kind = statementFileKind(asset.name, asset.mimeType);
      if (kind === 'pdf') {
        setError(s.pdfNotYet);
        return;
      }
      if (kind !== 'csv' && kind !== 'xlsx') {
        setError(s.errUnreadable);
        return;
      }
      if ((asset.size ?? 0) > STATEMENT_MAX_FILE_BYTES) {
        setError(s.errTooLarge);
        return;
      }

      setStage({ name: 'working', label: s.reading });
      const file = new FileSystem.File(asset.uri);
      const bytes = await file.bytes();
      try {
        if (file.exists) file.delete();
      } catch {
        // Best-effort cleanup; the bytes are already in memory.
      }

      let table;
      try {
        table = tableFromBytes(bytes, asset.name, asset.mimeType).table;
      } catch (caught) {
        setStage({ name: 'pick' });
        if (caught instanceof GroupImportFileError) {
          setError(
            caught.failure === 'too_large'
              ? s.errTooLarge
              : caught.failure === 'empty'
                ? s.errEmpty
                : caught.failure === 'too_many_rows'
                  ? s.errTooManyRows
                  : s.errUnreadable,
          );
        } else setError(s.errUnreadable);
        return;
      }

      const parsed = parseStatementTable(table, { today });

      if (!isPaid) {
        // Free: a teaser, read on this phone, never sent anywhere.
        if (!parsed.ok) {
          setStage({ name: 'pick' });
          setError(parsed.reason === 'unknown_layout' ? s.errUnknown : s.errNothingFound);
          return;
        }
        const left = await statementPreviewsLeft();
        if (left <= 0) {
          setStage({ name: 'pick' });
          setError(s.noPreviewsLeft);
          router.push('/paywall');
          return;
        }
        await spendStatementPreview();
        const preview = previewStatement(parsed.rows);
        setStage({
          name: 'preview',
          count: preview.count,
          spent: preview.spentMinor,
          first: [...preview.first],
          left: left - 1,
        });
        return;
      }

      if (parsed.ok) {
        await showPlan(parsed.rows, 'INR');
        return;
      }
      // Pro, and the layout is not one we read ourselves: the reader takes it.
      const pages = tableToPages(table.rows);
      if (pages.length === 0 || pages.length > STATEMENT_MAX_PAGES * 4) {
        setStage({ name: 'pick' });
        setError(pages.length === 0 ? s.errNothingFound : s.errTooManyRows);
        return;
      }
      await readWithAi(pages);
    } catch {
      setStage({ name: 'pick' });
      setError(s.errGeneric);
    }
  }, [isPaid, readWithAi, s, showPlan, today]);

  const pickPhoto = useCallback(async () => {
    setError(null);
    if (!isPaid) {
      setError(s.errFreePhoto);
      router.push('/paywall');
      return;
    }
    try {
      const image = await pickReceiptImage();
      if (!image) return;
      const mimeType =
        image.mimeType === 'image/png' || image.mimeType === 'image/webp'
          ? image.mimeType
          : 'image/jpeg';
      await readWithAi([{ kind: 'image', page: 1, base64: image.base64, mimeType }]);
    } catch {
      setStage({ name: 'pick' });
      setError(s.errGeneric);
    }
  }, [isPaid, readWithAi, s]);

  const toggle = useCallback((key: string) => {
    setTicked((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const shown = useMemo(
    () =>
      plan
        ? plan.items.filter((i) => i.status !== 'merged_sms' && i.status !== 'duplicate_in_file')
        : [],
    [plan],
  );
  const allTicked = shown.length > 0 && shown.every((i) => ticked.has(i.key));
  const toggleAll = useCallback(() => {
    setTicked(allTicked ? new Set() : new Set(shown.map((i) => i.key)));
  }, [allTicked, shown]);

  const save = useCallback(async () => {
    if (!plan || !ownerId) return;
    setStage({ name: 'saving' });
    try {
      const result = await applyStatementPlan(
        plan,
        ticked,
        { currency, today },
        {
          ownerId,
          drafts: smsDrafts,
          idFor: (key) => smsCaptureId(ownerId, key),
          now: () => new Date().toISOString(),
        },
      );
      setStage({
        name: 'done',
        added: result.added,
        enriched: result.enriched,
        skipped: plan.summary.duplicatesSkipped,
      });
    } catch {
      setStage({ name: 'review' });
      setError(s.errGeneric);
    }
  }, [currency, ownerId, plan, s.errGeneric, ticked, today]);

  const ink = theme.color.text;

  const noteFor = (item: StatementItem): string | null => {
    if (item.flags.includes('balance_mismatch')) return s.noteBalance;
    if (item.flags.includes('low_confidence')) return s.noteLow;
    if (item.flags.includes('bad_date')) return s.noteNoDate;
    if (item.status === 'likely_duplicate') return s.noteLikelyDup;
    if (item.status === 'possible_duplicate') return s.notePossibleDup;
    return null;
  };

  // -- Stages ---------------------------------------------------------------

  if (stage.name === 'working' || stage.name === 'saving') {
    return (
      <Screen edges={['top']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <ActivityIndicator color={theme.color.brand} />
          <Text tone="muted">{stage.name === 'working' ? stage.label : s.reading}</Text>
        </View>
      </Screen>
    );
  }

  const header = (
    <View style={{ gap: theme.spacing.md, paddingTop: theme.spacing.md }}>
      <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.common.close}
          onPress={() => router.back()}
          hitSlop={6}
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
        >
          <Ionicons name="close" size={iconSize.lg} color={ink} />
        </Pressable>
        <Text variant="title" style={{ flex: 1, fontWeight: '800' }} numberOfLines={1}>
          {s.title}
        </Text>
      </Row>
      {error ? <Callout tone="negative">{error}</Callout> : null}
    </View>
  );

  if (stage.name === 'pick') {
    return (
      <Screen edges={['top']}>
        <View
          style={{
            paddingHorizontal: theme.spacing.xl,
            paddingBottom: clearance,
            gap: theme.spacing.lg,
          }}
        >
          {header}
          <Text tone="muted">{s.intro}</Text>
          <Card style={{ gap: theme.spacing.sm }}>
            <Row style={{ gap: theme.spacing.sm, alignItems: 'flex-start' }}>
              <Ionicons
                name="shield-checkmark-outline"
                size={iconSize.md}
                color={theme.color.brand}
              />
              <Text style={{ flex: 1 }}>{s.consent}</Text>
            </Row>
          </Card>
          <Button label={s.chooseFile} onPress={() => void pickFile()} />
          <Button label={s.choosePhoto} variant="secondary" onPress={() => void pickPhoto()} />
          <Text variant="caption" tone="muted">
            {s.supported}
          </Text>
          {!PDF_READING_AVAILABLE ? (
            <Text variant="caption" tone="muted">
              {s.pdfNotYet}
            </Text>
          ) : null}
          {!isPaid ? (
            <Text variant="caption" tone="muted">
              {s.freeNote}
            </Text>
          ) : null}
        </View>
      </Screen>
    );
  }

  if (stage.name === 'preview') {
    return (
      <Screen edges={['top']}>
        <View
          style={{
            paddingHorizontal: theme.spacing.xl,
            paddingBottom: clearance,
            gap: theme.spacing.lg,
          }}
        >
          {header}
          <Text variant="title">
            {fill(s.previewHeading, {
              n: stage.count,
              amount: format(money(stage.spent, 'INR'), { locale }),
            })}
          </Text>
          <Card padded={false}>
            {stage.first.map((row, index) => (
              <Row
                key={index}
                style={{
                  padding: theme.spacing.md,
                  gap: theme.spacing.md,
                  alignItems: 'center',
                }}
              >
                <Text style={{ flex: 1 }} numberOfLines={1}>
                  {draftDescription(row.description)}
                </Text>
                <MoneyText
                  amount={BigInt(row.amount)}
                  currency="INR"
                  locale={locale}
                  variant="body"
                />
              </Row>
            ))}
          </Card>
          <Text tone="muted">{s.previewLocked}</Text>
          <Text variant="caption" tone="muted">
            {fill(s.previewsLeft, { n: stage.left })}
          </Text>
          <Button label={s.unlock} onPress={() => router.push('/paywall')} />
          <Button label={s.another} variant="ghost" onPress={reset} />
        </View>
      </Screen>
    );
  }

  if (stage.name === 'done') {
    return (
      <Screen edges={['top']}>
        <View
          style={{
            paddingHorizontal: theme.spacing.xl,
            paddingBottom: clearance,
            gap: theme.spacing.lg,
          }}
        >
          {header}
          <Callout tone="positive">{fill(s.added, { n: stage.added })}</Callout>
          {stage.enriched > 0 ? (
            <Text tone="muted">{fill(s.enriched, { n: stage.enriched })}</Text>
          ) : null}
          <Text tone="muted">
            {fill(s.summary, { added: stage.added, skipped: stage.skipped })}
          </Text>
          <Button label={s.openReview} onPress={() => router.replace('/captures')} />
          <Button label={s.another} variant="ghost" onPress={reset} />
        </View>
      </Screen>
    );
  }

  // Review.
  type Entry =
    { kind: 'heading'; key: string; text: string } | { kind: 'row'; item: StatementItem };
  const entries: Entry[] = [];
  const out = shown.filter((i) => i.section === 'out');
  const into = shown.filter((i) => i.section === 'in');
  if (out.length > 0) entries.push({ kind: 'heading', key: 'out', text: s.moneyOut });
  for (const item of out) entries.push({ kind: 'row', item });
  if (into.length > 0) entries.push({ kind: 'heading', key: 'in', text: s.moneyIn });
  for (const item of into) entries.push({ kind: 'row', item });

  const chosen = shown.filter((i) => ticked.has(i.key)).length;
  const listState = { ticked, theme };

  return (
    <Screen edges={['top']}>
      <FlashList
        data={entries}
        keyExtractor={(entry) =>
          entry.kind === 'heading' ? entry.key : entry.item.key + entry.item.row.index
        }
        getItemType={(entry) => entry.kind}
        extraData={listState}
        contentContainerStyle={{ paddingHorizontal: theme.spacing.xl, paddingBottom: clearance }}
        ListHeaderComponent={
          <View style={{ gap: theme.spacing.sm }}>
            {header}
            {plan ? (
              <Text tone="muted">
                {fill(s.summary, {
                  added: plan.summary.added,
                  skipped: plan.summary.duplicatesSkipped,
                })}
              </Text>
            ) : null}
            <Row style={{ justifyContent: 'flex-end' }}>
              <Button
                label={allTicked ? s.untickAll : s.tickAll}
                variant="ghost"
                onPress={toggleAll}
              />
            </Row>
          </View>
        }
        renderItem={({ item: entry }) => {
          if (entry.kind === 'heading') {
            return (
              <Text
                variant="micro"
                tone="muted"
                style={{
                  textTransform: 'uppercase',
                  marginTop: theme.spacing.md,
                  marginBottom: theme.spacing.xs,
                }}
              >
                {entry.text}
              </Text>
            );
          }
          const { item } = entry;
          const on = ticked.has(item.key);
          const note = noteFor(item);
          return (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              onPress={() => toggle(item.key)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.spacing.md,
                paddingVertical: theme.spacing.sm,
              }}
            >
              <Ionicons
                name={on ? 'checkbox' : 'square-outline'}
                size={iconSize.lg}
                color={on ? theme.color.brand : theme.color.textMuted}
              />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1}>{draftDescription(item.row.description)}</Text>
                <Text variant="caption" tone="muted" numberOfLines={1}>
                  {item.row.date ?? ''}
                  {note ? `  ·  ${note}` : ''}
                </Text>
              </View>
              <MoneyText
                amount={BigInt(item.row.amount)}
                currency={currency as never}
                locale={locale}
                variant="body"
              />
            </Pressable>
          );
        }}
        ListFooterComponent={
          <View style={{ gap: theme.spacing.md, paddingTop: theme.spacing.xl }}>
            {error ? <Callout tone="negative">{error}</Callout> : null}
            <Button
              label={fill(s.add, { n: chosen })}
              disabled={chosen === 0}
              onPress={() => void save()}
            />
          </View>
        }
      />
    </Screen>
  );
}
