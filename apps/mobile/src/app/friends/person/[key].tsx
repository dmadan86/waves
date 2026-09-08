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
import { router, useLocalSearchParams } from 'expo-router';
import { Alert, Linking, Pressable, ScrollView, View } from 'react-native';

import {
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
import { ProfileAvatar } from '@/components/ProfileAvatar';
import { PeopleSkeleton } from '@/components/Skeletons';
import { fill, plural, useStrings } from '@/i18n';

/** A person's balance in one group: the group, and one net per currency in it. */
interface GroupBlock {
  groupId: string;
  groupName: string | null;
  coverEmoji: string | null;
  lines: PersonGroupBalanceRow[];
}

export default function PersonDetailScreen() {
  const theme = useTheme();
  const clearance = useTabBarClearance();
  const { t, locale } = useStrings();
  const { key, name } = useLocalSearchParams<{ key: string; name?: string }>();

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

  const confirmBlock = (): void => {
    Alert.alert(fill(t.blocked.confirmTitle, { name: realName }), t.blocked.confirmBody, [
      { text: t.common.cancel, style: 'cancel' },
      {
        text: t.blocked.action,
        style: 'destructive',
        onPress: () => block({ id: key, name: realName, avatarUrl: profile?.avatar_url ?? null }),
      },
    ]);
  };

  // One block per group (a group can carry two currencies), and the per-currency
  // total across all of them — the figure the Friends list showed, restated here
  // with the groups it was summed from underneath it.
  const { groups, totals } = useMemo(() => {
    const byGroup = new Map<string, GroupBlock>();
    const byCurrency = new Map<string, bigint>();
    for (const row of rows) {
      const block = byGroup.get(row.group_id) ?? {
        groupId: row.group_id,
        groupName: row.group_name,
        coverEmoji: row.cover_emoji,
        lines: [],
      };
      block.lines.push(row);
      byGroup.set(row.group_id, block);
      byCurrency.set(row.currency, (byCurrency.get(row.currency) ?? 0n) + BigInt(row.net));
    }
    return { groups: [...byGroup.values()], totals: [...byCurrency.entries()] };
  }, [rows]);

  const loading = who.isLoading || person.isLoading;
  const failed = who.isError && person.isError;

  return (
    <Screen>
      <Row style={{ paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.md }}>
        <IconButton label={t.common.back} onPress={() => router.back()}>
          <Ionicons
            name={directionalIcon('chevron-back')}
            size={iconSize.lg}
            color={theme.color.text}
          />
        </IconButton>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text variant="heading" numberOfLines={1}>
            {title}
          </Text>
        </View>
        {isRealPerson && !profile?.is_you ? (
          <IconButton
            label={blocked ? t.blocked.unblock : t.blocked.action}
            onPress={blocked ? () => unblock(key) : confirmBlock}
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
            {profile ? (
              <IdentityCard profile={profile} masked={!ready || blocked} name={title} />
            ) : null}

            {profile && !blocked && ready ? <ContactCard profile={profile} /> : null}

            {totals.length > 0 ? (
              <Card style={{ gap: theme.spacing.md }}>
                {totals.map(([currency, net]) => (
                  <Row key={currency} style={{ justifyContent: 'space-between' }}>
                    <Text variant="subheading" tone="muted">
                      {net > 0n ? t.tabs.owesYou : t.tabs.youOweThem}
                    </Text>
                    <MoneyText
                      amount={net}
                      currency={currency}
                      locale={locale}
                      variant="heading"
                      mode="balance"
                    />
                  </Row>
                ))}
              </Card>
            ) : (
              // Square, not broken — and now the person is still here to say so
              // to, which is the whole reason identity got its own call.
              <Card>
                <Text tone="muted">{t.allSettled}</Text>
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
                  {groups.map((group, index) => (
                    <View key={group.groupId}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={group.groupName ?? undefined}
                        onPress={() => router.push(`/group/${group.groupId}`)}
                        style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
                      >
                        <Row style={{ paddingVertical: theme.spacing.sm, alignItems: 'center' }}>
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
                          <View style={{ alignItems: 'flex-end', gap: 2 }}>
                            {group.lines.map((line) => (
                              <MoneyText
                                key={line.currency}
                                amount={BigInt(line.net)}
                                currency={line.currency}
                                locale={locale}
                                variant="subheading"
                                mode="balance"
                              />
                            ))}
                          </View>
                          <Ionicons
                            name={directionalIcon('chevron-forward')}
                            size={iconSize.md}
                            color={theme.color.textFaint}
                            style={{ marginLeft: theme.spacing.sm }}
                          />
                        </Row>
                      </Pressable>
                      {index < groups.length - 1 ? <Divider /> : null}
                    </View>
                  ))}
                </Card>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

/** Face, name, and the one fact that says how you know them. */
function IdentityCard({
  profile,
  masked,
  name,
}: {
  profile: PersonProfileRow;
  masked: boolean;
  name: string;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();

  return (
    <View style={{ alignItems: 'center', gap: theme.spacing.sm }}>
      {/* A blocked person keeps the app's ghost avatar here as everywhere else:
          the point of a block is that you stop seeing who they are. */}
      <ProfileAvatar
        name={masked ? t.misc.someone : name}
        avatarUrl={masked ? null : profile.avatar_url}
      />
      <Row style={{ gap: theme.spacing.sm, alignItems: 'center' }}>
        <Text variant="heading" numberOfLines={1}>
          {masked ? t.misc.someone : name}
        </Text>
        {profile.is_you ? <Badge label={t.person.you} /> : null}
      </Row>
      <Text variant="caption" tone="muted">
        {plural(locale, profile.shared_groups, t.person.sharedGroups).replace(
          '{n}',
          String(profile.shared_groups),
        )}
      </Text>
    </View>
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
