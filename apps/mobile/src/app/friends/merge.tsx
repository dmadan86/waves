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
 * as many words before anything is written. Only guests can be picked — a real
 * person is already one identity by their account and must never be folded
 * under a made-up name, which the RPC also enforces.
 *
 * Who is offered comes from group membership, not from balances: every guest
 * you share a group with, whatever they owe, carrying the number or address
 * that says which of them you already know.
 *
 * Laid out suggestions-first. The screen used to list every guest with a "+" on
 * each row and a count at the bottom of picks you could not see, so even an
 * obvious pair ("Renny" twice) had to be found by eye. Now:
 *
 * 1. **Likely duplicates** — sets the roster itself says are one person (a
 *    shared number or email, else a shared name; see `findDuplicateSets`), each
 *    with its reason and a one-tap Merge. A suggestion is only ever a proposal:
 *    the tap opens the same confirm a hand-picked merge goes through.
 * 2. **Or pick yourself** — everybody else, with a checkbox and a tinted row,
 *    so what is picked is visible where it was picked. A search icon filters it.
 * 3. **A slim selection bar** that shows who is picked and carries the merge.
 *
 * Either path ends on one confirm sheet, "Keep which name?". The merge RPC keeps
 * a *name*, not a surviving row (every membership is folded under one new
 * person wearing the name it is handed), so choosing which person to keep is
 * choosing which of their names; the field below the choices still takes any
 * name. Then the "this can't be undone" dialog, then the write. Every rule
 * underneath — who can be picked, how a name is suggested, what the merge
 * writes — is unchanged.
 *
 * Assigning a device contact only *names* the merged person. It never creates a
 * new guest and never asks which group to add anyone to. A contact whose name
 * fits exactly one guest ticks them; a name that fits several ticks nobody and
 * says so, because a name three people share is not evidence about any of them.
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
import { useLocalSearchParams } from 'expo-router';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Share,
  TextInput,
  View,
} from 'react-native';

import {
  Avatar,
  AvatarStack,
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
  Sheet,
  Text,
  useTabBarClearance,
  useTheme,
  MODAL_ORIENTATIONS,
} from '@waves/ui';

import { ensureGroupJoinToken, groupJoinLink, mergeGhosts } from '@/data/api';
import { useGroups, useMergeCandidates } from '@/data/hooks';
import {
  canMerge,
  contactNameMatch,
  defaultMergeName,
  duplicateNameKey,
  findDuplicateSets,
  keepNameOptions,
  memberIdsForMerge,
  mergeErrorMessage,
  type DuplicateSet,
  type MergeCandidate,
} from '@/data/mergePeople';
import { ContactPicker, type PickedContact } from '@/components/ContactPicker';
import { PeopleSkeleton } from '@/components/Skeletons';
import { friendlyError } from '@/lib/errors';
import { duplicateNames, duplicateReason } from '@/lib/mergeSuggestionText';
import { router } from '@/lib/navigation';
import { displayPhone } from '@/lib/phone';
import { useSync } from '@/sync';
import { fill, plural, useStrings, type UiStrings } from '@/i18n';
import { isUnasked, useDialog } from '@/lib/dialog';
import { DIALOG_CANCEL, DIALOG_CONFIRM } from '@/lib/dialogQueue';

/**
 * How much of the hand-pick roster is drawn before asking. It is every ghost in
 * every active group, so it has no ceiling; this keeps a cold open cheap without
 * hiding anybody behind a search box they would have to guess at.
 */
const ROSTER_PAGE = 25;

/** Nothing ticked. Hoisted so it is one stable object, not a new set per render. */
const EMPTY: ReadonlySet<string> = new Set();

/** Overlapping avatars in the selection bar before it counts the rest as +N. */
const BAR_AVATARS = 4;

/** One group the merged person belongs to, for the post-merge invite sheet. */
interface InviteGroup {
  readonly id: string;
  readonly name: string | null;
  readonly emoji: string | null;
}

/** What a merge is about to act on: the hand-picked people, or one suggestion. */
type MergeTarget =
  { readonly kind: 'picked' } | { readonly kind: 'set'; readonly set: DuplicateSet };

/** What the merge mutation is handed — fixed at confirm, not read off state. */
interface MergeRequest {
  readonly rows: readonly MergeCandidate[];
  readonly name: string;
  readonly groups: InviteGroup[];
}

export default function MergePeopleScreen() {
  const theme = useTheme();
  // This screen renders under the persistent bottom nav (like friends/contacts),
  // so the selection bar sits on the tab-bar clearance, not the plain inset —
  // otherwise the Merge pill lands behind the bar, unreachable by scrolling.
  const clearance = useTabBarClearance();
  const { t, locale } = useStrings();
  const { ask, confirm } = useDialog();
  const { flush } = useSync();

  // People pre-picked on the Friends tab (its multiselect merge) arrive as a
  // comma-joined list of person_keys, plus the name to pre-fill. They seed the
  // selection here so the bar is already showing who they picked.
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
  // The name the Friends tab guessed, used only until the candidates are read
  // off the mirror. Read raw for the same reason `keys` is.
  const seededName = typeof params.name === 'string' ? params.name : '';

  // Every guest you share a group with, from the mirror — whatever the balance,
  // and carrying the address that says which of them you already know.
  const people = useMergeCandidates(t.misc.someone);
  const guests = people.data;
  const groups = useGroups();

  // The suggestions are derived, never written into the selection: the roster
  // arrives from the mirror a beat after mount and re-derives on every sync, and
  // a proposal that ticked boxes would fight the picks somebody already made.
  const duplicateSets = useMemo(() => findDuplicateSets(guests), [guests]);
  const suggestedKeys = useMemo(
    () => new Set(duplicateSets.flatMap((set) => set.people.map((row) => row.person_key))),
    [duplicateSets],
  );

  // Null until the user picks for themselves; from then on it is theirs alone.
  const [picked, setPicked] = useState<ReadonlySet<string> | null>(null);
  const selected = picked ?? (initialKeys.size > 0 ? initialKeys : EMPTY);

  const [error, setError] = useState<string | null>(null);
  // Set when a picked contact's name fits more than one guest — the screen says
  // so and picks nobody, rather than quietly ticking several different humans.
  const [contactNotice, setContactNotice] = useState<string | null>(null);
  const [showAllGuests, setShowAllGuests] = useState(false);
  // The device contact assigned to name the merge (if any). Held only for its
  // name — it is never turned into a guest.
  const [pickedContact, setPickedContact] = useState<PickedContact | null>(null);
  const [pickingContact, setPickingContact] = useState(false);

  // The roster filter: an icon until it is wanted, then a field in place. A
  // filter over the same rows, not a second data source.
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // The confirm sheet: what it is merging, and the name typed or chosen in it
  // (null while it still shows the suggestion, which follows the people).
  const [target, setTarget] = useState<MergeTarget | null>(null);
  const [sheetName, setSheetName] = useState<string | null>(null);
  // Set by the sheet's Merge button so the irreversibility dialog opens once
  // the sheet has left the screen — two overlays never animate at once (see
  // `Sheet`'s `onClosed`).
  const confirmAfterClose = useRef(false);

  // The post-merge invite step: the merged person's name and the groups they
  // span, or null while the sheet is closed.
  const [inviteFor, setInviteFor] = useState<{ name: string; groups: InviteGroup[] } | null>(null);
  const [shareBusyId, setShareBusyId] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const selectedRows = useMemo(
    () => guests.filter((row) => selected.has(row.person_key)),
    [guests, selected],
  );

  // "Or pick yourself" is everybody the suggestions do not already cover, plus
  // anybody picked (a pre-pick from Friends must stay visible where it can be
  // unticked). A search reaches the whole roster, suggested people included,
  // so a set can still be split by hand when the suggestion is only half right.
  const searchNeedle = searchQuery.trim().toLowerCase();
  const pickRows = useMemo(() => {
    if (searchNeedle) {
      return guests.filter((row) =>
        `${row.display_name} ${row.phone ?? ''} ${row.email ?? ''}`
          .toLowerCase()
          .includes(searchNeedle),
      );
    }
    return guests.filter(
      (row) => !suggestedKeys.has(row.person_key) || selected.has(row.person_key),
    );
  }, [guests, searchNeedle, suggestedKeys, selected]);
  const shownPickRows = showAllGuests || searchNeedle ? pickRows : pickRows.slice(0, ROSTER_PAGE);

  /** Somebody picked whose membership has not reached the server yet. */
  const pendingPicked = selectedRows.some((row) => row.pending);
  /** Distinct people picked — what the selection bar counts. */
  const pickedCount = new Set(selectedRows.map((row) => row.person_key)).size;

  const toggle = (row: MergeCandidate): void => {
    setError(null);
    setContactNotice(null);
    // Folded from whatever is ticked *now*, so two taps in a row before React
    // has re-rendered still land on the real set rather than on a snapshot.
    setPicked((prev) => {
      const current = prev ?? selected;
      const next = new Set(current);
      if (current.has(row.person_key)) {
        next.delete(row.person_key);
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
   * A contact was picked. It only names the merge: a single name match is
   * ticked (the recognition this screen is built on), several tick nobody and
   * say so, and the contact's name is what the confirm sheet opens on.
   */
  const onPickContact = (chosen: readonly PickedContact[]): void => {
    const contact = chosen[0];
    if (!contact) return;
    const { pick, ambiguous } = contactNameMatch(guests, contact.name);
    if (pick) setPicked((prev) => new Set(prev ?? selected).add(pick.person_key));
    setContactNotice(
      ambiguous ? fill(t.mergePeople.contactAmbiguous, { name: contact.name }) : null,
    );
    setPickedContact(contact);
    setError(null);
    setPickingContact(false);
  };

  // Who the confirm sheet is about: the suggestion tapped, or the hand picks.
  const targetRows: readonly MergeCandidate[] = useMemo(
    () => (target === null ? [] : target.kind === 'set' ? target.set.people : selectedRows),
    [target, selectedRows],
  );
  const named = useMemo(
    () =>
      targetRows.map((row) => ({
        display_name: row.display_name,
        phone: row.phone,
        email: row.email,
        group_count: row.group_ids.length,
      })),
    [targetRows],
  );
  const nameOptions = useMemo(() => keepNameOptions(named), [named]);
  // The name the merge keeps if nobody chooses one: the identified person's
  // (see `defaultMergeName`). The Friends tab's guess only fills in before the
  // candidates have loaded, so the field is never blank for a frame.
  const suggestedName = defaultMergeName(named) || (target?.kind === 'picked' ? seededName : '');
  const name = sheetName ?? suggestedName;
  const showingSuggestion = sheetName === null && name.trim().length > 0;
  const targetCount = new Set(targetRows.map((row) => row.person_key)).size;
  const targetReady =
    canMerge(targetRows) && !targetRows.some((row) => row.pending) && name.trim().length > 0;

  /**
   * The groups a set of guests spans, deduped by group id. Read off the mirror
   * the candidates came from — no round-trip, and it holds for a person you
   * are square with, whose balance rows would list no groups at all.
   */
  const gatherInviteGroups = (rows: readonly MergeCandidate[]): InviteGroup[] => {
    const byId = new Map<string, InviteGroup>();
    const known = new Map(groups.data.map((group) => [group.id, group]));
    for (const row of rows) {
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
    mutationFn: (request: MergeRequest) =>
      mergeGhosts(memberIdsForMerge(request.rows), request.name),
    onSuccess: (_data, request) => {
      // The merge is written server-side by the RPC; pull it into the mirror so
      // the now-local Friends list (ADR-005) — and this screen, which reads the
      // same rows — folds it without waiting for the next background sync.
      void flush();
      // Whoever was merged is no longer separate people; clear the picks so the
      // bar does not keep counting keys that just stopped existing.
      setPicked(null);
      if (request.groups.length === 0) {
        router.back();
        return;
      }
      // Asked through `ask` rather than `confirm`: this is the one prompt whose
      // *no* takes somebody off the screen, and `confirm` reads a question that
      // was never shown (the queue was full) as a no. A request that was not
      // asked simply leaves the screen where it is.
      void ask({
        title: fill(t.mergePeople.invitePromptTitle, { name: request.name }),
        body: t.mergePeople.invitePromptBody,
        actions: [
          { id: DIALOG_CONFIRM, label: t.people.invite, tone: 'primary' },
          { id: DIALOG_CANCEL, label: t.mergePeople.invitePromptSkip, tone: 'quiet' },
        ],
      }).then((answer) => {
        if (answer === DIALOG_CONFIRM) setInviteFor({ name: request.name, groups: request.groups });
        else if (!isUnasked(answer)) router.back();
      });
    },
    onError: (caught) => setError(mergeErrorMessage(caught, t.mergePeople)),
  });

  /** Open the confirm sheet on a suggestion, or on the hand picks. */
  const openConfirm = (next: MergeTarget): void => {
    if (merge.isPending) return;
    setError(null);
    // A contact assigned for the hand picks names them; a suggestion starts on
    // its own suggested name.
    setSheetName(next.kind === 'picked' && pickedContact ? pickedContact.name : null);
    setTarget(next);
  };

  const closeSheet = (): void => setTarget(null);

  // Merging is permanent, so the "this can't be undone" warning is a dialog the
  // person confirms deliberately, naming everybody being folded — an extra pick
  // from a mis-tap is visible in the last moment before it stops being
  // reversible. Everything it needs is captured before the sheet closes.
  const pendingRequest = useRef<MergeRequest | null>(null);
  const confirmMerge = async (): Promise<void> => {
    const request = pendingRequest.current;
    pendingRequest.current = null;
    if (!request || merge.isPending) return;
    const ok = await confirm({
      title: t.mergePeople.warningTitle,
      body: fill(t.mergePeople.warningWho, {
        people: request.rows.map((row) => row.display_name).join(', '),
      }),
      note: t.mergePeople.warningBody,
      confirmLabel: plural(
        locale,
        new Set(request.rows.map((row) => row.person_key)).size,
        t.mergePeople.mergeCount,
      ),
      tone: 'danger',
    });
    if (ok) merge.mutate(request);
  };

  const submitSheet = (): void => {
    if (!targetReady) return;
    pendingRequest.current = {
      rows: [...targetRows],
      name: name.trim(),
      // Snapshot the groups before the write, from the pre-merge people — the
      // pre-merge keys resolve cleanly, a merged one may not.
      groups: gatherInviteGroups(targetRows),
    };
    confirmAfterClose.current = true;
    closeSheet();
  };

  const onSheetClosed = (): void => {
    if (!confirmAfterClose.current) return;
    confirmAfterClose.current = false;
    void confirmMerge();
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

  const showBar = pickedCount > 0;
  const showFooter = showBar || error !== null || merge.isPending;

  return (
    <Screen>
      {/* Compact header: back, title, and a one-line subtitle that wraps
          rather than truncates. No art — the list is the point of the screen. */}
      <Row
        style={{
          paddingHorizontal: theme.spacing.lg,
          paddingTop: theme.spacing.sm,
          paddingBottom: theme.spacing.sm,
          alignItems: 'flex-start',
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
        <View style={{ flex: 1, minWidth: 0, paddingTop: theme.spacing.xs }}>
          <Text variant="heading" numberOfLines={1}>
            {t.mergePeople.title}
          </Text>
          <Text variant="caption" tone="muted">
            {t.mergePeople.subtitle}
          </Text>
        </View>
      </Row>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingTop: theme.spacing.xs,
          // With no bar pinned below, the last row still has to clear the tab bar.
          paddingBottom: showFooter ? theme.spacing.lg : clearance,
          gap: theme.spacing.sm,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {people.isLoading ? (
          <PeopleSkeleton />
        ) : guests.length === 0 ? (
          <EmptyState title={t.mergePeople.title} body={t.mergePeople.empty} />
        ) : (
          <>
            {/* Likely duplicates — hidden outright when there are none, rather
                than an empty card saying so. */}
            {duplicateSets.length > 0 ? (
              <>
                <SectionLabel label={t.mergePeople.likelyDuplicates} />
                <Card padded={false}>
                  {duplicateSets.map((set, index) => (
                    <View key={set.key}>
                      <SuggestionRow
                        set={set}
                        locale={locale}
                        t={t}
                        disabled={merge.isPending}
                        onMerge={() => openConfirm({ kind: 'set', set })}
                      />
                      {index < duplicateSets.length - 1 ? <Divider /> : null}
                    </View>
                  ))}
                </Card>
              </>
            ) : null}

            {/* Or pick yourself — label, then the contact and search icons on
                the same line, so neither costs a row until it is used. */}
            <Row style={{ gap: theme.spacing.xs, marginTop: theme.spacing.sm }}>
              <View style={{ flex: 1 }}>
                <SectionLabel
                  label={
                    duplicateSets.length > 0 ? t.mergePeople.pickYourself : t.mergePeople.pickPeople
                  }
                />
              </View>
              <IconButton
                label={
                  pickedContact
                    ? fill(t.mergePeople.assignedTo, { name: pickedContact.name })
                    : t.tabs.fromContacts
                }
                onPress={() => setPickingContact(true)}
              >
                <MaterialCommunityIcons
                  name={pickedContact ? 'account-check-outline' : 'book-account-outline'}
                  size={iconSize.lg}
                  color={pickedContact ? theme.color.brand : theme.color.textMuted}
                />
              </IconButton>
              <IconButton
                label={searchOpen ? t.common.close : t.mergePeople.searchLabel}
                onPress={() => {
                  // Closing the field clears it: a hidden filter still
                  // narrowing the list would read as people gone missing.
                  if (searchOpen) setSearchQuery('');
                  setSearchOpen(!searchOpen);
                }}
              >
                <Ionicons
                  name={searchOpen ? 'close' : 'search'}
                  size={iconSize.lg}
                  color={theme.color.textMuted}
                />
              </IconButton>
            </Row>

            {searchOpen ? (
              <Row
                style={{
                  gap: theme.spacing.sm,
                  paddingHorizontal: theme.spacing.md,
                  height: 40,
                  borderRadius: theme.radius.pill,
                  backgroundColor: theme.color.surfaceMuted,
                }}
              >
                <Ionicons name="search" size={iconSize.base} color={theme.color.textFaint} />
                <TextInput
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  accessibilityLabel={t.mergePeople.searchLabel}
                  placeholder={t.mergePeople.searchPlaceholder}
                  placeholderTextColor={theme.color.textFaint}
                  autoFocus
                  style={{
                    flex: 1,
                    fontSize: theme.typography.body.fontSize,
                    color: theme.color.text,
                    padding: 0,
                    textAlign: 'auto',
                  }}
                />
              </Row>
            ) : null}

            {/* The contact's name fitted several guests. Nobody was ticked —
                this says why, and the list below is where they choose. */}
            {contactNotice ? <Callout tone="info">{contactNotice}</Callout> : null}

            {pickRows.length === 0 ? (
              <Text variant="caption" tone="muted" style={{ paddingVertical: theme.spacing.sm }}>
                {searchNeedle ? t.mergePeople.noMatches : t.mergePeople.noMoreGuests}
              </Text>
            ) : (
              <Card padded={false} style={{ padding: theme.spacing.xs }}>
                {shownPickRows.map((row) => (
                  <PickRow
                    key={row.person_key}
                    row={row}
                    checked={selected.has(row.person_key)}
                    locale={locale}
                    t={t}
                    onToggle={() => toggle(row)}
                  />
                ))}
              </Card>
            )}
            {shownPickRows.length < pickRows.length ? (
              <Button
                label={plural(
                  locale,
                  pickRows.length - shownPickRows.length,
                  t.mergePeople.showAllGuests,
                )}
                variant="ghost"
                size="sm"
                onPress={() => setShowAllGuests(true)}
              />
            ) : null}
          </>
        )}
      </ScrollView>

      {/* Pinned above the tab bar: who is picked, and the one action. Slim on
          purpose — it is a status line with a button, not a second header. */}
      {showFooter ? (
        <View
          style={{
            paddingHorizontal: theme.spacing.lg,
            paddingTop: theme.spacing.sm,
            paddingBottom: clearance,
            borderTopWidth: 1,
            borderTopColor: theme.color.border,
            backgroundColor: theme.color.surface,
            gap: theme.spacing.sm,
          }}
        >
          {error ? <Callout tone="negative">{error}</Callout> : null}
          {/* Somebody picked is still only in the queue. Saying so here beats
              the server's refusal, which would call them a person you share no
              group with. */}
          {pendingPicked ? <Callout tone="warning">{t.mergePeople.pendingBlocked}</Callout> : null}
          {showBar ? (
            <Row style={{ minHeight: 40, gap: theme.spacing.sm }}>
              <AvatarStack
                names={selectedRows.map((row) => row.display_name)}
                max={BAR_AVATARS}
                size={28}
              />
              <Text variant="subheading" numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>
                {plural(locale, pickedCount, t.mergePeople.picked)}
              </Text>
              {merge.isPending ? (
                <ActivityIndicator color={theme.color.brand} />
              ) : pickedCount < 2 ? (
                <Text variant="caption" tone="muted" numberOfLines={1}>
                  {t.mergePeople.pickTwo}
                </Text>
              ) : (
                <Pill
                  label={t.mergePeople.cta}
                  accessibilityLabel={plural(locale, pickedCount, t.mergePeople.mergeCount)}
                  tone="brand"
                  arrow
                  disabled={pendingPicked}
                  onPress={() => openConfirm({ kind: 'picked' })}
                />
              )}
            </Row>
          ) : merge.isPending ? (
            <ActivityIndicator color={theme.color.brand} />
          ) : null}
        </View>
      ) : null}

      {/* Keep which name? — the one decision a merge asks for. The choices are
          the picked people's own names, the suggested one first; the field
          below takes any other. */}
      <Sheet
        visible={target !== null}
        onClose={closeSheet}
        onClosed={onSheetClosed}
        title={t.mergePeople.keepWhichTitle}
        closeLabel={t.common.close}
        style={{ maxHeight: '80%' }}
      >
        <ScrollView
          contentContainerStyle={{ gap: theme.spacing.sm, paddingBottom: theme.spacing.sm }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text variant="caption" tone="muted">
            {t.mergePeople.keepWhichBody}
          </Text>
          <View>
            {nameOptions.map((option) => {
              const on = duplicateNameKey(option) === duplicateNameKey(name);
              return (
                <Pressable
                  key={option}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={option}
                  onPress={() => setSheetName(option)}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.spacing.sm,
                    minHeight: 44,
                    paddingHorizontal: theme.spacing.sm,
                    borderRadius: theme.radius.sm,
                    backgroundColor: on ? theme.color.brandSoft : 'transparent',
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Ionicons
                    name={on ? 'radio-button-on' : 'radio-button-off'}
                    size={iconSize.lg}
                    color={on ? theme.color.brand : theme.color.textFaint}
                  />
                  <Avatar name={option} size={28} ghost />
                  <Text variant="body" numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>
                    {option}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text variant="micro" tone="muted">
            {t.mergePeople.otherName}
          </Text>
          <TextInput
            value={name}
            onChangeText={setSheetName}
            accessibilityLabel={t.mergePeople.nameLabel}
            placeholder={t.mergePeople.namePlaceholder}
            placeholderTextColor={theme.color.textFaint}
            style={{
              height: 44,
              paddingHorizontal: theme.spacing.md,
              borderRadius: theme.radius.sm,
              borderWidth: 1,
              borderColor: theme.color.border,
              fontSize: theme.typography.body.fontSize,
              color: theme.color.text,
              textAlign: 'auto',
            }}
          />
          {/* Say out loud that the name is a suggestion: it is filled from the
              person we already have details for, which is right often enough
              to save typing and wrong often enough never to read as settled. */}
          {showingSuggestion ? (
            <Text variant="micro" tone="muted">
              {t.mergePeople.nameSuggested}
            </Text>
          ) : null}
          <Button
            label={plural(locale, targetCount, t.mergePeople.mergeCount)}
            variant="brand"
            fullWidth
            disabled={!targetReady}
            onPress={submitSheet}
          />
        </ScrollView>
      </Sheet>

      {/* Picking a device contact to name the merge. A React Native Modal keeps
          its children mounted across a close, so the picker is the same one
          add-person uses, opened fresh each time. */}
      <Modal
        supportedOrientations={MODAL_ORIENTATIONS}
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
            {pickingContact ? <ContactPicker single onConfirm={onPickContact} /> : null}
          </View>
        </Screen>
      </Modal>

      {/* After the merge: share a durable join link for each group the merged
          person spans. There is no targeted send in this app — each group has
          one link (see group/[id]/invite) — so inviting them to "all their
          groups" is one Share per group here. */}
      <Modal
        supportedOrientations={MODAL_ORIENTATIONS}
        visible={inviteFor !== null}
        animationType="slide"
        onRequestClose={dismissInvite}
      >
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
  return displayPhone(person.phone) || person.email?.trim() || '';
}

/** A small caps-weight section label ("LIKELY DUPLICATES"). Uppercased in the
 *  style rather than the string, so scripts without case are left alone. */
function SectionLabel({ label }: { label: string }): React.JSX.Element {
  const theme = useTheme();
  return (
    <Text
      variant="micro"
      tone="muted"
      accessibilityRole="header"
      style={{ textTransform: 'uppercase', letterSpacing: 0.6, marginTop: theme.spacing.xs }}
    >
      {label}
    </Text>
  );
}

/**
 * A compact rounded action — the suggestion's "Merge" (soft) and the bar's
 * "Merge →" (filled). Sized to sit inside a 56dp row; the shared `Button` is a
 * 38dp-minimum full control, which is what made the old footer oversized.
 */
function Pill({
  label,
  accessibilityLabel,
  tone,
  arrow = false,
  disabled = false,
  onPress,
}: {
  label: string;
  accessibilityLabel: string;
  tone: 'soft' | 'brand';
  arrow?: boolean;
  disabled?: boolean;
  onPress: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const ink = tone === 'brand' ? theme.color.onBrand : theme.color.brand;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.xs,
        height: 32,
        paddingHorizontal: theme.spacing.md,
        borderRadius: theme.radius.pill,
        backgroundColor: tone === 'brand' ? theme.color.brand : theme.color.brandSoft,
        opacity: disabled ? 0.4 : pressed ? 0.8 : 1,
      })}
    >
      <Text variant="caption" style={{ color: ink, fontWeight: '700' }}>
        {label}
      </Text>
      {arrow ? (
        <Ionicons name={directionalIcon('arrow-forward')} size={iconSize.sm} color={ink} />
      ) : null}
    </Pressable>
  );
}

/** One "likely duplicates" row: the overlapping avatars, the names, why they
 *  were matched, and a Merge pill that opens the confirm for just this set. */
function SuggestionRow({
  set,
  locale,
  t,
  disabled,
  onMerge,
}: {
  set: DuplicateSet;
  locale: string;
  t: UiStrings;
  disabled: boolean;
  onMerge: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const names = duplicateNames(set);
  return (
    <Row
      style={{
        minHeight: 56,
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.sm,
        gap: theme.spacing.sm,
      }}
    >
      <AvatarStack names={set.people.map((row) => row.display_name)} max={3} size={32} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="subheading" numberOfLines={1}>
          {names}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {duplicateReason(set, locale, t.mergePeople)}
        </Text>
      </View>
      <Pill
        label={t.mergePeople.cta}
        accessibilityLabel={fill(t.mergePeople.mergeSetLabel, { people: names })}
        tone="soft"
        disabled={disabled}
        onPress={onMerge}
      />
    </Row>
  );
}

/**
 * One person on the hand-pick list: a leading checkbox, their initials, name and
 * address, and how many groups they turn up in. The whole row is the control,
 * and a picked row is tinted so the selection is visible where it was made.
 * Inert while their membership is only in the local queue — the server would
 * refuse the whole merge over them.
 */
function PickRow({
  row,
  checked,
  locale,
  t,
  onToggle,
}: {
  row: MergeCandidate;
  checked: boolean;
  locale: string;
  t: UiStrings;
  onToggle: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const address = contactAddress(row);
  // A pending row can still be unticked (a pre-pick from Friends), never ticked.
  const inert = row.pending && !checked;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: inert }}
      accessibilityLabel={[row.display_name, address, row.pending ? t.mergePeople.pendingTag : null]
        .filter(Boolean)
        .join(', ')}
      disabled={inert}
      onPress={onToggle}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        minHeight: 52,
        paddingHorizontal: theme.spacing.sm,
        paddingVertical: theme.spacing.xs,
        borderRadius: theme.radius.sm,
        backgroundColor: checked ? theme.color.brandSoft : 'transparent',
        opacity: inert ? 0.5 : pressed ? 0.7 : 1,
      })}
    >
      <View
        style={{
          width: 20,
          height: 20,
          borderRadius: 6,
          borderWidth: checked ? 0 : 1.5,
          borderColor: theme.color.textFaint,
          backgroundColor: checked ? theme.color.brand : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {checked ? (
          <Ionicons name="checkmark" size={iconSize.sm} color={theme.color.onBrand} />
        ) : null}
      </View>
      <Avatar name={row.display_name} size={32} ghost />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="body" numberOfLines={1} style={{ fontWeight: '600' }}>
          {row.display_name}
        </Text>
        {row.pending ? (
          <Text variant="micro" tone="muted" numberOfLines={1}>
            {t.mergePeople.pendingTag}
          </Text>
        ) : address ? (
          <Text
            variant="caption"
            tone="muted"
            numberOfLines={1}
            // A number reads left to right in every locale; without this an
            // Arabic row would put "+91" at the wrong end.
            style={{ writingDirection: 'ltr', textAlign: 'auto' }}
          >
            {address}
          </Text>
        ) : null}
      </View>
      <Text variant="micro" tone="faint" numberOfLines={1}>
        {plural(locale, row.group_ids.length, t.mergePeople.groupCount)}
      </Text>
    </Pressable>
  );
}
