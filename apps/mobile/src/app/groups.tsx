import { otherCurrencyChips } from '@/data/totals';
import { withScenic } from '@/components/ScenicScope';
import { AdSlot } from '@/components/AdSlot';
import { placeSlots } from '@/lib/adPlanPure';
import { useAdPlan } from '@/lib/useAdPlan';
import { useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { FlashList } from '@shopify/flash-list';
import { RefreshControl, View } from 'react-native';

import {
  Button,
  EmptyState,
  iconSize,
  Screen,
  Text,
  useTabBarClearance,
  useTheme,
} from '@waves/ui';

import { useGroups, useHomeSummary } from '@/data/hooks';
import { groupsOutsideCompanies } from '@/lib/spaces';
import { groupLabel } from '@/data/types';
import { useStrings } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { DEFAULT_GROUPS_SORT, sortGroups, type GroupsSort } from '@/lib/groupsList';
import { SkeletonList } from '@/components/Skeletons';
import { ScenicScreen } from '@/components/hero/ScenicScreen';
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

  // One fixed order (most recent first), as on Home: no sort control here.
  const sort: GroupsSort = DEFAULT_GROUPS_SORT;
  const sortDesc = true;

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

    const sorted = sortGroups(decorated, sort, locale);
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
  }, [list, summary, profile?.id, sort, sortDesc, locale, t.settledHeader]);

  // Native ads between group rows (never while a menu is open).
  const adHandle = useAdPlan('groups_all', {
    rowCount: rows.filter((row) => row.kind === 'group').length,
    surfaceState: { selectMode: false, sheetOpen: false },
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
              paddingHorizontal: theme.spacing.lg,
              paddingBottom: clearance,
            }}
            ListHeaderComponent={
              <View style={{ gap: theme.spacing.xs }}>
                {top}
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
