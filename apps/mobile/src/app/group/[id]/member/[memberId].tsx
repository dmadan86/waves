import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';

import { currencyExposure, format, isValidVpa, money, type CurrencyCode } from '@waves/core';
import {
  Avatar,
  Badge,
  Button,
  Card,
  directionalIcon,
  EmptyState,
  IconButton,
  iconSize,
  ListRow,
  MoneyText,
  Row,
  Screen,
  SectionHeader,
  Text,
  useTheme,
} from '@waves/ui';

import { EditTextSheet } from '@/components/EditTextSheet';
import { ProfileAvatar } from '@/components/ProfileAvatar';
import { SettingsSection, type SettingsRow } from '@/components/SettingsSection';
import {
  useClaimMemberAsMe,
  useGhostMergePersonIds,
  useGroup,
  useGroupLedger,
  useSetMemberRole,
  useUpdateMember,
} from '@/data/hooks';
import { friendlyError } from '@/lib/errors';
import { expenseTitle } from '@/data/expenseTitle';
import { personKeyOf } from '@/data/peopleBalances';
import { useBlockedUsers } from '@/data/blocked';
import {
  displayName,
  groupLabel,
  GroupType,
  isBlockedMember,
  isGhost,
  isViewer,
} from '@/data/types';
import { fill, plural, useStrings } from '@/i18n';
import { useAuth, useViewerId } from '@/lib/auth';
import { useBottomClearance } from '@/lib/clearance';
import { router } from '@/lib/navigation';
import { useDialog } from '@/lib/dialog';

/** The crown's gold — there is no theme token for it, and it has to read as
 *  gold on both the light and dark palettes, the one thing a theme colour
 *  would not promise. */
const CROWN_GOLD = '#E3A008';

/**
 * The compact member page's own "Group type" word, off the same enum the
 * create and settings screens read from — this is the one place it is only
 * shown, never chosen, so it has no `ChipRow` beside it.
 */
function groupTypeLabel(type: string | null | undefined, t: ReturnType<typeof useStrings>['t']) {
  switch (type) {
    case GroupType.Trip:
      return t.extras.typeTrip;
    case GroupType.Home:
      return t.extras.typeHome;
    case GroupType.Couple:
      return t.extras.typeCouple;
    case GroupType.Event:
      return t.extras.typeEvent;
    case GroupType.Friends:
      return t.extras.typeFriends;
    default:
      return t.extras.typeOther;
  }
}

/** One of the header's two small facts — member count, group type. */
function HeaderPill({ label }: { label: string }) {
  const theme = useTheme();
  return (
    <View
      style={{
        paddingHorizontal: theme.spacing.sm,
        paddingVertical: 2,
        borderRadius: theme.radius.pill,
        backgroundColor: theme.color.surfaceMuted,
      }}
    >
      <Text variant="micro" tone="muted" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** The small gold crown on an admin's avatar — the one glyph this app has no
 *  other use for, so it carries no theme token of its own. */
function AdminCrown({ avatarSize }: { avatarSize: number }) {
  const theme = useTheme();
  const size = Math.round(avatarSize * 0.44);
  return (
    <View
      style={{
        position: 'absolute',
        top: -4,
        right: -4,
        width: size,
        height: size,
        borderRadius: size,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.color.surface,
        borderWidth: 1.5,
        borderColor: theme.color.surface,
        ...theme.shadow.soft,
      }}
    >
      <MaterialCommunityIcons name="crown" size={Math.round(size * 0.6)} color={CROWN_GOLD} />
    </View>
  );
}

/** One tile of the "Group summary" card — a tinted icon, a label, a value,
 *  and a chevron onto the group's own spending breakdown. */
function SummaryTile({
  icon,
  iconBg,
  iconColor,
  label,
  value,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  iconBg: string;
  iconColor: string;
  label: string;
  value: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${value}`}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minWidth: 0,
        gap: 4,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Row style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: theme.radius.sm,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: iconBg,
          }}
        >
          <Ionicons name={icon} size={iconSize.base} color={iconColor} />
        </View>
        <Ionicons
          name={directionalIcon('chevron-forward')}
          size={iconSize.sm}
          color={theme.color.textFaint}
        />
      </Row>
      <Text variant="caption" tone="muted" numberOfLines={1}>
        {label}
      </Text>
      <Text variant="subheading" numberOfLines={1}>
        {value}
      </Text>
    </Pressable>
  );
}

/** The expense list's sort pill — a toggle rather than a menu: two orders,
 *  one tap apart, which is all a group member's own feed has ever needed. */
function SortPill({ oldestFirst, onToggle }: { oldestFirst: boolean; onToggle: () => void }) {
  const theme = useTheme();
  const { t } = useStrings();
  const label = oldestFirst ? t.people.sortOldestFirst : t.people.sortNewestFirst;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onToggle}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.xs,
        paddingHorizontal: theme.spacing.sm,
        paddingVertical: 4,
        borderRadius: theme.radius.pill,
        backgroundColor: theme.color.surfaceMuted,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Ionicons name="swap-vertical-outline" size={iconSize.sm} color={theme.color.textMuted} />
      <Text variant="micro" tone="muted" numberOfLines={1}>
        {label}
      </Text>
      <Ionicons name="chevron-down" size={iconSize.xs} color={theme.color.textFaint} />
    </Pressable>
  );
}

export default function MemberScreen() {
  const theme = useTheme();
  const clearance = useBottomClearance();
  const { t, locale } = useStrings();
  const { confirm } = useDialog();
  const { id, memberId } = useLocalSearchParams<{ id: string; memberId: string }>();
  const groupId = id ?? '';
  const { profile } = useAuth();
  // Identity for "which member am I", from the session rather than the profile:
  // the session is on the device at launch, the profile is a fetch that lands
  // later, and in the gap `profile?.id` is undefined — which `isViewer` refuses
  // to match, but only if it is given the right thing to compare. See
  // `lib/auth.useViewerId`.
  const viewerId = useViewerId();

  const { group, members, expenses } = useGroup(groupId);
  const ledger = useGroupLedger(groupId, viewerId);
  const updateMember = useUpdateMember(groupId);
  const setRole = useSetMemberRole(groupId);
  const claimAsMe = useClaimMemberAsMe(groupId);
  const { blockedIds, block, unblock } = useBlockedUsers();
  const mergePersonIds = useGhostMergePersonIds();

  const member = members.data?.find((row) => row.id === memberId);
  const isMe = member ? isViewer(member, viewerId) : false;
  const myRow = members.data?.find((row) => isViewer(row, viewerId));
  const iAmAdmin = myRow?.role === 'admin';
  const currency = group.data?.default_currency ?? 'INR';

  const [name, setName] = useState(member?.ghost_name ?? '');
  const [vpa, setVpa] = useState(member?.vpa ?? '');
  const [status, setStatus] = useState<string | null>(null);
  /** What came of "this is me", in its own line: it can be good news. */
  const [claimNote, setClaimNote] = useState<{ text: string; ok: boolean } | null>(null);
  /** Which editable row has its sheet open, or null. */
  const [editing, setEditing] = useState<'name' | 'vpa' | null>(null);
  /** The expense feed's own order — newest first until flipped. */
  const [oldestFirst, setOldestFirst] = useState(false);

  // Seed the editors from the member the moment the query resolves, and again
  // if the row identity changes — synced in render (the app's idiom for
  // "follow a value until touched"), not in an effect, so it never triggers a
  // cascading-render lint or a frame of empty fields.
  const [seededId, setSeededId] = useState<string | null>(null);
  if (member && seededId !== member.id) {
    setSeededId(member.id);
    setName(member.ghost_name ?? '');
    setVpa(member.vpa ?? '');
  }

  if (!member) {
    return (
      <Screen>
        <EmptyState title={t.people.memberNotFound} body={t.people.memberNotFoundBody} />
      </Screen>
    );
  }

  const ghost = isGhost(member);
  const blocked = isBlockedMember(member, blockedIds);
  // A blocked person wears the ghost look and the ghost name here too — the one
  // exception is the block card below, which needs their real name to name the
  // action. Blocking is display-only; it never touches the balance shown here.
  const shownName = displayName(member, viewerId, blockedIds, t.misc.someone);
  const realName = member.profile?.display_name ?? member.ghost_name ?? t.misc.someone;

  // Where the name+chevron on the person card leads: that person, un-collapsed
  // across every group shared with them — the same destination and the same
  // dead-end rules the group screen's own balance rows use (see
  // `GroupScreen.personKeyFor`). Yourself and a member only in the local queue
  // are dead ends; a blocked person is not, and travels under their mask.
  const personKey =
    isMe || member.pending
      ? null
      : personKeyOf({
          profileId: member.profile_id,
          mergePersonId: mergePersonIds.get(member.id) ?? null,
          memberId: member.id,
        });

  const confirmBlock = async (): Promise<void> => {
    if (!member.profile_id) return;
    const profileId = member.profile_id;
    const ok = await confirm({
      title: fill(t.blocked.confirmTitle, { name: realName }),
      body: t.blocked.confirmBody,
      confirmLabel: t.blocked.action,
      tone: 'danger',
    });
    if (ok) {
      block({ id: profileId, name: realName, avatarUrl: member.profile?.avatar_url ?? null });
    }
  };
  /**
   * "This is me": the placeholder somebody added for you, taken from inside
   * the group. Asked and answered in plain words, because approving moves
   * every expense filed under that name.
   */
  const sayThisIsMe = async (): Promise<void> => {
    const placeholder = member.ghost_name ?? t.misc.someone;
    const ok = await confirm({
      title: fill(t.claims.thisIsMeConfirmTitle, { name: placeholder }),
      body: fill(iAmAdmin ? t.claims.thisIsMeConfirmBodyAdmin : t.claims.thisIsMeConfirmBody, {
        name: placeholder,
      }),
      confirmLabel: t.claims.thisIsMe,
    });
    if (!ok) return;
    setClaimNote(null);
    claimAsMe.mutate(member.id, {
      onSuccess: (verdict) => {
        if (verdict.ok) {
          setClaimNote({
            ok: true,
            text:
              verdict.status === 'approved'
                ? fill(t.claims.thisIsMeDone, { name: placeholder })
                : t.claims.thisIsMeAsked,
          });
          return;
        }
        setClaimNote({
          ok: false,
          text:
            verdict.reason === 'HAS_HISTORY'
              ? t.claims.youHaveHistory
              : verdict.reason === 'ALREADY_CLAIMED' || verdict.reason === 'NOT_CLAIMABLE'
                ? t.claims.placeTaken
                : t.claims.thisIsMeFailed,
        });
      },
      onError: (caught) =>
        setClaimNote({
          ok: false,
          text: friendlyError(caught, t.claims.thisIsMeFailed, 'member.thisIsMe'),
        }),
    });
  };

  const balance = ledger.balances.get(member.id) ?? 0n;
  // The hero wears the money colour for its meaning — mint when this person is
  // owed, pink when they owe — and a neutral lilac when they are square, so a
  // settled member is never painted a direction they are not in. Ink from the
  // pair keeps the amount readable on the tint.
  const heroTint = balance > 0n ? 'mint' : balance < 0n ? 'pink' : 'lilac';
  const heroInk = theme.tint[heroTint].ink;
  const showSettle = balance !== 0n && !isMe;

  /**
   * Promote, demote, block, unblock — whichever of them apply to this person.
   *
   * Built as a list so the section can be omitted entirely when none apply,
   * rather than drawing a heading over nothing. That is the case for yourself,
   * and for a ghost seen by a non-admin.
   */
  const manageRows: SettingsRow[] = [
    // Anybody in the group can say a placeholder is them; the server decides
    // whether an admin has to confirm it.
    ...(ghost && myRow
      ? [
          {
            icon: 'person-circle-outline' as const,
            label: t.claims.thisIsMe,
            hint: fill(t.claims.thisIsMeHint, { name: member.ghost_name ?? t.misc.someone }),
            onPress: claimAsMe.isPending ? undefined : () => void sayThisIsMe(),
          },
        ]
      : []),
    ...(iAmAdmin && !isMe
      ? [
          {
            icon: (member.role === 'admin' ? 'shield-outline' : 'shield-checkmark-outline') as
              'shield-outline' | 'shield-checkmark-outline',
            // Relabelled from the old "Make admin" / "Remove admin" to a
            // neutral "Manage role" with the role read off as the subtitle —
            // the tap still toggles it immediately, same as before.
            label: t.people.manageRole,
            hint: ghost
              ? t.people.adminNeedsAccount
              : member.role === 'admin'
                ? t.people.currentRoleAdmin
                : t.people.currentRoleMember,
            onPress:
              ghost || setRole.isPending
                ? undefined
                : () =>
                    setRole.mutate(
                      {
                        memberId: member.id,
                        role: member.role === 'admin' ? 'member' : 'admin',
                      },
                      {
                        onSuccess: () => setStatus(t.account.saved),
                        onError: (caught) =>
                          setStatus(friendlyError(caught, t.couldNotSave, 'member.setRole')),
                      },
                    ),
          },
        ]
      : []),
    ...(!isMe && !ghost && member.profile_id
      ? [
          {
            icon: (blocked ? 'eye-outline' : 'ban-outline') as 'eye-outline' | 'ban-outline',
            label: blocked ? t.blocked.unblock : t.blocked.action,
            hint: t.blocked.note,
            destructive: !blocked,
            onPress: blocked ? () => unblock(member.profile_id!) : () => void confirmBlock(),
          },
        ]
      : []),
  ];

  // Expenses this person is actually part of.
  const involved = expenses.rows.filter((expense) =>
    expense.currentVersion?.shares.some((share) => share.member_id === member.id),
  );
  // The feed's own sort, newest-first by default: an explicit chronological
  // order rather than trusting whatever order the rows happened to arrive in,
  // so the "Newest first" pill always tells the truth about what is below it.
  // Plain, not memoized: the per-member expense list is never long enough for
  // a re-sort on render to be a cost worth guarding against.
  const sortedInvolved = [...involved].sort((a, b) => {
    const dateA = a.currentVersion?.expense_date ?? '';
    const dateB = b.currentVersion?.expense_date ?? '';
    return oldestFirst ? dateA.localeCompare(dateB) : dateB.localeCompare(dateA);
  });

  // What this person actually fronted, per currency (ADR-004: never summed into
  // one). "You paid ₹12,400, €90 and ฿2,100" — the honest answer on a trip that
  // touched more than one currency, drawn from the payments the ledger stored.
  const paidExposure = currencyExposure(
    expenses.rows.reduce<Record<string, bigint>>((acc, expense) => {
      const version = expense.currentVersion;
      if (!version || expense.deleted_at) return acc;
      for (const payer of version.payers) {
        if (payer.member_id !== member.id) continue;
        acc[version.currency] = (acc[version.currency] ?? 0n) + BigInt(payer.amount);
      }
      return acc;
    }, {}),
  );
  const paidSummaryValue =
    paidExposure.length > 0
      ? paidExposure
          .map((entry) =>
            format(money(entry.amountMinor, entry.currency as CurrencyCode), { locale }),
          )
          .join(' · ')
      : format(money(0n, currency as CurrencyCode), { locale });

  const save = (patch: { ghost_name?: string; vpa?: string | null }): void => {
    setStatus(null);
    updateMember.mutate(
      { memberId: member.id, patch },
      {
        onSuccess: () => setStatus(t.account.saved),
        onError: (caught) => setStatus(friendlyError(caught, t.couldNotSave, 'member.save')),
      },
    );
  };

  // The header: the group's own name and roster, not this member's — "whose
  // group this member belongs to" rather than "who this member is", which the
  // person card right under it already says. `groupLabel` with no group row
  // (just the members) is the plain "You, X and Y" sentence; with the group
  // row it is that sentence only for an unnamed group, else the group's name.
  const activeMembers = (members.data ?? []).filter((row) => !row.left_at);
  const groupTitle = group.data?.name?.trim() || groupLabel(group.data, members.data, viewerId);
  const membersSummary = groupLabel(undefined, members.data, viewerId);

  const goToInsights = (): void => router.push(`/group/${groupId}/insights`);

  const greenBg = theme.color.positiveSoft;
  const greenIcon = theme.color.positive;
  const amberBg = theme.scheme === 'dark' ? theme.color.surfaceMuted : '#FDF1DC';
  const amberIcon = theme.scheme === 'dark' ? theme.color.textMuted : '#B9740A';

  // The person card's identity block — avatar, name, admin crown and badges —
  // built once and wrapped in a Pressable only when there is somewhere for it
  // to lead (see `personKey` above), the same shape the group screen's own
  // balance rows use for the same reason.
  const identity = (
    <>
      <View>
        <ProfileAvatar
          name={shownName}
          avatarUrl={ghost || blocked ? null : (member.profile?.avatar_url ?? null)}
          size={44}
        />
        {member.role === 'admin' ? <AdminCrown avatarSize={44} /> : null}
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Row style={{ alignItems: 'center', gap: theme.spacing.xs }}>
          <Text variant="subheading" numberOfLines={1} style={{ flexShrink: 1 }}>
            {shownName}
          </Text>
          {personKey ? (
            <Ionicons
              name={directionalIcon('chevron-forward')}
              size={iconSize.sm}
              color={theme.color.textFaint}
            />
          ) : null}
        </Row>
        <Row style={{ gap: theme.spacing.xs, flexWrap: 'wrap' }}>
          {ghost ? <Badge label={t.notJoinedYet} /> : null}
          {blocked ? <Badge label={t.blocked.badge} /> : null}
          {member.role === 'admin' ? <Badge label={t.people.admin} tone="brand" /> : null}
          {isMe ? <Badge label={t.people.you} tone="positive" /> : null}
        </Row>
      </View>
    </>
  );
  const identityBlock = personKey ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={shownName}
      accessibilityHint={t.people.seeSharedGroups}
      onPress={() =>
        router.push(
          `/friends/person/${encodeURIComponent(personKey)}?name=${encodeURIComponent(
            shownName,
          )}` as never,
        )
      }
      style={({ pressed }) => ({
        flex: 1,
        minWidth: 0,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      {identity}
    </Pressable>
  ) : (
    <View
      style={{
        flex: 1,
        minWidth: 0,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
      }}
    >
      {identity}
    </View>
  );

  return (
    <Screen>
      <Row
        style={{
          paddingHorizontal: theme.spacing.lg,
          paddingTop: theme.spacing.sm,
          paddingBottom: theme.spacing.sm,
          alignItems: 'center',
          gap: theme.spacing.sm,
        }}
      >
        <IconButton label={t.common.back} onPress={() => router.back()}>
          <Ionicons
            name={directionalIcon('chevron-back')}
            size={iconSize.lg}
            color={theme.color.text}
          />
        </IconButton>
        <View style={{ flex: 1, minWidth: 0, alignItems: 'center', gap: 2 }}>
          <Text variant="heading" numberOfLines={1}>
            {groupTitle}
          </Text>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {membersSummary}
          </Text>
          <Row style={{ gap: theme.spacing.xs, marginTop: 2 }}>
            <HeaderPill
              label={`\u{1F465} ${plural(locale, activeMembers.length, t.memberCount)}`}
            />
            <HeaderPill label={groupTypeLabel(group.data?.type, t)} />
          </Row>
        </View>
        <IconButton label={t.group.more} onPress={() => router.push(`/group/${groupId}/settings`)}>
          <Ionicons name="ellipsis-vertical" size={iconSize.lg} color={theme.color.text} />
        </IconButton>
      </Row>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingTop: theme.spacing.xs,
          paddingBottom: clearance,
          gap: 10,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* The person card: who, whether they are an admin, and — across a
            divider — which way the balance runs and by how much. The amount
            used to stand alone in a big tinted hero; a direction in words
            beside a smaller figure reads just as clearly in a fraction of the
            height (ADR-009 and the #191 regression still apply — colour alone
            never carries the meaning). */}
        <Card style={{ padding: theme.spacing.md }}>
          <Row style={{ alignItems: 'center' }}>
            {identityBlock}

            <View
              style={{
                width: 1,
                alignSelf: 'stretch',
                backgroundColor: theme.color.border,
                marginHorizontal: theme.spacing.sm,
              }}
            />

            <View style={{ alignItems: 'flex-end' }}>
              <Text variant="caption" style={{ color: heroInk, opacity: 0.85 }}>
                {balance > 0n
                  ? t.tabs.owesYou
                  : balance < 0n
                    ? t.tabs.youOweThem
                    : t.tabs.allSquare}
              </Text>
              <MoneyText
                amount={balance}
                currency={currency}
                locale={locale}
                mode="balance"
                variant="title"
                tone="default"
                style={{ color: heroInk }}
              />
            </View>
          </Row>
        </Card>

        {/* Two buttons: settling up (only when there is a direction to settle,
            same condition as before) and the group's existing invite/QR share,
            now a one-tap shortcut from this page too. */}
        <Row style={{ gap: 10 }}>
          {showSettle ? (
            <Button
              label={t.settleUp}
              variant="brand"
              icon={
                <Ionicons
                  name="paper-plane-outline"
                  size={iconSize.md}
                  color={theme.color.onBrand}
                />
              }
              style={{ flex: 1.3, height: 46 }}
              onPress={() => router.push(`/group/${groupId}/settle`)}
            />
          ) : null}
          <Button
            label={t.people.shareGroup}
            variant="secondary"
            icon={<Ionicons name="qr-code-outline" size={iconSize.md} color={theme.color.brand} />}
            style={{ flex: 1, height: 46 }}
            onPress={() => router.push(`/group/${groupId}/invite`)}
          />
        </Row>

        {/* Group summary: the same two facts the old "In this group" list
            carried (what they paid, how many expenses), now two tiles with
            their own chevron onto the group's spending breakdown. */}
        <View style={{ gap: theme.spacing.sm }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${t.people.groupSummary}. ${t.people.viewDetails}`}
            onPress={goToInsights}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text variant="subheading">{t.people.groupSummary}</Text>
            <Row style={{ gap: 2, alignItems: 'center' }}>
              <Text variant="caption" tone="muted">
                {t.people.viewDetails}
              </Text>
              <Ionicons
                name={directionalIcon('chevron-forward')}
                size={iconSize.sm}
                color={theme.color.textFaint}
              />
            </Row>
          </Pressable>
          <Card style={{ padding: theme.spacing.md }}>
            <Row style={{ gap: 10 }}>
              <SummaryTile
                icon="card-outline"
                iconBg={greenBg}
                iconColor={greenIcon}
                label={t.people.paidAcross}
                value={paidSummaryValue}
                onPress={goToInsights}
              />
              <SummaryTile
                icon="receipt-outline"
                iconBg={amberBg}
                iconColor={amberIcon}
                label={t.people.expensesLabel}
                value={String(involved.length)}
                onPress={goToInsights}
              />
            </Row>
          </Card>
        </View>

        {/* The two editable facts, as rows that open a sheet — the same pattern
            the account screen uses, so a field is one line until somebody wants
            to change it. A ghost's name is editable by anyone in the group; the
            UPI override is yours alone. */}
        {ghost || isMe ? (
          <SettingsSection
            rows={[
              ...(ghost
                ? [
                    {
                      icon: 'person-outline' as const,
                      label: t.people.memberName,
                      hint: t.people.ghostNote,
                      value: name.trim() || t.misc.someone,
                      valueMuted: !name.trim(),
                      onPress: () => setEditing('name'),
                    },
                  ]
                : []),
              ...(isMe
                ? [
                    {
                      icon: 'wallet-outline' as const,
                      label: t.people.upiForGroup,
                      hint: t.people.upiForGroupNote,
                      value: vpa.trim() || (profile?.default_vpa ?? 'you@bank'),
                      valueMuted: !vpa.trim(),
                      onPress: () => setEditing('vpa'),
                    },
                  ]
                : []),
            ]}
          />
        ) : null}

        {/* Managing this person: one section of rows rather than a card each.

            These were two cards, each a caption over a button over a note, at
            two different weights — a soft lavender "Make admin" and a red
            "Block" — for two things that are both just controls. GoPay files
            exactly this under one "More action" heading of icon rows, and the
            note each one carried becomes the row's second line, which is where
            a sentence explaining a control belongs.

            An admin can promote or demote anyone but themselves. A ghost shows
            the row disabled with the reason rather than hiding it, so the
            capability stays discoverable — the server enforces the rule either
            way (GHOST_CANNOT_ADMIN, and the last admin cannot be demoted).
            Blocking is display-only and never touches the balance above. */}
        {manageRows.length > 0 ? (
          <SettingsSection title={t.people.manageTitle} rows={manageRows} />
        ) : null}

        {claimNote ? (
          <Text variant="caption" tone={claimNote.ok ? 'positive' : 'negative'}>
            {claimNote.text}
          </Text>
        ) : null}

        {status ? (
          <Text variant="caption" tone={status === t.account.saved ? 'positive' : 'negative'}>
            {status}
          </Text>
        ) : null}

        <View>
          <SectionHeader
            title={plural(locale, involved.length, t.expense.inCount)}
            action={
              <SortPill oldestFirst={oldestFirst} onToggle={() => setOldestFirst((v) => !v)} />
            }
          />
          <Card padded={false} style={{ paddingHorizontal: theme.spacing.md }}>
            {sortedInvolved.map((expense, index) => {
              const share = expense.currentVersion?.shares.find(
                (row) => row.member_id === member.id,
              );
              return (
                <View key={expense.id}>
                  <ListRow
                    title={expenseTitle(
                      expense.currentVersion?.description,
                      expense.currentVersion?.category,
                      t,
                      expense.currentVersion?.category_meta,
                    )}
                    subtitle={
                      expense.currentVersion
                        ? new Intl.DateTimeFormat(locale, {
                            day: 'numeric',
                            month: 'short',
                          }).format(new Date(expense.currentVersion.expense_date))
                        : undefined
                    }
                    leading={<Avatar name={expense.currentVersion?.description ?? '?'} size={36} />}
                    onPress={() => router.push(`/group/${groupId}/expense/${expense.id}`)}
                    trailing={
                      share ? (
                        <MoneyText
                          amount={BigInt(share.amount)}
                          currency={currency}
                          locale={locale}
                          variant="caption"
                        />
                      ) : null
                    }
                  />
                  {index < sortedInvolved.length - 1 ? (
                    <View style={{ height: 1, backgroundColor: theme.color.border }} />
                  ) : null}
                </View>
              );
            })}
          </Card>
        </View>
      </ScrollView>

      {/* The editors, over the list rather than inside it — see the account
          screen for why a row beats a field with a Save button beside it. */}
      <EditTextSheet
        visible={editing === 'name'}
        title={t.people.memberName}
        hint={t.people.ghostNote}
        value={name}
        saving={updateMember.isPending}
        onSave={(next) => {
          setName(next);
          save({ ghost_name: next });
          setEditing(null);
        }}
        onClose={() => setEditing(null)}
      />
      <EditTextSheet
        visible={editing === 'vpa'}
        title={t.people.upiForGroup}
        hint={t.people.upiForGroupNote}
        value={vpa}
        placeholder={profile?.default_vpa ?? 'you@bank'}
        autoCapitalize="none"
        saving={updateMember.isPending}
        onSave={(next) => {
          // An empty field clears the override rather than storing a blank —
          // and an unparseable handle is refused here, since the sheet is the
          // only door and the ledger should never hold one.
          if (next.trim() !== '' && !isValidVpa(next.trim())) {
            setStatus(t.people.upiInvalid);
            return;
          }
          setVpa(next);
          save({ vpa: next.trim() === '' ? null : next.trim() });
          setEditing(null);
        }}
        onClose={() => setEditing(null)}
      />
    </Screen>
  );
}
