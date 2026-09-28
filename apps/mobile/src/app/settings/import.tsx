/**
 * Bringing a ledger in — from Splitwise, or from Waves itself (ADR-012).
 *
 * The parsing is the easy half and lives in `packages/core`. This screen is the
 * other half: deciding which name in the file is which person here, and being
 * straight about what each kind of file does and does not contain.
 *
 * A **Splitwise** export holds each person's *net* for every row. It does not
 * hold who paid — many (paid, owed) pairs produce the same net, and the file
 * keeps none of them. Balances come across to the paisa; the payer on each row
 * is a deterministic reconstruction, and the preview says so in those words,
 * because somebody who later opens a row and finds they apparently paid for a
 * dinner they did not pay for deserves to have been told first.
 *
 * A **Waves** export holds the real (paid, owed) pair and the settlements
 * besides, so nothing is reconstructed. What still does not survive is stated
 * in ./import's own words on screen: ids, edit history and settlement
 * allocations are new, and that is what "lossless" honestly covers (M5).
 */

import { useState, type ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { randomUUID } from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import {
  importSplitwiseCsv,
  isWavesExport,
  parseWavesExport,
  type WavesImportGroup,
  type WavesImportSettlement,
  type ImportProblem,
} from '@waves/core';
import {
  Avatar,
  Button,
  Callout,
  ChipRow,
  directionalIcon,
  Divider,
  IconButton,
  iconSize,
  MoneyText,
  ProgressBar,
  Row,
  Screen,
  Sheet,
  Text,
  tintForKey,
  useTheme,
} from '@waves/ui';

import { createGroup, fetchMembers, importLedger, type ImportPerson } from '@/data/api';
import { beginImport } from '@/lib/importProgress';
import { friendlyError } from '@/lib/errors';
import { importProblemLine, importProblemText } from '@/lib/problemText';
import { plural, useStrings, type UiStrings } from '@/i18n';
import { router } from '@/lib/navigation';
import { useReducedMotion } from '@/lib/reducedMotion';
import { useGroupLabeller, useGroups, useHomeSummary } from '@/data/hooks';
import { displayName, GroupType, isViewer, type MemberRow } from '@/data/types';
import { useAuth, useViewerId } from '@/lib/auth';
import { SPEC_ACCENT, SPEC_INK, SPEC_MUTED } from '@/lib/specPalette';
import { useBottomClearance } from '@/lib/clearance';

type IconName = keyof typeof Ionicons.glyphMap;

/** What a column in the file has been mapped to. */
type Mapping = { kind: 'me' } | { kind: 'member'; memberId: string } | { kind: 'ghost' };

const NEW_GROUP = 'new';

/**
 * Yield one frame so React can flush a state change to the screen before the
 * thread is tied up again. The file read is async, but the parse that follows
 * runs on this thread and blocks it — without a paint in between, a large file
 * freezes on a blank screen and looks like nothing happened.
 */
const nextFrame = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => resolve()));

/** Which slow step the screen is on, so it can name what it is waiting for. */
type Stage = 'reading' | 'parsing' | 'importing';

/**
 * The two file formats, flattened to what this screen needs.
 *
 * They differ in exactly two ways that matter here — whether the payer is real
 * or reconstructed, and whether settlements came along — so one shape with two
 * origins beats two screens that drift apart.
 */
interface Loaded {
  origin: 'splitwise' | 'waves';
  /** What to call the group if a new one is made. */
  suggestedName: string;
  people: readonly string[];
  currency: string;
  expenses: readonly {
    description: string;
    category: string | null;
    date: string;
    currency: string;
    amount: bigint;
    payers: Readonly<Record<string, bigint>>;
    shares: Readonly<Record<string, bigint>>;
  }[];
  settlements: readonly WavesImportSettlement[];
  /** Net per person in `currency`. Other currencies are counted but not shown. */
  balances: Readonly<Record<string, bigint>>;
  /** Currencies in the file beyond the main one, so the preview can say so. */
  otherCurrencies: readonly string[];
  problems: readonly ImportProblem[];
}

function fromWaves(group: WavesImportGroup, fallbackName: string): Loaded {
  const currencies = [...new Set(group.expenses.map((expense) => expense.currency))];
  return {
    origin: 'waves',
    suggestedName: group.name ?? fallbackName,
    people: group.people,
    currency: group.currency,
    expenses: group.expenses,
    settlements: group.settlements,
    balances: group.balances[group.currency] ?? {},
    otherCurrencies: currencies.filter((currency) => currency !== group.currency),
    problems: group.problems,
  };
}

export default function ImportScreen() {
  const labelOf = useGroupLabeller();
  const theme = useTheme();
  // The bottom bar shows on this screen (it is a settings page, not a modal), and
  // it is opaque — so the scroll has to clear the *bar*, not just the system
  // inset. `useScreenClearance` only cleared the inset, which left the Import CTA
  // jammed under the bar. `useBottomClearance` asks the bar itself whether it is
  // showing here rather than this screen having to know; a token more on top
  // gives the footer CTA its breath.
  const clearance = useBottomClearance() + theme.spacing.xl;
  const { t, locale } = useStrings();
  const reduceMotion = useReducedMotion();
  const groups = useGroups();
  const { profile } = useAuth();
  const summary = useHomeSummary(profile?.id ?? null);
  const { dark, ink, muted, accent, lavender, line } = useImportInks();

  // Identity for "which member am I", from the session rather than the profile:
  // the session is on the device at launch, the profile is a fetch that lands
  // later, and in the gap `profile?.id` is undefined — which `isViewer` refuses
  // to match, but only if it is given the right thing to compare. See
  // `lib/auth.useViewerId`.
  const viewerId = useViewerId();

  const [file, setFile] = useState<string | null>(null);
  const [parsed, setParsed] = useState<Loaded | null>(null);
  /**
   * A Waves export can hold every group somebody is in. Importing them all in
   * one go would need one who-is-who mapping per group on one screen, which is
   * how somebody puts a stranger's history into the wrong ledger. One at a
   * time, chosen deliberately.
   */
  const [fileGroups, setFileGroups] = useState<readonly WavesImportGroup[]>([]);
  const [fileGroupIndex, setFileGroupIndex] = useState(0);
  const [target, setTarget] = useState<string>(NEW_GROUP);
  const chosenGroup =
    target === NEW_GROUP
      ? null
      : ((groups.data ?? []).find((group) => group.id === target) ?? null);
  // The name a new group is created with. Seeded from the file (the Splitwise
  // default, or the export's own name) and then the person's to change — they no
  // longer have to accept "Splitwise" or rename it afterwards.
  const [newGroupName, setNewGroupName] = useState('');
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [mapping, setMapping] = useState<Record<string, Mapping>>({});
  /**
   * Generated once per parsed file and reused on every retry. This is what
   * makes a second tap after a dropped connection a replay rather than a
   * duplicate import (ADR-005).
   */
  const [mutationIds, setMutationIds] = useState<string[]>([]);

  const [busy, setBusy] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [stage, setStage] = useState<Stage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{
    groupId: string;
    expenses: number;
    ghosts: number;
    settlements: number;
    settlementsPending: number;
  } | null>(null);

  /** Everyone starts as somebody new — see `load`. */
  const load = (loaded: Loaded): void => {
    setParsed(loaded);
    setNewGroupName(loaded.suggestedName);
    setMutationIds([...loaded.expenses, ...loaded.settlements].map(() => randomUUID()));
    // Claiming a name as yourself is a deliberate act. Guessing by name would
    // silently merge your ledger with a stranger who shares your first name.
    setMapping(Object.fromEntries(loaded.people.map((person) => [person, { kind: 'ghost' }])));
    setTarget(NEW_GROUP);
    setMembers([]);
  };

  const choose = async (source: 'splitwise' | 'other' = 'other'): Promise<void> => {
    setError(null);
    setDone(null);
    setBusy(true);
    try {
      // The format is decided by sniffing the file contents (isWavesExport),
      // never the picker — so both sources funnel through here. The `source`
      // only narrows what the picker offers: a Splitwise export is a CSV, so
      // that option leads with CSV; "other data" (a Waves JSON, or anything
      // else) leads with JSON. Both keep the text/octet-stream fallbacks, since
      // some Android providers mislabel a .csv as `application/octet-stream`.
      const type =
        source === 'splitwise'
          ? ['text/csv', 'text/comma-separated-values', 'text/plain', 'application/octet-stream']
          : [
              'application/json',
              'text/csv',
              'text/comma-separated-values',
              'text/plain',
              'application/octet-stream',
            ];
      const picked = await DocumentPicker.getDocumentAsync({
        type,
        copyToCacheDirectory: true,
      });
      if (picked.canceled) return;

      const asset = picked.assets[0];
      if (!asset) return;

      setFileGroups([]);
      setFileGroupIndex(0);
      setParsed(null);

      // Paint the "reading" bar before touching the file. The read below is
      // async, but the parse after it is not — both run on this thread, so
      // without a frame here a large file blocks before any progress shows.
      setStage('reading');
      await nextFrame();

      const pickedFile = new FileSystem.File(asset.uri);
      // Async read (Blob.text) rather than the synchronous textSync: a large
      // file no longer holds the JS thread while it comes off disk.
      const text = await pickedFile.text();
      try {
        if (pickedFile.exists) pickedFile.delete();
      } catch {
        // Best-effort privacy cleanup; parsing has already copied the content into memory.
      }
      setFile(asset.name);

      // The parse is synchronous and can be the slow part on a big file, so flush
      // the "parsing" label to the screen before it blocks the thread.
      setStage('parsing');
      await nextFrame();

      // Asked of the contents, not the extension: a file saved from a browser
      // or shared through a chat app arrives named all sorts of things.
      if (isWavesExport(text)) {
        const result = parseWavesExport(text);
        if (result.problems.length > 0) {
          setError(importProblemText(result.problems[0]!, t.importLedger));
          return;
        }
        const fallback = asset.name.replace(/\.json$/i, '');
        if (result.groups.length === 0 || !result.groups[0]) {
          setError(t.importLedger.noGroupsInFile);
          return;
        }
        setFileGroups(result.groups);
        load(fromWaves(result.groups[0], fallback));
        return;
      }

      const result = importSplitwiseCsv(text);
      load({
        origin: 'splitwise',
        // A Splitwise CSV is named "export" more often than not and carries no
        // group name of its own, so default to the source's own name rather than
        // a filename that means nothing. The person can rename the group later.
        suggestedName: t.importLedger.splitwiseGroupName,
        people: result.people,
        currency: result.currency,
        expenses: result.expenses,
        settlements: [],
        balances: result.balances,
        otherCurrencies: [],
        problems: result.problems,
      });
    } catch (caught) {
      setError(friendlyError(caught, t.importLedger.importFailed, 'import.readFile'));
    } finally {
      setBusy(false);
      setStage(null);
    }
  };

  const chooseTarget = async (groupId: string): Promise<void> => {
    setTarget(groupId);
    setMapping((current) =>
      Object.fromEntries(Object.keys(current).map((person) => [person, { kind: 'ghost' }])),
    );
    setMembers(groupId === NEW_GROUP ? [] : await fetchMembers(groupId));
  };

  /** Cycle a column through: new person → you → each existing member → back. */
  const cycle = (person: string): void => {
    setMapping((current) => {
      const now = current[person] ?? { kind: 'ghost' };
      const others = members.filter((member) => !isViewer(member, viewerId));

      let next: Mapping;
      if (now.kind === 'ghost') next = { kind: 'me' };
      else if (now.kind === 'me')
        next = others[0] ? { kind: 'member', memberId: others[0].id } : { kind: 'ghost' };
      else {
        const index = others.findIndex((member) => member.id === now.memberId);
        const following = others[index + 1];
        next = following ? { kind: 'member', memberId: following.id } : { kind: 'ghost' };
      }

      // One column at most can be you; taking the badge takes it from whoever
      // held it, rather than importing two of you and halving your balance.
      const cleared =
        next.kind === 'me'
          ? Object.fromEntries(
              Object.entries(current).map(([key, value]) =>
                value.kind === 'me' ? [key, { kind: 'ghost' } as Mapping] : [key, value],
              ),
            )
          : current;
      return { ...cleared, [person]: next };
    });
  };

  const describeMapping = (person: string): string => {
    const chosen = mapping[person] ?? { kind: 'ghost' };
    if (chosen.kind === 'me') return t.account.you;
    if (chosen.kind === 'ghost') return t.importLedger.newPerson;
    const member = members.find((one) => one.id === chosen.memberId);
    return member ? displayName(member, viewerId) : t.importLedger.newPerson;
  };

  const claimedByMe = Object.values(mapping).some((value) => value.kind === 'me');

  /**
   * Hand the import to the background store and walk home. The write itself no
   * longer happens on this screen: the moment it is kicked, we replace this
   * screen with the dashboard, where a banner above the group list tracks the
   * percentage and the finished group animates into the list. The job below
   * closes over everything it needs, so it runs to completion whether or not
   * this screen is still mounted (see `@/lib/importProgress`).
   */
  const run = (): void => {
    if (!parsed) return;
    const snapshot = parsed;
    const chosenMapping = mapping;
    const chosenTarget = target;
    const ids = mutationIds;
    const iClaimedAColumn = claimedByMe;
    // What the person typed, falling back to the file's suggestion and then a
    // generic label — a new group never lands nameless.
    const name = newGroupName.trim() || snapshot.suggestedName || t.importLedger.importedGroup;
    // A client-chosen id for a brand-new group, fixed here so the whole job is a
    // safe replay: if the store re-runs it after an offline wait, createGroup is
    // idempotent on this id (returns the same group, never a second one) and the
    // ledger write dedups on its mutation ids. Unused for an existing target.
    const newGroupId = randomUUID();

    // The one precondition we can settle before leaving: claiming yourself in an
    // existing group you are not a member of would file your history under a
    // ghost. A new group makes you a member, so this only bites an existing
    // target — and there we already hold its members, so the check is local.
    if (
      chosenTarget !== NEW_GROUP &&
      iClaimedAColumn &&
      !members.some((member) => isViewer(member, viewerId))
    ) {
      setError(t.importLedger.couldNotFindYou);
      return;
    }

    const scheduled = beginImport({
      name,
      run: async () => {
        try {
          let groupId = chosenTarget;
          if (groupId === NEW_GROUP) {
            groupId = newGroupId;
            await createGroup({
              groupId: newGroupId,
              name,
              type: GroupType.Other,
              currency: snapshot.currency,
            });
          }

          // Whoever is "you" maps to your own membership in the target group; the
          // server resolves the rest, so a null memberId means "make a ghost".
          const mine = (await fetchMembers(groupId)).find((member) => isViewer(member, viewerId));
          if (iClaimedAColumn && !mine) throw new Error(t.importLedger.couldNotFindYou);

          const people: ImportPerson[] = snapshot.people.map((person) => {
            const chosen = chosenMapping[person] ?? { kind: 'ghost' };
            if (chosen.kind === 'me') return { name: person, memberId: mine?.id ?? null };
            if (chosen.kind === 'member') return { name: person, memberId: chosen.memberId };
            return { name: person, memberId: null };
          });

          const result = await importLedger({
            groupId,
            people,
            origin: snapshot.origin,
            expenses: snapshot.expenses.map((expense, index) => ({
              clientMutationId: ids[index] ?? randomUUID(),
              description: expense.description,
              category: expense.category,
              date: expense.date,
              currency: expense.currency,
              amount: expense.amount,
              payers: expense.payers,
              shares: expense.shares,
            })),
            settlements: snapshot.settlements.map((settlement, index) => ({
              clientMutationId: ids[snapshot.expenses.length + index] ?? randomUUID(),
              from: settlement.from,
              to: settlement.to,
              currency: settlement.currency,
              amount: settlement.amount,
              method: settlement.method,
              status: settlement.status,
              note: settlement.note,
              at: settlement.at,
            })),
          });

          // Pull the new group into the mirror so Home can show (and animate) it.
          groups.refetch();
          return {
            groupId,
            expenses: result.expenses,
            ghosts: result.ghosts,
            settlements: result.settlements ?? 0,
            settlementsPending: result.settlementsPending ?? 0,
          };
        } catch (caught) {
          // Keep the one precondition message as-is; wrap everything else in a
          // people-facing line. The store shows whichever we throw verbatim.
          if (caught instanceof Error && caught.message === t.importLedger.couldNotFindYou) {
            throw caught;
          }
          throw new Error(friendlyError(caught, t.importLedger.importFailed, 'import.commit'));
        }
      },
    });

    // Only leave once the job is actually on. If another import is already
    // running, the store refused this one — staying put with a message beats
    // walking home to watch a different import and silently losing this file.
    if (!scheduled) {
      setError(t.importLedger.alreadyImporting);
      return;
    }
    router.replace('/');
  };

  return (
    <Screen>
      <Row style={{ paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.sm }}>
        <IconButton label={t.common.back} onPress={() => router.back()}>
          <Ionicons name={directionalIcon('chevron-back')} size={iconSize.lg} color={ink} />
        </IconButton>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={{ fontSize: 20, fontWeight: '700', color: ink }}>
            {t.importLedger.ledgerTitle}
          </Text>
        </View>
        <IconButton label={t.importLedger.helpTitle} onPress={() => setHelpOpen(true)}>
          <Ionicons name="help-circle-outline" size={iconSize.lg} color={ink} />
        </IconButton>
      </Row>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: clearance,
          paddingTop: theme.spacing.sm,
          gap: 12,
        }}
        showsVerticalScrollIndicator={false}
      >
        <LinearGradient
          colors={dark ? [theme.color.surface, theme.color.surface] : ['#FFFFFF', '#F1EEFD']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            borderRadius: 18,
            paddingVertical: 14,
            paddingLeft: 16,
            paddingRight: 8,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            overflow: 'hidden',
          }}
        >
          <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
            <Text style={{ fontSize: 17, fontWeight: '800', color: ink }}>
              {t.importLedger.bringHistory}
            </Text>
            <Text style={{ fontSize: 13, lineHeight: 18, color: muted }}>
              {t.importLedger.ledgerHowTo}
            </Text>
          </View>
          <CsvArt />
        </LinearGradient>

        {/* Two ways in, one flow: the file's contents decide the format either
            way (see choose()), so these only set the picker's expectation and
            the wording the person reads. Once a file is loaded, the block below
            takes over; the buttons stay as the way to pick a different one. */}
        <PillButton
          label={t.importLedger.fromSplitwise}
          icon="document-text-outline"
          chevron
          disabled={busy}
          onPress={() => void choose('splitwise')}
        />
        <PillButton
          label={t.importLedger.fromOther}
          icon="folder-open-outline"
          variant="soft"
          disabled={busy}
          onPress={() => void choose('other')}
        />

        {stage === 'reading' || stage === 'parsing' ? (
          <View style={{ gap: theme.spacing.sm }}>
            <Text style={{ fontSize: 13, color: muted }}>
              {stage === 'reading' ? t.importLedger.reading : t.importLedger.parsing}
            </Text>
            <ProgressBar animated={!reduceMotion} />
          </View>
        ) : null}

        {/* A file holding several groups: one at a time, chosen here. */}
        {fileGroups.length > 1 && !done ? (
          <View style={{ gap: 8 }}>
            <SectionTitle>{t.importLedger.whichGroup}</SectionTitle>
            <ChipRow<string>
              // Keyed by position, not by name: two groups in one export can
              // share a name, and matching on the name loads the first of them
              // whichever chip is tapped.
              value={String(fileGroupIndex)}
              onChange={(key) => {
                const index = Number(key);
                const chosen = fileGroups[index];
                if (chosen) {
                  setFileGroupIndex(index);
                  load(fromWaves(chosen, numberedGroup(t, index)));
                }
              }}
              options={fileGroups.map((group, index) => ({
                value: String(index),
                label: `${group.name ?? numberedGroup(t, index)} · ${group.expenses.length}`,
              }))}
            />
          </View>
        ) : null}

        {parsed && !done ? (
          <>
            <SoftCard>
              <Row style={{ alignItems: 'center', gap: 12 }}>
                <FileBadge kind={parsed.origin === 'waves' ? 'JSON' : 'CSV'} />
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: ink }} numberOfLines={1}>
                    {file}
                  </Text>
                  <Text style={{ fontSize: 13, color: muted }}>
                    {plural(locale, parsed.expenses.length, t.importLedger.expenseCount)}
                    {parsed.settlements.length > 0
                      ? ` · ${plural(locale, parsed.settlements.length, t.importLedger.settlementCount)}`
                      : ''}{' '}
                    · {plural(locale, parsed.people.length, t.importLedger.peopleCount)} ·{' '}
                    {parsed.currency}
                  </Text>
                </View>
                {parsed.expenses.length > 0 ? (
                  <Ionicons name="checkmark-circle" size={28} color="#1FA463" />
                ) : null}
              </Row>
              <View style={{ height: 1, backgroundColor: line }} />
              <Text style={{ fontSize: 13, lineHeight: 18, color: muted }}>
                {parsed.origin === 'waves'
                  ? t.importLedger.fromWavesNote
                  : t.importLedger.fromSplitwiseNote}
              </Text>
              {parsed.otherCurrencies.length > 0 ? (
                <Text style={{ fontSize: 12, color: muted }}>
                  {t.importLedger.otherCurrenciesNote
                    .replace('{currency}', parsed.currency)
                    .replace('{others}', parsed.otherCurrencies.join(', '))}
                </Text>
              ) : null}
            </SoftCard>

            {parsed.problems.length > 0 ? (
              <SoftCard>
                <Text style={{ fontSize: 15, fontWeight: '700', color: theme.color.negative }}>
                  {plural(locale, parsed.problems.length, t.importLedger.rowsSkipped)}
                </Text>
                {parsed.problems.slice(0, 6).map((problem) => (
                  <Text
                    key={`${problem.kind}-${problem.row}`}
                    style={{ fontSize: 13, color: muted }}
                  >
                    {importProblemLine(problem, t.importLedger)}
                  </Text>
                ))}
                {parsed.problems.length > 6 ? (
                  <Text style={{ fontSize: 12, color: muted }}>
                    {t.importLedger.andMore.replace('{n}', String(parsed.problems.length - 6))}
                  </Text>
                ) : null}
              </SoftCard>
            ) : null}

            {parsed.expenses.length > 0 ? (
              <View style={{ gap: 8 }}>
                <SectionTitle>{t.importLedger.whereItGoes}</SectionTitle>
                {/* Two choices, not a list of every group: a new group is the
                    usual answer, and the rest wait behind one tap in a sheet. */}
                <SoftCard style={{ padding: 6, gap: 0 }}>
                  <TargetRow
                    label={t.importLedger.aNewGroup}
                    hint={t.importLedger.nameItBelow}
                    icon="add"
                    tint={0}
                    selected={target === NEW_GROUP}
                    onPress={() => void chooseTarget(NEW_GROUP)}
                  />
                  <TargetRow
                    label={chosenGroup ? labelOf(chosenGroup) : t.importLedger.anExistingGroup}
                    hint={
                      chosenGroup
                        ? `${plural(locale, summary.memberCountFor(chosenGroup.id), t.memberCount)} · ${t.importLedger.tapToChange}`
                        : t.importLedger.anExistingGroupHint
                    }
                    icon="people-outline"
                    tint={1}
                    divider
                    chevron={!chosenGroup}
                    selected={chosenGroup !== null}
                    onPress={() => setPickerOpen(true)}
                  />
                </SoftCard>

                {/* Name the new group here rather than accept the file's default.
                    Only for a new group — an existing target already has a name. */}
                {target === NEW_GROUP ? (
                  <View style={{ marginTop: 4, gap: 6 }}>
                    <Text style={{ fontSize: 13, color: muted, paddingHorizontal: 4 }}>
                      {t.group.groupName}
                    </Text>
                    <Row
                      style={{
                        alignItems: 'center',
                        gap: 12,
                        height: 48,
                        paddingHorizontal: 14,
                        borderRadius: 14,
                        borderWidth: 1,
                        borderColor: line,
                        backgroundColor: theme.color.surface,
                      }}
                    >
                      <Ionicons name="people-outline" size={20} color={muted} />
                      <TextInput
                        value={newGroupName}
                        onChangeText={setNewGroupName}
                        placeholder={parsed.suggestedName}
                        placeholderTextColor={theme.color.textFaint}
                        accessibilityLabel={t.group.groupName}
                        returnKeyType="done"
                        style={{
                          flex: 1,
                          fontSize: 16,
                          fontWeight: '600',
                          color: ink,
                          paddingVertical: 0,
                        }}
                      />
                      {newGroupName.length > 0 ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={t.entry.clear}
                          onPress={() => setNewGroupName('')}
                          hitSlop={8}
                          style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
                        >
                          <Ionicons name="close-circle" size={20} color={theme.color.textFaint} />
                        </Pressable>
                      ) : null}
                    </Row>
                  </View>
                ) : null}
              </View>
            ) : null}

            {parsed.expenses.length > 0 ? (
              <View style={{ gap: 8 }}>
                <SectionTitle>{t.importLedger.whoIsWho}</SectionTitle>
                <SoftCard style={{ paddingVertical: 4, paddingHorizontal: 14, gap: 0 }}>
                  {parsed.people.map((person, index) => {
                    const claimed = mapping[person]?.kind !== 'ghost';
                    return (
                      <Pressable
                        key={person}
                        onPress={() => cycle(person)}
                        accessibilityRole="button"
                        accessibilityLabel={t.importLedger.personIsMapped
                          .replace('{name}', person)
                          .replace('{who}', describeMapping(person))}
                        style={({ pressed }) => ({
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 12,
                          paddingVertical: 8,
                          borderTopWidth: index > 0 ? 1 : 0,
                          borderTopColor: line,
                          opacity: pressed ? 0.7 : 1,
                        })}
                      >
                        <Avatar name={person} size={32} tint={tintForKey(person)} />
                        <Text
                          style={{
                            flex: 1,
                            minWidth: 0,
                            fontSize: 15,
                            fontWeight: '600',
                            color: ink,
                          }}
                          numberOfLines={1}
                        >
                          {person}
                        </Text>
                        <MoneyText
                          amount={parsed.balances[person] ?? 0n}
                          currency={parsed.currency}
                          variant="caption"
                        />
                        <View
                          style={{
                            paddingHorizontal: 10,
                            paddingVertical: 4,
                            borderRadius: 12,
                            backgroundColor: claimed ? accent : lavender,
                          }}
                        >
                          <Text
                            style={{
                              fontSize: 12,
                              fontWeight: '600',
                              color: claimed ? '#FFFFFF' : accent,
                            }}
                            numberOfLines={1}
                          >
                            {describeMapping(person)}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </SoftCard>
                <Text style={{ fontSize: 12, color: muted, paddingHorizontal: 4 }}>
                  {t.importLedger.tapANameNote}
                </Text>
              </View>
            ) : null}

            {parsed.expenses.length > 0 ? (
              <>
                <PillButton
                  label={
                    busy
                      ? t.importLedger.importing
                      : plural(locale, parsed.expenses.length, t.importLedger.importCount)
                  }
                  icon="cloud-upload-outline"
                  disabled={busy || !claimedByMe}
                  onPress={() => run()}
                />
                {!claimedByMe ? (
                  <Text style={{ fontSize: 13, color: muted, textAlign: 'center' }}>
                    {t.importLedger.tapYourNameFirst}
                  </Text>
                ) : null}
              </>
            ) : null}
          </>
        ) : null}

        {done ? (
          <SoftCard>
            <Row style={{ alignItems: 'center', gap: 10 }}>
              <Ionicons name="checkmark-circle" size={26} color="#1FA463" />
              <Text style={{ fontSize: 17, fontWeight: '700', color: ink }}>
                {t.importLedger.imported}
              </Text>
            </Row>
            <Text style={{ fontSize: 13, color: muted }}>
              {plural(locale, done.expenses, t.importLedger.expenseCount)}
              {done.settlements > 0
                ? ` · ${plural(locale, done.settlements, t.importLedger.settlementCount)}`
                : ''}
              {done.ghosts > 0
                ? ` · ${plural(locale, done.ghosts, t.importLedger.peopleAdded)}`
                : ''}
            </Text>
            {done.settlementsPending > 0 ? (
              <Text style={{ fontSize: 13, color: muted }}>
                {plural(locale, done.settlementsPending, t.importLedger.settlementsPending)}
              </Text>
            ) : null}
            <PillButton
              label={t.importLedger.openTheGroup}
              icon="people-outline"
              onPress={() => router.replace(`/group/${done.groupId}`)}
            />
          </SoftCard>
        ) : null}

        {error ? <Callout tone="negative">{error}</Callout> : null}
      </ScrollView>

      {/* Every group I am in, to pick the one the rows go into. Picking one
          closes the sheet; the card behind then names it. */}
      <Sheet
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        padded={false}
        closeLabel={t.common.close}
        style={{ paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.lg, gap: 10 }}
      >
        <Text style={{ fontSize: 20, fontWeight: '800', color: ink, paddingHorizontal: 8 }}>
          {t.importLedger.chooseGroup}
        </Text>
        <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
          {(groups.data ?? []).map((group, index) => (
            <TargetRow
              key={group.id}
              label={labelOf(group)}
              hint={plural(locale, summary.memberCountFor(group.id), t.memberCount)}
              icon="people-outline"
              tint={index + 1}
              divider={index > 0}
              selected={target === group.id}
              onPress={() => {
                setPickerOpen(false);
                void chooseTarget(group.id);
              }}
            />
          ))}
        </ScrollView>
      </Sheet>

      {/* How it works, on tap of the header's help glyph. This sheet is where
          the longer explanation lives, so the screen itself can stay short:
          where each file comes from, what does and does not come across, and
          that none of it needs a connection. */}
      <Sheet
        visible={helpOpen}
        onClose={() => setHelpOpen(false)}
        padded={false}
        closeLabel={t.common.close}
        style={{
          paddingHorizontal: theme.spacing.xxl,
          paddingTop: theme.spacing.xl,
          gap: theme.spacing.lg,
        }}
      >
        <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
          <Ionicons name="help-circle-outline" size={iconSize.xl} color={theme.color.brand} />
          <Text variant="title">{t.importLedger.helpTitle}</Text>
        </Row>
        <ScrollView
          style={{ maxHeight: 340 }}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ gap: theme.spacing.md }}
        >
          {/* Where the file comes from. The screen's two buttons name the
              sources; only this — the menu to go through in the other app — is
              the part somebody cannot work out by looking. */}
          <Text variant="body" tone="muted">
            {t.importLedger.splitwiseHowTo}
          </Text>
          <Text variant="body" tone="muted">
            {t.importLedger.wavesHowTo}
          </Text>
          <Divider />
          <Text variant="caption" tone="muted">
            {t.importLedger.fromSplitwiseNote}
          </Text>
          <Text variant="caption" tone="muted">
            {t.importLedger.fromWavesNote}
          </Text>
          <Divider />
          {/* Offline: parked and run on reconnect (see `@/lib/importProgress`). */}
          <Text variant="caption" tone="muted">
            {t.importLedger.helpOffline}
          </Text>
        </ScrollView>
        <Button label={t.misc.gotIt} fullWidth onPress={() => setHelpOpen(false)} />
      </Sheet>
    </Screen>
  );
}

/** The mockup's inks in the light theme; the theme's own in the dark. */
function useImportInks() {
  const theme = useTheme();
  const dark = theme.scheme === 'dark';
  return {
    dark,
    ink: dark ? theme.color.text : SPEC_INK,
    muted: dark ? theme.color.textMuted : SPEC_MUTED,
    accent: dark ? theme.color.brand : SPEC_ACCENT,
    lavender: dark ? theme.color.surfaceMuted : '#EFEBFD',
    line: dark ? theme.color.border : '#ECEAF4',
  };
}

/** Rotating soft tints for the group discs, so neighbours never match. */
const DISC_TINTS: readonly { fg: string; bg: string }[] = [
  { fg: '#6845E8', bg: '#EFEBFD' },
  { fg: '#2F6FE4', bg: '#E7F0FE' },
  { fg: '#E8871E', bg: '#FFF1E0' },
  { fg: '#1F9D74', bg: '#E3F6EF' },
  { fg: '#D6457E', bg: '#FDE8F1' },
];

/** A white card with the redesign's soft corners and lift. */
function SoftCard({ children, style }: { children: ReactNode; style?: object }) {
  const theme = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: theme.color.surface,
          borderRadius: 18,
          padding: 14,
          gap: 10,
          shadowColor: '#2A1E6B',
          shadowOpacity: theme.scheme === 'dark' ? 0 : 0.06,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: 4 },
          elevation: 2,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

function SectionTitle({ children }: { children: string }) {
  const { ink } = useImportInks();
  return (
    <Text accessibilityRole="header" style={{ fontSize: 18, fontWeight: '800', color: ink }}>
      {children}
    </Text>
  );
}

/** A full-width pill: deep violet for the way forward, lavender for the other
 *  way in. */
function PillButton({
  label,
  icon,
  onPress,
  disabled = false,
  chevron = false,
  variant = 'solid',
}: {
  label: string;
  icon: IconName;
  onPress: () => void;
  disabled?: boolean;
  chevron?: boolean;
  variant?: 'solid' | 'soft';
}) {
  const theme = useTheme();
  const { dark, accent, lavender } = useImportInks();
  const solid = variant === 'solid';
  const fg = solid ? '#FFFFFF' : accent;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        height: 50,
        borderRadius: 25,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        paddingHorizontal: 20,
        backgroundColor: solid ? (dark ? theme.color.brand : '#3E2A9E') : lavender,
        opacity: disabled ? 0.5 : pressed ? 0.88 : 1,
      })}
    >
      <Ionicons name={icon} size={20} color={fg} />
      <Text style={{ fontSize: 16, fontWeight: '700', color: fg }} numberOfLines={1}>
        {label}
      </Text>
      {chevron ? (
        <Ionicons
          name={directionalIcon('chevron-forward')}
          size={18}
          color={fg}
          style={{ position: 'absolute', end: 18 }}
        />
      ) : null}
    </Pressable>
  );
}

/** The loaded file's type, as a folded green page with its extension. */
function FileBadge({ kind }: { kind: string }) {
  return (
    <View
      style={{
        width: 44,
        height: 50,
        borderRadius: 8,
        borderTopRightRadius: 16,
        backgroundColor: '#DDF3E7',
        justifyContent: 'flex-end',
        alignItems: 'center',
        paddingBottom: 6,
      }}
    >
      <View style={{ paddingHorizontal: 4, borderRadius: 3, backgroundColor: '#1FA463' }}>
        <Text style={{ fontSize: 9, fontWeight: '800', color: '#FFFFFF' }}>{kind}</Text>
      </View>
    </View>
  );
}

function TargetRow({
  label,
  hint,
  icon,
  tint,
  divider = false,
  chevron = false,
  selected,
  onPress,
}: {
  label: string;
  hint?: string;
  icon: IconName;
  tint: number;
  divider?: boolean;
  /** Leads to a choice rather than being one: a chevron in place of the radio. */
  chevron?: boolean;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const { dark, ink, muted, accent, lavender, line } = useImportInks();
  const disc = DISC_TINTS[tint % DISC_TINTS.length] ?? DISC_TINTS[0]!;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={chevron ? 'button' : 'radio'}
      accessibilityLabel={hint ? `${label}, ${hint}` : label}
      accessibilityState={{ selected }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 8,
        paddingHorizontal: 8,
        borderRadius: 14,
        backgroundColor: selected ? lavender : 'transparent',
        opacity: pressed ? 0.8 : 1,
      })}
    >
      {divider && !selected ? (
        <View
          style={{
            position: 'absolute',
            top: 0,
            start: 8,
            end: 8,
            height: 1,
            backgroundColor: line,
          }}
        />
      ) : null}
      <View
        style={{
          width: 38,
          height: 38,
          borderRadius: 19,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: dark ? theme.color.surfaceMuted : disc.bg,
        }}
      >
        <Ionicons name={icon} size={icon === 'add' ? 22 : 18} color={disc.fg} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
        <Text style={{ fontSize: 15, fontWeight: '600', color: ink }} numberOfLines={1}>
          {label}
        </Text>
        {hint ? <Text style={{ fontSize: 12, color: muted }}>{hint}</Text> : null}
      </View>
      {chevron ? (
        <Ionicons
          name={directionalIcon('chevron-forward')}
          size={20}
          color={theme.color.textFaint}
        />
      ) : (
        <Ionicons
          name={selected ? 'radio-button-on' : 'radio-button-off'}
          size={22}
          color={selected ? accent : theme.color.textFaint}
        />
      )}
    </Pressable>
  );
}

/** The hero's picture: a CSV page, a dashed arrow, and the people it becomes.
 *  Drawn from views and glyphs, so it themes and costs no asset. */
function CsvArt() {
  const theme = useTheme();
  const dark = theme.scheme === 'dark';
  const disc = (color: string, size: number, style: object) => (
    <View
      style={[
        {
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: color,
          borderWidth: 2,
          borderColor: dark ? theme.color.surface : '#FFFFFF',
        },
        style,
      ]}
    >
      <Ionicons name="person" size={size * 0.5} color="#FFFFFF" />
    </View>
  );
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: 118, height: 84 }}
    >
      <View
        style={{
          position: 'absolute',
          left: 6,
          top: 14,
          width: 50,
          height: 62,
          borderRadius: 8,
          padding: 7,
          gap: 5,
          backgroundColor: dark ? theme.color.surfaceMuted : '#FFFFFF',
          transform: [{ rotate: '-8deg' }],
          shadowColor: '#2A1E6B',
          shadowOpacity: 0.12,
          shadowRadius: 6,
          shadowOffset: { width: 0, height: 3 },
          elevation: 3,
        }}
      >
        <View style={{ height: 3, borderRadius: 2, backgroundColor: '#DCD6FA' }} />
        <View style={{ height: 3, width: 22, borderRadius: 2, backgroundColor: '#DCD6FA' }} />
        <View
          style={{
            marginTop: 8,
            alignSelf: 'flex-start',
            paddingHorizontal: 5,
            paddingVertical: 1,
            borderRadius: 4,
            backgroundColor: '#5A3FD8',
          }}
        >
          <Text style={{ fontSize: 10, fontWeight: '800', color: '#FFFFFF' }}>CSV</Text>
        </View>
      </View>
      <View
        style={{
          position: 'absolute',
          left: 44,
          top: 4,
          width: 40,
          height: 24,
          borderTopWidth: 1.5,
          borderRightWidth: 1.5,
          borderStyle: 'dashed',
          borderColor: '#8C7BF0',
          borderTopRightRadius: 20,
        }}
      />
      {disc('#9C8CF2', 30, { right: 6, top: 4 })}
      {disc('#6FA4F5', 30, { right: 30, top: 42 })}
      {disc('#F5A66F', 24, { right: 0, top: 44 })}
    </View>
  );
}

/** The name a group falls back to when the file did not give it one. */
function numberedGroup(t: UiStrings, index: number): string {
  return t.importLedger.groupNumber.replace('{n}', String(index + 1));
}
