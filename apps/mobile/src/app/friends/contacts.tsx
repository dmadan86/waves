/**
 * Browsing the phone's address book to add somebody to a group.
 *
 * The address book never leaves the device — `ContactPicker` reads it, searches
 * it and shows it locally, and only the people ticked are sent anywhere.
 * There is deliberately no "which of my contacts already use Waves" here: that
 * feature requires uploading the whole book, and it turns an address book into
 * a membership oracle for anybody who later reaches the server (ADR-006).
 *
 * A person in Waves always belongs to a group, because a debt is between people
 * *about something*. So picking contacts asks the one question that has to be
 * answered — which group — rather than inventing floating "friends" that owe
 * nobody anything. The whole lot goes into one group: picking six people for a
 * trip and then answering "which group?" six times is the same answer six
 * times.
 *
 * What the screen adds to the bare picker is memory. It knows who you have
 * already written down — every ghost in every group you are in — so a contact
 * you added last summer says where they already are instead of looking new, and
 * the group step will not write them into the same group a second time. That
 * knowledge is assembled on this device from the local mirror; the address book
 * still goes nowhere.
 */

import { useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ActivityIndicator, ScrollView, View } from 'react-native';

import {
  Avatar,
  AvatarStack,
  Button,
  Callout,
  Card,
  directionalIcon,
  Divider,
  IconButton,
  iconSize,
  ListRow,
  Row,
  Screen,
  SectionHeader,
  Text,
  useTabBarClearance,
  useTheme,
} from '@waves/ui';

import { fill, plural, useStrings } from '@/i18n';
import { friendlyError } from '@/lib/errors';
import { sameAddress } from '@/lib/contactMatch';

import { ContactPicker, type PickedContact } from '@/components/ContactPicker';
import { addGhostMember } from '@/data/api';
import { useGroups } from '@/data/hooks';
import { useKnownContacts } from '@/data/knownContacts';
import { groupLabel, type MemberRow } from '@/data/types';

export default function ContactsScreen(): React.JSX.Element {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const queryClient = useQueryClient();

  const [picked, setPicked] = useState<readonly PickedContact[]>([]);
  const [added, setAdded] = useState<number | null>(null);
  const [skipped, setSkipped] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Read off the mirror rather than the wire (ADR-005). The group list was a
  // network query, which meant the last step of this screen — "which group?" —
  // was the one part of it that needed signal, on the screen most likely to be
  // used on a trip.
  const groups = useGroups();
  const { index: known, membersByGroup } = useKnownContacts();

  /**
   * How many of the people picked are already in each group.
   *
   * Computed for every group at once so the "which group?" step can say it on
   * each row before anything is written, rather than making somebody pick a
   * group to find out. Matching is by address (`sameAddress`), not by name: two
   * flatmates called Ravi are two members, and a name test would silently
   * refuse to add the second one.
   */
  const alreadyIn = useMemo(() => {
    const counts = new Map<string, number>();
    for (const group of groups.data) {
      const members = membersByGroup.get(group.id) ?? [];
      counts.set(group.id, picked.filter((contact) => isMember(members, contact)).length);
    }
    return counts;
  }, [groups.data, membersByGroup, picked]);

  /**
   * Everybody picked, into the one group, one call each.
   *
   * Anyone already in that group is skipped rather than written again: the
   * server would happily make a second ghost with the same number, and the
   * group would end up owing money to two copies of one person — a mess the
   * merge screen exists to clean up, and one worth not making in the first
   * place.
   *
   * A failure part-way leaves the earlier ones added, and says whose name did
   * not make it. Adding five people is five separate acts, not a transaction:
   * throwing away four good ones because the fifth had a number the server
   * would not take is a worse answer than telling you about the fifth.
   */
  const add = useMutation({
    mutationFn: async ({
      groupId,
      contacts,
    }: {
      groupId: string;
      contacts: readonly PickedContact[];
    }) => {
      const members = membersByGroup.get(groupId) ?? [];
      const fresh = contacts.filter((contact) => !isMember(members, contact));
      const failed: string[] = [];
      for (const contact of fresh) {
        try {
          await addGhostMember(groupId, contact.name, {
            email: contact.email,
            phone: contact.phone,
          });
        } catch (caught) {
          failed.push(contact.name);
          // Report each real failure for its side effect (the raw server message
          // goes to Sentry); its return is discarded — the user is not shown a
          // transport error, but whose names did not make it, below.
          friendlyError(caught, t.misc.couldNotAddGeneric, 'contacts.add');
        }
      }
      // A partial failure is a normal outcome, not an exception: the names that
      // did not make it ride back in the result, so nothing raw is thrown and
      // onError is left for a genuine transport failure of the whole call.
      return {
        added: fresh.length - failed.length,
        skipped: contacts.length - fresh.length,
        failed,
      };
    },
    onSuccess: async ({ added, skipped, failed }, { groupId }) => {
      // Only announce a count when at least one landed; on a total failure the
      // error below carries the whole story.
      setAdded(added > 0 ? added : null);
      setSkipped(skipped);
      setPicked([]);
      setError(failed.length > 0 ? fill(t.misc.couldNotAdd, { names: failed.join(', ') }) : null);
      await queryClient.invalidateQueries({ queryKey: ['members', groupId] });
      await queryClient.invalidateQueries({ queryKey: ['people', 'balances'] });
    },
    onError: (caught: unknown) => {
      // Reached only when the whole operation fails unexpectedly — a raw
      // transport or server error — so friendlyError with the generic fallback
      // is exactly right here (per-contact failures are handled in the loop).
      setError(friendlyError(caught, t.misc.couldNotAddGeneric, 'contacts.add'));
    },
  });

  return (
    // The picker anchors a button to the bottom of the screen, so this one has
    // to hold the bottom inset too. Without it the button lands under the
    // navigation bar — invisible on a phone with three buttons rather than a
    // gesture pill, which is the case an emulator does not show you.
    <Screen edges={['top', 'bottom']}>
      <View
        style={{
          flex: 1,
          paddingHorizontal: theme.spacing.xl,
          paddingBottom: theme.spacing.md,
          gap: theme.spacing.lg,
        }}
      >
        <Row style={{ paddingTop: theme.spacing.md }}>
          <IconButton label={t.common.back} onPress={() => router.back()}>
            <Ionicons
              name={directionalIcon('chevron-back')}
              size={iconSize.lg}
              color={theme.color.text}
            />
          </IconButton>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text variant="heading">{t.misc.fromYourContacts}</Text>
          </View>
          <View style={{ width: 44 }} />
        </Row>

        {picked.length > 0 ? (
          <ChooseGroup
            contacts={picked}
            groups={groups.data}
            alreadyIn={alreadyIn}
            busy={add.isPending}
            error={error}
            onCancel={() => {
              setPicked([]);
              setError(null);
            }}
            onChoose={(groupId) => add.mutate({ groupId, contacts: picked })}
          />
        ) : (
          <>
            {/* Also shown when nothing was added but somebody was skipped:
                ticking five people and being told nothing at all is the outcome
                that reads as a failure when it was in fact a no-op. */}
            {added !== null || skipped > 0 ? (
              <Card style={{ backgroundColor: theme.color.buttonPrimary }}>
                <Row style={{ gap: theme.spacing.sm }}>
                  <Ionicons
                    name="checkmark-circle"
                    size={iconSize.lg}
                    color={theme.color.onBrand}
                  />
                  <Text variant="caption" tone="onBrand" style={{ flex: 1 }}>
                    {added !== null
                      ? fill(t.misc.contactsAdded, {
                          count: plural(locale, added, t.misc.peopleCount),
                        })
                      : ''}
                    {/* Somebody who ticked five and sees "3 people added" is owed
                        the other two, or the count reads as a bug. */}
                    {skipped > 0
                      ? `${added !== null ? ' ' : ''}${plural(locale, skipped, t.misc.alreadyThereSkipped)}`
                      : ''}
                  </Text>
                </Row>
              </Card>
            ) : null}
            <ContactPicker
              onConfirm={setPicked}
              confirmVerb={t.misc.continueWith}
              known={known}
              // The person who is not in the address book at all. Waves already
              // has a screen that takes a typed name and makes the one-to-one
              // group behind it, so this points at that rather than growing a
              // second way to invent a person.
              escape={{
                label: t.misc.someoneNotInContacts,
                onPress: () => router.push('/friends/add-person' as never),
              }}
            />
          </>
        )}
      </View>
    </Screen>
  );
}

/**
 * Which group this person joins.
 *
 * Groups only — no "add without a group" — because a member with no group has
 * nothing to owe or be owed, and would sit in the app looking like a mistake.
 */
function ChooseGroup({
  contacts,
  groups,
  alreadyIn,
  busy,
  error,
  onCancel,
  onChoose,
}: {
  contacts: readonly PickedContact[];
  groups: readonly { id: string; name: string | null; cover_emoji: string | null }[];
  /** How many of `contacts` each group already holds, keyed by group id. */
  alreadyIn: ReadonlyMap<string, number>;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onChoose: (groupId: string) => void;
}): React.JSX.Element {
  const theme = useTheme();
  const clearance = useTabBarClearance();
  const { t, locale } = useStrings();
  const only = contacts.length === 1 ? contacts[0] : undefined;

  return (
    <ScrollView
      contentContainerStyle={{ paddingBottom: clearance, gap: theme.spacing.lg }}
      showsVerticalScrollIndicator={false}
    >
      <Card style={{ gap: theme.spacing.xs }}>
        <Row style={{ gap: theme.spacing.md }}>
          {only ? (
            <Avatar name={only.name} size={44} />
          ) : (
            <AvatarStack names={contacts.map((contact) => contact.name)} size={36} />
          )}
          <View style={{ flex: 1 }}>
            <Text variant="subheading" numberOfLines={1}>
              {only ? only.name : plural(locale, contacts.length, t.misc.peopleCount)}
            </Text>
            <Text variant="micro" tone="muted" numberOfLines={2}>
              {only
                ? (only.email ?? only.phone ?? t.misc.noAddress)
                : contacts.map((contact) => contact.name).join(', ')}
            </Text>
          </View>
        </Row>
      </Card>

      <SectionHeader title={only ? t.misc.addToWhichGroup : t.misc.addThemAllToWhichGroup} />

      {groups.length === 0 ? (
        <Card style={{ gap: theme.spacing.md }}>
          <Text variant="caption" tone="muted">
            {t.extras.noGroupsYet}
          </Text>
          <Button
            label={t.misc.startAGroup}
            variant="secondary"
            onPress={() => router.push('/new-group')}
          />
        </Card>
      ) : (
        <Card padded={false} style={{ paddingHorizontal: theme.spacing.lg }}>
          {groups.map((group, index) => {
            const here = alreadyIn.get(group.id) ?? 0;
            // Every person picked is already in here, so there is nothing this
            // row could do. Said, not hidden: a group that vanishes from the
            // list reads as data lost rather than as a question answered.
            const full = here >= contacts.length;
            return (
              <View key={group.id} style={full ? { opacity: 0.5 } : undefined}>
                <ListRow
                  title={groupLabel(group)}
                  subtitle={
                    full
                      ? t.misc.everyoneAlreadyIn
                      : here > 0
                        ? plural(locale, here, t.misc.alreadyInCount)
                        : undefined
                  }
                  leading={
                    <Avatar
                      name={groupLabel(group)}
                      emoji={group.cover_emoji ?? undefined}
                      size={40}
                    />
                  }
                  onPress={busy || full ? undefined : () => onChoose(group.id)}
                  trailing={
                    full ? undefined : (
                      <Ionicons
                        name={directionalIcon('chevron-forward')}
                        size={iconSize.md}
                        color={theme.color.textFaint}
                      />
                    )
                  }
                />
                {index < groups.length - 1 ? <Divider /> : null}
              </View>
            );
          })}
        </Card>
      )}

      {busy ? <ActivityIndicator color={theme.color.brand} /> : null}
      {error ? <Callout tone="negative">{error}</Callout> : null}

      <Text variant="micro" tone="muted">
        {t.extras.ghostShareNote}
      </Text>

      <Button label={t.misc.pickDifferentPeople} variant="ghost" onPress={onCancel} />
    </ScrollView>
  );
}

/**
 * Whether this contact is already one of the group's members.
 *
 * Matched on the address the invite was written to, never on the name: two
 * people called Ravi in one flat are two members, and a name test would refuse
 * to add the second of them while giving no reason anybody could act on.
 */
function isMember(members: readonly MemberRow[], contact: PickedContact): boolean {
  return members.some((member) =>
    sameAddress(
      { email: member.invite_email ?? null, phone: member.invite_phone ?? null },
      contact,
    ),
  );
}
