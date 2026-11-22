/**
 * What a group's ledger screen wears at the top: Home's scenic hero, in two
 * pieces handed to `ScenicScreen`.
 *
 *   `GroupHeaderRow`  the fixed row: back, the group's mark, name and type tag,
 *                     then sync, search, activity and the ⋮ menu. Drawn twice by
 *                     the shell (white over the photo, theme ink once scrolled).
 *   `GroupHeroCard`   the glass card: your standing in the group, who is in it,
 *                     a payment claim waiting on you, and the quick actions.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import type { RefObject } from 'react';
import { Pressable, View } from 'react-native';

import {
  Badge,
  Button,
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
import { HeroIconButton } from '@/components/home/HeroControls';
import { QuickActionsRow } from '@/components/home/QuickActionsRow';
import { BALANCE_MASK, HomeBalanceCard } from '@/components/home/ScenicBalanceCard';
import { PersonAvatar } from '@/components/PersonAvatar';
import { useBlockedUsers } from '@/data/blocked';
import { SyncStatusIcon } from '@/components/SyncBanner';
import { useBalanceHidden } from '@/lib/balanceHidden';
import { router, useGoBack } from '@/lib/navigation';
import { convertedCaption } from '@/lib/settleCurrency';
import { useDialog } from '@/lib/dialog';

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

/** The group's mark tile, and the member faces under the balance. */
const TILE = 36;
const FACE = 32;
const MAX_FACES = 4;

/** A name built from people's names reads without the punctuation an address
 *  book puts in front of one (".Rvs Anoop" → "Rvs Anoop"). Only for that
 *  fallback: a name the group was given (".NET Team") is shown as typed. */
function cleanLabel(label: string): string {
  return label.replace(/(^|,\s*)[^\p{L}\p{N}\s]+(?=\p{L}|\p{N})/gu, '$1');
}

/** The fixed header row's content for `ScenicScreen`'s `header` render prop. */
export function GroupHeaderRow({
  groupId,
  group,
  members,
  profileId,
  ink,
  solid,
  pendingCount,
  onSearch,
  onOpenMenu,
}: {
  groupId: string;
  group: GroupRow;
  members: readonly MemberRow[];
  profileId: string | null;
  ink: string;
  solid: boolean;
  /** Payment claims waiting on you: the bell's dot. */
  pendingCount: number;
  /** Opens the expense search; left out while there is nothing to search. */
  onSearch?: () => void;
  onOpenMenu: () => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const goBack = useGoBack();
  const typeTag = useGroupTypeTag(group.type, group.event_template, group.custom_tag);
  const name = group.name?.trim()
    ? group.name.trim()
    : cleanLabel(groupLabel(group, members, profileId));
  return (
    <>
      <HeroIconButton
        icon={directionalIcon('chevron-back')}
        label={t.common.back}
        onPress={goBack}
        ink={ink}
      />
      <Pressable
        onPress={() => router.push(`/group/${groupId}/settings`)}
        accessibilityRole="button"
        accessibilityLabel={t.group.settings}
        style={({ pressed }) => ({
          flex: 1,
          minWidth: 0,
          flexDirection: 'row',
          gap: theme.spacing.sm,
          alignItems: 'center',
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <GroupPhoto
          photoPath={group.photo_path}
          emoji={group.cover_emoji}
          color={group.cover_color}
          size={TILE}
          background={theme.color.surface}
        />
        <View style={{ flexShrink: 1, gap: 2 }}>
          <Text
            numberOfLines={1}
            style={{
              color: ink,
              fontSize: 18,
              lineHeight: 22,
              fontWeight: '700',
              ...(solid
                ? null
                : {
                    textShadowColor: 'rgba(0,0,0,0.35)',
                    textShadowOffset: { width: 0, height: 1 },
                    textShadowRadius: 4,
                  }),
            }}
          >
            {name}
          </Text>
          {typeTag ? (
            <View style={{ alignSelf: 'flex-start' }}>
              <GroupTypeTag tag={typeTag} onBrand={!solid} />
            </View>
          ) : null}
        </View>
      </Pressable>
      <SyncStatusIcon onBrand={!solid} groupId={groupId} ink={ink} />
      {onSearch ? (
        <HeroIconButton
          icon="search-outline"
          label={t.group.searchExpenses}
          onPress={onSearch}
          ink={ink}
        />
      ) : null}
      <HeroIconButton
        icon="notifications-outline"
        label={t.activity}
        dot={pendingCount > 0}
        onPress={() => router.push({ pathname: '/activity', params: { group: groupId } })}
        ink={ink}
      />
      <HeroIconButton
        icon="ellipsis-vertical"
        label={t.group.more}
        onPress={onOpenMenu}
        ink={ink}
      />
    </>
  );
}

/** The glass card: standing, people, waiting claims and the quick actions. */
export function GroupHeroCard({
  groupId,
  group,
  members,
  currency,
  myBalance,
  convertedFrom = [],
  pending,
  pendingForMe,
  nameOf,
  leftOwing = 0,
  pool = false,
  loading = false,
  blurTarget,
  onAddExpense,
  onSettleUp,
  onScan,
  onRemind,
}: {
  groupId: string;
  group: GroupRow;
  members: readonly MemberRow[];
  currency: string;
  myBalance: bigint;
  /** Currencies counted in `currency` at their recorded rates (ADR-003 amendment). */
  convertedFrom?: readonly string[];
  pending: bigint;
  pendingForMe: readonly SettlementRow[];
  nameOf: (memberId: string | null) => string;
  /** Members who left but still have a balance: "2 members · 1 left". */
  leftOwing?: number;
  /** Share it household: nobody owes anybody, so the balance verdict is not drawn. */
  pool?: boolean;
  loading?: boolean;
  blurTarget: RefObject<View | null>;
  onAddExpense: () => void;
  onSettleUp: () => void;
  onScan: () => void;
  onRemind: () => void;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const { confirm } = useDialog();
  const { blockedIds } = useBlockedUsers();
  const { hidden, ready, toggle } = useBalanceHidden();
  const confirmSettlement = useConfirmSettlement(groupId);
  const disputeSettlement = useDisputeSettlement(groupId);
  const busy = confirmSettlement.isPending || disputeSettlement.isPending;
  // The one inline claim, if that is the case we are in: whether the payer
  // attached a proof. Called with an empty id (a null lookup) otherwise, so the
  // hook count never changes.
  const soleClaim = pendingForMe.length === 1 ? pendingForMe[0] : null;
  const soleProof = useSettlementProof(soleClaim?.id ?? '');
  const convertedNote = convertedCaption(convertedFrom, locale, t.fx.convertedCaption);
  const shownMembers = members.slice(0, MAX_FACES);
  const extraMembers = Math.max(0, members.length - shownMembers.length);
  const memberText = `${plural(locale, members.length, t.memberCount)}${
    leftOwing > 0 ? ` · ${fill(t.memberLeftCount, { n: leftOwing })}` : ''
  }`;

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

  const glyph = (name: keyof typeof Ionicons.glyphMap) => ({
    glyph: (color: string) => <Ionicons name={name} size={28} color={color} />,
  });

  const extra = (
    <View
      style={{
        gap: theme.spacing.sm,
        paddingHorizontal: theme.spacing.lg,
        paddingTop: theme.spacing.sm,
        paddingBottom: theme.spacing.xs,
      }}
    >
      {myBalance !== 0n && !pool && convertedNote ? (
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {convertedNote}
        </Text>
      ) : null}
      <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
        <Pressable
          onPress={() => router.push(`/group/${groupId}/members`)}
          accessibilityRole="button"
          accessibilityLabel={`${t.group.membersLabel}. ${memberText}`}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            flexShrink: 1,
            gap: theme.spacing.sm,
          }}
        >
          <Row style={{ alignItems: 'center' }}>
            {shownMembers.map((member, index) => (
              <View
                key={member.id}
                style={{
                  marginStart: index === 0 ? 0 : -6,
                  borderRadius: FACE / 2,
                  borderWidth: 1.5,
                  borderColor: theme.color.surface,
                }}
              >
                <PersonAvatar
                  name={displayName(member, null, blockedIds, t.misc.someone)}
                  member={member}
                  ghost={isGhost(member) || isBlockedMember(member, blockedIds)}
                  size={FACE}
                />
              </View>
            ))}
            {extraMembers > 0 ? (
              <Text variant="micro" tone="muted" style={{ marginStart: 4, fontWeight: '700' }}>
                +{extraMembers}
              </Text>
            ) : null}
          </Row>
          <Text variant="caption" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
            {memberText}
          </Text>
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
            borderColor: theme.color.brand,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="add" size={iconSize.lg} color={theme.color.brand} />
        </Pressable>
      </Row>

      {/* Exactly one claim: the fast path, amount and the two answers inline. */}
      {pendingForMe.length === 1 && soleClaim ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="caption" tone="muted">
            {fill(t.group.saysTheyPaidYouWindow, {
              name: nameOf(soleClaim.from_member_id),
              window: plural(locale, daysToConfirm(soleClaim.initiated_at), t.group.daysToConfirm),
            })}
          </Text>
          {hidden || !ready ? (
            <Text variant="title">{BALANCE_MASK}</Text>
          ) : (
            <MoneyText
              amount={BigInt(soleClaim.amount)}
              currency={soleClaim.currency}
              locale={locale}
              variant="title"
              tone="default"
            />
          )}
          <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
            <Button
              label={t.group.confirmReceived}
              size="sm"
              disabled={busy}
              onPress={() => confirmSettlement.mutate(soleClaim.id)}
            />
            <Button
              label={t.group.rejectSettlement}
              size="sm"
              variant="ghost"
              disabled={busy}
              onPress={() => rejectPrompt(soleClaim)}
            />
          </Row>
          {/* The payer's evidence is on the review screen; a way in only when
              there is actually a proof to look at. */}
          {soleProof.data ? (
            <Pressable
              onPress={() => router.push(`/group/${groupId}/pending`)}
              accessibilityRole="button"
              accessibilityLabel={t.proof.view}
              hitSlop={8}
              style={{ alignSelf: 'flex-start' }}
            >
              <Row style={{ alignItems: 'center', gap: theme.spacing.xs }}>
                <Ionicons name="image-outline" size={iconSize.sm} color={theme.color.brand} />
                <Text variant="micro" tone="brand" style={{ textDecorationLine: 'underline' }}>
                  {t.proof.view}
                </Text>
              </Row>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {/* Two or more: a summary that opens the full review list. */}
      {pendingForMe.length >= 2 ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="caption" tone="muted">
            {plural(locale, pendingForMe.length, t.group.peopleSaidPaid)}
          </Text>
          {hidden || !ready ? (
            <Text variant="title">{BALANCE_MASK}</Text>
          ) : (
            <MoneyText
              amount={pendingForMe.reduce((sum, settlement) => sum + BigInt(settlement.amount), 0n)}
              currency={currency}
              locale={locale}
              variant="title"
              tone="default"
            />
          )}
          <Button
            label={fill(t.group.reviewClaims, { count: pendingForMe.length })}
            size="sm"
            onPress={() => router.push(`/group/${groupId}/pending`)}
          />
        </View>
      ) : null}
    </View>
  );

  return (
    <HomeBalanceCard
      net={myBalance}
      owed={0n}
      owing={0n}
      owedGroups={0}
      owingGroups={0}
      currency={currency}
      locale={locale}
      hidden={hidden || !ready}
      onToggleHide={toggle}
      settling={false}
      loading={loading || !ready}
      blurTarget={blurTarget}
      label={pool ? t.members : undefined}
      // A shared pot has no verdict: the card names the group rather than a debt.
      amountText={pool ? memberText : undefined}
      labelAccessory={pending !== 0n ? <Badge label={t.pendingConfirmation} tone="brand" /> : null}
      sides={null}
      extra={extra}
      footer={
        <QuickActionsRow
          radius={theme.radius.xl}
          discColor="transparent"
          iconColor={theme.color.brand}
          discSize={32}
          rowPadding={theme.spacing.sm}
          actions={[
            { key: 'scan', label: t.scanBill, ...glyph('scan-outline'), onPress: onScan },
            {
              key: 'remind',
              label: t.people.remind,
              ...glyph('alarm-outline'),
              onPress: onRemind,
            },
            {
              key: 'settle',
              label: t.homeDash.settleUp,
              ...glyph('cash-outline'),
              onPress: onSettleUp,
            },
            {
              key: 'expense',
              label: t.addExpense,
              ...glyph('add-circle-outline'),
              onPress: onAddExpense,
            },
          ]}
        />
      }
    />
  );
}
