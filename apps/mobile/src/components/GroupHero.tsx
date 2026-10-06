import { useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  I18nManager,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Avatar,
  Badge,
  directionalIcon,
  iconSize,
  MoneyText,
  Row,
  Text,
  useTheme,
} from '@waves/ui';

import { useConfirmSettlement, useDisputeSettlement, useSettlementProof } from '@/data/hooks';
import {
  displayName,
  groupLabel,
  isBlockedMember,
  isGhost,
  type GroupRow,
  type MemberRow,
  type SettlementRow,
} from '@/data/types';
import { fill, plural, useStrings } from '@/i18n';
import { GroupPhoto } from '@/components/GroupPhoto';
import { GroupTypeTag, useGroupTypeTag } from '@/components/GroupTypeTag';
import { HeroPillButton } from '@/components/ScreenHero';
import { HeroScene } from '@/components/home/HeroScene';
import { ProfileAvatar } from '@/components/ProfileAvatar';
import { useHeroScene } from '@/lib/heroScenePreference';
import { HERO_THEMES } from '@/lib/scene';
import { useBlockedUsers } from '@/data/blocked';
import { SyncStatusIcon } from '@/components/SyncBanner';
import { router, useGoBack } from '@/lib/navigation';
import { formatShortDateRange } from '@/lib/tripDateRange';
import { useDialog } from '@/lib/dialog';

/**
 * Which hero slide a paging scroll has landed on, correct in both directions.
 * Android reports a horizontal ScrollView's offset from the physical left even
 * under RTL (logical first slide at the far right); iOS handles RTL natively.
 * Only the Android-RTL case is flipped, so the dot pager tracks the same slide
 * the reader sees.
 */
function heroPageOf(event: {
  contentOffset: { x: number };
  layoutMeasurement: { width: number };
  contentSize: { width: number };
}): number {
  const width = event.layoutMeasurement.width;
  if (width <= 0) return 0;
  const flip = Platform.OS === 'android' && I18nManager.isRTL;
  const maxOffset = Math.max(0, event.contentSize.width - width);
  const fromStart = flip ? maxOffset - event.contentOffset.x : event.contentOffset.x;
  return Math.max(0, Math.round(fromStart / width));
}

/**
 * Whole days left before a pending settlement auto-confirms — the 7-day window
 * the server's `waves_auto_confirm_settlements` job enforces, from when the
 * payer recorded it. Never below one; a claim past the window is auto-confirmed
 * by the cron and has already left the pending list.
 */
const AUTO_CONFIRM_DAYS = 7;
function daysToConfirm(initiatedIso: string, now: number = Date.now()): number {
  const parsed = Date.parse(initiatedIso);
  if (!Number.isFinite(parsed)) return AUTO_CONFIRM_DAYS;
  const left = AUTO_CONFIRM_DAYS * 86_400_000 - (now - parsed);
  return Math.max(1, Math.ceil(left / 86_400_000));
}

/**
 * The group's fixed hero: the top controls, then a paging deck whose first slide
 * is the balance and its actions and whose second (only when something is
 * pending) is the incoming "they paid you" claim — one claim inline, or a
 * summary that opens the full review list for many. Rendered above the feed and
 * pinned, so the list scrolls under it rather than carrying it off the top.
 */
export function GroupHero({
  groupId,
  group,
  members,
  profileId,
  currency,
  myBalance,
  pending,
  pendingForMe,
  heroGradient,
  nameOf,
  onOpenMenu,
}: {
  groupId: string;
  group: GroupRow;
  members: readonly MemberRow[];
  profileId: string | null;
  currency: string;
  myBalance: bigint;
  pending: bigint;
  pendingForMe: readonly SettlementRow[];
  heroGradient: readonly string[];
  nameOf: (memberId: string | null) => string;
  onOpenMenu: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { t, locale } = useStrings();
  // Trips and events both carry a date range; show it beside the member count.
  const dateRange =
    group.type === 'trip' || group.type === 'event'
      ? formatShortDateRange(group.start_date, group.end_date, locale)
      : null;
  const typeTag = useGroupTypeTag(group.type, group.event_template, group.custom_tag);
  const { confirm } = useDialog();
  const goBack = useGoBack();
  const confirmSettlement = useConfirmSettlement(groupId);
  const disputeSettlement = useDisputeSettlement(groupId);

  const { width: windowW } = useWindowDimensions();
  const [heroSlideW, setHeroSlideW] = useState(0);
  // Until the deck measures itself, size each slide from the window: the hero
  // spans the screen, less its own side padding. Left undefined, a slide in a
  // horizontal ScrollView shrinks to its content for that first frame, so the
  // settle / who-pays-whom pair sat beside "Add expense" and then jumped right.
  const slideW = heroSlideW || windowW - theme.spacing.xl * 2;
  const [heroPage, setHeroPage] = useState(0);
  // The hero's measured height. The scene is sized from it in points: an
  // absolutely placed image sized by its edges lays out at zero on Android.
  const [heroHeight, setHeroHeight] = useState(0);
  const heroDeckRef = useRef<ScrollView>(null);

  const busy = confirmSettlement.isPending || disputeSettlement.isPending;

  // The one inline claim, if that is the case we are in — used to look up whether
  // the payer attached a proof, so the fast path can offer to show it before the
  // payee confirms rather than asking them to trust the amount blind. Called with
  // an empty id (a harmless null lookup) whenever there is not exactly one claim,
  // so the hook count never changes.
  const soleClaim = pendingForMe.length === 1 ? pendingForMe[0] : null;
  const soleProof = useSettlementProof(soleClaim?.id ?? '');

  const rejectPrompt = (settlement: SettlementRow): void => {
    void confirm({
      title: t.group.rejectTitle,
      body: fill(t.group.rejectBody, { name: nameOf(settlement.from_member_id) }),
      confirmLabel: t.group.rejectConfirm,
      cancelLabel: t.group.keep,
      tone: 'danger',
    }).then((ok) => {
      if (ok) disputeSettlement.mutate(settlement.id);
    });
  };

  const { blockedIds } = useBlockedUsers();
  const scene = useHeroScene();
  // A light scene (morning, winter) puts dark ink on the hero, like the Groups screen.
  const darkInk = HERO_THEMES[scene].ink === 'dark';
  const ink = darkInk ? theme.color.text : theme.color.onBrand;
  const pillInk = theme.color.brand;
  const shownMembers = members.slice(0, MAX_FACES);
  const extraMembers = Math.max(0, members.length - shownMembers.length);
  const startedOn =
    dateRange ??
    new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(
      new Date(group.created_at),
    );
  const typeTagNode = typeTag ? <GroupTypeTag tag={typeTag} onBrand={!darkInk} /> : null;

  return (
    <View
      style={{
        paddingTop: insets.top + theme.spacing.sm,
        paddingHorizontal: theme.spacing.lg,
        paddingBottom: theme.spacing.md,
        borderBottomLeftRadius: theme.radius.xxl,
        borderBottomRightRadius: theme.radius.xxl,
        gap: theme.spacing.sm,
        overflow: 'hidden',
        backgroundColor: HERO_THEMES[scene].sky[0],
      }}
    >
      {/* Measures the hero for the scene behind it; draws nothing. */}
      <View
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
        onLayout={(event) => setHeroHeight(Math.round(event.nativeEvent.layout.height))}
      />
      {/* The scene (`HeroScene`, the dashboard's dusk hills) fills the hero; it
          is drawn a little taller than the hero so its page-colour fade falls
          below the rounded foot, which clips it. */}
      {heroHeight > 0 ? (
        <View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ position: 'absolute', top: 0, left: 0, width: windowW, height: heroHeight }}
        >
          <HeroScene
            scene={scene}
            width={windowW}
            height={heroHeight + 30}
            horizon={heroHeight - 6}
            headerBottom={insets.top + TILE + theme.spacing.sm}
            pageColor={theme.color.bg}
            // The scene is seen whole here: no top shade, no haze band —
            // both read as a tinted box on a header this short.
            shade={false}
            haze={false}
          />
        </View>
      ) : null}
      <Row style={{ gap: theme.spacing.sm, alignItems: 'center' }}>
        <Pressable
          onPress={goBack}
          accessibilityRole="button"
          accessibilityLabel={t.common.back}
          hitSlop={10}
        >
          <Ionicons name={directionalIcon('chevron-back')} size={iconSize.xl} color={ink} />
        </Pressable>
        <Pressable
          onPress={() => router.push(`/group/${groupId}/settings`)}
          accessibilityRole="button"
          accessibilityLabel={t.group.settings}
          style={({ pressed }) => ({
            flex: 1,
            flexDirection: 'row',
            gap: theme.spacing.sm,
            justifyContent: 'flex-start',
            alignItems: 'center',
            opacity: pressed ? 0.6 : 1,
          })}
        >
          {/* The group's mark straight on a white tile, so it reads on any scene. */}
          <View
            style={{
              borderRadius: TILE / 3,
              shadowColor: '#1B1340',
              shadowOpacity: 0.15,
              shadowRadius: 6,
              shadowOffset: { width: 0, height: 2 },
              elevation: 3,
            }}
          >
            <GroupPhoto
              photoPath={group.photo_path}
              emoji={group.cover_emoji}
              size={TILE}
              background="#FFFFFF"
            />
          </View>
          <View style={{ flexShrink: 1, gap: 2 }}>
            <Text
              numberOfLines={1}
              style={{ color: ink, fontSize: 18, lineHeight: 22, fontWeight: '700' }}
            >
              {group.name?.trim()
                ? group.name.trim()
                : cleanLabel(groupLabel(group, members ?? [], profileId))}
            </Text>
            <Row style={{ alignItems: 'center', gap: theme.spacing.xs }}>
              {typeTagNode}
              <Text
                variant="micro"
                numberOfLines={1}
                style={{ color: ink, opacity: 0.9, flexShrink: 1, fontSize: 12 }}
              >
                {plural(locale, members?.length ?? 0, t.memberCount)}
                {` · ${startedOn}`}
              </Text>
            </Row>
          </View>
        </Pressable>
        <SyncStatusIcon onBrand={!darkInk} groupId={groupId} />
        {/* The group's activity, beside the menu. The dot says a payment claim is
            waiting on you. */}
        <Pressable
          onPress={() => router.push({ pathname: '/activity', params: { group: groupId } })}
          accessibilityRole="button"
          accessibilityLabel={t.activity}
          hitSlop={10}
        >
          <Ionicons name="notifications-outline" size={iconSize.xl} color={ink} />
          {pendingForMe.length > 0 ? (
            <View
              style={{
                position: 'absolute',
                top: -1,
                right: 0,
                width: 9,
                height: 9,
                borderRadius: 5,
                backgroundColor: theme.color.negative,
                borderWidth: 1.5,
                borderColor: darkInk ? theme.color.surface : '#3A2A78',
              }}
            />
          ) : null}
        </Pressable>
        <Pressable
          onPress={onOpenMenu}
          accessibilityRole="button"
          accessibilityLabel={t.group.more}
          hitSlop={10}
        >
          <Ionicons name="ellipsis-vertical" size={iconSize.xl} color={ink} />
        </Pressable>
      </Row>

      {/* The paging deck: balance and actions lead; a pending claim (one inline,
          or a summary of many) rides as the second slide. */}
      <View onLayout={(event) => setHeroSlideW(event.nativeEvent.layout.width)}>
        <ScrollView
          ref={heroDeckRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          scrollEnabled={pendingForMe.length > 0 && heroSlideW > 0}
          onMomentumScrollEnd={(event) => setHeroPage(heroPageOf(event.nativeEvent))}
          onContentSizeChange={() => {
            // Acting on a claim drops it from the deck; if the view was parked on
            // that now-gone slide it would show blank — snap back to the balance
            // slide. A content-size callback, not an effect, so it stays off the
            // hooks path. At most two slides, so the last valid page is 1 while
            // anything is pending, 0 otherwise.
            const maxPage = pendingForMe.length > 0 ? 1 : 0;
            if (heroPage > maxPage) {
              heroDeckRef.current?.scrollTo({ x: 0, animated: false });
              setHeroPage(0);
            }
          }}
        >
          {/* Slide 0 — the verdict and its figure, then who is in and the one action. */}
          <View style={{ width: slideW, gap: theme.spacing.sm }}>
            <View>
              <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
                <Text
                  numberOfLines={1}
                  style={{
                    color: ink,
                    fontSize: 14,
                    lineHeight: 18,
                    fontWeight: '600',
                    opacity: 0.9,
                    flexShrink: 1,
                  }}
                >
                  {myBalance === 0n ? t.allSettled : myBalance > 0n ? t.youAreOwed : t.youOwe}
                </Text>
                {pending !== 0n ? <Badge label={t.pendingConfirmation} tone="brand" /> : null}
              </Row>
              <MoneyText
                amount={myBalance}
                currency={currency}
                locale={locale}
                mode="balance"
                variant="title"
                tone="default"
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.6}
                style={{ color: ink, fontSize: 30, lineHeight: 36, fontWeight: '800' }}
              />
            </View>

            <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
              <Pressable
                onPress={() => router.push(`/group/${groupId}/members`)}
                accessibilityRole="button"
                accessibilityLabel={t.group.membersLabel}
                style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 1 }}
              >
                {shownMembers.map((member, index) => (
                  <View
                    key={member.id}
                    style={{
                      marginStart: index === 0 ? 0 : -6,
                      borderRadius: FACE / 2,
                      borderWidth: 1.5,
                      borderColor: 'rgba(255,255,255,0.9)',
                    }}
                  >
                    {isGhost(member) || isBlockedMember(member, blockedIds) ? (
                      <Avatar
                        name={displayName(member, null, blockedIds, t.misc.someone)}
                        ghost
                        size={FACE}
                      />
                    ) : (
                      // Their photo when they have one; initials otherwise.
                      <ProfileAvatar
                        name={displayName(member, null, blockedIds, t.misc.someone)}
                        avatarUrl={member.profile?.avatar_url ?? null}
                        size={FACE}
                      />
                    )}
                  </View>
                ))}
                {extraMembers > 0 ? (
                  <Text
                    variant="micro"
                    style={{ color: ink, marginStart: theme.spacing.xs, fontWeight: '700' }}
                  >
                    +{extraMembers}
                  </Text>
                ) : null}
              </Pressable>
              {/* The way to bring somebody in: the group's invite sheet. */}
              <Pressable
                onPress={() => router.push(`/group/${groupId}/invite`)}
                accessibilityRole="button"
                accessibilityLabel={t.people.inviteTitle}
                hitSlop={6}
                style={{
                  width: FACE,
                  height: FACE,
                  borderRadius: FACE / 2,
                  borderWidth: 1.5,
                  borderStyle: 'dashed',
                  borderColor: ink,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="add" size={iconSize.md} color={ink} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t.addExpense}
                onPress={() => router.push(`/group/${groupId}/add-expense`)}
                style={({ pressed }) => ({
                  marginStart: 'auto',
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.spacing.xs,
                  height: 36,
                  paddingHorizontal: theme.spacing.md,
                  borderRadius: theme.radius.pill,
                  backgroundColor: '#FFFFFF',
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                <Ionicons name="add" size={iconSize.lg} color={pillInk} />
                <Text variant="subheading" style={{ color: pillInk }} numberOfLines={1}>
                  {t.addExpense}
                </Text>
              </Pressable>
            </Row>
          </View>

          {/* Exactly one claim: the fast path, amount and the two answers inline. */}
          {pendingForMe.length === 1 &&
            pendingForMe.map((settlement) => (
              <View key={settlement.id} style={{ width: slideW, gap: theme.spacing.md }}>
                <Text variant="caption" tone="onBrand" style={{ opacity: 0.85 }} numberOfLines={1}>
                  {fill(t.group.saysTheyPaidYouWindow, {
                    name: nameOf(settlement.from_member_id),
                    window: plural(
                      locale,
                      daysToConfirm(settlement.initiated_at),
                      t.group.daysToConfirm,
                    ),
                  })}
                </Text>

                <MoneyText
                  amount={BigInt(settlement.amount)}
                  currency={settlement.currency}
                  locale={locale}
                  variant="title"
                  tone="default"
                  style={{ color: theme.color.onBrand }}
                />

                <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
                  <HeroPillButton
                    label={t.group.confirmReceived}
                    icon="checkmark"
                    gradient={heroGradient}
                    disabled={busy}
                    style={{ flex: 1 }}
                    onPress={() => confirmSettlement.mutate(settlement.id)}
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t.group.rejectSettlement}
                    disabled={busy}
                    onPress={() => rejectPrompt(settlement)}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      paddingVertical: theme.spacing.sm,
                      paddingHorizontal: theme.spacing.lg,
                      borderRadius: theme.radius.pill,
                      borderWidth: 1,
                      borderColor: 'rgba(255, 255, 255, 0.5)',
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <Text variant="subheading" tone="onBrand" numberOfLines={1}>
                      {t.group.rejectSettlement}
                    </Text>
                  </Pressable>
                </Row>

                {/* The payer's evidence is on the review screen; surface a way in
                    only when there is actually a proof to look at. */}
                {soleProof.data ? (
                  <Pressable
                    onPress={() => router.push(`/group/${groupId}/pending`)}
                    accessibilityRole="button"
                    accessibilityLabel={t.proof.view}
                    hitSlop={8}
                    style={({ pressed }) => ({
                      alignSelf: 'flex-start',
                      opacity: pressed ? 0.6 : 0.9,
                    })}
                  >
                    <Row style={{ alignItems: 'center', gap: theme.spacing.xs }}>
                      <Ionicons
                        name="image-outline"
                        size={iconSize.sm}
                        color={theme.color.onBrand}
                      />
                      <Text
                        variant="micro"
                        tone="onBrand"
                        style={{ textDecorationLine: 'underline' }}
                      >
                        {t.proof.view}
                      </Text>
                    </Row>
                  </Pressable>
                ) : null}
              </View>
            ))}

          {/* Two or more: a summary that opens the full review list. */}
          {pendingForMe.length >= 2 ? (
            <View style={{ width: slideW, gap: theme.spacing.md }}>
              <Text variant="caption" tone="onBrand" style={{ opacity: 0.85 }} numberOfLines={1}>
                {plural(locale, pendingForMe.length, t.group.peopleSaidPaid)}
              </Text>
              <MoneyText
                amount={pendingForMe.reduce(
                  (sum, settlement) => sum + BigInt(settlement.amount),
                  0n,
                )}
                currency={currency}
                locale={locale}
                variant="title"
                tone="default"
                style={{ color: theme.color.onBrand }}
              />
              <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
                <HeroPillButton
                  label={fill(t.group.reviewClaims, { count: pendingForMe.length })}
                  trailingIcon="chevron-forward"
                  gradient={heroGradient}
                  onPress={() => router.push(`/group/${groupId}/pending`)}
                />
              </Row>
            </View>
          ) : null}
        </ScrollView>

        {pendingForMe.length > 0 ? (
          <Row style={{ justifyContent: 'center', gap: 6, marginTop: theme.spacing.sm }}>
            {Array.from({ length: 2 }).map((_, index) => (
              <View
                key={index}
                style={{
                  width: heroPage === index ? 18 : 6,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: theme.color.onBrand,
                  opacity: heroPage === index ? 1 : 0.4,
                }}
              />
            ))}
          </Row>
        ) : null}
      </View>
    </View>
  );
}

/** The white tile the group's mark sits on. */
const TILE = 44;

/** The member faces under the balance, and how many are drawn before "+N". */
const FACE = 28;
const MAX_FACES = 4;

/** A name built from people's names reads without the punctuation an address
 *  book puts in front of one (".Rvs Anoop" → "Rvs Anoop"). Only for that
 *  fallback: a name the group was given (".NET Team") is shown as typed. */
function cleanLabel(label: string): string {
  return label.replace(/(^|,\s*)[^\p{L}\p{N}\s]+(?=\p{L}|\p{N})/gu, '$1');
}
