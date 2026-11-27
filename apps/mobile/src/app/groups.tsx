import { otherCurrencyChips } from '@/data/totals';
import { withScenic } from '@/components/ScenicScope';
import { AdSlot } from '@/components/AdSlot';
import { placeSlots } from '@/lib/adPlanPure';
import { useAdPlan } from '@/lib/useAdPlan';
import { useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, RefreshControl, View } from 'react-native';

import {
  Button,
  directionalIcon,
  iconSize,
  Screen,
  Text,
  useTabBarClearance,
  useTheme,
} from '@waves/ui';

import { useArchivedGroups, useGroups, useHomeSummary } from '@/data/hooks';
import { groupsOutsideCompanies } from '@/lib/spaces';
import { groupLabel } from '@/data/types';
import { fill, useStrings } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { archiveSuggestion, splitFamily, viewerLeft } from '@/lib/groupSections';
import { useKeptGroups } from '@/lib/archiveKept';
import { EmptyCard } from '@/components/standard';
import { SearchField } from '@/components/SearchToggle';
import { useSync } from '@/sync/provider';
import { MutationKind } from '@waves/core';
import { SkeletonList } from '@/components/Skeletons';
import { AnimatedFlashList, ScenicScreen } from '@/components/hero/ScenicScreen';
import { HomeHeroBackground } from '@/components/home/HomeHeroBackground';
import { TabIconButton } from '@/components/home/TabHeader';
import { HomeQuickActions } from '@/components/home/HomeQuickActions';
import { QuickExpenseSheet } from '@/components/QuickExpenseSheet';
import { QuickAddSheet, useQuickAddActions } from '@/components/QuickAddSheet';
import { HomeBalanceCard } from '@/components/home/ScenicBalanceCard';
import { GroupSpaceRow, useGroupRowEnv } from '@/components/home/HomeSpaces';
import { useHomeSpaceFigures } from '@/data/homeSpaces';
import { useBalanceHidden } from '@/lib/balanceHidden';
import { useDefaultCurrency } from '@/lib/currency';
import { useHomeHero } from '@/lib/useHomeHero';
import { usePullRefresh } from '@/lib/pullRefresh';
import { useGroupUnread } from '@/lib/useGroupUnread';
import { router, switchTab } from '@/lib/navigation';

/**
 * The full, browsable list of every group — the "All groups" door off the
 * dashboard's capped preview.
 *
 * Groups open latest-activity first, like the dashboard. The money-first order
 * (groups that owe or are owed, or wait on a confirmation, on top, biggest
 * balances first, the settled ones below a quiet "Settled" label) is one pick
 * away in the sort menu.
 *
 * It wears the scenic header Home and Personal wear — the way back, the title,
 * the doors to join and to a new group — with the card riding up over
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const archived = useArchivedGroups();
  const { mutate } = useSync();
  const { kept, ready: keptReady, keep } = useKeptGroups();
  const [quickExpenseOpen, setQuickExpenseOpen] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const quickAddActions = useQuickAddActions();
  // The same headline Home carries: one currency, the rest counted not added.
  const headline = summary.totals[0] ?? {
    currency: defaultCurrency,
    net: 0n,
    owed: 0n,
    owing: 0n,
  };
  const chips = otherCurrencyChips(summary.totals, headline.currency);
  const inHeadline = list.filter(
    (group) => (group.default_currency ?? 'INR') === headline.currency,
  );
  const owedGroups = inHeadline.filter((group) => summary.balanceFor(group.id) > 0n).length;
  const owingGroups = inHeadline.filter((group) => summary.balanceFor(group.id) < 0n).length;

  // Family spaces first, then the other groups, each most recent first.
  const rows = useMemo(() => {
    const decorated = list.map((group) => {
      const balance = summary.balanceFor(group.id);
      const pending = summary.hasPending(group.id);
      return {
        id: group.id,
        group,
        label: groupLabel(group, summary.membersFor(group.id), profile?.id),
        type: group.type,
        ledger_mode: group.ledger_mode,
        former: viewerLeft(summary.membersFor(group.id), profile?.id),
        balance,
        pending,
        needsAction: pending || balance !== 0n || summary.hasOtherCurrencyBalance(group.id),
        // A group nobody has spent in yet counts from the day it was made.
        lastActive: Math.max(summary.lastActivityFor(group.id), Date.parse(group.created_at) || 0),
      };
    });
    const { family, groups: others } = splitFamily(decorated, query);
    type Entry = (typeof decorated)[number];
    type ListRow =
      | { kind: 'group'; item: Entry; first: boolean; last: boolean }
      | { kind: 'header'; label: string };
    const out: ListRow[] = [];
    const section = (label: string | null, items: Entry[]) => {
      if (label && items.length) out.push({ kind: 'header', label });
      items.forEach((item, i) =>
        out.push({ kind: 'group', item, first: i === 0, last: i === items.length - 1 }),
      );
    };
    // No "Groups" label unless a "Family" one sits above it.
    section(t.homeToday.family, family);
    section(family.length ? t.homeToday.spaces : null, others);
    return { rows: out, all: decorated };
  }, [list, summary, profile?.id, query, t.homeToday.family, t.homeToday.spaces]);
  const suggestion = keptReady && !query ? archiveSuggestion(rows.all, env.nowMs, kept) : null;
  const archiveGroup = (id: string): void => {
    void mutate(MutationKind.GroupUpdate, id, { archived_at: new Date().toISOString() });
  };
  const rowList = rows.rows;

  // Native ads between group rows (never while a menu is open).
  const adHandle = useAdPlan('groups_all', {
    rowCount: rowList.filter((row) => row.kind === 'group').length,
    surfaceState: { selectMode: false, sheetOpen: false },
  });
  const adSlotsKey = adHandle.plan.slots.join(',');
  const data = useMemo(
    () =>
      placeSlots(
        rowList,
        adHandle.plan.slots,
        new Set(),
        { row: 'group', header: 'header' },
        adHandle.minGap,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- adHandle.plan.slots is the only part of the plan used
    [rowList, adSlotsKey],
  );

  const empty = loading ? (
    <SkeletonList rows={5} />
  ) : (
    <EmptyCard
      icon="people-outline"
      title={t.tabs.noGroups}
      helper={t.noGroupsBody}
      action={{ label: t.newGroup, onPress: () => router.push('/new-group') }}
    />
  );

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
        header={(ink) => (
          <>
            <TabIconButton icon="arrow-back" label={t.common.back} onPress={() => router.back()} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                numberOfLines={1}
                style={{
                  color: ink,
                  fontSize: 20,
                  lineHeight: 26,
                  fontWeight: '700',
                }}
              >
                {t.groupsTitle}
              </Text>
              <Text variant="caption" numberOfLines={1} style={{ color: ink, opacity: 0.92 }}>
                {t.misc.groupsSubtitle}
              </Text>
            </View>
            {/* The join door, beside the new-group one: somebody handed a QR or a
                link has nowhere else obvious to look. */}
            <TabIconButton
              icon="search"
              label={t.searchGroups}
              onPress={() => setSearchOpen(true)}
            />
            <TabIconButton
              icon="qr-code-outline"
              label={t.misc.joinWithCode}
              onPress={() => router.push('/scan' as never)}
            />
            <TabIconButton
              icon="add"
              label={t.newGroup}
              onPress={() => router.push('/new-group')}
            />
          </>
        )}
        card={(sceneRef) =>
          list.length === 0 && !loading ? null : (
            <View style={{ marginHorizontal: -theme.spacing.lg }}>
              <HomeBalanceCard
                net={headline.net}
                owed={headline.owed}
                owing={headline.owing}
                owedGroups={owedGroups}
                owingGroups={owingGroups}
                owedChips={chips.owed}
                owingChips={chips.owing}
                currency={headline.currency}
                locale={locale}
                hidden={amountsHidden}
                onToggleHide={toggleBalance}
                settling={false}
                loading={loading || !balanceReady}
                blurTarget={sceneRef}
                footer={
                  <HomeQuickActions
                    onAddExpense={() => setQuickExpenseOpen(true)}
                    onAddExpenseLong={() => setQuickAddOpen(true)}
                    onSettleUp={() => router.push('/settle-up')}
                    onReview={() => router.navigate('/captures')}
                    onScan={() => router.push(`/capture?scan=${Date.now()}`)}
                    onRemind={() => switchTab('/(tabs)/friends')}
                    onJoin={() => router.push('/scan' as never)}
                    radius={theme.radius.xl}
                  />
                }
              />
            </View>
          )
        }
        list={({ onScroll, top, keyboardShouldPersistTaps }) => (
          <AnimatedFlashList
            data={loading || rowList.length === 0 ? [] : data}
            keyExtractor={(row) =>
              row.kind === 'header'
                ? `header-${row.label}`
                : row.kind === 'ad'
                  ? row.key
                  : row.item.id
            }
            getItemType={(row) => row.kind}
            extraData={listExtraData}
            drawDistance={1500}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps={keyboardShouldPersistTaps}
            onScroll={onScroll}
            scrollEventThrottle={16}
            contentContainerStyle={{
              paddingHorizontal: theme.spacing.lg,
              paddingBottom: clearance,
            }}
            ListHeaderComponent={
              <View style={{ gap: theme.spacing.xs }}>
                {top}
                {searchOpen || query ? (
                  <SearchField
                    value={query}
                    onChange={setQuery}
                    onCancel={() => {
                      setQuery('');
                      setSearchOpen(false);
                    }}
                    placeholder={t.searchGroups}
                  />
                ) : null}
                {suggestion ? (
                  <View
                    style={{
                      gap: theme.spacing.sm,
                      padding: theme.spacing.md,
                      borderRadius: theme.radius.lg,
                      backgroundColor: theme.color.brandSoft,
                    }}
                  >
                    <Text>{fill(t.homeToday.archiveSuggest, { name: suggestion.label })}</Text>
                    <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
                      <Button label={t.group.archive} onPress={() => archiveGroup(suggestion.id)} />
                      <Button
                        label={t.homeToday.keep}
                        variant="ghost"
                        onPress={() => keep(suggestion.id)}
                      />
                    </View>
                  </View>
                ) : null}
                {loading ? (
                  <View style={{ paddingTop: theme.spacing.lg }}>{empty}</View>
                ) : rowList.length === 0 ? (
                  <View style={{ paddingTop: theme.spacing.lg }}>
                    {query ? (
                      <Text tone="muted" style={{ textAlign: 'center' }}>
                        {t.noGroupsMatch}
                      </Text>
                    ) : (
                      empty
                    )}
                  </View>
                ) : null}
              </View>
            }
            ListFooterComponent={
              archived.data.length > 0 && !query ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push('/settings/archived')}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    minHeight: 48,
                    marginTop: theme.spacing.md,
                    paddingHorizontal: theme.spacing.xs,
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <Text tone="muted">
                    {fill(t.homeToday.archivedRow, { n: String(archived.data.length) })}
                  </Text>
                  <Ionicons
                    name={directionalIcon('chevron-forward')}
                    size={iconSize.md}
                    color={theme.color.textMuted}
                  />
                </Pressable>
              ) : null
            }
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
              const { group } = row.item;
              return (
                <View
                  style={{
                    borderLeftWidth: 1,
                    borderRightWidth: 1,
                    borderColor: theme.color.border,
                    backgroundColor: theme.color.surface,
                    borderTopLeftRadius: row.first ? theme.radius.lg : 0,
                    borderTopRightRadius: row.first ? theme.radius.lg : 0,
                    borderBottomLeftRadius: row.last ? theme.radius.lg : 0,
                    borderBottomRightRadius: row.last ? theme.radius.lg : 0,
                    borderTopWidth: row.first ? 1 : 0,
                    borderBottomWidth: row.last ? 1 : 0,
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
                    divider={!row.first}
                    unread={unreadGroups.has(group.id) || voiceNewCount(group.id) > 0}
                    env={env}
                  />
                </View>
              );
            }}
          />
        )}
      />

      <QuickAddSheet
        visible={quickAddOpen}
        onClose={() => setQuickAddOpen(false)}
        actions={quickAddActions}
      />
      <QuickExpenseSheet visible={quickExpenseOpen} onClose={() => setQuickExpenseOpen(false)} />
    </Screen>
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
