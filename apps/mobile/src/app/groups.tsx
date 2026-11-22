import { withScenic } from '@/components/ScenicScope';
import { AdSlot } from '@/components/AdSlot';
import { placeSlots } from '@/lib/adPlanPure';
import { useAdPlan } from '@/lib/useAdPlan';
import { useMemo, useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { FlashList } from '@shopify/flash-list';
import { Pressable, RefreshControl, TextInput, View } from 'react-native';

import {
  directionalIcon,
  Button,
  EmptyState,
  iconSize,
  Row,
  Screen,
  Text,
  useTabBarClearance,
  useTheme,
} from '@waves/ui';

import { useGroups, useHomeSummary } from '@/data/hooks';
import { groupsOutsideCompanies } from '@/lib/spaces';
import { groupLabel } from '@/data/types';
import { useStrings, type UiStrings } from '@/i18n';
import { SortMenu, type MenuAnchor } from '@/components/SortMenu';
import { useAuth } from '@/lib/auth';
import {
  DEFAULT_GROUPS_SORT,
  filterGroups,
  sortGroups,
  type GroupsFilter,
  type GroupsSort,
} from '@/lib/groupsList';
import { SkeletonList } from '@/components/Skeletons';
import { ScenicScreen } from '@/components/hero/ScenicScreen';
import { HomeHeroBackground } from '@/components/home/HomeHeroBackground';
import { HeroIconButton } from '@/components/home/HeroControls';
import { HomeBalanceCard } from '@/components/home/ScenicBalanceCard';
import { GroupSpaceRow, useGroupRowEnv } from '@/components/home/HomeSpaces';
import { useHomeSpaceFigures } from '@/data/homeSpaces';
import { useBalanceHidden } from '@/lib/balanceHidden';
import { useDefaultCurrency } from '@/lib/currency';
import { useHomeHero } from '@/lib/useHomeHero';
import { usePullRefresh } from '@/lib/pullRefresh';
import { useGroupUnread } from '@/lib/useGroupUnread';
import { router } from '@/lib/navigation';

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
function AllGroupsScreen() {
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
  const { hidden: balanceHidden, ready: balanceReady, toggle: toggleBalance } = useBalanceHidden();
  const amountsHidden = balanceHidden || !balanceReady;
  const hero = useHomeHero();
  const pull = usePullRefresh();
  const defaultCurrency = useDefaultCurrency();
  const { pool } = useHomeSpaceFigures();
  const { draftsByGroup, voiceNewCount, env } = useGroupRowEnv();
  // The same headline Home carries: one currency, the rest counted not added.
  const headline = summary.totals[0] ?? {
    currency: defaultCurrency,
    net: 0n,
    owed: 0n,
    owing: 0n,
  };
  const inHeadline = list.filter(
    (group) => (group.default_currency ?? 'INR') === headline.currency,
  );
  const owedGroups = inHeadline.filter((group) => summary.balanceFor(group.id) > 0n).length;
  const owingGroups = inHeadline.filter((group) => summary.balanceFor(group.id) < 0n).length;

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

  const firstGroupIndex = data.findIndex((row) => row.kind === 'group');
  const lastGroupIndex = data.findLastIndex((row) => row.kind === 'group');
  const listExtraData = useMemo(
    () => ({ theme, locale, unreadGroups }),
    [theme, locale, unreadGroups],
  );
  return (
    <Screen edges={[]}>
      <ScenicScreen
        background={(g) => <HomeHeroBackground hero={hero} {...g} />}
        refreshControl={
          <RefreshControl
            refreshing={pull.refreshing}
            onRefresh={pull.onRefresh}
            tintColor={theme.color.brand}
          />
        }
        header={(ink, solid) => (
          <>
            <HeroIconButton
              icon={directionalIcon('arrow-back')}
              label={t.common.back}
              onPress={() => router.back()}
              ink={ink}
            />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                numberOfLines={1}
                style={{
                  color: ink,
                  fontSize: 20,
                  lineHeight: 26,
                  fontWeight: '700',
                  ...inkShadow(solid),
                }}
              >
                {t.groupsTitle}
              </Text>
              <Text
                variant="caption"
                numberOfLines={1}
                style={{ color: ink, opacity: 0.92, ...inkShadow(solid) }}
              >
                {t.misc.groupsSubtitle}
              </Text>
            </View>
            {/* The join door, beside the new-group one: somebody handed a QR or a
                link has nowhere else obvious to look. */}
            <HeroIconButton
              icon="qr-code-outline"
              label={t.misc.joinWithCode}
              onPress={() => router.push('/scan' as never)}
              ink={ink}
            />
            <HeroIconButton
              icon="add"
              label={t.newGroup}
              onPress={() => router.push('/new-group')}
              ink={ink}
            />
          </>
        )}
        card={(sceneRef) =>
          list.length === 0 && !loading ? null : (
            <HomeBalanceCard
              net={headline.net}
              owed={headline.owed}
              owing={headline.owing}
              owedGroups={owedGroups}
              owingGroups={owingGroups}
              currency={headline.currency}
              locale={locale}
              hidden={amountsHidden}
              onToggleHide={toggleBalance}
              settling={false}
              loading={loading || !balanceReady}
              blurTarget={sceneRef}
            />
          )
        }
        list={({ onScroll, top, keyboardShouldPersistTaps }) => (
          <FlashList
            data={loading || rows.length === 0 ? [] : data}
            keyExtractor={(row) =>
              row.kind === 'header' ? 'settled-header' : row.kind === 'ad' ? row.key : row.item.id
            }
            getItemType={(row) => row.kind}
            extraData={listExtraData}
            drawDistance={1500}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps={keyboardShouldPersistTaps}
            onScroll={onScroll}
            scrollEventThrottle={16}
            contentContainerStyle={{
              paddingHorizontal: theme.spacing.md,
              paddingBottom: clearance,
            }}
            ListHeaderComponent={
              <View style={{ gap: theme.spacing.xs }}>
                {top}
                <SearchField
                  label={t.searchGroups}
                  clearLabel={t.pickers.clearSearch}
                  query={query}
                  onQuery={setQuery}
                  searchRef={searchRef}
                />
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
                {loading || rows.length === 0 ? (
                  <View style={{ paddingTop: theme.spacing.lg }}>{empty}</View>
                ) : null}
              </View>
            }
            renderItem={({ item: row, index }) => {
              if (row.kind === 'header') return <SectionLabel key="settled" label={row.label} />;
              if (row.kind === 'ad')
                return (
                  <AdSlot
                    handle={adHandle}
                    format="native"
                    slot={row.slot}
                    rowGap={theme.spacing.sm}
                  />
                );
              const { group } = row.item;
              return (
                <View
                  style={{
                    borderLeftWidth: 1,
                    borderRightWidth: 1,
                    borderColor: theme.color.border,
                    backgroundColor: theme.color.surface,
                    borderTopLeftRadius: index === firstGroupIndex ? theme.radius.lg : 0,
                    borderTopRightRadius: index === firstGroupIndex ? theme.radius.lg : 0,
                    borderBottomLeftRadius: index === lastGroupIndex ? theme.radius.lg : 0,
                    borderBottomRightRadius: index === lastGroupIndex ? theme.radius.lg : 0,
                    overflow: 'hidden',
                  }}
                >
                  <GroupSpaceRow
                    group={group}
                    summary={summary}
                    viewerId={profile?.id ?? null}
                    figure={pool.get(group.id)}
                    drafts={draftsByGroup.get(group.id) ?? 0}
                    locale={locale}
                    hidden={amountsHidden}
                    divider={index !== firstGroupIndex}
                    unread={unreadGroups.has(group.id) || voiceNewCount(group.id) > 0}
                    env={env}
                  />
                </View>
              );
            }}
          />
        )}
      />

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

/** The search field, the first thing in the scrolling body under the card. */
function SearchField({
  label,
  clearLabel,
  query,
  onQuery,
  searchRef,
}: {
  label: string;
  clearLabel: string;
  query: string;
  onQuery: (next: string) => void;
  searchRef: React.RefObject<TextInput | null>;
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <Pressable
      onPress={() => searchRef.current?.focus()}
      accessible={false}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        height: 40,
        marginTop: theme.spacing.xs,
        paddingHorizontal: theme.spacing.md,
        borderRadius: theme.radius.pill,
        backgroundColor: theme.color.surface,
        borderWidth: 1,
        borderColor: theme.color.border,
      }}
    >
      <Ionicons name="search" size={iconSize.md} color={theme.color.textMuted} />
      <TextInput
        ref={searchRef}
        value={query}
        onChangeText={onQuery}
        autoCapitalize="none"
        accessibilityRole="search"
        accessibilityLabel={label}
        placeholder={label}
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
  );
}

/** Light text over a bright patch of sky still reads with a soft shadow; not once solid. */
function inkShadow(solid: boolean) {
  return solid
    ? {}
    : {
        textShadowColor: 'rgba(0,0,0,0.25)',
        textShadowOffset: { width: 0, height: 1 },
        textShadowRadius: 3,
      };
}

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
        paddingTop: theme.spacing.sm,
        paddingBottom: theme.spacing.xs,
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

export default withScenic(AllGroupsScreen);
