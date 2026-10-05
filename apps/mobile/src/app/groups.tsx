import { memo, useMemo, useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, TextInput, useWindowDimensions, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Button,
  EmptyState,
  iconSize,
  MoneyText,
  Row,
  Screen,
  Sheet,
  Text,
  useTabBarClearance,
  useTheme,
} from '@waves/ui';

import { useGroups, useHomeSummary, usePinnedGroupIds, useSetGroupPin } from '@/data/hooks';
import { groupLabel } from '@/data/types';
import { plural, useStrings } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { PressableScale } from '@/lib/anim';
import {
  filterGroups,
  sortGroups,
  type GroupsEntry,
  type GroupsFilter,
  type GroupsSort,
} from '@/lib/groupsList';
import { useHeroScene } from '@/lib/heroScenePreference';
import { HERO_THEMES } from '@/lib/scene';
import { GroupMark } from '@/components/GroupMark';
import { SkeletonList } from '@/components/Skeletons';
import { HeroScene } from '@/components/home/HeroScene';
import { TranslucentBackButton } from '@/components/ContactPickerScene';
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
const SCENE_ROOM = 16;
const SCENE_OVERLAP = 14;
const SCENE_INTO_CARD = 34;

/** Chips are a row of small pills; the round sort button matches their height. */
const CHIP_HEIGHT = 32;

/**
 * The full, browsable list of every group — the "All groups" door off the
 * dashboard's capped preview.
 *
 * A money screen has a sharper job than a directory — it should answer "where
 * do I need to act?" before it answers "what do I have?". So by default the
 * groups that owe or are owed (or are waiting on a confirmation) sort to the
 * top, biggest balances first; the settled ones fall below a quiet "Settled"
 * label, dimmed, present but not competing. The chips under the search field
 * narrow the roster to what you are owed, what you owe, or your favorites (the
 * same pin the dashboard and the group's own menu set), and the round button
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
  const list = useMemo(() => groups.data ?? [], [groups.data]);
  const loading = groups.isLoading || summary.isLoading;
  const pinnedIds = usePinnedGroupIds();
  const setGroupPin = useSetGroupPin();

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<GroupsFilter>('all');
  const [sort, setSort] = useState<GroupsSort>('amount');
  const [sortOpen, setSortOpen] = useState(false);
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

    const isFavorite = (entry: GroupsEntry): boolean => pinnedIds.has(entry.id);
    const ordered = sortGroups(
      filterGroups(decorated, filter, trimmed, isFavorite),
      sort,
      isFavorite,
      locale,
    );

    type Entry = (typeof decorated)[number];
    type ListRow = { kind: 'group'; item: Entry } | { kind: 'header'; label: string };
    const out: ListRow[] = [];
    // The favorites sit in front of the money-first split, so the "Settled"
    // label belongs to the unfavorited rest — and only when that rest holds a
    // mix, since a block that is all settled (or all active) needs no label.
    const rest = ordered.filter((entry) => !isFavorite(entry));
    const firstSettled = rest.findIndex((entry) => !entry.needsAction);
    const settledLabelAt = sort === 'amount' && firstSettled > 0 ? rest[firstSettled]!.id : null;
    for (const item of ordered) {
      if (item.id === settledLabelAt) out.push({ kind: 'header', label: t.settledHeader });
      out.push({ kind: 'group', item });
    }
    return out;
  }, [list, summary, profile?.id, trimmed, filter, sort, locale, pinnedIds, t.settledHeader]);

  // What a rendered row reads from outside its own data: the locale (money and
  // member-count formatting) and the theme (its colours). Both hold identity
  // between renders and move only when they truly change, so this memo is a
  // stable extraData that re-renders rows on a language or light/dark switch
  // without the per-render churn an inline array would cause.
  const listExtraData = useMemo(() => ({ locale, theme }), [locale, theme]);

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
          filter={filter}
          onFilter={setFilter}
          sortActive={sort !== 'amount'}
          onOpenSort={() => setSortOpen(true)}
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
            data={rows}
            keyExtractor={(row) => (row.kind === 'header' ? 'settled-header' : row.item.id)}
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
              paddingHorizontal: theme.spacing.lg,
              paddingTop: theme.spacing.xs,
              paddingBottom: clearance,
            }}
            // With the search keyboard open, a tap on a result row should open
            // it in one go, not be eaten by the keyboard dismiss (FlashList
            // defaults this to "never").
            keyboardShouldPersistTaps="handled"
            renderItem={({ item: row }) => {
              if (row.kind === 'header') return <SectionLabel label={row.label} />;

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

              const pinned = pinnedIds.has(group.id);
              return (
                <GroupListRow
                  groupId={group.id}
                  label={row.item.label}
                  coverEmoji={group.cover_emoji}
                  balance={balance}
                  currency={group.default_currency}
                  locale={locale}
                  subtitle={subtitle}
                  spoken={spoken}
                  direction={direction}
                  // Settled groups are present, not urgent: dimmed so the eye
                  // lands on the rows that still need something.
                  dim={!row.item.needsAction}
                  pinned={pinned}
                  pinLabel={`${pinned ? t.group.unpin : t.group.pin} ${row.item.label}`}
                  onTogglePin={() => setGroupPin.mutate({ groupId: group.id, pinned: !pinned })}
                  isDemo={group.isDemo === true}
                />
              );
            }}
          />
        )}
      </View>

      <Sheet
        visible={sortOpen}
        onClose={() => setSortOpen(false)}
        title={t.misc.sortGroupsTitle}
        closeLabel={t.common.close}
      >
        <View style={{ paddingBottom: theme.spacing.md }}>
          {(
            [
              ['amount', t.misc.sortAmount, 'cash-outline'],
              ['recent', t.misc.sortRecent, 'time-outline'],
              ['name', t.misc.sortName, 'text-outline'],
            ] as const
          ).map(([key, label, icon]) => (
            <Pressable
              key={key}
              accessibilityRole="radio"
              accessibilityState={{ selected: sort === key }}
              onPress={() => {
                setSort(key);
                setSortOpen(false);
              }}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
              <Row
                style={{
                  alignItems: 'center',
                  gap: theme.spacing.md,
                  paddingVertical: theme.spacing.md,
                }}
              >
                <Ionicons name={icon} size={iconSize.lg} color={theme.color.textMuted} />
                <Text variant="body" style={{ flex: 1 }}>
                  {label}
                </Text>
                {sort === key ? (
                  <Ionicons name="checkmark" size={iconSize.lg} color={theme.color.brand} />
                ) : null}
              </Row>
            </Pressable>
          ))}
        </View>
      </Sheet>
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
          paddingTop: insetsTop + theme.spacing.xs,
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: SCENE_ROOM,
        }}
      >
        <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
          <TranslucentBackButton dark={darkInk} label={backLabel} onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text variant="subheading" numberOfLines={1} style={{ color: ink }}>
              {title}
            </Text>
            <Text
              variant="micro"
              numberOfLines={1}
              style={{ color: ink, opacity: darkInk ? 0.7 : 0.85 }}
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
      <View style={{ marginTop: -SCENE_OVERLAP, paddingHorizontal: theme.spacing.lg }}>
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

/** A solid white disc — the header's own action button, glyph in brand. */
const whiteDisc = {
  width: HEADER_BUTTON,
  height: HEADER_BUTTON,
  borderRadius: HEADER_BUTTON / 2,
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: '#FFFFFF',
} as const;

/**
 * The filter chips and, at the far end, the round sort button. The chips scroll
 * if a long translation overflows; the button is pinned outside the scroll so it
 * is always in reach. A chip rests as a soft tint of its colour and fills solid
 * when chosen; "All" is the brand pill.
 */
function FilterBar({
  filter,
  onFilter,
  sortActive,
  onOpenSort,
}: {
  filter: GroupsFilter;
  onFilter: (next: GroupsFilter) => void;
  sortActive: boolean;
  onOpenSort: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const { t } = useStrings();
  const chips: readonly {
    key: GroupsFilter;
    label: string;
    icon: React.ComponentProps<typeof Ionicons>['name'];
    ink: string;
    soft: string;
  }[] = [
    {
      key: 'all',
      label: t.filterAll,
      icon: 'people',
      ink: theme.color.brand,
      soft: theme.color.surfaceMuted,
    },
    {
      key: 'owed',
      label: t.misc.filterOwed,
      icon: 'arrow-down-circle',
      ink: theme.color.positive,
      soft: theme.color.positiveSoft,
    },
    {
      key: 'owe',
      label: t.misc.filterOwe,
      icon: 'arrow-up-circle',
      ink: theme.color.negative,
      soft: theme.color.negativeSoft,
    },
    {
      key: 'favorites',
      label: t.misc.filterFavorites,
      icon: 'star',
      ink: theme.color.warning,
      soft: theme.color.warningSoft,
    },
  ];

  return (
    <Row
      style={{
        alignItems: 'center',
        gap: theme.spacing.sm,
        paddingHorizontal: theme.spacing.lg,
        paddingVertical: theme.spacing.sm,
      }}
    >
      <Row style={{ flex: 1, gap: theme.spacing.xs }}>
        {chips.map((chip) => {
          const selected = filter === chip.key;
          const color = selected ? '#FFFFFF' : chip.ink;
          return (
            <Pressable
              key={chip.key}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => onFilter(chip.key)}
              style={({ pressed }) => ({
                // Shrinks before it clips, so four chips fit a narrow phone; the
                // label gives way to an ellipsis, not the icon.
                flexShrink: 1,
                height: CHIP_HEIGHT,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                paddingHorizontal: theme.spacing.sm,
                borderRadius: CHIP_HEIGHT / 2,
                backgroundColor: selected ? chip.ink : chip.soft,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Ionicons name={chip.icon} size={iconSize.sm} color={color} />
              <Text
                variant="caption"
                numberOfLines={1}
                style={{ color, fontWeight: '600', flexShrink: 1 }}
              >
                {chip.label}
              </Text>
            </Pressable>
          );
        })}
      </Row>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t.misc.sortGroupsTitle}
        onPress={onOpenSort}
        style={({ pressed }) => ({
          width: CHIP_HEIGHT,
          height: CHIP_HEIGHT,
          borderRadius: CHIP_HEIGHT / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: sortActive ? theme.color.brand : theme.color.surface,
          borderWidth: 1,
          borderColor: sortActive ? theme.color.brand : theme.color.border,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Ionicons
          name="options-outline"
          size={iconSize.md}
          color={sortActive ? theme.color.onBrand : theme.color.textMuted}
        />
      </Pressable>
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
 * star to favorite and a chevron.
 *
 * The amount keeps `MoneyText`'s `balance` mode, which is where owe-versus-owed
 * lives: colour *and* sign together, with the minor units drawn fainter. A
 * settled group has nothing to colour, so it drops the zero amount and says so
 * in words instead, dimmed — which quietens it without telling the reader the
 * wrong direction.
 *
 * The star is the same pin the dashboard and the group's own menu set (a
 * favorite sorts to the top), so there is one concept, not two. Long-press stays
 * as the quick path to it.
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
  balance,
  currency,
  locale,
  subtitle,
  spoken,
  direction,
  dim,
  pinned = false,
  pinLabel,
  onTogglePin,
  isDemo = false,
}: {
  groupId: string;
  label: string;
  coverEmoji: string | null;
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
  /** A favorite: sorted to the top, star filled, announced in the row's label. */
  pinned?: boolean;
  /** The one client-side demo group (`@/demo`) — wears a small "Demo" pill
      beside its name, same word the dashboard's own row and Friends use. */
  isDemo?: boolean;
  /** "Pin Goa trip" / "Unpin Goa trip" — what a screen reader announces for the
      star and the long-press action. */
  pinLabel?: string;
  onTogglePin?: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const { t } = useStrings();

  return (
    <View style={{ paddingBottom: theme.spacing.sm }}>
      <Pressable
        accessibilityRole="button"
        // The full subtitle, not just the status word: a pending group at a zero
        // balance would otherwise be read out as "All settled", hiding the very
        // state that needs attention. Favorite is spoken too — a screen reader
        // never sees the star the row draws below.
        accessibilityLabel={
          pinned ? `${label}. ${t.group.pinnedBadge}. ${spoken}` : `${label}. ${spoken}`
        }
        onPress={() => router.push(`/group/${groupId}`)}
        onLongPress={onTogglePin}
        accessibilityActions={
          onTogglePin && pinLabel ? [{ name: 'togglePin', label: pinLabel }] : undefined
        }
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'togglePin') onTogglePin?.();
        }}
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
            minHeight: 64,
            paddingVertical: theme.spacing.sm,
            paddingStart: theme.spacing.md,
            paddingEnd: theme.spacing.sm,
            opacity: dim ? 0.7 : 1,
          }}
        >
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: theme.color.surfaceMuted,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <GroupMark emoji={coverEmoji} size={20} />
          </View>
          <View style={{ flex: 1, gap: 1 }}>
            <Row style={{ alignItems: 'center', gap: theme.spacing.xs }}>
              <Text
                variant="body"
                numberOfLines={1}
                style={{ flexShrink: 1, fontSize: 15, fontWeight: '700' }}
              >
                {label}
              </Text>
              {isDemo ? (
                <View
                  style={{
                    paddingHorizontal: 6,
                    paddingVertical: 1,
                    borderRadius: 6,
                    backgroundColor: theme.color.surfaceMuted,
                  }}
                >
                  <Text variant="micro" tone="muted" style={{ fontWeight: '700' }}>
                    {t.demo.badge}
                  </Text>
                </View>
              ) : null}
            </Row>
            <Text variant="micro" tone="muted" numberOfLines={1}>
              {subtitle}
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
          <Ionicons
            name="chevron-forward"
            size={iconSize.sm}
            color={theme.color.textMuted}
            style={{ width: 14 }}
          />
        </Row>
        {onTogglePin ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={pinLabel}
            accessibilityState={{ selected: pinned }}
            onPress={onTogglePin}
            hitSlop={8}
            style={{ position: 'absolute', top: 6, end: 6 }}
          >
            <Ionicons
              name={pinned ? 'star' : 'star-outline'}
              size={14}
              color={pinned ? theme.color.warning : theme.color.textMuted}
            />
          </Pressable>
        ) : null}
      </Pressable>
    </View>
  );
});
