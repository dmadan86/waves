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
 * merged are already in their groups. A contact whose name fits exactly one
 * guest ticks them; a name that fits several ticks nobody and says so, because a
 * name three people share is not evidence about any of them. Either way the
 * contact's name becomes the merged name and is held for the invite step below.
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
  contactNameMatch,
  defaultMergeName,
  hasContact,
  isPicked,
  memberIdsForMerge,
  mergeErrorMessage,
  type MergeCandidate,
} from '@/data/mergePeople';
import { ContactPicker, type PickedContact } from '@/components/ContactPicker';
import { PeopleSkeleton } from '@/components/Skeletons';
import { friendlyError } from '@/lib/errors';
import { useSync } from '@/sync';
import { fill, plural, useStrings, type UiStrings } from '@/i18n';

/**
 * How much of the mergeable roster is drawn before asking. It is every ghost in
 * every active group, so it has no ceiling; this keeps a cold open cheap without
 * hiding anybody behind a search box they would have to guess at.
 */
const ROSTER_PAGE = 25;

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
  // Set when a picked contact's name fits more than one guest — the screen says
  // so and picks nobody, rather than quietly ticking several different humans.
  const [contactNotice, setContactNotice] = useState<string | null>(null);
  const [showAllGuests, setShowAllGuests] = useState(false);

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
    () => guests.filter((row) => isPicked(row, selected)),
    [guests, selected],
  );
  /** The guests not in the merge yet — what the "add a person" list offers. */
  const remaining = useMemo(
    () => guests.filter((row) => !isPicked(row, selected)),
    [guests, selected],
  );
  const shownRemaining = showAllGuests ? remaining : remaining.slice(0, ROSTER_PAGE);

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
  // never blank for a frame. Read raw for the same reason `keys` above is:
  // `useLocalSearchParams` has already decoded it, and a second pass throws on a
  // name containing a literal %.
  const seededName = typeof params.name === 'string' ? params.name : '';
  const name = typedName ?? (suggestedName || seededName);
  const showingSuggestion = typedName === null && name.trim().length > 0;

  /** Somebody in the merge whose membership has not reached the server yet. */
  const pendingPicked = selectedRows.some((row) => row.pending);

  const toggle = (row: MergeCandidate): void => {
    setError(null);
    setContactNotice(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (isPicked(row, prev)) {
        // A seeded pick may be spelled as one of their member ids rather than
        // their person key (see `isPicked`), so drop every spelling of them.
        next.delete(row.person_key);
        for (const id of row.member_ids) next.delete(id);
      } else if (!row.pending) {
        // Adding somebody the server has not seen would make the RPC refuse the
        // whole merge, and say of them that they are not a guest you share a
        // group with — untrue, about a person this very screen is listing.
        // Removing one always works, so only the add is blocked.
        next.add(row.person_key);
      }
      return next;
    });
  };

  /**
   * A contact was picked. It only names the merge: the contact's name becomes
   * the merged name and is held for the invite step. No guest is created, and no
   * group is chosen — the merge is over the people already here.
   *
   * A name match ticks somebody only when it is unambiguous. It used to tick
   * every guest wearing that name, which was survivable while the roster was
   * only people carrying a live debt; now that it is every guest in every group,
   * one contact called "Alex" could silently sweep three different humans into
   * an irreversible merge whose confirmation named nobody. So a single match is
   * ticked (that is the recognition this screen is built on), several matches
   * tick nobody and say so, and the person picks the one they meant.
   */
  const onPickContact = (chosen: readonly PickedContact[]): void => {
    const contact = chosen[0];
    if (!contact) return;
    const { pick, ambiguous } = contactNameMatch(guests, contact.name);
    if (pick) setSelected((prev) => new Set(prev).add(pick.person_key));
    setContactNotice(
      ambiguous ? fill(t.mergePeople.contactAmbiguous, { name: contact.name }) : null,
    );
    setPickedContact(contact);
    // Assigning a contact is naming the merged person: the contact's name wins,
    // and it stops auto-tracking the picks from here on.
    setTypedName(contact.name);
    setError(null);
    setPickingContact(false);
  };

  const ready = canMerge(selectedRows) && !pendingPicked && name.trim().length > 0;
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
  //
  // It names everybody being folded, so an extra pick — from a contact match, or
  // a mis-tap on a long roster — is visible in the last moment before it stops
  // being reversible. A warning that says only "this can't be undone" cannot be
  // checked against anything.
  const confirmMerge = (): void => {
    if (!ready || merge.isPending) return;
    const who = fill(t.mergePeople.warningWho, {
      people: selectedRows.map((row) => row.display_name).join(', '),
    });
    Alert.alert(t.mergePeople.warningTitle, `${who}\n\n${t.mergePeople.warningBody}`, [
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
                          spoken={identitySpoken(row, locale, t)}
                          identified={hasContact(row)}
                          identifiedLabel={t.mergePeople.hasContact}
                          removeLabel={fill(t.pickers.removeName, { name: row.display_name })}
                          onRemove={() => toggle(row)}
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
                  already: the number or address you wrote down, how many groups
                  they turn up in, and whether they are still waiting to sync.
                  Ready-and-identified people sort first.

                  Drawn a page at a time rather than all at once: the roster is
                  every ghost in every active group, which is unbounded, and this
                  screen cannot hand it to a FlashList — the list would have to
                  own the whole scroll (nesting one inside this ScrollView
                  defeats it), which would put the name field in a header that
                  remounts and loses focus mid-typing. A "show the rest" tap is
                  the honest trade. */}
              <View style={{ gap: theme.spacing.sm }}>
                <Text variant="caption" tone="muted">
                  {t.mergePeople.addGuestTitle}
                </Text>
                {remaining.length === 0 ? (
                  <Text variant="caption" tone="muted">
                    {t.mergePeople.noMoreGuests}
                  </Text>
                ) : (
                  <>
                    <Card padded={false} style={{ paddingHorizontal: theme.spacing.lg }}>
                      {shownRemaining.map((row, index) => (
                        <View key={row.person_key}>
                          <ListRow
                            title={row.display_name}
                            subtitle={identityLine(row, locale, t)}
                            // The tick the selected rows wear has nowhere to go
                            // on a ListRow, so the fact it stands for is spoken
                            // here instead — the number itself is on the row.
                            accessibilityLabel={[
                              row.display_name,
                              hasContact(row) ? t.mergePeople.hasContact : '',
                              identitySpoken(row, locale, t),
                            ]
                              .filter(Boolean)
                              .join(', ')}
                            accessibilityState={{ disabled: row.pending }}
                            leading={<Avatar name={row.display_name} size={40} ghost />}
                            trailing={
                              <Ionicons
                                name={row.pending ? 'cloud-upload-outline' : 'add-circle'}
                                size={iconSize.xl}
                                color={row.pending ? theme.color.textFaint : theme.color.brand}
                              />
                            }
                            // Inert while their membership is only in the queue:
                            // the server would refuse the whole merge over them.
                            onPress={row.pending ? undefined : () => toggle(row)}
                          />
                          {index < shownRemaining.length - 1 ? <Divider /> : null}
                        </View>
                      ))}
                    </Card>
                    {shownRemaining.length < remaining.length ? (
                      <Button
                        label={plural(
                          locale,
                          remaining.length - shownRemaining.length,
                          t.mergePeople.showAllGuests,
                        )}
                        variant="ghost"
                        fullWidth
                        onPress={() => setShowAllGuests(true)}
                      />
                    ) : null}
                  </>
                )}
              </View>

              {/* Give the merged person a real identity: assign them a device
                  contact. A contact whose name fits exactly one guest ticks
                  them; several matches tick nobody and say so. Either way the
                  contact's name becomes the merged name (see onPickContact). No
                  guest is created and no group is chosen. */}
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

              {/* The contact's name fitted several guests. Nobody was ticked —
                  this says why, and the roster above is where they choose. */}
              {contactNotice ? <Callout tone="info">{contactNotice}</Callout> : null}

              {/* Somebody in the merge is still only in the queue. Saying so
                  here beats the server's refusal, which would call them a person
                  you share no group with. */}
              {pendingPicked ? (
                <Callout tone="warning">{t.mergePeople.pendingBlocked}</Callout>
              ) : null}

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

/** The one address we hold for this guest — a number first, else an email. */
function contactAddress(person: MergeCandidate): string {
  return person.phone?.trim() || person.email?.trim() || '';
}

/** The facts the identity line is made of, unformatted. */
function identityParts(
  person: MergeCandidate,
  locale: string,
  t: UiStrings,
): { address: string; reach: string; pending: string } {
  return {
    address: contactAddress(person),
    reach:
      person.group_ids.length === 1
        ? t.tabs.inOneGroup
        : plural(locale, person.group_ids.length, t.tabs.acrossGroups),
    pending: person.pending ? t.mergePeople.pendingTag : '',
  };
}

/**
 * What makes this guest somebody already, in one line.
 *
 * The number or address you wrote down when you invited them comes first — it is
 * the nearest thing to proof of a particular human a guest can carry, and it is
 * the whole reason one of two same-looking names is the one to keep. Their reach
 * across groups follows it, and whether they are still waiting to sync last.
 *
 * The address is wrapped in a Unicode isolate (U+2068 … U+2069) because it is
 * the one strongly-LTR run in a line that is otherwise the UI language: without
 * it a leading `+` walks to the wrong end of an Arabic subtitle. `ListRow`'s
 * subtitle takes a string, not a node, so the isolation is in the text rather
 * than in a nested `writingDirection` Text the way `friends/person/[key]` does
 * it. Screen readers skip the controls, but {@link identitySpoken} is built from
 * the bare address anyway so nothing depends on that.
 */
function identityLine(person: MergeCandidate, locale: string, t: UiStrings): string {
  const { address, reach, pending } = identityParts(person, locale, t);
  // Spelled as escapes on purpose: FSI and PDI are invisible, and a copy-paste
  // or an editor that strips format characters would silently undo the fix.
  const isolated = address ? `\u2068${address}\u2069` : '';
  return [isolated, reach, pending].filter(Boolean).join(' · ');
}

/** The same facts for a spoken label — no isolate controls, comma-separated. */
function identitySpoken(person: MergeCandidate, locale: string, t: UiStrings): string {
  const { address, reach, pending } = identityParts(person, locale, t);
  return [address, reach, pending].filter(Boolean).join(', ');
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
  spoken,
  identified,
  identifiedLabel,
  removeLabel,
  onRemove,
}: {
  name: string;
  subtitle: string;
  /** The same line without the bidi isolate controls, for a screen reader. */
  spoken: string;
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
        <Text variant="caption" tone="muted" numberOfLines={1} accessibilityLabel={spoken}>
          {subtitle}
        </Text>
      </View>
      <IconButton label={removeLabel} onPress={onRemove}>
        <Ionicons name="close-circle" size={iconSize.xl} color={theme.color.textFaint} />
      </IconButton>
    </Row>
  );
}
