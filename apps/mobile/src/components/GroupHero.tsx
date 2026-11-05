/**
 * The top of a group: a calm header on the page. Back chevron, the group's mark
 * and name (with its type tag), sync / activity / menu; under it the one number
 * that matters (your balance in this group, in its money colour) and the two
 * actions it invites. A payment claim waiting on you rides under the balance.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
import { PersonAvatar } from '@/components/PersonAvatar';
import { useBlockedUsers } from '@/data/blocked';
import { SyncStatusIcon } from '@/components/SyncBanner';
import { router, useGoBack } from '@/lib/navigation';
import { convertedCaption } from '@/lib/settleCurrency';
import { formatShortDateRange } from '@/lib/tripDateRange';
import { useDialog } from '@/lib/dialog';

const AUTO_CONFIRM_DAYS = 7;
function daysToConfirm(initiatedIso: string, now: number = Date.now()): number {
  const parsed = Date.parse(initiatedIso);
  if (!Number.isFinite(parsed)) return AUTO_CONFIRM_DAYS;
  const left = AUTO_CONFIRM_DAYS * 86_400_000 - (now - parsed);
  return Math.max(1, Math.ceil(left / 86_400_000));
}

export function GroupHero({
  groupId,
  group,
  members,
  profileId,
  currency,
  myBalance,
  convertedFrom = [],
  pending,
  pendingForMe,
  nameOf,
  leftOwing = 0,
  onOpenMenu,
  onSettle,
}: {
  groupId: string;
  group: GroupRow;
  members: readonly MemberRow[];
  profileId: string | null;
  currency: string;
  myBalance: bigint;
  convertedFrom?: readonly string[];
  pending: bigint;
  pendingForMe: readonly SettlementRow[];
  nameOf: (memberId: string | null) => string;
  leftOwing?: number;
  onOpenMenu: () => void;
  /** Opens the balances to settle; the button shows only when something is owed. */
  onSettle?: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { t, locale } = useStrings();
  const dateRange =
    group.type === 'trip' || group.type === 'event'
      ? formatShortDateRange(group.start_date, group.end_date, locale)
      : null;
  const typeTag = useGroupTypeTag(group.type, group.event_template, group.custom_tag);
  const convertedNote = convertedCaption(convertedFrom, locale, t.fx.convertedCaption);
  const { confirm } = useDialog();
  const goBack = useGoBack();
  const confirmSettlement = useConfirmSettlement(groupId);
  const disputeSettlement = useDisputeSettlement(groupId);
  const busy = confirmSettlement.isPending || disputeSettlement.isPending;

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
  const ink = theme.color.text;
  const shownMembers = members.slice(0, MAX_FACES);
  const extraMembers = Math.max(0, members.length - shownMembers.length);
  const startedOn =
    dateRange ??
    new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(
      new Date(group.created_at),
    );

  return (
    <View
      style={{
        paddingTop: insets.top + theme.spacing.xs,
        paddingHorizontal: theme.spacing.lg,
        paddingBottom: theme.spacing.sm,
        gap: theme.spacing.sm,
      }}
    >
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
            alignItems: 'center',
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <GroupPhoto
            photoPath={group.photo_path}
            emoji={group.cover_emoji}
            color={group.cover_color}
            size={TILE}
          />
          <View style={{ flexShrink: 1, gap: 2 }}>
            <Text numberOfLines={1} style={{ fontSize: 18, lineHeight: 22, fontWeight: '700' }}>
              {group.name?.trim()
                ? group.name.trim()
                : cleanLabel(groupLabel(group, members ?? [], profileId))}
            </Text>
            <Row style={{ alignItems: 'center', gap: theme.spacing.xs }}>
              {typeTag ? <GroupTypeTag tag={typeTag} /> : null}
              <Text variant="micro" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
                {plural(locale, members?.length ?? 0, t.memberCount)}
                {leftOwing > 0 ? ` · ${fill(t.memberLeftCount, { n: leftOwing })}` : ''}
                {` · ${startedOn}`}
              </Text>
            </Row>
          </View>
        </Pressable>
        <SyncStatusIcon groupId={groupId} />
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
                borderColor: theme.color.bg,
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

      {/* The verdict and its figure, in its money colour. */}
      <View>
        <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
          <Text variant="caption" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
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
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.6}
          style={{ fontSize: 30, lineHeight: 36, fontWeight: '700' }}
        />
        {myBalance !== 0n && convertedNote ? (
          <Text variant="micro" tone="muted" numberOfLines={1}>
            {convertedNote}
          </Text>
        ) : null}
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
                borderColor: theme.color.bg,
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
            <Text
              variant="micro"
              tone="muted"
              style={{ marginStart: theme.spacing.xs, fontWeight: '700' }}
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
            borderColor: theme.color.textFaint,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="add" size={iconSize.lg} color={theme.color.textMuted} />
        </Pressable>
        <Row style={{ marginStart: 'auto', gap: theme.spacing.sm }}>
          {onSettle && myBalance !== 0n ? (
            <Button
              label={t.settleUp}
              variant="secondary"
              size="sm"
              hitSlop={4}
              onPress={onSettle}
            />
          ) : null}
          <Button
            label={t.addExpense}
            variant="brand"
            size="sm"
            hitSlop={4}
            icon={<Ionicons name="add" size={iconSize.lg} color={theme.color.onBrand} />}
            onPress={() => router.push(`/group/${groupId}/add-expense`)}
          />
        </Row>
      </Row>

      {/* Exactly one claim: amount and the two answers inline. */}
      {soleClaim ? (
        <View
          style={{
            gap: theme.spacing.sm,
            paddingTop: theme.spacing.sm,
            borderTopWidth: 1,
            borderTopColor: theme.color.border,
          }}
        >
          <Text variant="caption" tone="muted" numberOfLines={2}>
            {fill(t.group.saysTheyPaidYouWindow, {
              name: nameOf(soleClaim.from_member_id),
              window: plural(locale, daysToConfirm(soleClaim.initiated_at), t.group.daysToConfirm),
            })}
          </Text>
          <MoneyText
            amount={BigInt(soleClaim.amount)}
            currency={soleClaim.currency}
            locale={locale}
            variant="title"
          />
          <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
            <Button
              label={t.group.confirmReceived}
              variant="brand"
              size="sm"
              hitSlop={4}
              disabled={busy}
              onPress={() => confirmSettlement.mutate(soleClaim.id)}
            />
            <Button
              label={t.group.rejectSettlement}
              variant="secondary"
              size="sm"
              hitSlop={4}
              disabled={busy}
              onPress={() => rejectPrompt(soleClaim)}
            />
            {/* The payer's evidence is on the review screen; a way in only when
                there is a proof to look at. */}
            {soleProof.data ? (
              <Pressable
                onPress={() => router.push(`/group/${groupId}/pending`)}
                accessibilityRole="button"
                accessibilityLabel={t.proof.view}
                hitSlop={8}
                style={{ marginStart: 'auto' }}
              >
                <Ionicons name="image-outline" size={iconSize.lg} color={theme.color.brand} />
              </Pressable>
            ) : null}
          </Row>
        </View>
      ) : null}

      {/* Two or more: a summary that opens the full review list. */}
      {pendingForMe.length >= 2 ? (
        <View
          style={{
            gap: theme.spacing.sm,
            paddingTop: theme.spacing.sm,
            borderTopWidth: 1,
            borderTopColor: theme.color.border,
          }}
        >
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {plural(locale, pendingForMe.length, t.group.peopleSaidPaid)}
          </Text>
          <MoneyText
            amount={pendingForMe.reduce((sum, settlement) => sum + BigInt(settlement.amount), 0n)}
            currency={currency}
            locale={locale}
            variant="title"
          />
          <Button
            label={fill(t.group.reviewClaims, { count: pendingForMe.length })}
            variant="brand"
            size="sm"
            hitSlop={4}
            onPress={() => router.push(`/group/${groupId}/pending`)}
          />
        </View>
      ) : null}
    </View>
  );
}

const TILE = 40;
const FACE = 28;
const MAX_FACES = 4;

function cleanLabel(label: string): string {
  return label.replace(/(^|,\s*)[^\p{L}\p{N}\s]+(?=\p{L}|\p{N})/gu, '$1');
}
