/**
 * One person: who they are, and what stands between you across every group.
 *
 * Three things on this screen are decided elsewhere on purpose, so that it can
 * never disagree with the screen it leads to:
 *
 * - the figures are `pairBalances` (core), through `usePairPerson` — the same
 *   per-group amounts and the same total the Who-pays-whom screen draws;
 * - the groups are named by the one labeller every screen uses (`groupLabel`),
 *   so an unnamed group reads the same here, on the chips and on the pair screen;
 * - Remind is the shared channel sheet (`useRemind`), never a one-off popup.
 *
 * Identity comes from its own call (`waves_person_profile`), which survives
 * being square: the balance is one card on the page, not the page. The contact
 * details on that call are not ours — the server sends them only when the person
 * has said group-mates may see them — and a card with nothing on it is not drawn.
 *
 * A person blocked on this device is shown as the app's anonymous ghost
 * everywhere, and that has to include here: no avatar, no number, no address,
 * whatever the server was willing to send.
 */
import { useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams } from 'expo-router';
import { Modal, Pressable, ScrollView, StatusBar, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { type CurrencyCode } from '@waves/core';
import {
  Button,
  Card,
  Divider,
  EmptyState,
  iconSize,
  MODAL_ORIENTATIONS,
  MoneyText,
  Row,
  Screen,
  Text,
  useTabBarClearance,
  useTheme,
} from '@waves/ui';

import { OverflowMenu } from '@/components/OverflowMenu';
import { PeopleSkeleton } from '@/components/Skeletons';
import { ViewerButton } from '@/components/ViewerButton';
import { ZoomableGallery } from '@/components/ZoomableGallery';
import { ContactCard } from '@/components/person/ContactCard';
import { OwesCard } from '@/components/person/OwesCard';
import {
  GroupChip,
  HeroCircleButton,
  HERO_TEXT_SHADOW,
  NavRow,
  PairGroupCard,
  PairHero,
  PairSheet,
  PickGroupSheet,
} from '@/components/person/pairParts';
import { useBlockedUsers } from '@/data/blocked';
import { directionGroups } from '@/lib/friendsTotals';
import { fill, plural, useStrings } from '@/i18n';
import { useDialog } from '@/lib/dialog';
import { linkableGroups, linkMemberRoute } from '@/lib/linkMember';
import { router } from '@/lib/navigation';
import { usePairPerson, type PairGroupRow } from '@/lib/usePairPerson';
import { PersonAvatar } from '@/components/PersonAvatar';

/** Group chips shown under the name before the rest collapse into "+N". */
const MAX_CHIPS = 3;

export default function PersonDetailScreen() {
  const theme = useTheme();
  const clearance = useTabBarClearance();
  const { t, locale } = useStrings();
  const { confirm } = useDialog();
  const insets = useSafeAreaInsets();
  const { key, name } = useLocalSearchParams<{ key: string; name?: string }>();
  const [photoOpen, setPhotoOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pick, setPick] = useState<'group' | 'history' | 'link' | null>(null);

  const person = usePairPerson(key ?? '', name);
  const { profile, groups, totals, title, realName, masked, blocked, ready, photo } = person;
  const { block, unblock } = useBlockedUsers();

  // A person with an account can be blocked; the `person_key` in the route is
  // their profile id. A guest's key is not a profile id and nothing elsewhere
  // keys off it, so those are left un-blockable.
  const canBlock = person.isRealPerson && !profile?.is_you;

  const confirmBlock = async (): Promise<void> => {
    const ok = await confirm({
      title: fill(t.blocked.confirmTitle, { name: realName }),
      body: t.blocked.confirmBody,
      confirmLabel: t.blocked.action,
      tone: 'danger',
    });
    if (ok) block({ id: key ?? '', name: realName, avatarUrl: profile?.avatar_url ?? null });
  };

  const owingGroups = useMemo(() => groups.filter((group) => group.lines.length > 0), [groups]);
  // "Link to a Waves user": the groups where this placeholder can be linked.
  const linkable = useMemo(() => linkableGroups(groups), [groups]);
  const loading = person.loading;
  const empty = !loading && !profile && groups.length === 0;
  const groupCount = groups.length > 0 ? groups.length : (profile?.shared_groups ?? 0);
  const inviteGroupId = (owingGroups[0] ?? groups[0])?.groupId ?? null;
  const lead = directionGroups(totals)[0]?.head;

  const openSettle = (): void =>
    router.push(
      `/friends/person/${encodeURIComponent(key ?? '')}/settle?name=${encodeURIComponent(title)}`,
    );
  // History, "all groups" and linking live inside a group, so with one group
  // they go straight there and with several the person picks which.
  const goGroup = (group: PairGroupRow, to: 'group' | 'history' | 'link'): void =>
    router.push(
      to === 'group'
        ? `/group/${group.groupId}`
        : to === 'history'
          ? `/group/${group.groupId}/settle`
          : linkMemberRoute(group),
    );
  const via = (to: 'group' | 'history' | 'link'): void => {
    const list = to === 'link' ? linkable : groups;
    const [only] = list;
    if (list.length === 1 && only) goGroup(only, to);
    else setPick(to);
  };

  return (
    <Screen edges={[]}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: clearance }}
        showsVerticalScrollIndicator={false}
      >
        <PairHero>
          <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <HeroCircleButton
              icon="chevron-back"
              label={t.common.back}
              onPress={() => router.back()}
            />
            {canBlock ? (
              <HeroCircleButton
                icon="ellipsis-vertical"
                label={t.person.moreOptions}
                onPress={() => setMenuOpen(true)}
              />
            ) : null}
          </Row>
          <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
            <View>
              {/* Tapping the face opens it full-screen, as WhatsApp, Telegram and
                  Signal do — only when there is a photo to open. */}
              {photo ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t.person.viewPhoto}
                  onPress={() => setPhotoOpen(true)}
                  style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
                >
                  <PersonAvatar name={title} size={64} avatarUrl={photo} />
                </Pressable>
              ) : (
                <PersonAvatar
                  name={masked ? t.misc.someone : title}
                  size={64}
                  ghost={masked || Boolean(profile?.is_ghost) || person.unregistered}
                />
              )}
              {/* On Waves: a person with an account, and not somebody blocked
                  here. Guests added by name carry none. */}
              {person.isRealPerson && !masked ? (
                <View
                  accessibilityLabel={t.person.onWaves}
                  style={{
                    position: 'absolute',
                    end: 2,
                    bottom: 2,
                    width: 14,
                    height: 14,
                    borderRadius: 7,
                    backgroundColor: theme.color.positive,
                    borderWidth: 2,
                    borderColor: theme.color.surface,
                  }}
                />
              ) : null}
            </View>
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text
                variant="title"
                numberOfLines={1}
                style={{ color: '#FFFFFF', ...HERO_TEXT_SHADOW }}
              >
                {title}
                {profile?.is_you ? ` (${t.person.you})` : ''}
              </Text>
              {groupCount > 0 ? (
                <Text
                  variant="caption"
                  numberOfLines={1}
                  style={{ color: '#FFFFFF', ...HERO_TEXT_SHADOW }}
                >
                  {plural(locale, groupCount, t.person.sharedGroups)}
                </Text>
              ) : null}
            </View>
          </Row>
          {groups.length > 0 ? (
            <Row style={{ flexWrap: 'wrap', gap: theme.spacing.xs }}>
              {groups.slice(0, MAX_CHIPS).map((group) => (
                <GroupChip key={group.groupId} group={group} />
              ))}
              {groups.length > MAX_CHIPS ? (
                <View
                  style={{
                    height: 28,
                    paddingHorizontal: theme.spacing.sm,
                    borderRadius: theme.radius.pill,
                    backgroundColor: theme.color.surface,
                    justifyContent: 'center',
                  }}
                >
                  <Text variant="caption">{`+${groups.length - MAX_CHIPS}`}</Text>
                </View>
              ) : null}
            </Row>
          ) : null}
        </PairHero>

        <PairSheet>
          {loading ? (
            <PeopleSkeleton />
          ) : empty ? (
            // The server returns nothing for somebody you no longer share a group
            // with — the same answer it gives for a key that resolves to nobody,
            // deliberately, so this screen cannot be used to probe for people.
            <EmptyState
              title={t.person.notFound}
              body={t.person.notFoundBody}
              action={
                <Button label={t.retry} variant="secondary" onPress={() => person.refetch()} />
              }
            />
          ) : (
            <>
              {person.unregistered && !blocked && ready ? (
                <InvitePrompt
                  label={t.person.notOnWaves}
                  action={t.people.invite}
                  actionLabel={fill(t.person.inviteA11y, { name: realName })}
                  onInvite={
                    inviteGroupId ? () => router.push(`/group/${inviteGroupId}/invite`) : null
                  }
                />
              ) : null}

              {/* An admin says who the placeholder really is — the same door as
                  on the member page, reached from here because this is where a
                  person who is "not on Waves" is looked for. */}
              {person.unregistered && !blocked && ready && linkable.length > 0 ? (
                <Card
                  style={{ paddingVertical: theme.spacing.xs, paddingHorizontal: theme.spacing.md }}
                >
                  <NavRow
                    icon="link-outline"
                    title={t.link.row}
                    body={fill(t.link.rowHint, { name: realName })}
                    onPress={() => via('link')}
                  />
                </Card>
              ) : null}

              {profile && !profile.is_ghost && !blocked && ready ? (
                <ContactCard profile={profile} />
              ) : null}

              {totals.length > 0 ? (
                <OwesCard
                  name={realName}
                  totals={totals}
                  groups={groups}
                  canAct={!blocked && ready}
                  onSettle={openSettle}
                />
              ) : (
                // Square, not broken. Two different kinds, which must not share a
                // sentence: nothing outstanding anywhere, or an amount in one
                // group answered by the opposite amount in another.
                <Card style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
                  <Ionicons
                    name="checkmark-circle"
                    size={iconSize.xl}
                    color={theme.color.positive}
                  />
                  <Text style={{ flex: 1 }}>
                    {owingGroups.length > 0 ? t.person.squareOverall : t.allSettled}
                  </Text>
                </Card>
              )}

              {owingGroups.length > 0 ? (
                <Card style={{ gap: theme.spacing.sm, padding: theme.spacing.md }}>
                  <Row style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <Text variant="subheading">
                      {owingGroups.length === 1
                        ? t.tabs.inOneGroup
                        : t.tabs.acrossGroups.other.replace('{n}', String(owingGroups.length))}
                    </Text>
                    {owingGroups.length > 1 && lead ? (
                      <Row style={{ alignItems: 'baseline', gap: theme.spacing.xs }}>
                        <Text variant="caption" tone="muted">
                          {t.person.total}
                        </Text>
                        <MoneyText
                          amount={lead.net}
                          currency={lead.currency as CurrencyCode}
                          locale={locale}
                          variant="subheading"
                          mode="balance"
                          numberOfLines={1}
                        />
                      </Row>
                    ) : null}
                  </Row>
                  {owingGroups.map((group) => (
                    <PairGroupCard
                      key={group.groupId}
                      group={group}
                      onPress={() => router.push(`/group/${group.groupId}`)}
                    />
                  ))}
                </Card>
              ) : null}

              {groups.length > 0 ? (
                <Card
                  style={{ paddingVertical: theme.spacing.xs, paddingHorizontal: theme.spacing.md }}
                >
                  <NavRow
                    icon="stats-chart-outline"
                    title={t.person.paymentHistory}
                    body={fill(t.person.paymentHistoryBody, { name: realName })}
                    onPress={() => via('history')}
                  />
                  <Divider />
                  <NavRow
                    icon="people-outline"
                    title={t.person.viewAllGroups}
                    body={t.person.viewAllGroupsBody}
                    onPress={() => via('group')}
                  />
                </Card>
              ) : null}
            </>
          )}
        </PairSheet>
      </ScrollView>

      <PickGroupSheet
        visible={pick !== null}
        onClose={() => setPick(null)}
        groups={pick === 'link' ? linkable : groups}
        name={realName}
        body={
          pick === 'link'
            ? fill(t.link.pickGroupBody, { name: realName, n: String(linkable.length) })
            : undefined
        }
        onPick={(group) => {
          const to = pick ?? 'group';
          setPick(null);
          goGroup(group, to);
        }}
      />

      {menuOpen ? (
        <OverflowMenu
          visible
          onClose={() => setMenuOpen(false)}
          items={[
            blocked
              ? {
                  icon: 'person-add-outline',
                  label: t.blocked.unblock,
                  onPress: () => unblock(key ?? ''),
                }
              : {
                  icon: 'person-remove-outline',
                  label: t.blocked.action,
                  tone: 'danger',
                  onPress: () => void confirmBlock(),
                },
          ]}
        />
      ) : null}

      {/* The face, full-screen, on the same dark immersive viewer the receipts
          use. Mounted only while open, because a Modal that starts hidden never
          presents on Android. */}
      {photoOpen && photo ? (
        <Modal
          supportedOrientations={MODAL_ORIENTATIONS}
          visible
          animationType="fade"
          onRequestClose={() => setPhotoOpen(false)}
        >
          {/* A Modal is its own native root on Android: without this, pinch and pan never reach the image. */}
          <GestureHandlerRootView style={{ flex: 1 }}>
            <View style={{ flex: 1, backgroundColor: '#000' }}>
              <StatusBar barStyle="light-content" />
              <ZoomableGallery pages={[{ url: photo }]} index={0} onIndexChange={() => {}} />
              <Row
                style={{
                  position: 'absolute',
                  top: insets.top + theme.spacing.sm,
                  left: theme.spacing.xl,
                  right: theme.spacing.xl,
                  gap: theme.spacing.md,
                  alignItems: 'center',
                }}
              >
                <ViewerButton
                  icon="close"
                  label={t.common.close}
                  onPress={() => setPhotoOpen(false)}
                />
                <Text variant="subheading" numberOfLines={1} style={{ flex: 1, color: '#FFFFFF' }}>
                  {title}
                </Text>
              </Row>
            </View>
          </GestureHandlerRootView>
        </Modal>
      ) : null}
    </Screen>
  );
}

/**
 * One line for somebody without an account. Says the one thing that is true —
 * they are not on Waves — and offers the way to change it. Reminding them is not
 * its job: that is Remind on the card below, the same channel sheet everywhere.
 */
function InvitePrompt({
  label,
  action,
  actionLabel,
  onInvite,
}: {
  label: string;
  action: string;
  actionLabel: string;
  /** Null when no group is known to invite them to: the line is then only a fact. */
  onInvite: (() => void) | null;
}) {
  const theme = useTheme();
  return (
    <Row
      style={{
        alignItems: 'center',
        gap: theme.spacing.sm,
        paddingHorizontal: theme.spacing.md,
        minHeight: 44,
        borderRadius: theme.radius.pill,
        backgroundColor: theme.color.surfaceMuted,
      }}
    >
      <Ionicons name="person-add-outline" size={iconSize.md} color={theme.color.brand} />
      <Text variant="caption" tone="muted" style={{ flex: 1 }} numberOfLines={2}>
        {label}
      </Text>
      {onInvite ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          onPress={onInvite}
          hitSlop={8}
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
        >
          <Text variant="caption" tone="brand" style={{ fontWeight: '700' }}>
            {action}
          </Text>
        </Pressable>
      ) : null}
    </Row>
  );
}
