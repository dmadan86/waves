import { AdSlot } from '@/components/AdSlot';
import { placeSlots } from '@/lib/adPlanPure';
import { useAdPlan } from '@/lib/useAdPlan';
import { memo, useMemo, useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, TextInput, useWindowDimensions, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  directionalIcon,
  Button,
  EmptyState,
  iconSize,
  MoneyText,
  Row,
  Screen,
  Text,
  useTabBarClearance,
  useTheme,
} from '@waves/ui';

import { useGroups, useHomeSummary } from '@/data/hooks';
import { groupsOutsideCompanies } from '@/lib/spaces';
import { groupLabel } from '@/data/types';
import { plural, useStrings, type UiStrings } from '@/i18n';
import { SortMenu, type MenuAnchor } from '@/components/SortMenu';
import { useAuth } from '@/lib/auth';
import { PressableScale } from '@/lib/anim';
import {
  DEFAULT_GROUPS_SORT,
  filterGroups,
  sortGroups,
  type GroupsFilter,
  type GroupsSort,
} from '@/lib/groupsList';
import { useHeroScene } from '@/lib/heroScenePreference';
import { HERO_THEMES } from '@/lib/scene';
import { GroupMark } from '@/components/GroupMark';
import { useCoverTile } from '@/lib/groupCoverColor';
import { UnreadDot } from '@/components/UnreadDot';
import { useGroupUnread } from '@/lib/useGroupUnread';
import { SkeletonList } from '@/components/Skeletons';
import { HeroScene } from '@/components/home/HeroScene';
import { useHeroStatusBar } from '@/components/ScreenHero';
import { router } from '@/lib/navigation';

/** The round buttons in the header, back button included, so the row is one height. */
const HEADER_BUTTON = 40;

/**
 * How much of the scene stays under the header's own text, how far the search
 * field rides up over its foot, and how far the scene fades on under the field —
 * the same three numbers, and the same rule (overlap never past the room), the
 * contact picker's scene uses.
 */
const SCENE_ROOM = 26;
const SCENE_OVERLAP = 14;
const SCENE_INTO_CARD = 34;

/**
 * The full, browsable list of every group — the "All groups" door off the
 * dashboard's capped preview.
 *
 * Groups open latest-activity first, like the dashboard. The money-first order
 * (groups that owe or are owed, or wait on a confirmation, on top, biggest
 * balances first, the settled ones below a quiet "Settled" label) is one pick
 * away in the sort menu. The chips under the search field
 * narrow the roster to what you are owed or what you owe, and the round button
 * at their end re-sorts it by recent activity or name.
 *
 * It wears the scenic header Home and Personal wear — the way back, the title,
 * the doors to join and to a new group — with the search field riding up over
 * the scene's foot. Rows are deliberately tight: this is the screen you come to
 * when the roster is long, so how many fit on screen is part of its job.
 */
export default function AllGroupsScreen() {
  const theme = useTheme();
  const clearance = useTabBarClearance();
  const { t, locale } = useStrings();
  const { profile } = useAuth();
  const summary = useHomeSummary(profile?.id ?? null);
  const groups = useGroups();
  const list = useMemo(() => groupsOutsideCompanies(groups.data ?? []), [groups.data]);
  const loading = groups.isLoading || summary.isLoading;
  // Groups someone else has touched since the reader last opened them.
  const groupIds = useMemo(() => list.map((group) => group.id), [list]);
  const unreadGroups = useGroupUnread(groupIds);

  const [query, setQuery] = useState('');
  const [filter] = useState<GroupsFilter>('all');
  const [sort, setSort] = useState<GroupsSort>(DEFAULT_GROUPS_SORT);
  const [sortDesc, setSortDesc] = useState(true);
  const [sortOpen, setSortOpen] = useState(false);
  const [sortAnchor, setSortAnchor] = useState<MenuAnchor | null>(null);
  const searchRef = useRef<TextInput>(null);
  const trimmed = query.trim().toLowerCase();
  const narrowed = trimmed !== '' || filter !== 'all';

  // Decorate every group with the facts a row shows — balance, whether a
  // settlement is pending, the member count — then filter, sort (favorites in
  // front, see `sortGroups`) and, in the default money-first order only, thread
  // a "Settled" label between the groups wanting action and the quiet ones.
  // One memo so a fast scroll isn't recomputing per frame.
  const rows = useMemo(() => {
    const decorated = list.map((group) => {
      const members = summary.membersFor(group.id);
      const balance = summary.balanceFor(group.id);
      const pending = summary.hasPending(group.id);
      return {
        id: group.id,
        group,
        label: groupLabel(group, members, profile?.id),
        balance,
        pending,
        count: summary.memberCountFor(group.id),
        needsAction: pending || balance !== 0n,
        lastActive: summary.lastActivityFor(group.id),
      };
    });

    const sorted = sortGroups(filterGroups(decorated, filter, trimmed), sort, locale);
    // The same toggle Friends has: picking the active sort again flips it.
    const ordered = sortDesc ? sorted : [...sorted].reverse();

    type Entry = (typeof decorated)[number];
    type ListRow = { kind: 'group'; item: Entry } | { kind: 'header'; label: string };
    const out: ListRow[] = [];
    // The "Settled" label only appears when the list holds a mix, since a
    // block that is all settled (or all active) needs no label.
    const firstSettled = ordered.findIndex((entry) => !entry.needsAction);
    const settledLabelAt =
      sort === 'amount' && sortDesc && firstSettled > 0 ? ordered[firstSettled]!.id : null;
    for (const item of ordered) {
      if (item.id === settledLabelAt) out.push({ kind: 'header', label: t.settledHeader });
      out.push({ kind: 'group', item });
    }
    return out;
  }, [list, summary, profile?.id, trimmed, filter, sort, sortDesc, locale, t.settledHeader]);

  // Native ads between group rows (never while a search is typed or a menu is open).
  const adHandle = useAdPlan('groups_all', {
    rowCount: rows.filter((row) => row.kind === 'group').length,
    surfaceState: { selectMode: narrowed, sheetOpen: sortOpen },
  });
  const adSlotsKey = adHandle.plan.slots.join(',');
  const data = useMemo(
    () =>
      placeSlots(
        rows,
        adHandle.plan.slots,
        new Set(),
        { row: 'group', header: 'header' },
        adHandle.minGap,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- adHandle.plan.slots is the only part of the plan used
    [rows, adSlotsKey],
  );

  // What a rendered row reads from outside its own data: the locale (money and
  // member-count formatting) and the theme (its colours). Both hold identity
  // between renders and move only when they truly change, so this memo is a
  // stable extraData that re-renders rows on a language or light/dark switch
  // without the per-render churn an inline array would cause. The unread set
  // too: it is memoised on the mirror and the stored reads, so it moves only
  // when a dot should appear or go out.
  const listExtraData = useMemo(
    () => ({ locale, theme, unreadGroups }),
    [locale, theme, unreadGroups],
  );

  const empty = loading ? (
    <SkeletonList rows={5} />
  ) : narrowed ? (
    // A search or chip that matched nothing — the reason the list is empty is
    // the narrowing, so the mark and words say "nothing matched", not "you have
    // no groups".
    <EmptyState
      icon={<Ionicons name="search-outline" size={iconSize.xxl} color={theme.color.brand} />}
      title={t.noGroupsMatch}
    />
  ) : (
    // The true first-run empty: reassure, explain lightly what a "group" is for,
    // and hand over the one action that moves you off this screen.
    <EmptyState
      icon={<Ionicons name="people-outline" size={iconSize.xxl} color={theme.color.brand} />}
      title={t.tabs.noGroups}
      body={t.noGroupsBody}
      action={
        <View style={{ gap: theme.spacing.sm, alignItems: 'center' }}>
          <Button label={t.newGroup} onPress={() => router.push('/new-group')} />
          <Button
            label={t.misc.joinWithCode}
            variant="ghost"
            onPress={() => router.push('/scan' as never)}
          />
        </View>
      }
    />
  );

  return (
    // No safe-area edge of its own: the scene paints its own top inset so the
    // colour runs up behind the status bar instead of stopping at a white strip.
    <Screen edges={[]}>
      <GroupsHeader
        title={t.groupsTitle}
        subtitle={t.misc.groupsSubtitle}
        backLabel={t.common.back}
        joinLabel={t.misc.joinWithCode}
        newLabel={t.newGroup}
        searchLabel={t.searchGroups}
        clearLabel={t.pickers.clearSearch}
        query={query}
        onQuery={setQuery}
        searchRef={searchRef}
      />

      {/* The chips stay put above the list — only the roster scrolls. Nothing to
          filter on a brand-new account, so they wait for the first group. */}
      {list.length > 0 ? (
        <FilterBar
          sortLabel={sortLabelFor(sort, t)}
          sortDesc={sortDesc}
          onOpenSort={(anchor) => {
            setSortAnchor(anchor);
            setSortOpen(true);
          }}
        />
      ) : null}

      <View style={{ flex: 1 }}>
        {loading || rows.length === 0 ? (
          // Centred in what can be *seen*, not in what is laid out — the box
          // below holds the bar's foot off, so this branch is centred in the
          // visible height for free. The skeleton sits at the top instead: it is
          // standing in for rows, and rows start at the top.
          <View
            style={{
              flex: 1,
              justifyContent: loading ? 'flex-start' : 'center',
              paddingHorizontal: theme.spacing.lg,
              paddingBottom: clearance,
            }}
          >
            {empty}
          </View>
        ) : (
          <FlashList
            data={data}
            keyExtractor={(row) =>
              row.kind === 'header' ? 'settled-header' : row.kind === 'ad' ? row.key : row.item.id
            }
            getItemType={(row) => row.kind}
            // Render well ahead of the viewport so a fast fling doesn't flash
            // blank rows. The row items already carry their own balance/pending/
            // count (baked in the memo above), so a money change flows through
            // `data`; the outside a row reads — locale and theme — rides the
            // memoised `listExtraData`, which changes identity only on a real
            // language or light/dark switch, not every render.
            drawDistance={1500}
            extraData={listExtraData}
            showsVerticalScrollIndicator={false}
            // The foot goes on the list's content, so the last card can be
            // scrolled clear of the tab bar.
            contentContainerStyle={{
              paddingHorizontal: theme.spacing.md,
              paddingTop: 0,
              paddingBottom: clearance,
            }}
            // With the search keyboard open, a tap on a result row should open
            // it in one go, not be eaten by the keyboard dismiss (FlashList
            // defaults this to "never").
            keyboardShouldPersistTaps="handled"
            renderItem={({ item: row }) => {
              if (row.kind === 'header') return <SectionLabel label={row.label} />;
              if (row.kind === 'ad')
                return (
                  <AdSlot
                    handle={adHandle}
                    format="native"
                    slot={row.slot}
                    rowGap={theme.spacing.sm}
                  />
                );

              const { group, balance, pending, count } = row.item;
              const statusLabel =
                balance === 0n ? t.allSettled : balance > 0n ? t.youAreOwed : t.youOwe;
              const members = plural(locale, count, t.memberCount);
              // Pending keeps its place ahead of the count — it is the one state
              // waiting on you.
              const subtitle = pending ? `${t.pendingConfirmation} · ${members}` : members;
              // Spoken in full: "You are owed" never reaches a screen reader
              // from the small label, which is read as part of this instead.
              const spoken = pending
                ? `${t.pendingConfirmation} · ${members}`
                : `${statusLabel} · ${members}`;
              const direction =
                balance === 0n ? t.allSettled : balance > 0n ? t.group.rowOwed : t.group.rowYouOwe;

              return (
                <GroupListRow
                  groupId={group.id}
                  label={row.item.label}
                  coverEmoji={group.cover_emoji}
                  coverColor={group.cover_color}
                  balance={balance}
                  currency={group.default_currency}
                  locale={locale}
                  subtitle={subtitle}
                  spoken={spoken}
                  direction={direction}
                  // Settled groups are present, not urgent: dimmed so the eye
                  // lands on the rows that still need something.
                  dim={!row.item.needsAction}
                  isDemo={group.isDemo === true}
                  unread={unreadGroups.has(group.id)}
                />
              );
            }}
          />
        )}
      </View>

      <SortMenu
        open={sortOpen}
        anchor={sortAnchor}
        onClose={() => setSortOpen(false)}
        title={t.sort.by}
        closeLabel={t.common.close}
        options={SORT_KEYS.map((key) => ({
          key,
          label: sortLabelFor(key, t),
          icon: SORT_ICONS[key],
        }))}
        activeKey={sort}
        activeIndicator={sortDesc ? 'arrow-down' : 'arrow-up'}
        onPick={(key) => {
          if (key === sort) setSortDesc((d) => !d);
          else {
            setSort(key);
            setSortDesc(key !== 'name');
          }
          setSortOpen(false);
        }}
      />
    </Screen>
  );
}

/**
 * The scenic header: the scene Home and Personal wear, the title block's own
 * measured height sizing it, and the search field riding up over its foot — the
 * contact picker's move (`ContactPickerScene`), with this screen's controls on
 * the right: the join door, then the solid new-group one.
 */
function GroupsHeader({
  title,
  subtitle,
  backLabel,
  joinLabel,
  newLabel,
  searchLabel,
  clearLabel,
  query,
  onQuery,
  searchRef,
}: {
  title: string;
  subtitle: string;
  backLabel: string;
  joinLabel: string;
  newLabel: string;
  searchLabel: string;
  clearLabel: string;
  query: string;
  onQuery: (next: string) => void;
  searchRef: React.RefObject<TextInput | null>;
}): React.JSX.Element {
  const theme = useTheme();
  const insetsTop = useSafeAreaInsets().top;
  const { width: screenWidth } = useWindowDimensions();
  const scene = useHeroScene();
  const [headerHeight, setHeaderHeight] = useState(0);
  const darkInk = HERO_THEMES[scene].ink === 'dark';
  useHeroStatusBar(darkInk ? 'dark' : 'light');
  const ink = darkInk ? theme.color.text : '#FFFFFF';

  return (
    <View>
      {headerHeight > 0 ? (
        <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0 }}>
          <HeroScene
            scene={scene}
            width={screenWidth}
            height={headerHeight + SCENE_INTO_CARD}
            horizon={headerHeight - SCENE_OVERLAP}
            headerBottom={insetsTop + HEADER_BUTTON}
            pageColor={theme.color.bg}
          />
        </View>
      ) : null}

      <View
        onLayout={(event) => setHeaderHeight(event.nativeEvent.layout.height)}
        style={{
          paddingTop: insetsTop + theme.spacing.sm,
          paddingHorizontal: theme.spacing.md,
          paddingBottom: SCENE_ROOM,
        }}
      >
        <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={backLabel}
            onPress={() => router.back()}
            hitSlop={6}
            style={whiteDisc}
          >
            <Ionicons
              name={directionalIcon('arrow-back')}
              size={iconSize.lg}
              color={theme.color.text}
            />
          </PressableScale>
          <View style={{ flex: 1, gap: 1 }}>
            <Text
              variant="title"
              numberOfLines={1}
              style={{
                color: ink,
                fontSize: 22,
                lineHeight: 26,
                fontWeight: '800',
                ...inkShadow(darkInk),
              }}
            >
              {title}
            </Text>
            <Text
              variant="caption"
              numberOfLines={1}
              style={{ color: ink, opacity: darkInk ? 0.75 : 0.92, ...inkShadow(darkInk) }}
            >
              {subtitle}
            </Text>
          </View>
          {/* The join door, beside the new-group one: somebody handed a QR or a
              link has nowhere else obvious to look. */}
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={joinLabel}
            onPress={() => router.push('/scan' as never)}
            hitSlop={6}
            style={whiteDisc}
          >
            <Ionicons name="qr-code-outline" size={iconSize.lg} color={theme.color.brand} />
          </PressableScale>
          {/* The new-group door. It repeats in the empty state below, so it is
              reachable whether or not any group exists yet. */}
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={newLabel}
            onPress={() => router.push('/new-group')}
            hitSlop={6}
            style={whiteDisc}
          >
            <Ionicons name="add" size={iconSize.xl} color={theme.color.brand} />
          </PressableScale>
        </Row>
      </View>

      {/* The search field rides up over the scene's foot by exactly the overlap
          the scene was drawn with. */}
      <View style={{ marginTop: -SCENE_OVERLAP, paddingHorizontal: theme.spacing.md }}>
        <Pressable
          onPress={() => searchRef.current?.focus()}
          accessible={false}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.sm,
            height: 40,
            paddingHorizontal: theme.spacing.md,
            borderRadius: theme.radius.pill,
            backgroundColor: theme.color.surface,
            borderWidth: 1,
            borderColor: theme.color.border,
            shadowColor: '#000',
            shadowOpacity: 0.06,
            shadowRadius: 6,
            shadowOffset: { width: 0, height: 2 },
            elevation: 2,
          }}
        >
          <Ionicons name="search" size={iconSize.md} color={theme.color.textMuted} />
          <TextInput
            ref={searchRef}
            value={query}
            onChangeText={onQuery}
            autoCapitalize="none"
            accessibilityRole="search"
            accessibilityLabel={searchLabel}
            placeholder={searchLabel}
            placeholderTextColor={theme.color.textMuted}
            selectionColor={theme.color.brand}
            style={{ flex: 1, fontSize: 15, color: theme.color.text, paddingVertical: 0 }}
          />
          {query ? (
            <Pressable
              onPress={() => onQuery('')}
              accessibilityRole="button"
              accessibilityLabel={clearLabel}
              hitSlop={8}
            >
              <Ionicons name="close-circle" size={iconSize.md} color={theme.color.textMuted} />
            </Pressable>
          ) : null}
        </Pressable>
      </View>
    </View>
  );
}

/** Light text over a bright patch of sky still reads with a soft shadow. */
function inkShadow(darkInk: boolean) {
  return darkInk
    ? {}
    : {
        textShadowColor: 'rgba(0,0,0,0.25)',
        textShadowOffset: { width: 0, height: 1 },
        textShadowRadius: 3,
      };
}

/** A solid white disc — the header's own action buttons. */
const whiteDisc = {
  width: HEADER_BUTTON,
  height: HEADER_BUTTON,
  borderRadius: HEADER_BUTTON / 2,
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: '#FFFFFF',
} as const;

const SORT_KEYS: readonly GroupsSort[] = ['amount', 'recent', 'name'];
const SORT_ICONS: Record<GroupsSort, React.ComponentProps<typeof Ionicons>['name']> = {
  amount: 'cash-outline',
  recent: 'time-outline',
  name: 'text-outline',
};
function sortLabelFor(key: GroupsSort, t: UiStrings): string {
  return key === 'amount'
    ? t.misc.sortAmount
    : key === 'recent'
      ? t.misc.sortRecent
      : t.misc.sortName;
}

/**
 * One quiet row above the list: the same "Sort by" pill Friends wears, opening the same drop-down
 * (`SortMenu`) from where it sits. Picking the active sort again flips it.
 */
function FilterBar({
  sortLabel,
  sortDesc,
  onOpenSort,
}: {
  sortLabel: string;
  sortDesc: boolean;
  onOpenSort: (anchor: MenuAnchor | null) => void;
}): React.JSX.Element {
  const theme = useTheme();
  const { t } = useStrings();
  const pillRef = useRef<View>(null);
  const openSort = (): void => {
    const pill = pillRef.current;
    if (!pill) return onOpenSort(null);
    pill.measureInWindow((x, y, width, height) =>
      onOpenSort(width > 0 ? { x, y, width, height } : null),
    );
  };
  const pill = {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 32,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
  } as const;

  return (
    <Row
      style={{
        alignItems: 'center',
        justifyContent: 'flex-end',
        paddingHorizontal: theme.spacing.md,
        paddingTop: theme.spacing.sm,
        paddingBottom: 6,
      }}
    >
      <View ref={pillRef} collapsable={false}>
        <Pressable
          onPress={openSort}
          accessibilityRole="button"
          accessibilityLabel={`${t.sort.by}: ${sortLabel}`}
          hitSlop={8}
          style={({ pressed }) => ({
            ...pill,
            backgroundColor: theme.color.surface,
            borderColor: theme.color.border,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Ionicons name="reorder-three-outline" size={iconSize.sm} color={theme.color.textMuted} />
          <Text variant="caption" numberOfLines={1} style={{ fontWeight: '600' }}>
            {t.sort.by}: {sortLabel}
          </Text>
          <Ionicons
            name={sortDesc ? 'chevron-down' : 'chevron-up'}
            size={iconSize.sm}
            color={theme.color.textMuted}
          />
        </Pressable>
      </View>
    </Row>
  );
}

/** The quiet "Settled" label between the groups wanting action and the rest. */
function SectionLabel({ label }: { label: string }): React.JSX.Element {
  const theme = useTheme();
  return (
    <View style={{ paddingVertical: theme.spacing.xs, paddingHorizontal: theme.spacing.xs }}>
      {/* Upper-cased for the small-caps look a section label wants. A no-op in
          Tamil, Hindi and Arabic, which have no case. */}
      <Text variant="micro" tone="muted" style={{ letterSpacing: 1 }}>
        {label.toUpperCase()}
      </Text>
    </View>
  );
}

/**
 * One group as a compact card — the group's mark in a 40dp soft disc, the name
 * over its member count, the balance to the right with who-owes-whom under it, a
 * and a chevron.
 *
 * The amount keeps `MoneyText`'s `balance` mode, which is where owe-versus-owed
 * lives: colour *and* sign together, with the minor units drawn fainter. A
 * settled group has nothing to colour, so it drops the zero amount and says so
 * in words instead, dimmed — which quietens it without telling the reader the
 * wrong direction.
 *
 * Memoized, because it lives in a virtualized list: a recycled row that lands on
 * the same group does no work when the parent re-renders. Every prop is a
 * primitive, so the shallow compare actually holds and a fast fling never
 * re-renders a row it already drew.
 */
const GroupListRow = memo(function GroupListRow({
  groupId,
  label,
  coverEmoji,
  coverColor,
  balance,
  currency,
  locale,
  subtitle,
  spoken,
  direction,
  dim,
  isDemo = false,
  unread = false,
}: {
  groupId: string;
  label: string;
  coverEmoji: string | null;
  coverColor?: string | null;
  balance: bigint;
  currency: string;
  locale: string;
  subtitle: string;
  /** The row's accessibility text: the subtitle with the standing in full. */
  spoken: string;
  /** "owed" / "you owe" / "all settled", drawn small under the amount. */
  direction: string;
  /** Nothing owed and nothing pending — present, but not competing for the eye. */
  dim: boolean;
  /** The one client-side demo group (`@/demo`) — wears a small "Demo" pill
      beside its name, same word the dashboard's own row and Friends use. */
  isDemo?: boolean;
  /** Someone else has done something here since the reader last opened it. */
  unread?: boolean;
}): React.JSX.Element {
  const theme = useTheme();
  const tile = useCoverTile(coverColor, theme.color.brandSoft);
  const { t } = useStrings();

  return (
    <View style={{ paddingBottom: 4 }}>
      <Pressable
        accessibilityRole="button"
        // The full subtitle, not just the status word: a pending group at a zero
        // balance would otherwise be read out as "All settled", hiding the very
        // state that needs attention.
        accessibilityLabel={`${label}${unread ? `, ${t.groupNewActivity}` : ''}. ${spoken}`}
        onPress={() => router.push(`/group/${groupId}`)}
        style={({ pressed }) => ({
          backgroundColor: theme.color.surface,
          borderRadius: theme.radius.lg,
          borderWidth: 1,
          borderColor: theme.color.border,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Row
          style={{
            gap: theme.spacing.sm,
            alignItems: 'center',
            minHeight: 56,
            paddingVertical: 8,
            paddingStart: theme.spacing.sm,
            paddingEnd: 6,
            opacity: dim ? 0.7 : 1,
          }}
        >
          <View
            style={{
              width: 38,
              height: 38,
              borderRadius: 19,
              backgroundColor: tile.backgroundColor,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <GroupMark emoji={coverEmoji} size={20} color={tile.ink} />
            {unread ? <UnreadDot /> : null}
          </View>
          <View style={{ flex: 1, gap: 1 }}>
            <Row style={{ alignItems: 'center', gap: theme.spacing.xs }}>
              <Text
                variant="body"
                numberOfLines={1}
                // A step heavier while unread — the chat-list cue — so the
                // dot is not the only thing saying it.
                style={{ flexShrink: 1, fontSize: 15, fontWeight: unread ? '800' : '700' }}
              >
                {label}
              </Text>
              {isDemo ? (
                <View
                  style={{
                    paddingHorizontal: 6,
                    paddingVertical: 1,
                    borderRadius: 6,
                    backgroundColor: theme.color.warningSoft,
                  }}
                >
                  <Text variant="micro" style={{ color: theme.color.warning, fontWeight: '700' }}>
                    {t.demo.badge}
                  </Text>
                </View>
              ) : null}
            </Row>
            <Text variant="micro" tone="muted" numberOfLines={1}>
              {isDemo ? t.demo.rowSubtitle : subtitle}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            {balance === 0n ? null : (
              <MoneyText
                amount={balance}
                currency={currency as never}
                locale={locale}
                mode="balance"
                variant="body"
                style={{ fontWeight: '700' }}
              />
            )}
            <Text variant="micro" tone="muted" numberOfLines={1}>
              {direction}
            </Text>
          </View>
          <View style={{ alignItems: 'center', gap: 4, width: 18 }}>
            <Ionicons
              name={directionalIcon('chevron-forward')}
              size={iconSize.sm}
              color={theme.color.textMuted}
            />
          </View>
        </Row>
      </Pressable>
    </View>
  );
});
