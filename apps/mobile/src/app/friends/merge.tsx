/**
 * Merge same-person guests into one, on the Friends screen.
 *
 * A guest (ghost) appears once per group, because a name is no proof that the
 * "person1" in one group is the "person1" in another (see the
 * `waves_people_i_owe` migration). This screen is where the one thing that *is*
 * proof — a person saying "these are the same" — gets recorded. The merge is
 * per-viewer and never rewrites the ledger; each group keeps its own guest and
 * its own balance, and only the Friends aggregation folds them into one name.
 *
 * It is presented as permanent: there is no un-merge, and the screen says so in
 * as many words before the button. Only guests can be picked — a real person is
 * already one identity by their account and must never be folded under a made-up
 * name, which the RPC also enforces.
 *
 * Who is offered comes from group membership, not from balances. The screen used
 * to read the balance list, which drops anybody square with you and carries no
 * address — so a guest you had given a phone number to could not be seen at all,
 * and nothing on a row said which of two names was the one you already knew.
 * Both are the whole point of this screen: it now shows every guest you share a
 * group with, says what makes each of them somebody already (their number or
 * address, and how far they reach), and pre-fills the merged name from the
 * identified one. Pre-fills only — the field stays editable.
 *
 * Assigning a device contact only *names* the merged person. It never creates a
 * new guest and never asks which group to add anyone to — the people being
 * merged are already in their groups. If the contact's name matches a guest on
 * the list, that guest is ticked; either way the contact's name becomes the
 * merged name and is held so the invite step below can offer it.
 *
 * After the merge, the person can be invited to the groups they now span. There
 * is no targeted send in this app — invites are one durable join link per group
 * (see `group/[id]/invite`) — so "invite them" here is a sheet that shares that
 * same link for each of the merged person's groups.
 */
import { useMemo, useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useMutation } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Share,
  TextInput,
  View,
} from 'react-native';

import {
  Avatar,
  Button,
  Callout,
  Card,
  directionalIcon,
  Divider,
  EmptyState,
  IconButton,
  iconSize,
  ListRow,
  Row,
  Screen,
  Text,
  useTabBarClearance,
  useTheme,
} from '@waves/ui';

import { ensureGroupJoinToken, groupJoinLink, mergeGhosts } from '@/data/api';
import { useGroups, useMergeCandidates } from '@/data/hooks';
import {
  canMerge,
  defaultMergeName,
  hasContact,
  memberIdsForMerge,
  mergeErrorMessage,
  type MergeCandidate,
} from '@/data/mergePeople';
import { ContactPicker, type PickedContact } from '@/components/ContactPicker';
import { PeopleSkeleton } from '@/components/Skeletons';
import { friendlyError } from '@/lib/errors';
import { useSync } from '@/sync';
import { fill, plural, useStrings, type UiStrings } from '@/i18n';

/** One group the merged person belongs to, for the post-merge invite sheet. */
interface InviteGroup {
  readonly id: string;
  readonly name: string | null;
  readonly emoji: string | null;
}

export default function MergePeopleScreen() {
  const theme = useTheme();
  // This screen renders under the persistent bottom nav (like friends/contacts),
  // so it needs the tab-bar clearance — the plain screen inset left the Merge
  // button hidden behind the bar, unreachable by scrolling.
  const clearance = useTabBarClearance();
  const { t, locale } = useStrings();
  const { flush } = useSync();

  // People pre-picked on the Friends tab (its multiselect merge) arrive as a
  // comma-joined, encoded list of person_keys, plus the name to pre-fill. They
  // seed the selection and name here so this screen opens on the confirm step
  // rather than an empty pick.
  const params = useLocalSearchParams<{ keys?: string; name?: string }>();
  const initialKeys = useMemo(
    () =>
      new Set(
        (typeof params.keys === 'string' ? params.keys : '')
          .split(',')
          // useLocalSearchParams already URL-decodes params, so the keys arrive
          // decoded — decoding again would corrupt any key containing a %.
          .filter((key) => key.length > 0),
      ),
    [params.keys],
  );

  // Every guest you share a group with, from the mirror — whatever the balance,
  // and carrying the address that says which of them you already know.
  const people = useMergeCandidates(t.misc.someone);
  const guests = people.data;
  const groups = useGroups();

  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(initialKeys));
  // Null until somebody types (or assigns a contact): the field then shows the
  // suggestion below, which follows the picks. Not state that has to be kept in
  // step — a derived name cannot drift out of it.
  const [typedName, setTypedName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The device contact assigned to name the merge (if any). Held only for its
  // name and to show the "assigned" state — it is never turned into a guest.
  const [pickedContact, setPickedContact] = useState<PickedContact | null>(null);
  const [pickingContact, setPickingContact] = useState(false);

  // The post-merge invite step: the merged person's name and the groups they
  // span, or null while the sheet is closed.
  const [inviteFor, setInviteFor] = useState<{ name: string; groups: InviteGroup[] } | null>(null);
  const [shareBusyId, setShareBusyId] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  // Groups snapshot taken the instant before the merge writes — memberships do
  // not change, and the pre-merge person_keys resolve cleanly (a merged key may
  // not), so the invite prompt can list them without another round-trip.
  const pendingInviteGroups = useRef<InviteGroup[]>([]);

  const selectedRows = useMemo(
    () => guests.filter((row) => selected.has(row.person_key)),
    [guests, selected],
  );
  /** The guests not in the merge yet — what the "add a person" list offers. */
  const remaining = useMemo(
    () => guests.filter((row) => !selected.has(row.person_key)),
    [guests, selected],
  );

  // The name the merge would keep if nobody typed one: the identified person's
  // (see `defaultMergeName`). It follows the picks, so removing the person it
  // came from moves it to whoever is left, and the caption below says it is a
  // suggestion rather than a decision.
  const suggestedName = useMemo(
    () =>
      defaultMergeName(
        selectedRows.map((row) => ({
          display_name: row.display_name,
          phone: row.phone,
          email: row.email,
          group_count: row.group_ids.length,
        })),
      ),
    [selectedRows],
  );
  // The name the Friends tab guessed before this screen had the fuller picture —
  // used only until the candidates are read off the mirror, so the field is
  // never blank for a frame.
  const seededName = decodeURIComponent(typeof params.name === 'string' ? params.name : '');
  const name = typedName ?? (suggestedName || seededName);
  const showingSuggestion = typedName === null && name.trim().length > 0;

  const toggle = (personKey: string): void => {
    setError(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(personKey)) next.delete(personKey);
      else next.add(personKey);
      return next;
    });
  };

  /**
   * A contact was picked. It only names the merge: if its name matches somebody
   * already on this list, that is exactly the recognition this screen is built
   * on — tick them, the same as tapping their row would. Either way the contact
   * becomes the merged name and is held for the invite step. No guest is
   * created, and no group is chosen — the merge is over the people already here.
   */
  const onPickContact = (chosen: readonly PickedContact[]): void => {
    const contact = chosen[0];
    if (!contact) return;
    const needle = contact.name.trim().toLowerCase();
    const matches = guests.filter((row) => row.display_name.trim().toLowerCase() === needle);
    setSelected((prev) => {
      const next = new Set(prev);
      for (const row of matches) next.add(row.person_key);
      return next;
    });
    setPickedContact(contact);
    // Assigning a contact is naming the merged person: the contact's name wins,
    // and it stops auto-tracking the picks from here on.
    setTypedName(contact.name);
    setError(null);
    setPickingContact(false);
  };

  const ready = canMerge(selectedRows) && name.trim().length > 0;
  const nothingToMergeYet = guests.length === 0;

  /**
   * The groups the currently-selected guests span, deduped by group id. Read off
   * the mirror the candidates came from — no round-trip, and it holds for a
   * person you are square with, whose balance rows would list no groups at all.
   */
  const gatherInviteGroups = (): InviteGroup[] => {
    const byId = new Map<string, InviteGroup>();
    const known = new Map(groups.data.map((group) => [group.id, group]));
    for (const row of selectedRows) {
      for (const groupId of row.group_ids) {
        if (byId.has(groupId)) continue;
        const group = known.get(groupId);
        byId.set(groupId, {
          id: groupId,
          name: group?.name ?? null,
          emoji: group?.cover_emoji ?? null,
        });
      }
    }
    return [...byId.values()];
  };

  const merge = useMutation({
    mutationFn: () => mergeGhosts(memberIdsForMerge(selectedRows), name.trim()),
    onSuccess: () => {
      // The merge is written server-side by the RPC; pull it into the mirror so
      // the now-local Friends list (ADR-005) — and this screen, which reads the
      // same rows — folds it without waiting for the next background sync.
      void flush();
      const groups = pendingInviteGroups.current;
      // Nothing to invite into (no groups resolved) → this screen is done.
      if (groups.length === 0) {
        router.back();
        return;
      }
      // Ask before sharing anything. Skip closes the screen; Invite opens the
      // per-group share sheet.
      Alert.alert(
        fill(t.mergePeople.invitePromptTitle, { name: name.trim() }),
        t.mergePeople.invitePromptBody,
        [
          { text: t.mergePeople.invitePromptSkip, style: 'cancel', onPress: () => router.back() },
          { text: t.people.invite, onPress: () => setInviteFor({ name: name.trim(), groups }) },
        ],
      );
    },
    onError: (caught) => setError(mergeErrorMessage(caught, t.mergePeople)),
  });

  // Merging is permanent, so the "this can't be undone" warning is a dialog on
  // tap — the person confirms it deliberately — rather than a line they may
  // skim past. Only the confirm proceeds to the write.
  const confirmMerge = (): void => {
    if (!ready || merge.isPending) return;
    Alert.alert(t.mergePeople.warningTitle, t.mergePeople.warningBody, [
      { text: t.common.cancel, style: 'cancel' },
      {
        text: t.mergePeople.cta,
        style: 'destructive',
        onPress: () => {
          // Snapshot the groups before the write, from the pre-merge picks.
          pendingInviteGroups.current = gatherInviteGroups();
          merge.mutate();
        },
      },
    ]);
  };

  const dismissInvite = (): void => {
    setInviteFor(null);
    router.back();
  };

  /** Share one group's durable join link through the OS share sheet. */
  const shareGroupInvite = async (group: InviteGroup): Promise<void> => {
    setShareBusyId(group.id);
    setInviteError(null);
    try {
      const token = await ensureGroupJoinToken(group.id);
      void flush();
      const label = group.name ?? t.captures.group;
      const message = t.people.shareMessage
        .replace('{group}', label)
        .replace('{link}', groupJoinLink(token));
      await Share.share({ message });
    } catch (caught) {
      setInviteError(friendlyError(caught, t.couldNotSave, 'merge.shareInvite'));
    } finally {
      setShareBusyId(null);
    }
  };

  return (
    <Screen>
      {/* On edge-to-edge Android the resize inset does not always lift the
          content above the keyboard, so the name field's own button can end up
          behind it and the screen reads as "won't scroll to the end". The
          avoider (padding on iOS, resize on Android) keeps the button reachable
          while the keyboard is open. */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <Row style={{ paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.md }}>
          <IconButton label={t.common.back} onPress={() => router.back()}>
            <Ionicons
              name={directionalIcon('chevron-back')}
              size={iconSize.lg}
              color={theme.color.text}
            />
          </IconButton>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text variant="heading">{t.mergePeople.title}</Text>
          </View>
          <View style={{ width: 44 }} />
        </Row>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingHorizontal: theme.spacing.xl,
            paddingTop: theme.spacing.lg,
            paddingBottom: clearance,
            gap: theme.spacing.xl,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {people.isLoading ? (
            <PeopleSkeleton />
          ) : nothingToMergeYet ? (
            <EmptyState title={t.mergePeople.title} body={t.mergePeople.empty} />
          ) : (
            <>
              {/* The one thing this screen decides: the name the merged person
                  carries on Friends. Editable inline — a plain underlined field
                  with a pencil so it reads as "tap to change." */}
              <View style={{ gap: theme.spacing.xs }}>
                <Text variant="caption" tone="muted">
                  {t.mergePeople.nameLabel}
                </Text>
                <Row
                  style={{
                    alignItems: 'center',
                    gap: theme.spacing.sm,
                    borderBottomWidth: 1,
                    borderBottomColor: theme.color.border,
                  }}
                >
                  <TextInput
                    value={name}
                    onChangeText={setTypedName}
                    editable={selectedRows.length > 0}
                    accessibilityLabel={t.mergePeople.nameLabel}
                    placeholder={t.mergePeople.namePlaceholder}
                    placeholderTextColor={theme.color.textFaint}
                    style={{
                      flex: 1,
                      fontSize: 22,
                      fontWeight: '800',
                      color: theme.color.text,
                      paddingVertical: theme.spacing.xs,
                    }}
                  />
                  <Ionicons name="pencil" size={iconSize.md} color={theme.color.textFaint} />
                </Row>
                {/* Say out loud that the name is a suggestion. It is filled from
                    the person we already have details for, which is right often
                    enough to save a typing — and wrong often enough that it must
                    never read as settled. */}
                {showingSuggestion ? (
                  <Text variant="micro" tone="muted">
                    {t.mergePeople.nameSuggested}
                  </Text>
                ) : null}
              </View>

              {/* Only the people actually being merged — not the whole roster.
                  Each is removable; the list below adds more. */}
              <View style={{ gap: theme.spacing.sm }}>
                <Text variant="caption" tone="muted">
                  {selectedRows.length > 0
                    ? plural(locale, selectedRows.length, t.mergePeople.peopleHeader)
                    : t.mergePeople.needTwo}
                </Text>
                {selectedRows.length > 0 ? (
                  <Card padded={false} style={{ paddingHorizontal: theme.spacing.lg }}>
                    {selectedRows.map((row, index) => (
                      <View key={row.person_key}>
                        <MergeMemberRow
                          name={row.display_name}
                          subtitle={identityLine(row, locale, t)}
                          identified={hasContact(row)}
                          identifiedLabel={t.mergePeople.hasContact}
                          removeLabel={fill(t.pickers.removeName, { name: row.display_name })}
                          onRemove={() => toggle(row.person_key)}
                        />
                        {index < selectedRows.length - 1 ? <Divider /> : null}
                      </View>
                    ))}
                  </Card>
                ) : null}
              </View>

              {/* Everybody else you could merge — the step this screen lost, and
                  without which a person who was not pre-picked on Friends could
                  not be reached at all. Each row says what makes them somebody
                  already: the number or address you wrote down, and how many
                  groups they turn up in. Identified people sort first. */}
              <View style={{ gap: theme.spacing.sm }}>
                <Text variant="caption" tone="muted">
                  {t.mergePeople.addGuestTitle}
                </Text>
                {remaining.length === 0 ? (
                  <Text variant="caption" tone="muted">
                    {t.mergePeople.noMoreGuests}
                  </Text>
                ) : (
                  <Card padded={false} style={{ paddingHorizontal: theme.spacing.lg }}>
                    {remaining.map((row, index) => (
                      <View key={row.person_key}>
                        <ListRow
                          title={row.display_name}
                          subtitle={identityLine(row, locale, t)}
                          // The tick the selected rows wear has nowhere to go on
                          // a ListRow, so the fact it stands for is spoken here
                          // instead — the number itself is already on the row.
                          accessibilityLabel={[
                            row.display_name,
                            hasContact(row) ? t.mergePeople.hasContact : '',
                            identityLine(row, locale, t),
                          ]
                            .filter(Boolean)
                            .join(', ')}
                          leading={<Avatar name={row.display_name} size={40} ghost />}
                          trailing={
                            <Ionicons
                              name="add-circle"
                              size={iconSize.xl}
                              color={theme.color.brand}
                            />
                          }
                          onPress={() => toggle(row.person_key)}
                        />
                        {index < remaining.length - 1 ? <Divider /> : null}
                      </View>
                    ))}
                  </Card>
                )}
              </View>

              {/* Give the merged person a real identity: assign them a device
                  contact. A contact whose name matches a guest ticks it; either
                  way the contact's name becomes the merged name (see
                  onPickContact). No guest is created and no group is chosen. */}
              <Button
                label={
                  pickedContact
                    ? fill(t.mergePeople.assignedTo, { name: pickedContact.name })
                    : t.mergePeople.addPerson
                }
                variant="secondary"
                fullWidth
                disabled={merge.isPending}
                onPress={() => setPickingContact(true)}
                icon={
                  <MaterialCommunityIcons
                    name={pickedContact ? 'account-check-outline' : 'book-account-outline'}
                    size={iconSize.md}
                    color={theme.color.brand}
                  />
                }
              />

              {error ? <Callout tone="negative">{error}</Callout> : null}

              {/* The irreversibility is confirmed in a dialog on tap rather than
                  shouted inline — one clear "are you sure, this can't be undone"
                  before anything is written. */}
              <Button
                label={t.mergePeople.cta}
                size="lg"
                fullWidth
                disabled={!ready || merge.isPending}
                onPress={confirmMerge}
              />
              {merge.isPending ? <ActivityIndicator color={theme.color.brand} /> : null}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Picking a device contact to name the merge. Mounted only while open,
          for the same reason add-person's own contact modal is — a React Native
          Modal keeps its children mounted across a close, so without this gate
          the picker would reopen showing the last pick still ticked. */}
      <Modal
        visible={pickingContact}
        animationType="slide"
        onRequestClose={() => setPickingContact(false)}
      >
        <Screen edges={['top', 'bottom']} inModal>
          <View
            style={{
              flex: 1,
              paddingHorizontal: theme.spacing.xl,
              paddingBottom: theme.spacing.md,
              gap: theme.spacing.lg,
            }}
          >
            <Row style={{ paddingTop: theme.spacing.md }}>
              <IconButton label={t.common.close} onPress={() => setPickingContact(false)}>
                <Ionicons name="close" size={iconSize.lg} color={theme.color.text} />
              </IconButton>
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text variant="heading">{t.tabs.fromContacts}</Text>
              </View>
              <View style={{ width: 44 }} />
            </Row>
            <ContactPicker single onConfirm={onPickContact} confirmVerb={t.misc.continueWith} />
          </View>
        </Screen>
      </Modal>

      {/* After the merge: share a durable join link for each group the merged
          person spans. There is no targeted send in this app — each group has
          one link (see group/[id]/invite) — so inviting them to "all their
          groups" is one Share per group here. */}
      <Modal visible={inviteFor !== null} animationType="slide" onRequestClose={dismissInvite}>
        <Screen edges={['top', 'bottom']} inModal>
          <ScrollView
            contentContainerStyle={{
              paddingHorizontal: theme.spacing.xl,
              paddingBottom: theme.spacing.xl,
              gap: theme.spacing.lg,
            }}
            showsVerticalScrollIndicator={false}
          >
            <Row style={{ paddingTop: theme.spacing.md }}>
              <IconButton label={t.common.close} onPress={dismissInvite}>
                <Ionicons name="close" size={iconSize.lg} color={theme.color.text} />
              </IconButton>
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text variant="heading">{t.mergePeople.inviteSheetTitle}</Text>
              </View>
              <View style={{ width: 44 }} />
            </Row>

            <Text variant="caption" tone="muted">
              {fill(t.mergePeople.inviteSheetBody, { name: inviteFor?.name ?? '' })}
            </Text>

            {inviteFor ? (
              <Card padded={false} style={{ paddingHorizontal: theme.spacing.lg }}>
                {inviteFor.groups.map((group, index) => (
                  <View key={group.id}>
                    <ListRow
                      title={group.name ?? t.captures.group}
                      leading={
                        <Avatar
                          name={group.name ?? t.captures.group}
                          emoji={group.emoji ?? undefined}
                          size={40}
                        />
                      }
                      onPress={shareBusyId ? undefined : () => void shareGroupInvite(group)}
                      trailing={
                        shareBusyId === group.id ? (
                          <ActivityIndicator color={theme.color.brand} />
                        ) : (
                          <Ionicons
                            name="share-outline"
                            size={iconSize.md}
                            color={theme.color.brand}
                            accessibilityLabel={t.mergePeople.inviteShare}
                          />
                        )
                      }
                    />
                    {index < inviteFor.groups.length - 1 ? <Divider /> : null}
                  </View>
                ))}
              </Card>
            ) : null}

            {inviteError ? <Callout tone="negative">{inviteError}</Callout> : null}

            <Button label={t.common.done} size="lg" fullWidth onPress={dismissInvite} />
          </ScrollView>
        </Screen>
      </Modal>
    </Screen>
  );
}

/**
 * What makes this guest somebody already, in one line.
 *
 * The number or address you wrote down when you invited them comes first — it is
 * the nearest thing to proof of a particular human a guest can carry, and it is
 * the whole reason one of two same-looking names is the one to keep. Their reach
 * across groups follows it. Joined the way the rest of the app joins facts on a
 * row, so bidi text lays out on its own rather than through hardcoded sides.
 */
function identityLine(person: MergeCandidate, locale: string, t: UiStrings): string {
  const address = person.phone?.trim() || person.email?.trim() || '';
  const reach =
    person.group_ids.length === 1
      ? t.tabs.inOneGroup
      : plural(locale, person.group_ids.length, t.tabs.acrossGroups);
  return [address, reach].filter(Boolean).join(' · ');
}

/**
 * One person in the merge selection: their name, what makes them somebody
 * already, and a remove control. No avatar — the identity being built is the
 * name at the top, so the rows stay a compact, glanceable list rather than a
 * stack of circles. Removing is the only edit here — there is no "unpick to
 * unmerged," only "not part of this merge," so it reads as a delete, not a
 * toggle.
 */
function MergeMemberRow({
  name,
  subtitle,
  identified,
  identifiedLabel,
  removeLabel,
  onRemove,
}: {
  name: string;
  subtitle: string;
  /** We hold an address for them — the tick that says "this one is a real someone". */
  identified: boolean;
  identifiedLabel: string;
  removeLabel: string;
  onRemove: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <Row style={{ paddingVertical: theme.spacing.sm, alignItems: 'center', minHeight: 44 }}>
      <View style={{ flex: 1 }}>
        <Row style={{ alignItems: 'center', gap: theme.spacing.xs }}>
          <Text variant="subheading" numberOfLines={1} style={{ flexShrink: 1 }}>
            {name}
          </Text>
          {identified ? (
            <MaterialCommunityIcons
              name="account-check"
              size={iconSize.sm}
              color={theme.color.brand}
              accessibilityLabel={identifiedLabel}
            />
          ) : null}
        </Row>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <IconButton label={removeLabel} onPress={onRemove}>
        <Ionicons name="close-circle" size={iconSize.xl} color={theme.color.textFaint} />
      </IconButton>
    </Row>
  );
}
