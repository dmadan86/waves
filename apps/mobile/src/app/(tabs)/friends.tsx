/**
 * Everybody you are not square with, across every group.
 *
 * Two things this screen refuses to do, because both would put a confident
 * wrong number in front of somebody:
 *
 * It never adds two currencies together. Somebody can owe you ₹500 and be owed
 * €20, and there is no honest single figure without a rate — so they appear as
 * two lines rather than one invented total (ADR-003).
 *
 * It never merges two ghosts with the same name. Nothing proves the Ravi in
 * your Goa group is the Ravi in your flat group, and merging two people's
 * debts is not something you can undo once it is done. Only people with an
 * account are followed across groups, because a profile id is proof.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {
  ActivityIndicator,
  Animated,
  BackHandler,
  I18nManager,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  useWindowDimensions,
  View,
} from 'react-native';
import { FlashList, useRecyclingState } from '@shopify/flash-list';
import Reanimated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Button,
  EmptyState,
  iconSize,
  initialsOf,
  MoneyText,
  Row,
  Screen,
  Skeleton,
  Text,
  tintForKey,
  useTabBarClearance,
  useTheme,
  MODAL_ORIENTATIONS,
} from '@waves/ui';

import { balanceDirection, copyFor, moneyAccessibilityLabel } from '@waves/core';

import { type PersonBalanceRow } from '@/data/api';
import { sendNudge } from '@/lib/nudge';
import { useBlockedUsers } from '@/data/blocked';
import { defaultMergeName } from '@/data/mergePeople';
import { useKnownPeopleCount, usePeopleBalances } from '@/data/hooks';
import { useAuth } from '@/lib/auth';
import {
  commonOnlyGroupId,
  currencyTotals,
  directionGroups,
  personDirection,
  rowAction,
  shownAmounts,
  type CurrencyTotal,
} from '@/lib/friendsTotals';
import { PressableScale } from '@/lib/anim';
import { router } from '@/lib/navigation';
import { useReducedMotion } from '@/lib/reducedMotion';
import { useAvatarUrl } from '@/components/ProfileAvatar';
import { HeroDots } from '@/components/HeroDots';
import {
  HeroActionCircle,
  HeroFigureLine,
  HeroPillButton,
  ScreenHero,
} from '@/components/ScreenHero';
import { PeopleSkeleton } from '@/components/Skeletons';
import { plural, useStrings, type UiStrings } from '@/i18n';
import { usePullRefresh } from '@/lib/pullRefresh';

enum SortKey {
  Amount = 'amount',
  Date = 'date',
  Name = 'name',
}

enum SortDir {
  Asc = 'asc',
  Desc = 'desc',
}

/** Each key's icon and the direction it opens in — biggest/newest first, A→Z. */
const SORT_META: Record<SortKey, { icon: keyof typeof Ionicons.glyphMap; defaultDir: SortDir }> = {
  [SortKey.Amount]: { icon: 'cash-outline', defaultDir: SortDir.Desc },
  [SortKey.Date]: { icon: 'time-outline', defaultDir: SortDir.Desc },
  [SortKey.Name]: { icon: 'text-outline', defaultDir: SortDir.Asc },
};

const SORT_ORDER: readonly SortKey[] = [SortKey.Amount, SortKey.Date, SortKey.Name];

/** The human name of a sort key — shared by the menu row and the header's
 *  now-stateful sort control's spoken label. */
function sortLabel(key: SortKey, t: UiStrings): string {
  if (key === SortKey.Amount) return t.sort.amount;
  if (key === SortKey.Date) return t.sort.date;
  return t.sort.name;
}

/**
 * One person and every currency they are unsettled with you in.
 *
 * The mirror returns a row per (person, currency) — currencies never sum
 * (ADR-003), so a person owed in rupees and owing in dollars is two rows. This
 * folds them back into the one human the list shows, keeping each currency's net
 * as its own entry for the row's right edge to stack.
 */
interface PersonGroup {
  person_key: string;
  display_name: string;
  profile_id: string | null;
  /** A ghost only if every one of their rows is — a real account is proof. */
  is_ghost: boolean;
  entries: PersonBalanceRow[];
  /** The largest single-currency balance, for the amount sort. */
  topAbs: bigint;
  /** Newest activity across their rows, for the recent sort. */
  lastActivityAt: string | null;
}

function absBig(v: bigint): bigint {
  return v < 0n ? -v : v;
}

/** Later of two ISO timestamps, ignoring null. */
function laterDate(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return b > a ? b : a;
}

/** Fold the per-currency rows into one entry per person. */
function groupByPerson(rows: PersonBalanceRow[]): PersonGroup[] {
  const map = new Map<string, PersonGroup>();
  for (const row of rows) {
    let g = map.get(row.person_key);
    if (!g) {
      g = {
        person_key: row.person_key,
        display_name: row.display_name,
        profile_id: row.profile_id,
        is_ghost: true,
        entries: [],
        topAbs: 0n,
        lastActivityAt: null,
      };
      map.set(row.person_key, g);
    }
    g.entries.push(row);
    g.is_ghost = g.is_ghost && row.is_ghost;
    if (row.profile_id) g.profile_id = row.profile_id;
    const abs = absBig(BigInt(row.net));
    if (abs > g.topAbs) g.topAbs = abs;
    g.lastActivityAt = laterDate(g.lastActivityAt, row.last_activity_at);
  }
  return [...map.values()];
}

/** Sort people by the chosen key; asc/desc flips whatever the key means. A
 *  person's amount is their biggest single-currency balance (never a
 *  cross-currency sum), their date the newest activity across their rows. */
function sortPersons(people: PersonGroup[], key: SortKey, dir: SortDir): PersonGroup[] {
  const sign = dir === SortDir.Asc ? 1 : -1;
  const cmp = (a: PersonGroup, b: PersonGroup): number => {
    if (key === SortKey.Name) return a.display_name.localeCompare(b.display_name) * sign;
    if (key === SortKey.Date) {
      const at = a.lastActivityAt ? Date.parse(a.lastActivityAt) : 0;
      const bt = b.lastActivityAt ? Date.parse(b.lastActivityAt) : 0;
      return (at < bt ? -1 : at > bt ? 1 : 0) * sign;
    }
    return (a.topAbs < b.topAbs ? -1 : a.topAbs > b.topAbs ? 1 : 0) * sign;
  };
  return [...people].sort(cmp);
}

/** Where a menu's trigger sits on screen (window coordinates). */
interface MenuAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

const ADD_MENU_WIDTH = 220;

/**
 * How many currencies a single row will draw before it starts counting them.
 *
 * Two, because a row has to stay roughly one height: a person holding four
 * currencies was drawing four stacked lines beside a neighbour's one, and a list
 * whose rows are 1x and 4x tall has no rhythm for the eye to follow. Two is
 * enough to show that a balance runs both ways — the common reason a person has
 * more than one — and the rest are named as a count rather than hidden.
 */
const MAX_STACKED_AMOUNTS = 2;

/**
 * Which guests are probably the same person seen twice.
 *
 * Two ghosts with the same name in different groups are the *only* thing merge
 * fixes — yet the old hint fired on any two guests at all, and asked in a full
 * paragraph. This finds the real duplicates instead: ghosts whose display name
 * (trimmed, case-folded) is shared by two or more distinct person_keys. It hands
 * back the set of keys that belong to some duplicate cluster (so their rows can
 * wear a quiet "seen twice" mark), the count of people caught in one, and the
 * largest cluster pre-folded into merge params for a one-tap fix.
 */
interface DuplicateInfo {
  /** Every person_key that shares a name with another guest. */
  keys: ReadonlySet<string>;
  /** How many distinct guests are caught in some duplicate cluster. */
  count: number;
  /** The biggest cluster, ready to hand the merge screen. */
  prefill: { keys: string[]; name: string } | null;
}

function findDuplicates(rows: PersonBalanceRow[]): DuplicateInfo {
  // name → the distinct person_keys wearing it, and one display spelling to show.
  const byName = new Map<string, { keys: Set<string>; display: string }>();
  for (const row of rows) {
    if (!row.is_ghost) continue;
    const norm = row.display_name.trim().toLowerCase();
    if (!norm) continue;
    let bucket = byName.get(norm);
    if (!bucket) {
      bucket = { keys: new Set(), display: row.display_name };
      byName.set(norm, bucket);
    }
    bucket.keys.add(row.person_key);
  }
  const keys = new Set<string>();
  let biggest: { keys: string[]; name: string } | null = null;
  for (const bucket of byName.values()) {
    if (bucket.keys.size < 2) continue;
    for (const k of bucket.keys) keys.add(k);
    if (!biggest || bucket.keys.size > biggest.keys.length) {
      biggest = { keys: [...bucket.keys], name: bucket.display };
    }
  }
  return { keys, count: keys.size, prefill: biggest };
}

export default function FriendsScreen() {
  const theme = useTheme();
  const pull = usePullRefresh();
  const clearance = useTabBarClearance();
  const reduceMotion = useReducedMotion();
  const { t, locale } = useStrings();

  const { profile } = useAuth();
  // Local-first (ADR-005): who owes whom is computed from the mirror, so Friends
  // works with no connection — the same rows the RPC returns, folded by the
  // viewer's own ghost merges pulled into the mirror (A38).
  const people = usePeopleBalances(profile?.id ?? null);
  const rows = people.data;
  // Nobody yet, or everybody square? Both arrive here as an empty `rows`, and
  // they want opposite screens — see `EmptyFriends`.
  const known = useKnownPeopleCount(profile?.id ?? null);

  // Which guests look like the same person seen twice — the only thing merge is
  // for. Surfaced as a slim strip that points at the actual duplicates (and
  // marks their rows), not a paragraph that fired on any two guests at all.
  const duplicates = useMemo(() => findDuplicates(rows), [rows]);

  // The sort the whole list obeys. Tapping a key in the menu switches to it;
  // tapping the key already chosen flips its direction — amount and recent
  // activity open biggest/newest first, name A→Z, and either can be reversed.
  const [sortKey, setSortKey] = useState<SortKey>(SortKey.Amount);
  const [sortDir, setSortDir] = useState<SortDir>(SortDir.Desc);
  const [sortOpen, setSortOpen] = useState(false);

  // The "add someone" family — add a person, pull from contacts, scan an invite
  // QR — folded behind one `+` so the header reads as a title row, not a
  // five-icon toolbar of mystery glyphs.
  const [addOpen, setAddOpen] = useState(false);
  // Where the "+ Friend" pill sits on screen, so its menu opens right under it.
  const [addAnchor, setAddAnchor] = useState<MenuAnchor | null>(null);

  const pickSort = (key: SortKey): void => {
    if (key === sortKey) {
      setSortDir((dir) => (dir === SortDir.Asc ? SortDir.Desc : SortDir.Asc));
    } else {
      setSortKey(key);
      setSortDir(SORT_META[key].defaultDir);
    }
  };

  // Multiselect merge: long-press a guest to start picking, tap to add/remove,
  // then Merge folds them into one person through the very flow the header's
  // merge entry uses (rename + optional contact + the irreversibility warning),
  // only pre-selected. Only guests (ghosts) are mergeable, so only they are
  // selectable — a real account is already one identity across every group.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<ReadonlySet<string>>(new Set());

  // A live mirror of the selection, read by `toggleSelect` so a tap always folds
  // into the very latest set — not a snapshot captured at some earlier render,
  // and not a value that lags behind a passive effect. It is written in the same
  // helper that schedules the state, so a second tap that lands before React has
  // flushed still sees the real set (picking A then B keeps both, never just B).
  const selectedKeysRef = useRef<ReadonlySet<string>>(selectedKeys);
  // These handlers are handed to every row as props. They are wrapped in
  // useCallback so their identity is stable across renders — which is what lets
  // the memoized PersonRow skip work on a recycled row and keeps a long list
  // scrolling smoothly (the same discipline the group ledger's rows rely on).
  const applySelection = useCallback((next: ReadonlySet<string>): void => {
    selectedKeysRef.current = next;
    setSelectedKeys(next);
  }, []);

  const exitSelect = useCallback((): void => {
    setSelectMode(false);
    applySelection(new Set());
  }, [applySelection]);

  // A long press fires onLongPress (this), then the SAME touch fires the row's
  // onPress on release — which in selection mode is a toggle. Left alone, that
  // release toggles right back off the person the long press just picked, the
  // set empties, and selection mode vanishes the instant you lift your finger.
  // So the long press arms a one-shot guard that the very next toggle consumes
  // and ignores. Any later tap is a real pick.
  const swallowNextToggleRef = useRef(false);

  const enterSelect = useCallback(
    (personKey: string): void => {
      swallowNextToggleRef.current = true;
      setSelectMode(true);
      applySelection(new Set([personKey]));
    },
    [applySelection],
  );

  const toggleSelect = useCallback(
    (personKey: string): void => {
      // The release of the long press that just entered selection — ignore it
      // once so the picked person stays picked.
      if (swallowNextToggleRef.current) {
        swallowNextToggleRef.current = false;
        return;
      }
      const next = new Set(selectedKeysRef.current);
      if (next.has(personKey)) next.delete(personKey);
      else next.add(personKey);
      // Dropping the last pick leaves selection mode — an empty selection is no
      // selection.
      if (next.size === 0) exitSelect();
      else applySelection(next);
    },
    [applySelection, exitSelect],
  );

  const startMerge = (): void => {
    const keys = [...selectedKeys];
    // The Merge action is only enabled at two or more, but guard anyway.
    if (keys.length < 2) return;
    // Pre-fill the merge screen's name from the picked people — one display name
    // per person (a person unsettled in two currencies is two rows but one
    // name), most-common wins, exactly as the merge screen's own default does.
    const nameByKey = new Map<string, string>();
    for (const row of rows) {
      if (selectedKeys.has(row.person_key) && !nameByKey.has(row.person_key)) {
        nameByKey.set(row.person_key, row.display_name);
      }
    }
    const suggestedName = defaultMergeName(
      [...nameByKey.values()].map((display_name) => ({ display_name })),
    );
    const keyParam = keys.map(encodeURIComponent).join(',');
    const nameParam = encodeURIComponent(suggestedName);
    exitSelect();
    router.push(`/friends/merge?keys=${keyParam}&name=${nameParam}` as never);
  };

  // Android hardware back leaves selection mode rather than the tab.
  useEffect(() => {
    if (!selectMode) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      exitSelect();
      return true;
    });
    return () => sub.remove();
  }, [selectMode, exitSelect]);

  // One row per person, not per (person, currency). The mirror hands back a row
  // for each currency a person is unsettled in (currencies never mix — ADR-003);
  // folding them into one person is what lets the list read the Splitwise way —
  // a single row whose right edge stacks each currency's net — instead of the
  // same face twice. Memoised on rows + sort, which is all that moves it.
  const persons = useMemo(
    () => sortPersons(groupByPerson(rows), sortKey, sortDir),
    [rows, sortKey, sortDir],
  );

  // Folds the biggest cluster of likely duplicates straight into the merge
  // screen; with no cluster to offer, the screen opens empty to pick by hand.
  const openDuplicates = (): void => {
    const p = duplicates.prefill;
    if (!p) return router.push('/friends/merge' as never);
    const keyParam = p.keys.map(encodeURIComponent).join(',');
    const nameParam = encodeURIComponent(p.name);
    router.push(`/friends/merge?keys=${keyParam}&name=${nameParam}` as never);
  };

  // The headline's figures: the net you are up or down in each currency, summed
  // across everyone. Never across currencies — there is no honest single number
  // without a rate (ADR-003), so a mixed wallet shows one line per currency.
  const totals = useMemo(() => currencyTotals(rows), [rows]);

  return (
    <Screen edges={[]}>
      {/* The header is fixed — it does not ride the scroll. Only the list and the
          merge strip below move under it. Selection is a mode *within* the hero,
          not a replacement for it: the same indigo panel stays, and its title
          line swaps to close / count / Merge, so the header never blinks away
          under a long press. */}
      <FriendsHero
        totals={totals}
        locale={locale}
        t={t}
        sortKey={sortKey}
        sortDir={sortDir}
        onAdd={(anchor) => {
          setAddAnchor(anchor);
          setAddOpen(true);
        }}
        onSort={() => setSortOpen(true)}
        duplicateCount={duplicates.count >= 2 && !selectMode ? duplicates.count : 0}
        onDuplicates={openDuplicates}
        selectMode={selectMode}
        selectedCount={selectedKeys.size}
        onExitSelect={exitSelect}
        onMerge={startMerge}
        loading={people.isLoading}
      />

      <AddMenu open={addOpen} anchor={addAnchor} onClose={() => setAddOpen(false)} t={t} />

      <SortMenu
        open={sortOpen}
        onClose={() => setSortOpen(false)}
        sortKey={sortKey}
        sortDir={sortDir}
        onPick={pickSort}
        t={t}
      />

      {/* Only this scrolls — the list, beneath the fixed header. It runs to the
          foot of the screen and under the bottom bar, the way Home's groups do:
          the rows scroll behind the bar, and the clearance is paid on the
          content, so at the end of the list the card's rounded foot comes to
          rest above the bar. Boxing the card short of the bar instead left a
          band of empty background under the last row at every scroll position.
          The card is drawn per row (the first rounds the top, the last rounds
          the foot) so it scrolls inside the FlashList instead of clipping it. */}
      <Reanimated.View
        layout={reduceMotion ? undefined : LinearTransition.duration(160)}
        style={{ flex: 1 }}
      >
        {people.isLoading ? (
          <View style={{ paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.lg }}>
            <PeopleSkeleton />
          </View>
        ) : rows.length === 0 ? (
          // Centred in what can be seen: the clearance comes off the foot.
          <View
            style={{
              flex: 1,
              justifyContent: 'center',
              paddingHorizontal: theme.spacing.lg,
              paddingBottom: clearance,
            }}
          >
            <EmptyFriends hasPeople={known.data > 0} t={t} />
          </View>
        ) : (
          // The only virtualized list on this screen — same FlashList setup the
          // group ledger uses (recycled rows, a wide draw distance so a fast fling
          // never outruns recycling into blank rows).
          <FlashList
            data={persons}
            // Selection state lives outside the row data, so the list has to be
            // told to re-render its rows when it changes (the tick, the fill).
            // The length rides along because the last row draws the card's foot.
            extraData={`${selectMode}|${[...selectedKeys].join(',')}|${locale}|${theme.scheme}|${persons.length}`}
            keyExtractor={(item) => item.person_key}
            // A single-currency row and a multi-currency (stacked amounts) row are
            // structurally different subtrees; typing them lets FlashList recycle
            // like with like rather than reflowing one shape into the other.
            getItemType={(item) => (item.entries.length === 1 ? 'single' : 'multi')}
            drawDistance={1500}
            contentContainerStyle={{
              paddingHorizontal: theme.spacing.lg,
              paddingTop: theme.spacing.lg,
              paddingBottom: clearance,
            }}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={pull.refreshing}
                onRefresh={pull.onRefresh}
                tintColor={theme.color.brand}
              />
            }
            renderItem={({ item, index }) => {
              const first = index === 0;
              const last = index === persons.length - 1;
              return (
                <View
                  style={{
                    backgroundColor: theme.color.surface,
                    borderColor: theme.color.border,
                    borderLeftWidth: 1,
                    borderRightWidth: 1,
                    borderTopWidth: first ? 1 : 0,
                    borderBottomWidth: last ? 1 : 0,
                    borderTopLeftRadius: first ? theme.radius.lg : 0,
                    borderTopRightRadius: first ? theme.radius.lg : 0,
                    borderBottomLeftRadius: last ? theme.radius.lg : 0,
                    borderBottomRightRadius: last ? theme.radius.lg : 0,
                    overflow: 'hidden',
                  }}
                >
                  <PersonRow
                    person={item}
                    locale={locale}
                    t={t}
                    divider={!first}
                    duplicate={duplicates.keys.has(item.person_key)}
                    selectMode={selectMode}
                    selected={selectedKeys.has(item.person_key)}
                    onEnterSelect={enterSelect}
                    onToggleSelect={toggleSelect}
                  />
                </View>
              );
            }}
          />
        )}
      </Reanimated.View>
    </Screen>
  );
}

/**
 * The Friends hero — now the same shell Review opens on (`ScreenHero`), rather
 * than a hand-rolled panel that happened to look similar. Its own watermark
 * (`art`) and its solid white "+" (`primary`) are the shell's own features now,
 * not private code, so Review can (and does) reach for the same two things.
 * The sort control stays a bare glyph — secondary, not the screen's button —
 * and the overall balance sits underneath as the shell's `children`.
 *
 * The overall balance rides transparent on the colour (no inner card) — one line
 * per currency, because there is no honest single total across currencies without
 * a rate (ADR-003). All square, or nobody added? Then the balance says nothing
 * and the hero is just the title row.
 *
 * Merge selection is a mode *inside* the hero, not a replacement for it: the
 * shell's `overlay` crossfades the title row into close / count / Merge on the
 * same panel, on the same 150ms `useHeroCrossfade` Review's own balance-figure
 * swap rides, so the two gestures stay identical instead of drifting apart.
 */
function FriendsHero({
  totals,
  locale,
  t,
  sortKey,
  sortDir,
  onAdd,
  onSort,
  duplicateCount,
  onDuplicates,
  selectMode,
  selectedCount,
  onExitSelect,
  onMerge,
  loading,
}: {
  totals: readonly CurrencyTotal[];
  locale: string;
  t: UiStrings;
  sortKey: SortKey;
  sortDir: SortDir;
  /** Opens the add menu, told where the pill is so the menu drops from it. */
  onAdd: (anchor: MenuAnchor | null) => void;
  onSort: () => void;
  /** Likely duplicate guests; 0 hides the merge disc. */
  duplicateCount: number;
  onDuplicates: () => void;
  /** Merge selection is a mode inside the hero — its title line swaps to the
      close / count / Merge controls while it runs, on the same indigo panel. */
  selectMode: boolean;
  selectedCount: number;
  onExitSelect: () => void;
  onMerge: () => void;
  /** Cold launch, mirror not read yet — the hero paints a shimmering balance so
      the panel reads as a full Friends header rather than a bare title bar over
      an empty screen while the rows hydrate. */
  loading: boolean;
}): React.JSX.Element {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  // The balance pages like Home's: one slide per direction ("Net receivable",
  // "You owe"), swiped, with the dot pager between the pill and the edge. Two
  // stacked blocks made the hero tall and cramped. Until the deck measures
  // itself, a slide is the window less the hero's side padding, so the first
  // frame does not shrink a slide to its text and then jump.
  const { width: windowW } = useWindowDimensions();
  const [measuredW, setMeasuredW] = useState(0);
  const slideW = measuredW || windowW - theme.spacing.xl * 2;
  const [scrollX] = useState(() => new Animated.Value(0));
  const pillRef = useRef<View>(null);
  const openAdd = (): void => {
    const pill = pillRef.current;
    if (!pill) return onAdd(null);
    pill.measureInWindow((x, y, width, height) =>
      onAdd(width > 0 ? { x, y, width, height } : null),
    );
  };
  const deck = directionGroups(totals);

  return (
    <ScreenHero
      icon="people"
      title={t.friends}
      // The watermark: a big faint people glyph and a couple of translucent
      // rings, so the panel reads as a designed surface rather than a flat
      // rectangle of colour — this hero's own art, passed to the shared shell.
      art={<HeroArt />}
      actions={[
        // Adding a person moved down to the "+ Friend" pill under the balance,
        // where Home keeps its "+ Expense": the title row keeps only sort.
        {
          // Sort wears its own state — the active key's glyph and the
          // direction arrow — so a glance says how the list is ordered. No
          // single `Ionicons` name carries both, hence `render` over `icon`.
          label: `${t.sort.by}: ${sortLabel(sortKey, t)}`,
          onPress: onSort,
          render: (
            <Row style={{ alignItems: 'center', gap: 2 }}>
              <Ionicons
                name={SORT_META[sortKey].icon}
                size={iconSize.lg}
                color={theme.color.onBrand}
              />
              <Ionicons
                name={sortDir === SortDir.Asc ? 'arrow-up' : 'arrow-down'}
                size={iconSize.sm}
                color={theme.color.onBrand}
              />
            </Row>
          ),
        },
      ]}
      overlay={{
        active: selectMode,
        content: (
          <>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={t.common.close}
              onPress={onExitSelect}
              hitSlop={10}
              style={{ padding: theme.spacing.xs }}
            >
              <Ionicons name="close" size={iconSize.xl} color={theme.color.onBrand} />
            </PressableScale>
            <Text variant="heading" tone="onBrand" style={{ flex: 1 }} numberOfLines={1}>
              {plural(locale, selectedCount, t.mergePeople.selected)}
            </Text>
            <Button
              label={t.mergePeople.entry}
              size="sm"
              variant="onBrand"
              disabled={selectedCount < 2}
              onPress={onMerge}
            />
          </>
        ),
      }}
    >
      {!selectMode && loading ? (
        // Cold launch: a shimmering stand-in for the OVERALL balance, tinted
        // translucent-white so it reads on the indigo (the grey skeleton default
        // is overridden by the trailing style). Keeps the hero a full header
        // while the mirror hydrates instead of a bare title bar over blank.
        <View style={{ gap: theme.spacing.sm }}>
          <Skeleton width="30%" height={12} style={{ backgroundColor: 'rgba(255,255,255,0.20)' }} />
          <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <Skeleton
              width="28%"
              height={18}
              style={{ backgroundColor: 'rgba(255,255,255,0.14)' }}
            />
            <Skeleton
              width="52%"
              height={34}
              radius={theme.radius.sm}
              style={{ backgroundColor: 'rgba(255,255,255,0.22)' }}
            />
          </Row>
        </View>
      ) : !selectMode && deck.length > 0 ? (
        <Reanimated.View
          entering={reduceMotion ? undefined : FadeIn.duration(160)}
          exiting={reduceMotion ? undefined : FadeOut.duration(100)}
          onLayout={(event) => setMeasuredW(event.nativeEvent.layout.width)}
        >
          <Animated.ScrollView
            horizontal
            // Home's deck, not `pagingEnabled`: paging snaps by the platform's
            // slower page fling, which is what made this carousel feel heavier
            // than the dashboard's. A snap step plus the fast deceleration, one
            // slide per flick, is the same feel.
            snapToInterval={slideW}
            snapToAlignment="start"
            decelerationRate="fast"
            disableIntervalMomentum
            showsHorizontalScrollIndicator={false}
            scrollEnabled={deck.length > 1}
            scrollEventThrottle={16}
            onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
              useNativeDriver: true,
            })}
          >
            {deck.map((group, index) => (
              // Label above the amount, not beside it — the same order GroupHero
              // reads its own balance in (caption verdict, then the title-sized
              // figure), rather than a row that made this hero the odd one out.
              //
              // The slide being dragged in grows and brightens into focus as it
              // reaches centre, exactly as Home's do. Transform and opacity only,
              // both native-driven off the same `scrollX` the dots read.
              <Animated.View
                key={group.owed ? 'owed' : 'owing'}
                style={{
                  width: slideW,
                  opacity: scrollX.interpolate({
                    inputRange: [(index - 1) * slideW, index * slideW, (index + 1) * slideW],
                    outputRange: [0.75, 1, 0.75],
                    extrapolate: 'clamp',
                  }),
                  transform: [
                    {
                      scale: scrollX.interpolate({
                        inputRange: [(index - 1) * slideW, index * slideW, (index + 1) * slideW],
                        outputRange: [0.94, 1, 0.94],
                        extrapolate: 'clamp',
                      }),
                    },
                  ],
                }}
              >
                <View
                  // Home's rhythm: `sm` between the label and the figure.
                  style={{ gap: theme.spacing.sm }}
                >
                  {/* Home's wording and shape: "Net receivable: ₹12,345" on one
                    line. The symbol says the currency, so the code that used to
                    trail the label ("· INR") is gone; a second currency stacks
                    small under the figure it belongs with. */}
                  <View style={{ gap: 2 }}>
                    <HeroFigureLine label={group.owed ? t.dashHero.netOwed : t.dashHero.netOwe}>
                      <MoneyText
                        amount={group.head.net < 0n ? -group.head.net : group.head.net}
                        currency={group.head.currency}
                        locale={locale}
                        variant="title"
                        tone="default"
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.6}
                        style={{ color: theme.color.onBrand }}
                      />
                    </HeroFigureLine>
                    {group.rest.length > 0 ? (
                      // The same direction's other currencies, small and under the
                      // number they belong to. Wrapped rather than clipped — six
                      // currencies costs a second line here instead of six headlines.
                      <Row
                        style={{
                          justifyContent: 'flex-start',
                          flexWrap: 'wrap',
                          columnGap: theme.spacing.sm,
                        }}
                      >
                        {group.rest.map((total) => (
                          <MoneyText
                            key={total.currency}
                            amount={total.net < 0n ? -total.net : total.net}
                            currency={total.currency}
                            locale={locale}
                            variant="caption"
                            tone="onBrand"
                            style={{ opacity: 0.8 }}
                          />
                        ))}
                      </Row>
                    ) : null}
                  </View>
                </View>
              </Animated.View>
            ))}
          </Animated.ScrollView>
        </Reanimated.View>
      ) : null}
      {!selectMode ? (
        // Home's row: the white pill that hugs its word, the pager centred in
        // the slack, and a white disc on the shoulder — here the merge, wearing
        // the count of likely duplicates the way a notification wears its
        // number. Everything that adds a person (type a name, pull from
        // contacts, scan an invite QR) is behind the pill.
        <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
          <View ref={pillRef} collapsable={false}>
            <HeroPillButton
              icon="person-add-outline"
              label={t.tabs.friendShort}
              spokenLabel={t.tabs.addSomeone}
              gradient={theme.gradient.brand}
              onPress={openAdd}
            />
          </View>
          <View style={{ flex: 1, alignItems: 'center' }}>
            {deck.length > 1 ? (
              <HeroDots count={deck.length} scrollX={scrollX} snap={slideW} />
            ) : null}
          </View>
          {duplicateCount > 0 ? (
            <View>
              <HeroActionCircle
                icon="git-merge-outline"
                solid
                ink={theme.gradient.brand[0]}
                label={`${plural(locale, duplicateCount, t.mergePeople.duplicates)}. ${t.mergePeople.entry}`}
                onPress={onDuplicates}
              />
              <View
                accessible={false}
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  top: -4,
                  right: -4,
                  minWidth: 20,
                  height: 20,
                  paddingHorizontal: 5,
                  borderRadius: 10,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: theme.color.negative,
                  borderWidth: 2,
                  borderColor: theme.color.onBrand,
                }}
              >
                <Text variant="micro" style={{ color: '#FFFFFF', fontWeight: '700' }}>
                  {duplicateCount > 99 ? '99+' : String(duplicateCount)}
                </Text>
              </View>
            </View>
          ) : null}
        </Row>
      ) : null}
    </ScreenHero>
  );
}

/**
 * The hero's artwork — depth without an illustration pipeline. A big people
 * watermark bled off the bottom-right corner, and a couple of translucent rings
 * floating over the wash, so the panel reads as a designed surface rather than a
 * flat rectangle of colour. All white at low alpha, so it sits the same on the
 * indigo in either theme; `pointerEvents none` so it never intercepts a tap.
 */
function HeroArt(): React.JSX.Element {
  const theme = useTheme();
  const ring = (size: number, top: number, left: number, alpha: number): React.JSX.Element => (
    <View
      style={{
        position: 'absolute',
        top,
        left,
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 2,
        borderColor: `rgba(255,255,255,${alpha})`,
      }}
    />
  );
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
    >
      {ring(150, -60, -40, 0.1)}
      {ring(90, 20, -30, 0.08)}
      <View style={{ position: 'absolute', right: -30, bottom: -46 }}>
        <Ionicons name="people" size={190} color="rgba(255,255,255,0.09)" />
      </View>
      <View style={{ position: 'absolute', right: 54, top: -18 }}>
        <Ionicons name="heart" size={26} color={theme.color.onBrand} style={{ opacity: 0.12 }} />
      </View>
    </View>
  );
}

/**
 * The screen with nothing on it — which is two screens, not one.
 *
 * Somebody who has never added anyone and somebody who has ten friends and is
 * square with all of them both arrive here with no rows, and they need opposite
 * things said to them. "All square" is a small congratulation, and showing it to
 * a person with no friends at all is a category error: they are not square, they
 * are empty. So the first state names that and the second keeps the
 * congratulation for the people who earned it.
 *
 * The two states are drawn differently on purpose. "All square" stays a small
 * congratulation — the shared `EmptyState` glyph, no button, nothing to escape.
 * "No friends" is a first run, the emptiest the app ever looks, and the finance
 * apps in the category (Splitwise, Venmo, Wise) all meet that moment with a
 * warm hero and a way in rather than a lone stroke icon — so it gets its own
 * `NoFriendsHero`: two faces to say "people", and both ways to add one (type a
 * name, or pull from contacts) where a first-timer is actually looking, since
 * the header icons are easy to miss on an otherwise blank page.
 */
function EmptyFriends({ hasPeople, t }: { hasPeople: boolean; t: UiStrings }): React.JSX.Element {
  const theme = useTheme();

  if (!hasPeople) return <NoFriendsHero t={t} />;

  return (
    <View style={{ flex: 1, justifyContent: 'center' }}>
      <EmptyState
        title={t.tabs.allSquare}
        body={t.tabs.allSquareBody}
        icon={
          <Ionicons name="checkmark-done-outline" size={iconSize.xxl} color={theme.color.brand} />
        }
      />
    </View>
  );
}

/**
 * The first-run hero: two overlapping faces with a small plus, then the two
 * ways to add someone. The back face wears a pastel sky tint and the front the
 * brand, so the pair reads as two different people at a glance rather than one
 * icon doubled; the plus badge sits on the seam where a new person would join.
 * The whole mark is Views and Ionicons — the app has no illustration pipeline,
 * and a built medallion themes itself in dark mode for free.
 */
function NoFriendsHero({ t }: { t: UiStrings }): React.JSX.Element {
  const theme = useTheme();
  const sky = theme.tint.sky;
  const D = 68; // one face

  return (
    <View
      style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: theme.spacing.sm }}
    >
      {/* The face pair — two overlapping people, no plus badge. The badge read as
          a tappable "+" it never was; the real ways in are the labelled buttons
          below, so the medallion is now pure illustration. */}
      <View style={{ width: D * 1.7, height: D, marginBottom: theme.spacing.lg }}>
        <Face x={0} d={D} bg={sky.bg} ink={sky.ink} borderColor={theme.color.surface} />
        <Face
          x={D * 0.7}
          d={D}
          bg={theme.color.brandSoft}
          ink={theme.color.brand}
          borderColor={theme.color.surface}
        />
      </View>

      <Text variant="heading" align="center">
        {t.tabs.noFriends}
      </Text>
      <Text variant="body" tone="muted" align="center" style={{ maxWidth: 300 }}>
        {t.tabs.noFriendsBody}
      </Text>
      {/* Both ways in, where a first-timer is actually looking — the header `+`
          is easy to miss on an otherwise blank page. Primary types a name;
          secondary pulls from the phone's contacts. */}
      <View style={{ alignSelf: 'stretch', gap: theme.spacing.sm, marginTop: theme.spacing.lg }}>
        <Button
          label={t.tabs.addSomeone}
          onPress={() => router.push('/friends/add-person' as never)}
          fullWidth
        />
        <Button
          label={t.tabs.fromContacts}
          variant="secondary"
          onPress={() => router.push('/friends/contacts')}
          fullWidth
        />
      </View>
    </View>
  );
}

/** One circular face in the hero pair. */
function Face({
  x,
  d,
  bg,
  ink,
  borderColor,
}: {
  x: number;
  d: number;
  bg: string;
  ink: string;
  borderColor: string;
}): React.JSX.Element {
  return (
    <View
      style={{
        position: 'absolute',
        left: x,
        width: d,
        height: d,
        borderRadius: d / 2,
        backgroundColor: bg,
        borderWidth: 3,
        borderColor,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Ionicons name="person" size={d * 0.5} color={ink} />
    </View>
  );
}

/**
 * One person, one compact row on the shared list card — an avatar, the name over
 * its direction line, the balance to the right (the dashboard's group row, applied
 * to people). Direction lives in the caption ("Owes you" / "You owe") so the right
 * edge is just the coloured amount, and the invite/remind actions shrink to a
 * single round glyph beside it rather than a text pill that padded the row out.
 * A person unsettled in two currencies is one row with both nets stacked.
 *
 * Memoized: it lives in a virtualized list, and a recycled row that lands on the
 * same person with the same selection state does no work when the parent
 * re-renders. Every prop is a primitive or a reference the screen keeps stable
 * (`t` is static per locale, the two handlers are `useCallback`), so the shallow
 * compare holds and a fast fling never re-runs a row it already drew.
 */
const PersonRow = memo(function PersonRow({
  person,
  locale,
  t,
  divider,
  duplicate,
  selectMode,
  selected,
  onEnterSelect,
  onToggleSelect,
}: {
  person: PersonGroup;
  locale: string;
  t: ReturnType<typeof useStrings>['t'];
  /** A hairline above the row — every row but the first, so the card reads as one
      divided list. */
  divider: boolean;
  /** This guest shares a name with another — wears a quiet "seen twice" mark. */
  duplicate: boolean;
  selectMode: boolean;
  selected: boolean;
  onEnterSelect: (personKey: string) => void;
  onToggleSelect: (personKey: string) => void;
}): React.JSX.Element {
  const theme = useTheme();
  const { isBlocked } = useBlockedUsers();
  // A blocked person is hidden behind the ghost name and avatar here too, so
  // their identity never surfaces on the list — the amounts are unchanged; only
  // who the row names is.
  const blocked = isBlocked(person.profile_id);
  const shownName = blocked ? t.misc.someone : person.display_name;
  // Only a guest can be merged — a real account is already one identity across
  // every group — so only guest rows take part in a selection.
  const selectable = person.is_ghost;

  const entries = person.entries;
  // A member's profile photo, resolved from the private bucket path to a signed
  // URL the avatar can show. Suppressed for a blocked person — their identity is
  // hidden behind the ghost name and face, so a photo must not leak it. The
  // `avatar_url` is the same across a person's rows, so the first carries it.
  const photoUrl = useAvatarUrl(blocked ? null : (entries[0]?.avatar_url ?? null));
  // One common group can explain several currency rows for the same person: a
  // traveller may owe a guest in INR and USD from one trip, and that is still one
  // group to invite them to. Differing or missing group ids go to the person
  // page, where the full split is visible. A nudge is narrower — see `rowAction`.
  const single = entries.length === 1 ? entries[0] : null;
  const soloGroup = commonOnlyGroupId(entries);

  // One group explains it: open that group. Otherwise the person page splits the
  // balance back out per group and currency.
  const navigate = soloGroup
    ? () => router.push(`/group/${soloGroup}`)
    : () =>
        router.push(
          `/friends/person/${encodeURIComponent(person.person_key)}?name=${encodeURIComponent(
            shownName,
          )}` as never,
        );

  const onPress = selectMode
    ? selectable
      ? () => onToggleSelect(person.person_key)
      : undefined
    : navigate;
  const onLongPress =
    !selectMode && selectable ? () => onEnterSelect(person.person_key) : undefined;

  // The group scope, only when it earns a mention (a person spread over more than
  // one group). One group is the default and says nothing.
  const scope =
    single && single.group_count > 1
      ? plural(locale, single.group_count, t.tabs.acrossGroups)
      : null;
  // The caption folds direction and scope onto one line, so the right edge no
  // longer stacks a micro-label over the amount.
  //
  // Direction is knowable whenever every currency points the same way, not only
  // when there is one of them — somebody who owes you in rupees and in dollars
  // still simply owes you. Gating this on `single` left every multi-currency
  // person with no caption at all, so a dense list alternated between rows with
  // a second line and rows without, and the names stopped sitting on a common
  // grid. A genuinely mixed balance still says nothing: no word is true of both
  // halves, and the coloured amounts are the honest answer there.
  const action = selectMode ? null : rowAction(person);
  const runs = personDirection(entries);
  const direction = runs === 'owed' ? t.tabs.owesYou : runs === 'owing' ? t.tabs.youOweThem : null;
  const caption = [direction, scope].filter(Boolean).join(' · ') || null;

  // What a screen reader hears: who, then each currency's spoken direction and
  // amount, the group scope, and — for a guest — that they have not joined.
  const moneyLabels = entries.map((e) =>
    moneyAccessibilityLabel(
      { minor: BigInt(e.net), currency: e.currency },
      balanceDirection(BigInt(e.net)),
      copyFor(locale).money,
      { locale },
    ),
  );
  const statusPart = person.is_ghost ? (soloGroup ? t.people.invite : t.tabs.notJoined) : '';
  const rowA11yLabel = [shownName, ...moneyLabels, scope ?? '', statusPart]
    .filter(Boolean)
    .join('. ');

  // At most two amounts per row, and never at the cost of a direction: a balance
  // that runs both ways always shows both colours. The rest are counted.
  const { shown: shownEntries, hidden: hiddenCurrencies } = shownAmounts(
    entries,
    MAX_STACKED_AMOUNTS,
  );
  // Whether the right column is a single line. Asked of both halves of the
  // answer rather than of `entries`, because it is the cap that turns four
  // currencies into two figures and a count — a person can hold one currency
  // and still draw two lines if that ever changes. This decides how the column
  // sits against the name beside it; see the row's alignment below.
  const oneFigure = shownEntries.length === 1 && hiddenCurrencies === 0;

  const body = (
    <Row
      style={{
        paddingVertical: theme.spacing.sm,
        paddingHorizontal: theme.spacing.sm,
        // Top, not centre. Centring a one-line name against a stack of amounts
        // floats the name to the middle of the stack — it sat level with a
        // person's *second* currency, so the eye read the name against the wrong
        // number. Aligned to the top, the name and the amount that leads the row
        // are on the same line, whatever either side is carrying.
        //
        // Top is the rule for the two columns anybody *reads* — the name and the
        // figures — and only those. Everything else here is furniture with no
        // line to share: the avatar, the selection tick, the trailing control.
        // Pinned to the top alongside them, that furniture was stranded against
        // a tall stack of currencies, the gap beneath it growing with every
        // extra line the amounts took. It centres itself instead, so each of
        // those overrides its own alignment below rather than the row deciding
        // for all four columns at once.
        alignItems: 'flex-start',
        gap: theme.spacing.md,
        borderTopWidth: divider ? 1 : 0,
        borderTopColor: theme.color.border,
        // A non-selectable row reads as unavailable while a selection runs.
        opacity: selectMode && !selectable ? 0.4 : 1,
      }}
    >
      {selectMode ? (
        <Ionicons
          name={selected ? 'checkmark-circle' : 'ellipse-outline'}
          size={iconSize.xl}
          color={selected ? theme.color.brand : theme.color.textFaint}
          // Furniture: a checkbox reads against the whole person, not against
          // the first line of them.
          style={{ alignSelf: 'center' }}
        />
      ) : null}
      {/* The face centres against whatever the row turns out to be. Left at the
          row's top alignment it sat proud of a person carrying three lines of
          currencies, with a band of empty surface under it — the same stranding
          the amounts column suffers when it is the shorter side. */}
      <View style={{ alignSelf: 'center' }}>
        <PersonAvatar
          name={shownName}
          size={44}
          ghost={person.is_ghost || blocked}
          photoUrl={photoUrl}
        />
        {/* The "seen twice" mark — a small merge glyph on the avatar corner, so
            a duplicate the strip counted can also be spotted in the list itself. */}
        {duplicate && !selectMode ? (
          <View
            style={{
              position: 'absolute',
              right: -3,
              bottom: -3,
              width: 18,
              height: 18,
              borderRadius: 9,
              backgroundColor: theme.color.brand,
              borderWidth: 2,
              borderColor: theme.color.surface,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="git-merge" size={10} color={theme.color.onBrand} />
          </View>
        ) : null}
      </View>
      {/* With a caption the name column keeps the row's top alignment, so the
          name stays on the lead figure's line. Without one — a balance that
          runs both ways, where no single word is true — a lone name pinned to
          the top of a three-line stack of currencies left a band of empty row
          under it. It centres there instead, a size up, so the person reads as
          the row's subject rather than a label stranded in a corner. */}
      <View style={{ flex: 1, alignSelf: caption ? 'flex-start' : 'center' }}>
        {/* The invite / remind glyph rides beside the name it acts on, rather
            than in a column of its own at the far edge — there it read as a
            control for the amount, and the column cost every row its width. */}
        <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
          <Text
            variant={caption ? 'body' : 'subheading'}
            numberOfLines={1}
            style={{ fontWeight: '600', flexShrink: 1 }}
          >
            {shownName}
          </Text>
          {action === 'invite' && soloGroup ? (
            // A guest with no account yet: the useful action is the invite link
            // that also lets them claim this balance (A25). One group, one link.
            <RowAction
              icon="paper-plane-outline"
              label={t.people.invite}
              onPress={() => router.push(`/group/${soloGroup}/invite`)}
            />
          ) : action === 'remind' && single ? (
            // They owe you and one group explains it — a single pair to nudge,
            // kept honest by the server at one a day (ADR-010).
            <RemindButton row={single} />
          ) : null}
        </Row>
        {caption ? (
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {caption}
          </Text>
        ) : null}
      </View>
      {/* Right cluster: the coloured amount right-aligned, then a fixed-width
          trailing slot for the action glyph. The slot is always present, even on
          rows with no action, so every amount's right edge lines up and the
          invite/remind discs sit in one clean column at the edge — rather than
          floating at a different x on every row because the amount width differs.

          The figures keep the row's top alignment while there is a stack of
          them, so the lead figure lands on the name's line — but a person
          holding one currency has no stack, and their single amount hanging at
          the top of a two-line name-and-caption block left the row lopsided,
          the figure floating above the middle of the person it belongs to.
          With nothing underneath it to be mistaken for, it centres instead. */}
      <View
        style={{
          alignItems: 'flex-end',
          alignSelf: oneFigure ? 'center' : 'flex-start',
          maxWidth: '46%',
        }}
      >
        {/* The first amount is always the same size, whether the person holds one
            currency or four — it used to drop to caption as soon as there were
            two, so the column that should read as one row of figures carried
            16px and 13px side by side. The lead figure is the row's answer; the
            currencies under it are the detail. Never summed across them. */}
        {shownEntries.map((entry, index) => (
          <MoneyText
            key={entry.currency}
            amount={BigInt(entry.net)}
            currency={entry.currency}
            locale={locale}
            variant={index === 0 ? 'subheading' : 'caption'}
            mode="balance"
            // Every line, not only the lead: the column is capped at 46% of the
            // row, and a wrapped amount anywhere in the stack grows the row —
            // the exact thing this list was fixed to stop doing.
            numberOfLines={1}
            ellipsizeMode="tail"
          />
        ))}
        {hiddenCurrencies > 0 ? (
          <Text variant="micro" tone="faint">
            {plural(locale, hiddenCurrencies, t.tabs.moreCurrencies)}
          </Text>
        ) : null}
      </View>
    </Row>
  );

  return (
    // A plain Pressable, deliberately — the row lives in a scroll list, and a
    // per-row Reanimated press-spring is what made scrolling feel less than
    // buttery. A flat opacity dip costs nothing and keeps the list smooth.
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={250}
      // In selection mode a selectable row is a checkbox; a non-selectable one
      // (a real account — already one identity, nothing to merge) is inert, so it
      // announces neither role nor tap and reads as disabled. Outside selection
      // mode every row is the usual button into the person.
      disabled={selectMode && !selectable}
      accessibilityRole={selectMode ? (selectable ? 'checkbox' : 'none') : 'button'}
      accessibilityState={
        selectMode ? (selectable ? { checked: selected } : { disabled: true }) : undefined
      }
      accessibilityLabel={selectMode ? shownName : rowA11yLabel}
      style={({ pressed }) => ({
        opacity: pressed ? 0.6 : 1,
        // A tick alone can be missed; a picked row also wears a soft brand fill —
        // brandSoft rather than a grey, so the selection reads as *chosen*, the
        // same colour language the check and the header's Merge button speak.
        backgroundColor: selected ? theme.color.brandSoft : 'transparent',
      })}
    >
      {/* A slim brand bar down the leading edge of a picked row — the accent that
          turns a tinted background into a deliberate selection, the way a mail
          client marks the rows you have ticked. */}
      {selected ? (
        <View
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: 0,
            width: 3,
            backgroundColor: theme.color.brand,
          }}
        />
      ) : null}
      {body}
    </Pressable>
  );
});

/**
 * The vivid avatar disc — a saturated fill keyed off the person's
 * stable tint, with white initials, the pop the Monzo / Mesh / Satispay people
 * lists get from colour. A member's profile photo, once resolved to a signed
 * URL, fills the disc instead. A guest (a ghost, ADR-006) stays deliberately
 * quieter — the soft pastel with a dashed ring — so "not joined yet" still reads
 * apart from a full member at a glance. The colour is the person's own stable
 * tint, so it matches them everywhere else in the app.
 *
 * A flat saturated fill, deliberately — not a per-row native gradient. This disc
 * is drawn once for every visible row of a virtualized list, and a native
 * LinearGradient view per row is a real cost on a fast fling; a solid `ink` with
 * white initials reads all but identically and stays cheap.
 */
function PersonAvatar({
  name,
  size,
  ghost,
  photoUrl,
}: {
  name: string;
  size: number;
  ghost: boolean;
  /** A resolved, displayable URL (the caller signs the private bucket path). */
  photoUrl?: string | null;
}): React.JSX.Element {
  const theme = useTheme();
  const pair = theme.tint[tintForKey(name)];

  if (photoUrl) {
    return (
      <Image
        source={{ uri: photoUrl }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        resizeMode="cover"
        accessibilityLabel={name}
      />
    );
  }

  if (ghost) {
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: pair.bg,
          borderWidth: 1.5,
          borderColor: pair.ink,
          borderStyle: 'dashed',
        }}
      >
        <Text variant="caption" style={{ color: pair.ink, fontWeight: '700' }}>
          {initialsOf(name)}
        </Text>
      </View>
    );
  }

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pair.ink,
      }}
    >
      <Text style={{ color: theme.color.onBrand, fontWeight: '800', fontSize: size * 0.38 }}>
        {initialsOf(name)}
      </Text>
    </View>
  );
}

/**
 * A single round action glyph on a person row — the invite send button, sized to
 * a thumb but not to a text pill's width. A soft brand disc that dips under the
 * finger. Its own pressable, so a tap fires the action rather than opening the
 * person behind it.
 */
function RowAction({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      // Drawn small to sit on the name's line; the slop keeps a 44pt touch.
      hitSlop={10}
      style={{
        width: 26,
        height: 26,
        borderRadius: 13,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.color.brandSoft,
      }}
    >
      <Ionicons name={icon} size={iconSize.sm} color={theme.color.brand} />
    </PressableScale>
  );
}

/**
 * The one-tap nudge for somebody who owes you — a round bell glyph matching the
 * invite action's shape.
 *
 * Once tapped it does not offer to be tapped again — it settles into a quiet
 * "Reminded", and if the server says the daily limit is already spent it says
 * "Nudged today" in the same muted voice rather than an error. Being told off
 * for caring twice is exactly the collections-agency feeling ADR-010 forbids,
 * so a rate limit reads here as reassurance that it already went, not a wall.
 * Its own Pressable, so a tap nudges rather than opening the group behind it.
 */
/** The nudge's row-local state, kept as one value so a single recycling reset
    clears it. `done` shows a glyph; the full phrase rides the a11y label. */
type NudgeState =
  { phase: 'idle' } | { phase: 'pending' } | { phase: 'done'; ok: boolean; label: string };

function RemindButton({ row }: { row: PersonBalanceRow }): React.JSX.Element | null {
  const theme = useTheme();
  const { t } = useStrings();
  // FlashList recycles this row's whole tree, so a naive useState would carry
  // one person's "Reminded" tick — or a stale spinner — onto the next person the
  // row is reused for. `useRecyclingState` resets to idle whenever the row's
  // identity (the pair being nudged) changes, so the button always reflects the
  // person now under it. One value holds the whole lifecycle, so the reset is
  // atomic. A request generation guards the async gap: a nudge that settles
  // after the row has been recycled onto someone else is a stale reply for a
  // person no longer here, so its `setState` is dropped (the reset bumps the
  // generation; each `run` captures its own and checks it before applying).
  const genRef = useRef(0);
  const [state, setState] = useRecyclingState<NudgeState>(
    { phase: 'idle' },
    [row.member_id, row.only_group_id, row.currency],
    () => {
      genRef.current += 1;
    },
  );

  const run = (): void => {
    const gen = (genRef.current += 1);
    const fresh = (): boolean => genRef.current === gen;
    setState({ phase: 'pending' });
    void sendNudge(
      { groupId: row.only_group_id ?? '', memberId: row.member_id, currency: row.currency },
      t,
    ).then((result) => {
      // The row may have been recycled onto someone else while this was out.
      if (fresh()) setState({ phase: 'done', ok: result.ok, label: result.label });
    });
  };

  if (state.phase === 'done') {
    // A verdict, not a sentence — one glyph, sized to the fixed action slot; the
    // full phrase (a whole sentence in the error case) rides the a11y label.
    return (
      <View
        accessible
        accessibilityLabel={state.label}
        // The disc's own 26: the verdict replaces it on the name's line, and a
        // bigger glyph there would push the caption down as it lands.
        style={{ width: 26, height: 26, alignItems: 'center', justifyContent: 'center' }}
      >
        <Ionicons
          name={state.ok ? 'checkmark-circle' : 'alert-circle-outline'}
          size={iconSize.md}
          color={state.ok ? theme.color.positive : theme.color.negative}
        />
      </View>
    );
  }
  if (state.phase === 'pending')
    return (
      <View style={{ width: 26, height: 26, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="small" color={theme.color.brand} />
      </View>
    );

  return <RowAction icon="notifications-outline" label={t.people.remind} onPress={run} />;
}

/**
 * The sort dropdown — a bare corner card, WhatsApp-style, matching the app's
 * other overflow menus. One row per key with its icon; the active key wears the
 * brand ink and a direction arrow, and tapping it again flips the arrow.
 */
function SortMenu({
  open,
  onClose,
  sortKey,
  sortDir,
  onPick,
  t,
}: {
  open: boolean;
  onClose: () => void;
  sortKey: SortKey;
  sortDir: SortDir;
  onPick: (key: SortKey) => void;
  t: UiStrings;
}): React.JSX.Element {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal
      supportedOrientations={MODAL_ORIENTATIONS}
      visible={open}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={t.common.close}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.12)' }}
      >
        <View
          style={{
            position: 'absolute',
            top: insets.top + 56,
            right: theme.spacing.xl,
            minWidth: 220,
            borderRadius: theme.radius.lg,
            ...theme.shadow.lifted,
          }}
        >
          <View
            style={{
              borderRadius: theme.radius.lg,
              borderWidth: 1,
              borderColor: theme.color.border,
              backgroundColor: theme.color.surface,
              paddingVertical: theme.spacing.xs,
              overflow: 'hidden',
            }}
          >
            <Text
              variant="micro"
              tone="faint"
              style={{ paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.xs }}
            >
              {t.sort.by}
            </Text>
            {SORT_ORDER.map((key) => {
              const active = key === sortKey;
              const label = sortLabel(key, t);
              return (
                <Pressable
                  key={key}
                  onPress={() => onPick(key)}
                  accessibilityRole="button"
                  accessibilityLabel={label}
                  accessibilityState={{ selected: active }}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.spacing.md,
                    paddingHorizontal: theme.spacing.lg,
                    paddingVertical: theme.spacing.md,
                    backgroundColor: pressed ? theme.color.surfaceMuted : 'transparent',
                  })}
                >
                  <Ionicons
                    name={SORT_META[key].icon}
                    size={iconSize.lg}
                    color={active ? theme.color.brand : theme.color.textMuted}
                  />
                  <Text
                    variant="body"
                    style={{ flex: 1, color: active ? theme.color.brand : theme.color.text }}
                  >
                    {label}
                  </Text>
                  {active ? (
                    <Ionicons
                      name={sortDir === SortDir.Asc ? 'arrow-up' : 'arrow-down'}
                      size={iconSize.md}
                      color={theme.color.brand}
                    />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}

/**
 * The "Add people" menu, dropped from its pill: pull from contacts, find by
 * address or number, scan an invite QR. Typing a bare name is not here — it
 * lives on the empty Friends screen and inside the contacts picker ("someone
 * not in my contacts"), where it is the answer rather than a first choice.
 */
function AddMenu({
  open,
  anchor,
  onClose,
  t,
}: {
  open: boolean;
  /** The pill it opens from; null falls back to the header corner. */
  anchor: MenuAnchor | null;
  onClose: () => void;
  t: UiStrings;
}): React.JSX.Element {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width: windowW } = useWindowDimensions();
  // Dropped from the pill it belongs to, its leading edge under the pill's,
  // pulled back in if that would run it off the far side (the pill sits on the
  // right under RTL). Window coordinates, so the Modal below is drawn
  // edge-to-edge (translucent bars) to share the same origin.
  // `measureInWindow` is physical (from the left edge) while `start` is
  // logical, so under RTL the pill's leading edge is its distance from the
  // right: the window width less its far edge.
  const leading = anchor ? (I18nManager.isRTL ? windowW - (anchor.x + anchor.width) : anchor.x) : 0;
  const place = anchor
    ? {
        top: anchor.y + anchor.height + theme.spacing.sm,
        start: Math.max(
          theme.spacing.lg,
          Math.min(leading, windowW - ADD_MENU_WIDTH - theme.spacing.lg),
        ),
      }
    : { top: insets.top + 56, end: theme.spacing.xl };

  const go = (path: string): void => {
    onClose();
    router.push(path as never);
  };

  const items: {
    key: string;
    label: string;
    icon: React.ReactNode;
    onPress: () => void;
  }[] = [
    {
      key: 'contacts',
      label: t.tabs.fromContacts,
      icon: (
        <MaterialCommunityIcons
          name="book-account-outline"
          size={iconSize.lg}
          color={theme.color.text}
        />
      ),
      onPress: () => go('/friends/contacts'),
    },
    {
      // Sits after the address book because it is the narrower tool: this one
      // needs the exact address or number, and only finds somebody who has
      // allowed being found that way.
      key: 'find',
      label: t.person.findTitle,
      icon: <Ionicons name="search-outline" size={iconSize.lg} color={theme.color.text} />,
      onPress: () => go('/friends/find'),
    },
    {
      key: 'scan',
      label: t.misc.scanToJoin,
      icon: <Ionicons name="qr-code-outline" size={iconSize.lg} color={theme.color.text} />,
      onPress: () => go('/scan'),
    },
  ];

  return (
    <Modal
      supportedOrientations={MODAL_ORIENTATIONS}
      visible={open}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={t.common.close}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.12)' }}
      >
        <View
          style={{
            position: 'absolute',
            ...place,
            minWidth: ADD_MENU_WIDTH,
            borderRadius: theme.radius.lg,
            ...theme.shadow.lifted,
          }}
        >
          <View
            style={{
              borderRadius: theme.radius.lg,
              borderWidth: 1,
              borderColor: theme.color.border,
              backgroundColor: theme.color.surface,
              paddingVertical: theme.spacing.xs,
              overflow: 'hidden',
            }}
          >
            <Text
              variant="micro"
              tone="faint"
              style={{ paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.xs }}
            >
              {t.tabs.addSomeone}
            </Text>
            {items.map((item) => (
              <Pressable
                key={item.key}
                onPress={item.onPress}
                accessibilityRole="button"
                accessibilityLabel={item.label}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.spacing.md,
                  paddingHorizontal: theme.spacing.lg,
                  paddingVertical: theme.spacing.md,
                  backgroundColor: pressed ? theme.color.surfaceMuted : 'transparent',
                })}
              >
                {item.icon}
                <Text variant="body" style={{ flex: 1 }}>
                  {item.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}
