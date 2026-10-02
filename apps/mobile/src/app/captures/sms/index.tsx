/**
 * Bank messages — its own screen, which is the whole point of it.
 *
 * This used to be part of Review, and it should not have been. Review is the
 * short list of things genuinely waiting on a person: four drafts, each one a
 * question with an answer. Bank messages are a *stream* — a quarter of them is
 * hundreds of rows, most of which nobody needs to do anything about — and
 * pouring a stream into a list of questions makes the questions unfindable.
 * Worse, it made the list change while nobody was looking: an hourly job would
 * add eleven rows to the screen a person was in the middle of reading.
 *
 * So they are two screens, and the verbs are different. Review is answered.
 * This is *worked*: searched, narrowed by date, ticked in batches, placed
 * together. Everything below follows from that.
 *
 * ## The shape
 *
 * **Three piles, not one list.** Spent, Received, Neither — `classifySms`
 * decides which, and the third is the one that earns the feature its keep. Every
 * row in it is a debit: a credit card bill paid out of the same account that
 * made the purchases, a wallet loaded, a fund bought, cash from a machine. Read
 * as expenses they double-count a whole month, and an app that showed them as
 * spending would be wrong in a way its user could feel but not explain. They are
 * shown, named, and not counted.
 *
 * **A scan is an event you can watch.** Not a number that changes on another
 * screen. `SmsScanSheet` owns the choice, the progress and the outcome.
 *
 * **The promise is on the screen, not in a settings page.** One line under the
 * title, and again inside the scan while somebody is watching their own bank
 * messages being read. It is the reason this feature can exist at all and it is
 * worth the two lines.
 *
 * **Ticking is the main verb, so the tick boxes are always there.** Not behind
 * a long press. "Select all" means the rows on screen — never the ones a search
 * is hiding, which is the one mistake here that would cost real money.
 *
 * ## What syncs, and what does not
 *
 * The messages live in a device-only database that the sync engine cannot see
 * (`lib/smsMessageStore.ts`). Placing rows in a group writes ordinary expenses
 * — the shop, the amount, the day — and nothing else. The bodies stay on the
 * phone. Nothing on this path reports a count, a merchant or a body to Sentry,
 * Clarity or any analytics.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { FlashList } from '@shopify/flash-list';
import { randomUUID } from 'expo-crypto';
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import { MutationKind, peopleSignatureKey, SmsKind } from '@waves/core';
import {
  Button,
  EmptyState,
  IconButton,
  iconSize,
  MoneyText,
  Row,
  Screen,
  Sheet,
  Text,
  useTheme,
} from '@waves/ui';

import {
  DestinationPicker,
  type DestinationSelection,
  type PersonChoice,
} from '@/components/DestinationPicker';
import {
  capped,
  SmsAddBar,
  SmsDayHeader,
  SmsKindTabs,
  SmsTotalCard,
} from '@/components/SmsInboxParts';
import { filterLabel, SmsFilterSheet } from '@/components/SmsFilterSheet';
import { SignInWall } from '@/components/SignInWall';
import { SmsMessageRow } from '@/components/SmsMessageRow';
import { SmsScanOptionsSheet, SmsScanProgress, useSmsScan } from '@/components/SmsScanSheet';
import {
  useAddGhostMember,
  useAssignCapture,
  useCaptures,
  useCreateGroup,
  useGroupPeopleSignatures,
  useGroups,
  useHomeSummary,
  useOneToOneGroupIds,
  usePeopleBalances,
} from '@/data/hooks';
import { dayHeading } from '@/data/activity';
import { groupLabel, GroupType, isViewer } from '@/data/types';
import { plural, useStrings } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { planCaptureAssign, type AssignMember } from '@/lib/captureBulkAssign';
import { useBottomClearance } from '@/lib/clearance';
import { friendlyError } from '@/lib/errors';
import { useGuestGuard } from '@/lib/guestGuard';
import { router } from '@/lib/navigation';
import {
  allSelected,
  DEFAULT_DATE_FILTER,
  selectedRows,
  smsInboxRows,
  sumOf,
  toggleAll,
  toggleSelected,
  waitingCounts,
  type SmsDateFilter,
} from '@/lib/smsInbox';
import { reloadMessages, useSmsMessages } from '@/lib/smsMessages';
import { SmsSettlement, type StoredSms } from '@/lib/smsMessageTypes';
import { settleMessages } from '@/lib/smsMessageStore';
import { smsCaptureId } from '@/lib/smsCaptureId';
import { useSmsInboxReader } from '@/lib/smsFeature';
import { smsRowAsCapture, splitPlaceable } from '@/lib/smsPlacement';
import { takeScanRequest } from '@/lib/smsReadBridge';
import { ScanScope } from '@/lib/smsScan';
import { useToast } from '@/lib/toast';
import { usePlaceInPersonal } from '@/lib/usePlaceInPersonal';
import { useSync } from '@/sync';

/** What the bar at the foot takes up, so the last row can scroll clear of it. */
const BAR_RUNWAY = 100;

type ListItem =
  | {
      readonly type: 'day';
      readonly label: string;
      readonly total: bigint | null;
      readonly currency: string;
    }
  | { readonly type: 'row'; readonly row: StoredSms };

export default function SmsInboxScreen(): React.JSX.Element | null {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const clearance = useBottomClearance();
  const { session, isGuest } = useAuth();
  const ownerId = session?.user?.id ?? '';
  const reader = useSmsInboxReader();

  /**
   * Who to resolve "me" against: the session's user id, not the profile's.
   *
   * Same id, different arrival times — the session is restored from storage at
   * launch, the profile is a network fetch. Using the profile here made two
   * things wrong for as long as that fetch took: the group list was filtered by
   * a comparison that matches the first *ghost* rather than you (see
   * `data/types.isViewer`), and `myMemberId` — who goes down as having paid —
   * resolved the same way. An expense filed in that window would have named a
   * ghost as the payer.
   */
  const viewerId = session?.user?.id ?? null;
  const { rows, loading, reload } = useSmsMessages();
  const toast = useToast();
  // The shared path to the private ledger, behind the sheet's "Just me" row.
  const placeInPersonal = usePlaceInPersonal();
  const guard = useGuestGuard();

  const [kind, setKind] = useState<SmsKind>(SmsKind.Expense);
  const [query, setQuery] = useState('');
  const [date, setDate] = useState<SmsDateFilter>(DEFAULT_DATE_FILTER);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  // What a recycled row reads from outside its own data: the tick it wears and
  // the theme its colours come from. A row only re-renders when this changes,
  // so leaving the theme out strands rows in the scheme they were last drawn
  // in after a light/dark switch.
  const listExtraData = useMemo(() => ({ selected, theme }), [selected, theme]);
  const [scanOptionsOpen, setScanOptionsOpen] = useState(false);
  const reloadAfterScan = useCallback(() => void reload(), [reload]);
  const scan = useSmsScan(ownerId, reloadAfterScan);
  const startScan = scan.start;

  // Back from the disclosure screen with the permission just granted: scan
  // now, so granting and scanning were one tap.
  useFocusEffect(
    useCallback(() => {
      if (takeScanRequest()) void startScan(ScanScope.Recent);
    }, [startScan]),
  );
  const [filterOpen, setFilterOpen] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  // One slow clock for the whole screen — "2 days ago" on every row reads it,
  // and none of them may call Date.now() while rendering.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const visible = useMemo(
    () => smsInboxRows({ rows, kind, query, date, now }),
    [rows, kind, query, date, now],
  );
  const counts = useMemo(() => waitingCounts(rows), [rows]);
  const period = useMemo(() => sumOf(visible), [visible]);

  // Note what is *not* here: a pass that prunes the selection when the list
  // changes. It is unnecessary, and an effect that calls setState on every
  // render of a filtered list is a cascade waiting to happen. `chosen` below is
  // the intersection of what is ticked and what is on screen, so a key left
  // over from a row that has since been placed or filtered away is counted by
  // nothing and placed by nothing. The selection is cleared outright once a
  // placement succeeds.
  const chosen = useMemo(() => selectedRows(visible, selected), [visible, selected]);
  const chosenTotal = useMemo(() => sumOf(chosen), [chosen]);

  /** The list as days: a heading with the day's total, then that day's rows. */
  const items = useMemo((): ListItem[] => {
    const out: ListItem[] = [];
    let day: StoredSms[] = [];
    let label = '';
    const flush = (): void => {
      if (day.length === 0) return;
      const sum = sumOf(day);
      out.push({
        type: 'day',
        label,
        total: kind === SmsKind.Other ? null : sum.total,
        currency: sum.currency,
      });
      for (const row of day) out.push({ type: 'row', row });
    };
    for (const row of visible) {
      const heading = dayHeading(locale, row.at, now);
      if (heading !== label) {
        flush();
        day = [];
        label = heading;
      }
      day.push(row);
    }
    flush();
    return out;
  }, [visible, locale, now, kind]);

  // Ticking keeps the navigation: the bar at the foot sits above it, and is
  // there whether or not anything is ticked.
  const selecting = chosen.length > 0;

  // ─────────────────────────────────────────────── where things go ──

  const groups = useGroups();
  const summary = useHomeSummary(viewerId);
  const people = usePeopleBalances(viewerId);
  const oneToOne = useOneToOneGroupIds();
  const signatures = useGroupPeopleSignatures(viewerId);
  const createGroup = useCreateGroup();
  const assignCapture = useAssignCapture();
  const captures = useCaptures();
  const { mutate } = useSync();

  const [newGroupId, setNewGroupId] = useState(() => randomUUID());
  const [newMemberId, setNewMemberId] = useState(() => randomUUID());
  const addGhost = useAddGhostMember(newGroupId);

  // Only groups the viewer still belongs to. Leaving sets `left_at` and does
  // not remove the row, so a left group lingers in the local mirror.
  const assignableGroups = useMemo(
    () =>
      (groups.data ?? []).filter((group) =>
        summary.membersFor(group.id).some((member) => isViewer(member, viewerId)),
      ),
    [groups.data, summary, viewerId],
  );

  const peopleChoices = useMemo(() => {
    const byGroup = new Map<string, PersonChoice>();
    for (const row of people.data ?? []) {
      if (!row.only_group_id || !oneToOne.data.has(row.only_group_id)) continue;
      byGroup.set(row.only_group_id, {
        personKey: row.person_key,
        name: row.display_name,
        groupId: row.only_group_id,
      });
    }
    return [...byGroup.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [people.data, oneToOne.data]);

  const groupBySignature = useMemo(() => {
    const map = new Map<string, string>();
    for (const sig of signatures.data) {
      const key = peopleSignatureKey(sig.names);
      if (!map.has(key)) map.set(key, sig.groupId);
    }
    return map;
  }, [signatures.data]);

  /**
   * Ticked messages into a group, as ordinary expenses.
   *
   * Each row is its own attempt. One that refuses does not take the others with
   * it, and it is left ticked rather than vanishing into a success message that
   * would be a lie. Both writes ride the offline queue (ADR-005), so this works
   * with no network and survives being killed halfway.
   *
   * A row that already reached Review has a capture; that capture is closed
   * against the expense it became, so the same spend does not sit in two
   * places. A row that never became one simply has nothing to close.
   */
  const placeInGroup = useCallback(
    async (input: {
      groupId: string;
      label: string;
      members: readonly AssignMember[];
      myMemberId: string | null;
      currency: string;
    }): Promise<void> => {
      if (placing) return;
      if (guard.blockWrite()) return;
      setPlacing(true);
      try {
        const { placeable, unusable } = splitPlaceable(chosen);
        const ids = new Map<string, string>();
        for (const row of placeable) {
          ids.set(row.dedupeKey, await smsCaptureId(ownerId, row.dedupeKey));
        }

        const plan = planCaptureAssign({
          captures: placeable.map((row) => smsRowAsCapture(row, ownerId, ids.get(row.dedupeKey)!)),
          members: input.members,
          myMemberId: input.myMemberId,
          currency: input.currency,
        });

        // Which of these Review already holds, so its draft can be closed.
        const openCaptureIds = new Set((captures.data ?? []).map((capture) => capture.id));

        const done: string[] = [];
        let failed = unusable.length + plan.unusable.length;
        let firstError: unknown = undefined;
        for (const write of plan.writes) {
          try {
            await mutate(MutationKind.ExpenseCreate, input.groupId, write.payload);
            if (openCaptureIds.has(write.captureId)) {
              // Only once the expense is on the queue: a draft closed before
              // its expense exists is a spend that quietly disappeared.
              await assignCapture.mutateAsync({
                captureId: write.captureId,
                groupId: input.groupId,
                expenseId: write.expenseId,
              });
            }
            done.push(write.captureId);
          } catch (caught) {
            failed += 1;
            // Kept rather than dropped: a counted refusal with its reason
            // discarded is a failure nobody can look at afterwards.
            if (firstError === undefined) firstError = caught;
          }
        }

        // Map the expense ids back to the messages they came from, and mark
        // those messages as answered.
        const byId = new Map([...ids].map(([key, id]) => [id, key]));
        const settledKeys = done
          .map((id) => byId.get(id))
          .filter((key): key is string => key !== undefined);
        await settleMessages(
          ownerId,
          settledKeys,
          SmsSettlement.Placed,
          (key) => ids.get(key) ?? null,
        );
        await reloadMessages(ownerId);
        setSelected(new Set());

        if (settledKeys.length > 0) {
          toast.show(
            plural(locale, settledKeys.length, t.smsInbox.placed).replaceAll('{name}', input.label),
          );
        }
        if (failed > 0) {
          // The count *and* the reason. A refusal reported only as a number is
          // one nobody can act on or look up afterwards; `friendlyError` renders
          // it and reports it in the same breath.
          const why =
            firstError === undefined
              ? null
              : friendlyError(firstError, t.captures.couldNotSave, 'sms.placeItem');
          toast.show(
            [plural(locale, failed, t.captures.assignBatchSomeFailed), why]
              .filter(Boolean)
              .join(' '),
            'negative',
          );
        }
      } catch (caught) {
        toast.show(friendlyError(caught, t.captures.couldNotSave, 'sms.place'), 'negative');
      } finally {
        setPlacing(false);
      }
    },
    [
      assignCapture,
      captures.data,
      chosen,
      guard,
      locale,
      mutate,
      ownerId,
      placing,
      t.captures.assignBatchSomeFailed,
      t.captures.couldNotSave,
      t.smsInbox.placed,
      toast,
    ],
  );

  /**
   * The ticked messages as private personal expenses — the "Just me" row.
   *
   * The records and the closing of any Review drafts are the shared path's job
   * (`usePlaceInPersonal`); what stays here is this screen's own bookkeeping,
   * which no other caller has: a placed message is marked answered so it stops
   * appearing as something still waiting, and the list is reloaded from the
   * device store. Only the ones that actually landed are settled — settling a
   * message whose record never got written would hide a spend that was never
   * recorded.
   */
  const keepForMyself = useCallback(async (): Promise<void> => {
    if (placing) return;
    setPickerOpen(false);
    if (chosen.length === 0) return;
    setPlacing(true);
    try {
      const { placeable, unusable } = splitPlaceable(chosen);
      const ids = new Map<string, string>();
      for (const row of placeable) {
        ids.set(row.dedupeKey, await smsCaptureId(ownerId, row.dedupeKey));
      }
      const done = await placeInPersonal({
        lockKey: placeable[0]?.dedupeKey ?? 'personal',
        items: placeable.map((row) => smsRowAsCapture(row, ownerId, ids.get(row.dedupeKey)!)),
      });

      const byId = new Map([...ids].map(([key, id]) => [id, key]));
      const settledKeys = done
        .map((id) => byId.get(id))
        .filter((key): key is string => key !== undefined);
      await settleMessages(
        ownerId,
        settledKeys,
        SmsSettlement.Placed,
        (key) => ids.get(key) ?? null,
      );
      await reloadMessages(ownerId);
      setSelected(new Set());

      // A message the parser could not turn into an amount never had a record
      // to try, and the shared path never saw it — so it is reported here, next
      // to the count that did land, rather than silently dropped.
      if (unusable.length > 0) {
        toast.show(plural(locale, unusable.length, t.captures.assignBatchSomeFailed), 'negative');
      }
    } catch (caught) {
      toast.show(friendlyError(caught, t.captures.couldNotSave, 'sms.personal'), 'negative');
    } finally {
      setPlacing(false);
    }
  }, [
    chosen,
    locale,
    ownerId,
    placeInPersonal,
    placing,
    t.captures.assignBatchSomeFailed,
    t.captures.couldNotSave,
    toast,
  ]);

  const chooseExistingGroup = useCallback(
    (groupId: string): void => {
      setPickerOpen(false);
      const members = summary.membersFor(groupId);
      const group = assignableGroups.find((row) => row.id === groupId);
      void placeInGroup({
        groupId,
        label: group ? groupLabel(group, members, viewerId) : '',
        members,
        myMemberId: members.find((member) => isViewer(member, viewerId))?.id ?? null,
        currency: group?.default_currency ?? chosen[0]?.currency ?? 'INR',
      });
    },
    [assignableGroups, chosen, placeInGroup, viewerId, summary],
  );

  // The People tab, confirmed. If they already share a group it is that group's
  // expense; if not, the group is made here — a lone name is the 1:1 case,
  // several is a real group, both named after whoever is in them.
  const assignToPeople = useCallback(
    async (names: string[]): Promise<void> => {
      const clean = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
      if (clean.length === 0) return;

      const shared = groupBySignature.get(peopleSignatureKey(clean));
      if (shared) {
        chooseExistingGroup(shared);
        return;
      }

      const groupId = newGroupId;
      const currency = chosen[0]?.currency ?? 'INR';
      setPickerOpen(false);
      const ghostIds: string[] = [];
      try {
        await createGroup.mutateAsync({
          groupId,
          creatorMemberId: newMemberId,
          name: clean.join(', '),
          type: GroupType.Other,
          currency,
        });
        for (const name of clean) ghostIds.push(await addGhost.mutateAsync(name));
      } catch (caught) {
        toast.show(
          friendlyError(caught, t.captures.couldNotSave, 'sms.newPeopleGroup'),
          'negative',
        );
        return;
      }
      setNewGroupId(randomUUID());
      setNewMemberId(randomUUID());
      // The group and its people exist only on the queue so far, so the mirror
      // cannot list its members yet. Their ids were minted here.
      void placeInGroup({
        groupId,
        label: clean.join(', '),
        members: [{ id: newMemberId }, ...ghostIds.map((id) => ({ id }))],
        myMemberId: newMemberId,
        currency,
      });
    },
    [
      addGhost,
      chooseExistingGroup,
      chosen,
      createGroup,
      groupBySignature,
      newGroupId,
      newMemberId,
      placeInGroup,
      t.captures.couldNotSave,
      toast,
    ],
  );

  /** Set aside: not an expense, or not one worth splitting. */
  const setAside = useCallback(async (): Promise<void> => {
    const keys = chosen.map((row) => row.dedupeKey);
    if (keys.length === 0) return;
    await settleMessages(ownerId, keys, SmsSettlement.Dismissed);
    await reloadMessages(ownerId);
    setSelected(new Set());
    toast.show(plural(locale, keys.length, t.smsInbox.setAsideDone));
  }, [chosen, locale, ownerId, t.smsInbox.setAsideDone, toast]);

  // ───────────────────────────────────────────────────── rendering ──

  const renderItem = useCallback(
    ({ item }: { item: ListItem }) =>
      item.type === 'day' ? (
        <SmsDayHeader
          label={item.label}
          total={item.total}
          currency={item.currency}
          locale={locale}
        />
      ) : (
        <SmsMessageRow
          row={item.row}
          selected={selected.has(item.row.dedupeKey)}
          locale={locale}
          now={now}
          t={t}
          onToggle={() => setSelected((current) => toggleSelected(current, item.row.dedupeKey))}
          onOpen={() =>
            router.push({ pathname: '/captures/sms/[key]', params: { key: item.row.dedupeKey } })
          }
        />
      ),
    [locale, now, selected, t],
  );

  // A guest is turned away with a reason rather than a blank screen. It comes
  // before the reader check because `useSmsInboxReader` is false for them as
  // well, and "nothing here" answers none of the question they would have.
  if (isGuest) return <SignInWall area="sms" />;

  // Asked again here rather than trusted from the screen that pushed: a deep
  // link, a stale back stack, or the flag switching off while this was open
  // must all end the same way.
  if (!reader) return null;

  const everythingTicked = allSelected(visible, selected);

  // What the hero's number is *of*, in the same words the tab below it wears —
  // the figure changes when you switch pile, so it has to say which pile.
  const kindLabel =
    kind === SmsKind.Expense
      ? t.smsInbox.tabExpenses
      : kind === SmsKind.Income
        ? t.smsInbox.tabIncome
        : t.smsInbox.tabOther;

  return (
    <Screen edges={['top']}>
      {/* A plain header on the screen's own background: back, the name, the
          date filter and the scan options. The figure, the search and the
          piles sit below it as cards of their own. */}
      <Row
        style={{
          alignItems: 'center',
          gap: theme.spacing.sm,
          paddingHorizontal: theme.spacing.sm,
          paddingTop: theme.spacing.xs,
        }}
      >
        <IconButton label={t.common.back} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={iconSize.xl} color={theme.color.text} />
        </IconButton>
        <Ionicons name="chatbubbles" size={iconSize.lg} color={theme.color.text} />
        <Text variant="title" numberOfLines={1} style={{ flex: 1, fontWeight: '800' }}>
          {t.smsInbox.title}
        </Text>
        <IconButton label={t.smsInbox.filterTitle} onPress={() => setFilterOpen(true)}>
          <Ionicons name="options-outline" size={iconSize.lg} color={theme.color.text} />
        </IconButton>
        <IconButton label={t.smsInbox.scanTitle} onPress={() => setScanOptionsOpen(true)}>
          <Ionicons name="ellipsis-horizontal" size={iconSize.lg} color={theme.color.text} />
        </IconButton>
      </Row>

      <View
        style={{
          gap: theme.spacing.md,
          paddingHorizontal: theme.spacing.lg,
          paddingTop: theme.spacing.sm,
        }}
      >
        {/* The figure for the pile on screen — or, while rows are ticked, for
            what is ticked. No money for the third pile, deliberately: those
            are the rows that must not be summed as spending. */}
        {visible.length > 0 ? (
          <SmsTotalCard
            label={
              selecting
                ? plural(locale, chosen.length, t.smsInbox.selected)
                : `${kindLabel} · ${filterLabel(date, locale, t)}`
            }
            amount={kind === SmsKind.Other ? null : (selecting ? chosenTotal : period).total}
            currency={(selecting ? chosenTotal : period).currency}
            countText={plural(
              locale,
              (selecting ? chosenTotal : period).count,
              t.smsImport.messageCount,
            )}
            uncountedText={
              kind !== SmsKind.Other && (selecting ? chosenTotal : period).uncounted > 0
                ? plural(
                    locale,
                    (selecting ? chosenTotal : period).uncounted,
                    t.smsInbox.notCounted,
                  )
                : null
            }
            onUncountedInfo={() => toast.show(t.smsInbox.notCountedWhy)}
            selectLabel={everythingTicked ? t.smsInbox.selectNone : t.smsInbox.selectAll}
            onSelect={() => setSelected((current) => toggleAll(visible, current))}
            locale={locale}
          />
        ) : null}

        {/* Search: a plain field, because this is a list people look through. */}
        <Row
          style={{
            alignItems: 'center',
            gap: theme.spacing.sm,
            paddingHorizontal: theme.spacing.lg,
            height: 42,
            borderRadius: theme.radius.pill,
            backgroundColor: theme.color.surface,
            borderWidth: 1,
            borderColor: theme.color.border,
          }}
        >
          <Ionicons name="search" size={iconSize.md} color={theme.color.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t.smsInbox.searchPlaceholder}
            placeholderTextColor={theme.color.textFaint}
            accessibilityLabel={t.smsInbox.searchPlaceholder}
            autoCorrect={false}
            style={{ flex: 1, color: theme.color.text, fontSize: 15, paddingVertical: 0 }}
          />
          {query !== '' ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.smsInbox.searchClear}
              hitSlop={8}
              onPress={() => setQuery('')}
            >
              <Ionicons name="close-circle" size={iconSize.md} color={theme.color.textMuted} />
            </Pressable>
          ) : null}
        </Row>

        {/* Three piles: Spent, Received, Neither — the third is the debits
            that must not be counted as spending (card bills, top-ups). */}
        <SmsKindTabs
          value={kind}
          onChange={setKind}
          tabs={[
            {
              value: SmsKind.Expense,
              label: t.smsInbox.tabExpenses,
              count: counts[SmsKind.Expense],
            },
            { value: SmsKind.Income, label: t.smsInbox.tabIncome, count: counts[SmsKind.Income] },
            { value: SmsKind.Other, label: t.smsInbox.tabOther, count: counts[SmsKind.Other] },
          ]}
        />
      </View>

      {/* The scan, happening here rather than in a sheet over the screen. */}
      {scan.progress ? (
        <View style={{ paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.sm }}>
          <SmsScanProgress progress={scan.progress} />
        </View>
      ) : null}

      <FlashList
        data={loading ? [] : items}
        keyExtractor={(item) => (item.type === 'day' ? `day:${item.label}` : item.row.dedupeKey)}
        getItemType={(item) => item.type}
        renderItem={renderItem}
        extraData={listExtraData}
        // Half the group ledger's 2500, and the reason is which frame is
        // expensive here rather than how fast anybody flings. Draw distance is
        // paid in full on the *first* paint, and this screen is pushed onto a
        // list of several hundred messages — three dozen rows ahead of the fold
        // is three dozen rows between the tap and the screen appearing. 1200px
        // is still most of a screen of runway, and the rest arrives while a
        // finger is moving rather than while it is waiting.
        drawDistance={1200}
        showsVerticalScrollIndicator={false}
        // The promise, at the foot of what it is a promise about. It used to be
        // the hero's subtitle, a second line of type above every control on a
        // screen whose problem was how much stood between opening it and
        // reading a message. Saying it under the messages is saying it about
        // the messages — and it is said again, where it matters most, inside
        // the scan while somebody watches their own inbox being read.
        ListFooterComponent={
          loading || visible.length === 0 ? null : (
            <Row
              style={{
                alignItems: 'center',
                justifyContent: 'center',
                gap: theme.spacing.xs,
                paddingVertical: theme.spacing.xl,
              }}
            >
              <Ionicons
                name="lock-closed-outline"
                size={iconSize.xs}
                color={theme.color.textFaint}
              />
              <Text variant="micro" tone="faint">
                {t.smsInbox.onDevice}
              </Text>
            </Row>
          )
        }
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingTop: theme.spacing.xs,
          // Room for the bar at the foot, which sits above the navigation.
          paddingBottom: clearance + BAR_RUNWAY,
        }}
        ListEmptyComponent={
          loading ? null : (
            <View style={{ paddingTop: theme.spacing.xxxl }}>
              <EmptyState
                icon={
                  <Ionicons
                    name={rows.length === 0 ? 'chatbubbles-outline' : 'checkmark-done-outline'}
                    size={iconSize.huge}
                    color={theme.color.brand}
                  />
                }
                // Three empty states, because there are three reasons to be
                // empty and one message for all of them would be wrong twice.
                title={
                  rows.length === 0
                    ? t.smsInbox.emptyNothingYet
                    : query !== ''
                      ? t.smsInbox.emptyNoMatch
                      : t.smsInbox.emptyAllDone
                }
                body={
                  rows.length === 0
                    ? t.smsInbox.emptyNothingYetBody
                    : query !== ''
                      ? t.smsInbox.emptyNoMatchBody
                      : t.smsInbox.emptyAllDoneBody
                }
                action={
                  rows.length === 0 ? (
                    <Button
                      label={t.smsInbox.scan}
                      disabled={scan.progress !== null}
                      onPress={() => void startScan(ScanScope.Recent)}
                    />
                  ) : null
                }
              />
            </View>
          )
        }
      />

      {/* The bar at the foot, there whenever the pile has rows: how many are
          new, or what is ticked with "Set aside", and the one action. */}
      {visible.length > 0 ? (
        <SmsAddBar
          // The ticked count is on the card above and in the button; the title
          // stays what is waiting, and "Set aside" takes the line under it.
          title={
            counts[kind] > 99
              ? t.smsInbox.newPayments.other.replace('{n}', capped(counts[kind]))
              : plural(locale, counts[kind], t.smsInbox.newPayments)
          }
          subtitle={t.smsInbox.reviewAndAdd}
          secondaryLabel={selecting ? plural(locale, 1, t.smsInbox.setAside) : null}
          onSecondary={() => void setAside()}
          actionLabel={plural(locale, chosen.length, t.smsInbox.addSelected)}
          // Never greyed out at zero: a tap with nothing ticked says how to
          // use it rather than doing nothing.
          disabled={placing}
          onAction={() =>
            selecting ? setPickerOpen(true) : toast.show(t.smsInbox.addSelectedHint)
          }
          bottom={clearance + theme.spacing.md}
        />
      ) : null}

      <SmsScanOptionsSheet
        visible={scanOptionsOpen}
        onClose={() => setScanOptionsOpen(false)}
        onScanEverything={() => void startScan(ScanScope.Everything)}
      />

      <SmsFilterSheet
        visible={filterOpen}
        rows={rows}
        value={date}
        onApply={(next) => {
          setDate(next);
          setFilterOpen(false);
        }}
        onClose={() => setFilterOpen(false)}
      />

      {/* The same picker the Review screen and the voice review open, so
          "where does this go?" is one control in the app rather than three. */}
      <Sheet
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        padded={false}
        closeLabel={t.common.close}
        style={{ paddingHorizontal: theme.spacing.xl, gap: theme.spacing.md, maxHeight: '80%' }}
      >
        <Text variant="heading">{t.captures.assignTitle}</Text>
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          style={{ flexShrink: 1 }}
        >
          <DestinationPicker
            key={pickerOpen ? 'open' : 'closed'}
            selection={{ kind: 'none' } as DestinationSelection}
            eyebrow={null}
            // The amount leads and the count follows it, which is the order the
            // other two screens already use. It read the other way round here --
            // count first, total pushed to the far edge -- for no reason beyond
            // this sheet having been built separately.
            subject={{
              title:
                chosenTotal.total !== null ? (
                  <MoneyText
                    amount={chosenTotal.total}
                    currency={chosenTotal.currency}
                    locale={locale}
                    variant="subheading"
                  />
                ) : null,
              note: (
                <Text variant="caption" tone="muted" numberOfLines={1}>
                  {plural(locale, chosen.length, t.smsInbox.selected)}
                </Text>
              ),
            }}
            // "Unassigned" is not offered: these already sit outside every
            // group, so the row would point at where they already are. "Just
            // me" is — a private personal expense (A48), written through the
            // same shared path the Review screen and the voice review use.
            pinned={['me']}
            createRow={null}
            emptyGroups={t.captures.noGroups}
            labelFor={(group) => groupLabel(group, summary.membersFor(group.id), viewerId)}
            groups={assignableGroups}
            people={peopleChoices}
            t={t}
            onChoose={(choice) => {
              if (choice.kind === 'existing') chooseExistingGroup(choice.groupId);
              else if (choice.kind === 'me') void keepForMyself();
            }}
            onResolvePeople={(names) => void assignToPeople(names)}
          />
        </ScrollView>
      </Sheet>
    </Screen>
  );
}
