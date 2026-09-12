import { memo, useMemo, useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, TextInput, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Button,
  directionalIcon,
  EmptyState,
  Gradient,
  IconButton,
  iconSize,
  MoneyText,
  Row,
  Screen,
  Text,
  useTabBarClearance,
  useTheme,
} from '@waves/ui';

import { useGroups, useHomeSummary, usePinnedGroupIds, useSetGroupPin } from '@/data/hooks';
import { groupLabel } from '@/data/types';
import { plural, useStrings, type UiStrings } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { PressableScale } from '@/lib/anim';
import { orderByPin } from '@/lib/groupPinOrder';
import { GroupMark } from '@/components/GroupMark';
import { SkeletonList } from '@/components/Skeletons';
import { router } from '@/lib/navigation';

/**
 * Below this many groups a search field is ceremony — the list is short enough
 * to take in at a glance, and a box asking "which one?" over four rows reads as
 * clutter, not help.
 */
const SEARCH_THRESHOLD = 6;

/**
 * The All-groups wash — the *same* two diagonal stops the dashboard's net-balance
 * slide rides, not a fourth hue invented for this screen.
 *
 * Friends deliberately earns its own indigo, because it is a destination you can
 * land on cold and the colour is how you know which tab you are on. This screen
 * is not a destination of its own: it is the dashboard's capped group list opened
 * in full, reached only by tapping "All groups ›" on a green hero. Carrying that
 * same green through the push makes the door and the room behind it read as one
 * place, and tells the reader they are still looking at their groups rather than
 * at somewhere new.
 */
const GROUPS_GRADIENT = ['#1F6B49', '#0C3A27'] as const;

const absBig = (n: bigint): bigint => (n < 0n ? -n : n);

/** The quieter white on the wash — placeholder and field furniture, dimmed
    enough to sit behind the typed text but still well clear of the green. */
const HERO_INK_FAINT = 'rgba(255,255,255,0.72)';

/**
 * The full, browsable list of every group — the "All groups" door off the
 * dashboard's capped preview.
 *
 * It used to be a flat directory: every row equal, newest-first, no way in but
 * to read the whole thing. A money screen has a sharper job than a directory —
 * it should answer "where do I need to act?" before it answers "what do I
 * have?". So the groups that owe or are owed (or are waiting on a confirmation)
 * sort to the top, biggest balances first; the settled ones fall below a quiet
 * "Settled" divider, dimmed, present but not competing. A search field appears
 * once the roster is long enough to need one, and the door to a new group sits
 * where a new-thing button belongs — top-right, and again inside the empty
 * state, so the first-time reader is never staring at "No groups yet" with no
 * way forward.
 *
 * What it looked like was the part that had not kept up. The sorting was right
 * and the screen still read as a system dialog: a plain back-chevron bar over
 * bare rows on the page colour, hairlines running edge to edge, nothing that
 * said which app this was. Every other list in Waves had by then settled on one
 * shape — a saturated hero panel bled up under the status bar carrying the title
 * and the screen's controls, and the rows beneath it on a single bordered,
 * hairline-divided card (the dashboard's group list, then Friends). This screen
 * now wears that shape too: same hero geometry, same card, same 44dp mark and
 * the same row rhythm the dashboard's `GroupRow` and Friends' `PersonRow` use,
 * so the full roster looks like the preview it was opened from.
 *
 * Nothing about *what* it shows moved — the same rows, the same order, the same
 * destinations, the same words. The hero deliberately carries no headline figure
 * the way the dashboard's and Friends' do: a total across groups would be new
 * information on a screen that was only meant to be repainted, and there is no
 * honest single number across currencies anyway (ADR-003). The search field
 * rides the wash instead, which is the one control this screen genuinely has.
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
  const searchRef = useRef<TextInput>(null);
  // The search field only appears once the roster is long enough to need one.
  // If it later shrinks back under that line the field vanishes — so the query
  // has to stop filtering along with it, or the list could sit empty behind a
  // stale query with no visible control left to clear it.
  const showSearch = list.length >= SEARCH_THRESHOLD;
  const trimmed = showSearch ? query.trim().toLowerCase() : '';

  // Decorate every group with the three facts a row shows — balance, whether a
  // settlement is pending, the member count — then split into the ones needing
  // action and the ones settled, each sorted, and thread a "Settled" divider
  // between them. Rebuilt as one memo so a fast scroll isn't recomputing per
  // frame.
  const rows = useMemo(() => {
    const decorated = list.map((group) => {
      const members = summary.membersFor(group.id);
      const balance = summary.balanceFor(group.id);
      const pending = summary.hasPending(group.id);
      return {
        group,
        label: groupLabel(group, members, profile?.id),
        balance,
        pending,
        count: summary.memberCountFor(group.id),
        needsAction: pending || balance !== 0n,
      };
    });

    const filtered = trimmed
      ? decorated.filter((d) => d.label.toLowerCase().includes(trimmed))
      : decorated;

    // Biggest balances first among the ones needing action; a pending-but-zero
    // group still belongs in the action block, just after the real debts.
    const active = filtered
      .filter((d) => d.needsAction)
      .sort((a, b) => {
        const x = absBig(a.balance);
        const y = absBig(b.balance);
        return x === y ? 0 : y > x ? 1 : -1;
      });
    const settled = filtered.filter((d) => !d.needsAction);

    // Pinning sits in front of all of the above, not inside it: a pinned group
    // that is fully settled still belongs at the very top, which is the one
    // thing money-first sorting can never do for it (see `group_pins`'s
    // migration header). `orderByPin` is a stable partition — it moves the
    // pinned entries to the front in the order they already had (active first,
    // by balance, then settled) and leaves everyone else in exactly the order
    // this screen would have given them anyway.
    const flat = [...active, ...settled];
    const ordered = orderByPin(flat, (entry) => pinnedIds.has(entry.group.id));
    const pinnedCount = ordered.filter((entry) => pinnedIds.has(entry.group.id)).length;
    const rest = ordered.slice(pinnedCount);
    // Stable partitioning a list that was already active-then-settled keeps
    // that property inside `rest` too, so its own needsAction values are still
    // every `true` before every `false` — this just finds where they flip.
    const restActiveCount = rest.findIndex((entry) => !entry.needsAction);
    const restSettledCount = restActiveCount === -1 ? 0 : rest.length - restActiveCount;

    type Entry = (typeof decorated)[number];
    type Row = { kind: 'group'; item: Entry } | { kind: 'header'; label: string };
    const out: Row[] = ordered
      .slice(0, pinnedCount)
      .map((item) => ({ kind: 'group', item }) as Row);
    for (let i = 0; i < rest.length; i += 1) {
      // Only announce "Settled" when there's a mix left in the unpinned rest —
      // a rest that is all settled (or all active) doesn't need a header
      // telling it so, the same rule the unpinned screen always followed.
      if (i === restActiveCount && restActiveCount > 0 && restSettledCount > 0) {
        out.push({ kind: 'header', label: t.settledHeader });
      }
      out.push({ kind: 'group', item: rest[i]! });
    }

    return out;
  }, [list, summary, profile?.id, trimmed, pinnedIds, t.settledHeader]);

  // What a rendered row reads from outside its own data: the locale (money and
  // member-count formatting) and the theme (its colours). Both hold identity
  // between renders and move only when they truly change, so this memo is a
  // stable extraData that re-renders rows on a language or light/dark switch
  // without the per-render churn an inline array would cause.
  const listExtraData = useMemo(() => ({ locale, theme }), [locale, theme]);

  const empty = loading ? (
    <SkeletonList rows={5} />
  ) : trimmed ? (
    // A search that matched nothing — the reason the list is empty is the query,
    // so the mark and words say "nothing matched", not "you have no groups".
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
      action={<Button label={t.newGroup} onPress={() => router.push('/new-group')} />}
    />
  );

  return (
    // No safe-area edge of its own: the hero paints its own top inset so the
    // colour runs up behind the status bar instead of stopping at a white strip.
    <Screen edges={[]}>
      {/* Fixed above the scroll, like the dashboard's and Friends' heroes — only
          the roster below it moves. */}
      <GroupsHero
        t={t}
        showSearch={showSearch}
        query={query}
        onQuery={setQuery}
        searchRef={searchRef}
      />

      <View
        style={{
          flex: 1,
          paddingHorizontal: theme.spacing.lg,
          paddingTop: theme.spacing.lg,
        }}
      >
        {loading || rows.length === 0 ? (
          // Centred in what can be *seen*, not in what is laid out: the box runs
          // on under the tab bar, so without its clearance the artwork settles
          // below the middle of the visible screen. The skeleton sits at the top
          // instead — it is standing in for rows, and rows start at the top.
          <View
            style={{
              flex: 1,
              justifyContent: loading ? 'flex-start' : 'center',
              paddingBottom: clearance,
            }}
          >
            {empty}
          </View>
        ) : (
          // The roster as one clean list on a single card — the same surface,
          // border, radius and clipped corners the dashboard's groups card and
          // the Friends list use. Each row draws its own hairline, so the card
          // reads as one divided list rather than a stack of loose rows.
          <View
            style={{
              flex: 1,
              backgroundColor: theme.color.surface,
              borderRadius: theme.radius.lg,
              borderWidth: 1,
              borderColor: theme.color.border,
              overflow: 'hidden',
            }}
          >
            <FlashList
              data={rows}
              keyExtractor={(row) => (row.kind === 'header' ? 'settled-header' : row.item.group.id)}
              getItemType={(row) => row.kind}
              // The group-ledger settings: render well ahead of the viewport so a
              // fast fling doesn't flash blank rows. The row items already carry
              // their own balance/pending/count (baked in the memo above), so a
              // money change flows through `data`; the outside a row reads —
              // locale and theme — rides the memoised `listExtraData`, which
              // changes identity only on a real language or light/dark switch,
              // not every render.
              drawDistance={1500}
              extraData={listExtraData}
              contentContainerStyle={{ paddingBottom: clearance }}
              showsVerticalScrollIndicator={false}
              // With the search keyboard open, a tap on a result row should open
              // it in one go, not be eaten by the keyboard dismiss (FlashList
              // defaults this to "never").
              keyboardShouldPersistTaps="handled"
              renderItem={({ item: row, index }) => {
                if (row.kind === 'header') {
                  return <SectionBand label={row.label} divider={index > 0} />;
                }

                const { group, balance, pending, count } = row.item;
                const statusLabel =
                  balance === 0n ? t.allSettled : balance > 0n ? t.youAreOwed : t.youOwe;
                // Status first, member count second: the reader's question is "do
                // I owe or am I owed?", not "how many people". Pending keeps its
                // context rather than replacing it — it used to swallow the member
                // count whole.
                const subtitle = pending
                  ? `${t.pendingConfirmation} · ${plural(locale, count, t.memberCount)}`
                  : `${statusLabel} · ${plural(locale, count, t.memberCount)}`;

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
                    // Settled groups are present, not urgent: dimmed so the eye
                    // lands on the rows that still need something.
                    dim={!row.item.needsAction}
                    // A hairline above every row except the first, and except the
                    // one that follows the "Settled" band — the band already draws
                    // its own edges, and a second line under it reads as a stray
                    // double rule.
                    divider={index > 0 && rows[index - 1]?.kind === 'group'}
                    pinned={pinned}
                    pinLabel={`${pinned ? t.group.unpin : t.group.pin} ${row.item.label}`}
                    onTogglePin={() => setGroupPin.mutate({ groupId: group.id, pinned: !pinned })}
                  />
                );
              }}
            />
          </View>
        )}
      </View>
    </Screen>
  );
}

/**
 * The All-groups hero — the dashboard's account panel, carrying the top of the
 * screen: the way back, the title, the door to a new group, and (once the roster
 * is long enough to need it) the search field. One green wash bled edge to edge
 * and up under the status bar, its bottom corners rounded, the white body sliding
 * in beneath.
 *
 * Unlike the dashboard's and Friends' heroes it shows no figure. That is
 * deliberate: this screen was only ever meant to be repainted, and a total across
 * every group would be a number nobody had asked it to compute — and could not
 * compute honestly across currencies anyway (ADR-003). The search field takes the
 * space a balance would have had, which is the right trade for the one screen in
 * the app whose job is finding a group rather than reading one.
 */
function GroupsHero({
  t,
  showSearch,
  query,
  onQuery,
  searchRef,
}: {
  t: UiStrings;
  /** The roster is long enough that the search field is earning its space. */
  showSearch: boolean;
  query: string;
  onQuery: (next: string) => void;
  searchRef: React.RefObject<TextInput | null>;
}): React.JSX.Element {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        paddingTop: insets.top + theme.spacing.md,
        paddingHorizontal: theme.spacing.xl,
        // A hero with a search field under its title already has two rows of
        // height; one with only a title needs the extra breath, or the panel
        // collapses to something that reads as a toolbar rather than a header.
        paddingBottom: showSearch ? theme.spacing.lg : theme.spacing.xxl,
        borderBottomLeftRadius: theme.radius.xxl,
        borderBottomRightRadius: theme.radius.xxl,
        gap: theme.spacing.lg,
        overflow: 'hidden',
      }}
    >
      {/* The wash, clipped to the hero's rounded corner. Flat-falls to its first
          stop if the native gradient is unavailable — still white on green. */}
      <Gradient
        colors={GROUPS_GRADIENT}
        radius={0}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />
      <HeroArt />

      <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
        {/* Mirrored with the writing direction: in Arabic the way back is to the
            right, and a hard-coded chevron would point at the wrong edge. */}
        <IconButton label={t.common.back} onPress={() => router.back()}>
          <Ionicons
            name={directionalIcon('chevron-back')}
            size={iconSize.xxl}
            color={theme.color.onBrand}
          />
        </IconButton>
        <Text variant="title" tone="onBrand" style={{ flex: 1 }} numberOfLines={1}>
          {t.groupsTitle}
        </Text>
        {/* The new-group door, where a new-thing button belongs. A solid white
            disc with the hero's green glyph — a real button, the same one Friends
            puts in its hero — rather than a bare icon that disappears into the
            wash. It repeats in the empty state below, so it is reachable whether
            or not any group exists yet. */}
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t.newGroup}
          onPress={() => router.push('/new-group')}
          hitSlop={10}
          style={{
            width: 38,
            height: 38,
            borderRadius: 19,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.color.onBrand,
          }}
        >
          <Ionicons name="add" size={iconSize.xl} color={GROUPS_GRADIENT[0]} />
        </PressableScale>
      </Row>

      {showSearch ? (
        // The field rides the colour rather than sitting on the page below it: a
        // translucent white pill, the hero's own control. A grey field on white
        // would have pushed the roster down a whole row and left the panel a bare
        // title bar.
        <Pressable
          onPress={() => searchRef.current?.focus()}
          accessible={false}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.sm,
            height: 44,
            paddingHorizontal: theme.spacing.lg,
            borderRadius: theme.radius.pill,
            backgroundColor: 'rgba(255,255,255,0.16)',
          }}
        >
          <Ionicons name="search" size={iconSize.md} color={HERO_INK_FAINT} />
          <TextInput
            ref={searchRef}
            value={query}
            onChangeText={onQuery}
            autoCapitalize="none"
            accessibilityRole="search"
            accessibilityLabel={t.searchGroups}
            placeholder={t.searchGroups}
            placeholderTextColor={HERO_INK_FAINT}
            // A white caret too — the platform default is the accent colour, and
            // a dark caret on the wash is invisible while you type.
            selectionColor={theme.color.onBrand}
            style={{ flex: 1, fontSize: 16, color: theme.color.onBrand, paddingVertical: 0 }}
          />
          {query ? (
            <Pressable
              onPress={() => onQuery('')}
              accessibilityRole="button"
              accessibilityLabel={t.pickers.clearSearch}
              hitSlop={8}
            >
              <Ionicons name="close-circle" size={iconSize.md} color={HERO_INK_FAINT} />
            </Pressable>
          ) : null}
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * The hero's artwork — depth without an illustration pipeline. A big faint stack
 * of cards bled off the bottom-right corner (a roster of groups, one behind the
 * next) and a couple of translucent rings over the wash, so the panel reads as a
 * designed surface rather than a flat rectangle of colour. All white at low
 * alpha, so it sits the same on the green in either theme; `pointerEvents none`
 * so it never intercepts a tap.
 */
function HeroArt(): React.JSX.Element {
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
      <View style={{ position: 'absolute', right: -26, bottom: -44 }}>
        <Ionicons name="albums" size={170} color="rgba(255,255,255,0.09)" />
      </View>
      <View style={{ position: 'absolute', right: 62, top: -14 }}>
        <Ionicons name="people" size={26} color="rgba(255,255,255,0.12)" />
      </View>
    </View>
  );
}

/**
 * The "Settled" band between the two halves of the list.
 *
 * A bare caption floating on the card read as a row with its text missing. Given
 * the muted fill and its own hairlines it reads as what it is — the seam where
 * the groups that still want something end and the quiet ones begin — the way a
 * grouped settings list marks a section.
 */
function SectionBand({ label, divider }: { label: string; divider: boolean }): React.JSX.Element {
  const theme = useTheme();
  return (
    <View
      style={{
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.xs,
        backgroundColor: theme.color.surfaceMuted,
        borderTopWidth: divider ? 1 : 0,
        borderBottomWidth: 1,
        borderColor: theme.color.border,
      }}
    >
      {/* Upper-cased for the small-caps look a section label wants. A no-op in
          Tamil, Hindi and Arabic, which have no case — so the band is the same
          shape in every language rather than shouting in one. */}
      <Text variant="micro" tone="muted" style={{ letterSpacing: 1 }}>
        {label.toUpperCase()}
      </Text>
    </View>
  );
}

/**
 * One group as a clean list row — the group's mark in a 44dp disc, the name over
 * its standing and member count, the balance to the right coloured and signed by
 * who owes whom. Deliberately the dashboard's `GroupRow` and Friends' `PersonRow`
 * geometry, down to the disc size and the paddings, so the full roster and the
 * preview it was opened from are recognisably the same list.
 *
 * The amount keeps `MoneyText`'s `balance` mode, which is where owe-versus-owed
 * lives: colour *and* sign together. Flattening those into one neutral figure is
 * a mistake this app has already made and reverted once — a settled row is dimmed
 * instead, which quietens it without telling the reader the wrong direction.
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
  dim,
  divider,
  pinned = false,
  pinLabel,
  onTogglePin,
}: {
  groupId: string;
  label: string;
  coverEmoji: string | null;
  balance: bigint;
  currency: string;
  locale: string;
  subtitle: string;
  /** Nothing owed and nothing pending — present, but not competing for the eye. */
  dim: boolean;
  /** A hairline above the row, so the card reads as one divided list. */
  divider: boolean;
  /** Sorted to the top by `orderByPin`; carries the small pin glyph and is
      announced in the row's accessibility label. */
  pinned?: boolean;
  /** "Pin Goa trip" / "Unpin Goa trip" — required whenever `onTogglePin` is
      passed; what a screen reader announces for the toggle below. */
  pinLabel?: string;
  /** Long-press: the fast path to pin/unpin. Mirrors the dashboard's
      `GroupRow` — same gesture, same accessibility action, same discoverable
      alternative (the ••• menu on the group's own screen). */
  onTogglePin?: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const { t } = useStrings();

  return (
    <Pressable
      accessibilityRole="button"
      // The full subtitle, not just the status word: a pending group at a zero
      // balance would otherwise be read out as "All settled", hiding the very
      // state that needs attention. Pinned is spoken too — a screen reader
      // never sees the glyph the row draws below.
      accessibilityLabel={
        pinned ? `${label}. ${t.group.pinnedBadge}. ${subtitle}` : `${label}. ${subtitle}`
      }
      onPress={() => router.push(`/group/${groupId}`)}
      onLongPress={onTogglePin}
      accessibilityActions={
        onTogglePin && pinLabel ? [{ name: 'togglePin', label: pinLabel }] : undefined
      }
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'togglePin') onTogglePin?.();
      }}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      <Row
        style={{
          gap: theme.spacing.md,
          alignItems: 'center',
          paddingVertical: theme.spacing.sm,
          paddingHorizontal: theme.spacing.sm,
          borderTopWidth: divider ? 1 : 0,
          borderTopColor: theme.color.border,
          opacity: dim ? 0.6 : 1,
        }}
      >
        {/* The dashboard's group disc — 44dp, round, muted, the group's own mark
            at its centre. It was a 40dp rounded square borrowed from the activity
            feed, which is the one place in the app groups are *not* drawn that
            way. */}
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: theme.color.surfaceMuted,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <GroupMark emoji={coverEmoji} size={22} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          {/* Two lines, not one: this is the screen you come to when you cannot
              find a group, so a long name is worth a second line here even though
              the dashboard's preview clips it at one. */}
          <Row style={{ alignItems: 'center', gap: theme.spacing.xs }}>
            {pinned ? <Ionicons name="pin" size={12} color={theme.color.textMuted} /> : null}
            <Text variant="body" numberOfLines={2} style={{ flexShrink: 1, fontWeight: '600' }}>
              {label}
            </Text>
          </Row>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
        <MoneyText
          amount={balance}
          currency={currency as never}
          locale={locale}
          mode="balance"
          variant="subheading"
        />
      </Row>
    </Pressable>
  );
});
