/**
 * One person: who they are, and what stands between you across every group.
 *
 * The Friends list rolls a person up into a single balance. When that person is
 * in more than one group the sum has no single group to open, so the row there
 * used to be a dead end. This is where it goes instead.
 *
 * It used to be *only* that — a balance, split back out per group. Two problems
 * came with that. The first is that `waves_person_group_balances` ends in
 * `HAVING sum(n.net) <> 0`, so the moment a person settles up they vanish from
 * their own screen; the balance is not the person. The second is that nothing
 * here ever said who this actually was: two people called Priya in two groups
 * were two identical rows and two identical screens.
 *
 * So identity comes from its own call (`waves_person_profile`), which survives
 * being square, and the balance is one section inside it rather than the whole
 * page. The contact details on that call are not ours: the server sends them
 * only when the person has said group-mates may see them, and the screen is
 * careful to distinguish "they have not told us" from "they have told us not to
 * tell you" — a vague sentence covering both would be the sort of hedge that
 * makes people assume the worse one.
 *
 * A person blocked on this device is shown as the app's anonymous ghost
 * everywhere, and that has to include here: no avatar, no number, no address,
 * whatever the server was willing to send.
 */
import { useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams } from 'expo-router';
import { Linking, Modal, Pressable, ScrollView, StatusBar, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Avatar,
  Badge,
  Button,
  Card,
  Divider,
  directionalIcon,
  EmptyState,
  IconButton,
  iconSize,
  MoneyText,
  Row,
  Screen,
  SectionHeader,
  Text,
  useTabBarClearance,
  useTheme,
} from '@waves/ui';

import {
  fetchPersonGroupBalances,
  fetchPersonProfile,
  type PersonGroupBalanceRow,
  type PersonProfileRow,
} from '@/data/api';
import { useBlockedUsers } from '@/data/blocked';
import { useAvatarUrl } from '@/components/ProfileAvatar';
import { PeopleSkeleton } from '@/components/Skeletons';
import { ViewerButton } from '@/components/ViewerButton';
import { ZoomableGallery } from '@/components/ZoomableGallery';
import { currencyTotals, directionGroups, type CurrencyTotal } from '@/lib/friendsTotals';
import { personAvatarPath } from '@/lib/personDetail';
import { fill, plural, useStrings } from '@/i18n';
import { router } from '@/lib/navigation';
import { useDialog } from '@/lib/dialog';

/**
 * A person's balance in one group: the group, and one net per currency in it,
 * biggest first so the row's lead figure is the one that matters.
 */
interface GroupBlock {
  groupId: string;
  groupName: string | null;
  coverEmoji: string | null;
  lines: CurrencyTotal[];
}

export default function PersonDetailScreen() {
  const theme = useTheme();
  const clearance = useTabBarClearance();
  const { t, locale } = useStrings();
  const { confirm } = useDialog();
  const insets = useSafeAreaInsets();
  const { key, name } = useLocalSearchParams<{ key: string; name?: string }>();
  const [photoOpen, setPhotoOpen] = useState(false);

  const who = useQuery({
    queryKey: ['person', key, 'profile'],
    queryFn: () => fetchPersonProfile(key),
    enabled: Boolean(key),
  });

  const person = useQuery({
    queryKey: ['person', key, 'groups'],
    queryFn: () => fetchPersonGroupBalances(key),
    enabled: Boolean(key),
  });

  const rows = useMemo(() => person.data ?? [], [person.data]);
  const profile = who.data ?? null;

  // Only a person with an account can be blocked, and for one the `person_key`
  // in the route *is* their profile id (the list keys them on it), so `key` is
  // the block key. A ghost or a merged-ghost person_key is not a profile id and
  // nothing elsewhere keys off it, so those are left un-blockable.
  const { isBlocked, block, unblock, ready } = useBlockedUsers();
  const isRealPerson = profile ? !profile.is_ghost : rows.some((row) => !row.is_ghost);
  // Independent of `isRealPerson`: a ghost's key is never in the block set, so
  // this stays false for one regardless — and asking directly means a block is
  // honoured before the rest has loaded, not only after.
  const blocked = isBlocked(key);
  const realName =
    profile?.display_name ??
    rows.find((row) => !row.is_ghost)?.display_name ??
    name ??
    t.misc.someone;
  // Until the block store has hydrated we cannot know whether this person is
  // blocked, so show the generic label rather than risk flashing a real name
  // that a block would have masked.
  const title =
    !ready || blocked
      ? t.misc.someone
      : (profile?.display_name ?? name ?? rows[0]?.display_name ?? '');

  const confirmBlock = async (): Promise<void> => {
    const ok = await confirm({
      title: fill(t.blocked.confirmTitle, { name: realName }),
      body: t.blocked.confirmBody,
      confirmLabel: t.blocked.action,
      tone: 'danger',
    });
    if (ok) block({ id: key, name: realName, avatarUrl: profile?.avatar_url ?? null });
  };

  // One block per group (a group can carry two currencies), and the per-currency
  // total across all of them — the figure the Friends list showed, restated here
  // with the groups it was summed from underneath it.
  //
  // Both go through `currencyTotals`, which is the same arithmetic the Friends
  // list uses and brings two things this screen was doing without: an order (the
  // biggest figure leads, rather than whatever the server's `ORDER BY currency`
  // happened to put first), and no zeroes. The rows arrive non-zero *per group*,
  // so a person you are owed ₹500 by on a trip and owe ₹500 to at home netted to
  // nothing across the two — and the headline announced "Owes you ₹0".
  const { groups, totals } = useMemo(() => {
    const byGroup = new Map<string, PersonGroupBalanceRow[]>();
    for (const row of rows) {
      const lines = byGroup.get(row.group_id) ?? [];
      lines.push(row);
      byGroup.set(row.group_id, lines);
    }
    return {
      groups: [...byGroup.values()].flatMap<GroupBlock>((lines) => {
        const head = lines[0];
        if (!head) return [];
        return [
          {
            groupId: head.group_id,
            groupName: head.group_name,
            coverEmoji: head.cover_emoji,
            lines: currencyTotals(lines),
          },
        ];
      }),
      totals: currencyTotals(rows),
    };
  }, [rows]);

  const loading = who.isLoading || person.isLoading;
  const failed = who.isError && person.isError;

  // A blocked person is the app's anonymous ghost everywhere, so their photo is
  // never even signed for — not merely hidden once it has been fetched.
  const masked = !ready || blocked;
  const photo = useAvatarUrl(personAvatarPath(profile, masked));

  return (
    <Screen>
      {/* The bar carries the face and the name, the way WhatsApp's contact info
          and this app's own dashboard greeting do. The name used to be said
          twice — centred here, then again under a portrait in the card below —
          and between them they cost the first screenful before a single balance
          appeared. One title, at the top, with the person's face in it. */}
      <Row
        style={{
          paddingHorizontal: theme.spacing.xl,
          paddingTop: theme.spacing.md,
          gap: theme.spacing.sm,
          alignItems: 'center',
        }}
      >
        <IconButton label={t.common.back} onPress={() => router.back()}>
          <Ionicons
            name={directionalIcon('chevron-back')}
            size={iconSize.lg}
            color={theme.color.text}
          />
        </IconButton>
        {/* Tapping the face opens it full-screen, as it does in WhatsApp,
            Telegram and Signal. Only when there is something to open: a set of
            initials enlarged to fill a black screen is a tap that punishes
            curiosity. */}
        {photo ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.person.viewPhoto}
            onPress={() => setPhotoOpen(true)}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
          >
            <Avatar name={title} size={40} photoUrl={photo} />
          </Pressable>
        ) : (
          // Somebody who has not joined wears the ghost mark here too, as they
          // do in the Friends list and on a group's balances.
          <Avatar
            name={masked ? t.misc.someone : title}
            size={40}
            ghost={masked || Boolean(profile?.is_ghost)}
          />
        )}
        <View style={{ flex: 1 }}>
          <Row style={{ gap: theme.spacing.sm, alignItems: 'center' }}>
            <Text variant="heading" numberOfLines={1} style={{ flexShrink: 1 }}>
              {title}
            </Text>
            {profile?.is_you ? <Badge label={t.person.you} /> : null}
          </Row>
          {profile ? (
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {plural(locale, profile.shared_groups, t.person.sharedGroups).replace(
                '{n}',
                String(profile.shared_groups),
              )}
            </Text>
          ) : null}
        </View>
        {isRealPerson && !profile?.is_you ? (
          <IconButton
            label={blocked ? t.blocked.unblock : t.blocked.action}
            onPress={blocked ? () => unblock(key) : () => void confirmBlock()}
          >
            <Ionicons
              name={blocked ? 'person-add-outline' : 'person-remove-outline'}
              size={iconSize.md}
              color={blocked ? theme.color.brand : theme.color.negative}
            />
          </IconButton>
        ) : (
          <View style={{ width: 44 }} />
        )}
      </Row>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.xl,
          paddingTop: theme.spacing.lg,
          paddingBottom: clearance,
          gap: theme.spacing.xl,
        }}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <PeopleSkeleton />
        ) : failed ? (
          <EmptyState
            title={t.loadError}
            body={t.loadErrorBody}
            action={
              <Button
                label={t.retry}
                variant="secondary"
                onPress={() => {
                  void who.refetch();
                  void person.refetch();
                }}
              />
            }
          />
        ) : !profile && rows.length === 0 ? (
          // The server returns nothing for somebody you no longer share a group
          // with — the same answer it gives for a key that resolves to nobody,
          // deliberately, so this screen cannot be used to probe for people.
          <EmptyState title={t.person.notFound} body={t.person.notFoundBody} />
        ) : (
          <>
            {profile && !blocked && ready ? <ContactCard profile={profile} /> : null}

            {totals.length > 0 ? (
              // Each direction said once, however many currencies it holds —
              // the rule the dashboard headline and the Friends hero already
              // follow. One row per currency meant reading "Owes you" three
              // times down a card whose whole job is to state two facts.
              <Card style={{ gap: theme.spacing.md }}>
                {directionGroups(totals).map((group) => (
                  <View key={group.owed ? 'owed' : 'owing'} style={{ gap: 2 }}>
                    <Row
                      style={{
                        justifyContent: 'space-between',
                        // Baseline, not centre: the label is body-sized and the
                        // amount is a heading, so it is the line the eye reads
                        // across that has to match, not the boxes' middles.
                        alignItems: 'baseline',
                        gap: theme.spacing.md,
                      }}
                    >
                      <Text variant="subheading" tone="muted">
                        {group.owed ? t.tabs.owesYou : t.tabs.youOweThem}
                      </Text>
                      <MoneyText
                        amount={group.head.net}
                        currency={group.head.currency}
                        locale={locale}
                        variant="heading"
                        mode="balance"
                        numberOfLines={1}
                      />
                    </Row>
                    {group.rest.length > 0 ? (
                      // The same direction's other currencies, small and under
                      // the figure they belong to. Wrapped, not clipped: six
                      // currencies costs a second line here, not six headlines.
                      <Row
                        style={{
                          justifyContent: 'flex-end',
                          flexWrap: 'wrap',
                          columnGap: theme.spacing.sm,
                        }}
                      >
                        {group.rest.map((total) => (
                          <MoneyText
                            key={total.currency}
                            amount={total.net}
                            currency={total.currency}
                            locale={locale}
                            variant="caption"
                            mode="balance"
                            numberOfLines={1}
                          />
                        ))}
                      </Row>
                    ) : null}
                  </View>
                ))}
              </Card>
            ) : (
              // Square, not broken — and now the person is still here to say so
              // to, which is the whole reason identity got its own call.
              //
              // Two different kinds of square, and they must not share a
              // sentence: nothing outstanding anywhere, or an amount in one
              // group answered by the opposite amount in another. "All settled"
              // over a list of live figures reads as a contradiction, and the
              // person checking is checking precisely because they can see one.
              <Card>
                <Text tone="muted">
                  {groups.length > 0 ? t.person.squareOverall : t.allSettled}
                </Text>
              </Card>
            )}

            {groups.length > 0 ? (
              <View style={{ gap: theme.spacing.md }}>
                <SectionHeader
                  title={
                    groups.length === 1
                      ? t.tabs.inOneGroup
                      : t.tabs.acrossGroups.other.replace('{n}', String(groups.length))
                  }
                />
                <Card padded={false} style={{ paddingHorizontal: theme.spacing.lg }}>
                  {groups.map((group, index) => {
                    // The group's biggest figure leads on the row's own line,
                    // level with its name and its emoji; anything else it holds
                    // hangs underneath. Stacking every currency inside the row
                    // instead centred the name against the middle of the stack,
                    // so a two-currency group read with its name beside the
                    // second amount and its emoji beside neither.
                    const [head, ...rest] = group.lines;
                    return (
                      <View key={group.groupId}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={group.groupName ?? undefined}
                          onPress={() => router.push(`/group/${group.groupId}`)}
                          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
                        >
                          <Row
                            style={{
                              paddingTop: theme.spacing.sm,
                              // The row's own bottom padding, unless the extra
                              // currencies below are carrying it. Said here
                              // rather than left to an empty wrapper: a group
                              // holding one currency used to render a `Row` with
                              // no children whose only job was its padding, and
                              // padding is not a thing to express as a component.
                              paddingBottom: rest.length > 0 ? 0 : theme.spacing.sm,
                              alignItems: 'center',
                            }}
                          >
                            <View
                              style={{
                                width: 44,
                                height: 44,
                                borderRadius: theme.radius.pill,
                                backgroundColor: theme.color.surfaceMuted,
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                            >
                              <Text style={{ fontSize: 22 }}>{group.coverEmoji ?? '👥'}</Text>
                            </View>
                            <Text
                              variant="subheading"
                              numberOfLines={1}
                              style={{ flex: 1, marginHorizontal: theme.spacing.md }}
                            >
                              {group.groupName ?? t.tabs.group}
                            </Text>
                            {/* Capped and clipped: a long figure in a wide
                                currency must not wrap and grow the row, which
                                is the same thing that broke the Friends list. */}
                            {head ? (
                              <View style={{ alignItems: 'flex-end', maxWidth: '42%' }}>
                                <MoneyText
                                  amount={head.net}
                                  currency={head.currency}
                                  locale={locale}
                                  variant="subheading"
                                  mode="balance"
                                  numberOfLines={1}
                                  ellipsizeMode="tail"
                                />
                              </View>
                            ) : null}
                            <Ionicons
                              name={directionalIcon('chevron-forward')}
                              size={iconSize.md}
                              color={theme.color.textFaint}
                              style={{ marginLeft: theme.spacing.sm }}
                            />
                          </Row>
                          {rest.length > 0 ? (
                            <Row
                              style={{
                                justifyContent: 'flex-end',
                                flexWrap: 'wrap',
                                columnGap: theme.spacing.sm,
                                paddingBottom: theme.spacing.sm,
                                // Clear of the chevron column, so the small
                                // figures end where the big one above them does.
                                paddingEnd: iconSize.md + theme.spacing.sm,
                              }}
                            >
                              {rest.map((line) => (
                                <MoneyText
                                  key={line.currency}
                                  amount={line.net}
                                  currency={line.currency}
                                  locale={locale}
                                  variant="caption"
                                  mode="balance"
                                  numberOfLines={1}
                                />
                              ))}
                            </Row>
                          ) : null}
                        </Pressable>
                        {index < groups.length - 1 ? <Divider /> : null}
                      </View>
                    );
                  })}
                </Card>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>

      {/* The face, full-screen: the gesture WhatsApp, Telegram and Signal all
          answer, on the same dark immersive viewer the receipts already use — so
          pinch-zoom, the floating close button and the black backdrop behave
          identically wherever a picture opens in this app. Mounted only while
          open, because a Modal that starts hidden never presents on Android. */}
      {photoOpen && photo ? (
        <Modal visible animationType="fade" onRequestClose={() => setPhotoOpen(false)}>
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
              {/* Whose face it is, over the picture — the one thing the viewer
                  has to say, and the reason the bar is not just a close button. */}
              <Text variant="subheading" numberOfLines={1} style={{ flex: 1, color: '#FFFFFF' }}>
                {title}
              </Text>
            </Row>
          </View>
        </Modal>
      ) : null}
    </Screen>
  );
}

/**
 * Contact, or the honest reason there is none.
 *
 * Three different silences, and they are not interchangeable: a ghost has no
 * account at all, an account can be holding nothing, and an account can be
 * holding something its owner has asked us not to pass on. The third is the
 * only one that is a decision, and saying so is what makes the setting on the
 * other side of it worth having.
 */
function ContactCard({ profile }: { profile: PersonProfileRow }) {
  const theme = useTheme();
  const { t } = useStrings();
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (value: string): Promise<void> => {
    await Clipboard.setStringAsync(value);
    setCopied(value);
  };

  if (profile.is_ghost) {
    return (
      <Card>
        <Text tone="muted">{t.person.ghostContact}</Text>
      </Card>
    );
  }

  if (profile.contact_withheld) {
    return (
      <Card>
        <Text tone="muted">{fill(t.person.contactWithheld, { name: profile.display_name })}</Text>
      </Card>
    );
  }

  const hasContact = Boolean(profile.phone || profile.email || profile.payment_handle);
  if (!hasContact) {
    return (
      <Card>
        <Text tone="muted">{t.person.noContact}</Text>
      </Card>
    );
  }

  return (
    <View style={{ gap: theme.spacing.md }}>
      <SectionHeader title={t.person.contact} />
      <Card style={{ gap: theme.spacing.md }}>
        {profile.phone ? (
          <ContactLine
            label={t.person.phone}
            value={profile.phone}
            copied={copied === profile.phone}
            onCopy={() => void copy(profile.phone as string)}
            actionIcon="call-outline"
            actionLabel={t.person.call}
            onAction={() => void Linking.openURL(`tel:${profile.phone as string}`)}
          />
        ) : null}
        {profile.phone && profile.email ? <Divider /> : null}
        {profile.email ? (
          <ContactLine
            label={t.person.email}
            value={profile.email}
            copied={copied === profile.email}
            onCopy={() => void copy(profile.email as string)}
            actionIcon="mail-outline"
            actionLabel={t.person.message}
            onAction={() => void Linking.openURL(`mailto:${profile.email as string}`)}
          />
        ) : null}
        {profile.payment_handle ? (
          <>
            <Divider />
            <ContactLine
              label={t.person.paidVia}
              value={profile.payment_handle}
              copied={copied === profile.payment_handle}
              onCopy={() => void copy(profile.payment_handle as string)}
            />
          </>
        ) : null}
      </Card>
    </View>
  );
}

function ContactLine({
  label,
  value,
  copied,
  onCopy,
  actionIcon,
  actionLabel,
  onAction,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
  actionIcon?: 'call-outline' | 'mail-outline';
  actionLabel?: string;
  onAction?: () => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();

  return (
    <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="caption" tone="muted">
          {label}
        </Text>
        {/* A phone number is Latin digits inside whatever script the rest of the
            screen is in, so it is isolated the way every other number in this
            app is — otherwise a leading '+' walks to the wrong end in Arabic. */}
        <Text numberOfLines={1} style={{ writingDirection: 'ltr' }}>
          {value}
        </Text>
      </View>
      <IconButton label={copied ? t.person.copied : t.person.copy} onPress={onCopy}>
        <Ionicons
          name={copied ? 'checkmark' : 'copy-outline'}
          size={iconSize.md}
          color={copied ? theme.color.positive : theme.color.textMuted}
        />
      </IconButton>
      {actionIcon && onAction ? (
        <IconButton label={actionLabel ?? ''} onPress={onAction}>
          <Ionicons name={actionIcon} size={iconSize.md} color={theme.color.brand} />
        </IconButton>
      ) : null}
    </Row>
  );
}
