import { Fragment, useCallback, useRef, useState, type ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import {
  ActivityIndicator,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import {
  Avatar,
  Button,
  Callout,
  ChipRow,
  directionalIcon,
  iconSize,
  ListRow as PlainListRow,
  MoneyText,
  Row,
  Sheet,
  Text,
  Toggle,
  useTheme,
  useTabBarClearance,
} from '@waves/ui';

import { format, money, type CurrencyCode } from '@waves/core';

import { GroupPhoto } from '@/components/GroupPhoto';
import { LinkMemberSheet } from '@/components/LinkMemberSheet';
import { linkReasonText, membersAsPeople, type LinkPerson } from '@/lib/linkMember';
import {
  ListRow,
  PillButton,
  ScenicBody,
  ScenicHeader,
  SectionHeader,
  StandardCard,
} from '@/components/standard';
import { type PickedContact } from '@/components/ContactPicker';
import { offerFromOtherGroups } from '@/lib/addFromAnotherGroup';
import { requestAddFromAnotherGroup } from '@/lib/addFromAnotherGroupBridge';
import { addSomeoneRoutes, type AddSomeoneRoute } from '@/lib/addSomeoneRoutes';
import { addPickedBatch } from '@/lib/addPickedBatch';
import { friendlyError } from '@/lib/errors';
import { removeMemberBody } from '@/data/removeMemberConfirm';
import { groupDeleteWarning, orderDebtsForWarning } from '@/lib/groupDeleteWarning';
import { GROUP_DESCRIPTION_MAX, normaliseGroupDescription } from '@/lib/groupDescription';
import { pickGroupPhoto } from '@/lib/image';
import { requestContacts } from '@/lib/contactPickerBridge';
import { router } from '@/lib/navigation';
import { isPhoneCountryError } from '@/lib/phone';
import { CountryRow } from '@/components/CountryPicker';
import { GroupCoverSheet } from '@/components/CoverEmojiPicker';
import { useRemoveDemo } from '@/demo/useRemoveDemo';
import { GroupTagField } from '@/components/GroupTagField';
import { TripDates } from '@/components/TripDates';
import { normaliseGroupTag } from '@/lib/groupTypeTag';
import { MissingRatesCard } from '@/components/MissingRates';
import { SettleInCurrencyRow } from '@/components/SettleInCurrencyRow';
import { SettlesInRow, TripRatesCard, useGroupTripRateStore } from '@/components/TripRates';
import { photoGateParam, photoGateStatus } from '@/lib/groupPhotoGate';
import { canEditSettlementCurrency } from '@/lib/currencyChoices';
import { canUploadGroupPhoto, removeGroupPhoto, uploadGroupPhoto } from '@/data/api';
import {
  useAddGhostMember,
  useGroupMuted,
  useSetGroupMute,
  useDeleteGroup,
  useGroup,
  useGroupFxRates,
  useGroupLedger,
  useGroups,
  useLeaveGroup,
  useCancelMemberLink,
  useGroupMemberLinks,
  useMergeMemberInto,
  useRemoveMember,
  useRequestMemberLink,
  useSetMemberRole,
  useUpdateGroup,
} from '@/data/hooks';
import { useKnownContacts } from '@/data/knownContacts';
import { GroupNotFound } from '@/components/GroupNotFound';
import { GroupSkeleton } from '@/components/Skeletons';
import { fill, plural, useStrings } from '@/i18n';
import { useViewerId } from '@/lib/auth';
import { useFavorites } from '@/lib/favorites';
import { useBlockedUsers } from '@/data/blocked';
import { useDialog } from '@/lib/dialog';
import { type DialogRow } from '@/lib/dialogQueue';
import {
  displayName,
  groupLabel,
  GroupType,
  isBlockedMember,
  type MemberRow,
  isGhost,
  isViewer,
  payableAt,
  SettlementStatus,
} from '@/data/types';

// Same chip icons the create screen wears, so changing a group's kind looks
// like the same control that first set it.
const iconFor =
  (name: keyof typeof Ionicons.glyphMap) =>
  // eslint-disable-next-line react/display-name
  (color: string): ReactNode => <Ionicons name={name} size={iconSize.base} color={color} />;

/** One entry in a member's ⋮ menu. */
interface MemberAction {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  destructive?: boolean;
  /** Undefined draws the row but does nothing, for an action that is not possible yet. */
  onPress?: () => void;
}

const ARCHIVE_ART = require('../../../../assets/images/archive-group-art.webp') as number;

export default function GroupSettingsScreen() {
  const theme = useTheme();
  const { height: windowHeight } = useWindowDimensions();
  // This screen renders under the persistent bottom nav, so it must pad for the
  // bar, not just the system inset — with the plain inset the last of the exit
  // rows sat behind the bar and could not be reached.
  const clearance = useTabBarClearance();
  const { t, locale } = useStrings();
  const { confirm, notify } = useDialog();
  // Why the group is still here. It sits under the delete row rather than
  // fading, because a refused delete leaves the screen looking exactly as it
  // did and a line that is gone in three seconds is a tap that did nothing.
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const { id } = useLocalSearchParams<{ id: string }>();
  const groupId = id ?? '';
  const tripRates = useGroupFxRates(groupId);
  const tripRateStore = useGroupTripRateStore(groupId);

  // Identity for "which member am I", from the session rather than the profile:
  // the session is on the device at launch, the profile is a fetch that lands
  // later, and in the gap `profile?.id` is undefined — which `isViewer` refuses
  // to match, but only if it is given the right thing to compare. See
  // `lib/auth.useViewerId`.
  const viewerId = useViewerId();

  const { group, members, expenses, settlements } = useGroup(groupId);
  const ledger = useGroupLedger(groupId, viewerId);
  const updateGroup = useUpdateGroup(groupId);
  const removeDemo = useRemoveDemo();
  const leaveGroup = useLeaveGroup(groupId);
  const deleteGroup = useDeleteGroup(groupId);
  const { isFavorite, toggle: toggleFavorite } = useFavorites();
  const { blockedIds } = useBlockedUsers();
  const addGhost = useAddGhostMember(groupId);
  const muted = useGroupMuted(groupId);
  const setGroupMute = useSetGroupMute();

  // A name is enough to start splitting with someone (ADR-006). Adding by name
  // or from the phone's contacts both live here; the members screen keeps the
  // extra email/phone address field for the case that needs it.
  const [newName, setNewName] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [addingContacts, setAddingContacts] = useState(false);
  // The "Add someone" sheet, opened from the "+ Add" pill beside the member count.
  const [addOpen, setAddOpen] = useState(false);
  // Who was just added by name, shown in the sheet so adding several people in
  // a row has an answer each time.
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const addMember = (): void => {
    // The button disables while pending, but the keyboard's "done"
    // (onSubmitEditing) can still fire — guard so a second tap can't queue the
    // same person twice.
    if (addGhost.isPending) return;
    const person = newName.trim();
    if (!person) return;
    setAddError(null);
    setJustAdded(null);
    addGhost.mutate(
      { name: person },
      {
        // Only clear the field if it still holds what we submitted, so a name
        // typed for the next person isn't wiped when this add lands.
        onSuccess: () => {
          setNewName((current) => (current.trim() === person ? '' : current));
          setJustAdded(person);
        },
        onError: (caught) =>
          setAddError(friendlyError(caught, t.misc.couldNotAddGeneric, 'groupSettings.addGhost')),
      },
    );
  };

  /**
   * Several people ticked out of the phone's contacts, one call each — the same
   * add path the members screen uses (the server takes one member per request,
   * so batching would only hide which of them failed). A failure part-way does
   * not undo the ones already in: the honest report is which names did not make
   * it, keeping the first refusal's words so the message can say why.
   */
  const addPicked = async (people: readonly PickedContact[]): Promise<void> => {
    setAddError(null);
    setAddingContacts(true);
    const { failed, reason } = await addPickedBatch(
      people,
      (person) => addGhost.mutateAsync(person),
      (caught) =>
        isPhoneCountryError(caught)
          ? t.people.phoneNeedsCountryCode
          : friendlyError(caught, t.misc.tryAgainMoment, 'groupSettings.addPicked'),
    );
    setAddingContacts(false);
    if (failed.length === 0) return;
    setAddError(fill(t.misc.couldNotAddSome, { reason }));
  };

  // Addresses already in the group, so the picker greys them out rather than
  // letting somebody add the same person twice. The server would collapse it
  // anyway — this just makes the reason visible.
  const alreadyAdded = new Set(
    (members.data ?? []).flatMap((member) =>
      [member.invite_email, member.invite_phone].filter((value): value is string => Boolean(value)),
    ),
  );

  /**
   * The ways in, named: what each row of the "add someone" section offers and
   * where it leads. The list itself is decided in `lib/addSomeoneRoutes` so it
   * can be read — and tested — without a renderer.
   *
   * `addressBook` is the device question, not the permission one. Web has no
   * `expo-contacts` at all, so that row would be a door into an apology and is
   * dropped; a phone that *can* be asked keeps the row whatever the answer
   * turns out to be, because the answer is the picker's to get.
   */
  /**
   * Follow one of them.
   *
   * The contacts row leaves its intent with the bridge before navigating,
   * because the picker is a pushed route and cannot hand a value back the way
   * an inline callback could; the ticked people come back through `addPicked`.
   * It also means the OS permission sheet is never raised cold — it is asked on
   * the way into the screen this row has just opened, and a refusal is answered
   * there, leaving every other way in this section exactly as it was.
   *
   * The address book is read on the device and stays on it: only the people
   * ticked are sent anywhere, and only as the name and address needed to invite
   * them (ADR-006).
   */
  const openRoute = (route: AddSomeoneRoute): void => {
    setAddOpen(false);
    if (route.key === 'contacts') {
      requestContacts({
        initial: [],
        existing: alreadyAdded,
        onPicked: (people) => void addPicked(people),
      });
    }
    // Same shape, same reason: the picker is a pushed route and cannot hand a
    // value back, so the intent is left with the bridge before navigating and
    // the ticked people arrive through `addPicked` like every other way in.
    if (route.key === 'fromAnotherGroup') {
      requestAddFromAnotherGroup({ groupId, onPicked: (people) => void addPicked(people) });
    }
    router.push(route.href as never);
  };

  /**
   * The other route in from `lib/addFromAnotherGroup`: the people already in
   * your other groups — the same five friends, a new trip. `addSomeoneRoutes`
   * (PR #784) names this gap and deliberately returns no row for it because
   * nothing built it yet; this is that flow, wired in ahead of that screen's
   * merge (see the header comment on `lib/addFromAnotherGroup` for the full
   * shape and the identity/consent decisions behind it).
   *
   * Whether the row is worth drawing at all is decided the same way that
   * module decides everything else — run the real selection, not a proxy
   * like "is in more than one group", since a lone other group made up of
   * real-account members alone (nobody to copy) must not offer a door that
   * opens onto an empty list.
   */
  const { membersByGroup } = useKnownContacts();
  const otherGroups = useGroups();
  const sourceGroups = (otherGroups.data ?? []).map((sourceGroup) => {
    const raw = membersByGroup.get(sourceGroup.id) ?? [];
    return {
      groupId: sourceGroup.id,
      groupLabel: groupLabel(sourceGroup, raw, viewerId),
      members: raw.map((member) => ({
        memberId: member.id,
        profileId: member.profile_id,
        name: displayName(member, viewerId),
        email: member.invite_email ?? null,
        phone: member.invite_phone ?? null,
        leftAt: member.left_at,
      })),
    };
  });
  const fromAnotherGroupOffer = offerFromOtherGroups({
    currentGroupId: groupId,
    viewerProfileId: viewerId,
    groups: sourceGroups,
  });

  // Leaves its intent with the bridge, same as the contacts row — the ticked
  // people come back through the very same `addPicked`, so a batch from
  // another group fails and reports exactly the way a batch from contacts
  // already does (see `addPicked` above).
  const routes = addSomeoneRoutes({
    groupId,
    t,
    addressBook: Platform.OS !== 'web',
    otherGroupPeople: fromAnotherGroupOffer.length > 0,
  });

  const [name, setName] = useState(group.data?.name ?? '');
  // Seed the name field once the group query resolves (and re-seed if the
  // loaded group changes) — synced in render, the app's idiom for following a
  // value until the user edits it, rather than a setState-in-effect.
  const [seededId, setSeededId] = useState<string | null>(null);
  // The name last handed to the server, so a rename is not sent twice while the
  // group query is still catching up (see `commitName`). Cleared alongside the
  // field whenever a different group is loaded into this screen.
  const [sentName, setSentName] = useState<string | null>(null);
  // The description follows the name exactly: same seeding, same
  // commit-on-blur, same guard against the double trigger. It is the other half
  // of what the group says about itself, so it is edited the same way rather
  // than acquiring a Save button of its own.
  const [description, setDescription] = useState(group.data?.description ?? '');
  // `undefined` is "nothing sent yet", and it has to be distinguishable from
  // the `null` a cleared description normalises to — otherwise the very first
  // clear would compare equal to "nothing sent" and be swallowed, and the
  // description would be unclearable. The name field gets away with a plain
  // null here only because its empty value is '' rather than null.
  const [sentDescription, setSentDescription] = useState<string | null | undefined>(undefined);
  const [tag, setTag] = useState(group.data?.custom_tag ?? '');
  if (group.data && seededId !== group.data.id) {
    setSeededId(group.data.id);
    setName(group.data.name ?? '');
    setSentName(null);
    setDescription(group.data.description ?? '');
    setSentDescription(undefined);
    setTag(group.data.custom_tag ?? '');
  }
  const [status, setStatus] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  // Whether the name is being edited (the rule under it lights up) and whether
  // the cover sheet is open. Both are about the identity row at the top.
  const [naming, setNaming] = useState(false);
  const [describing, setDescribing] = useState(false);
  const [coverOpen, setCoverOpen] = useState(false);

  /**
   * Save the name, if it has actually changed.
   *
   * There used to be a Save button beside the field, which asked for a tap to
   * confirm a change the person had already made and then sat disabled for the
   * rest of the screen's life. Committing on blur and on "done" is the same
   * act with one fewer control. The first guard compares against what the group
   * already carries rather than against emptiness, because clearing the field
   * is a real choice: the group goes back to being named after the people in
   * it, and that is a change worth sending.
   *
   * The second guard is about the two triggers overlapping. Pressing "done"
   * both submits and blurs, so this runs twice in a row, and the second run
   * still sees the old name on `group.data` because the mutation has not come
   * back yet — without `sentName` the same rename would be queued twice.
   */
  const commitName = (): void => {
    const next = name.trim();
    if (next === (group.data?.name ?? '') || next === sentName) return;
    setSentName(next);
    updateGroup.mutate({ name: next || null }, { onSuccess: () => setStatus(t.account.saved) });
  };

  /** Save the tag on blur or a chip tap; clearing it writes NULL. */
  const commitTag = (raw: string): void => {
    const next = normaliseGroupTag(raw);
    if (next === (group.data?.custom_tag ?? null)) return;
    updateGroup.mutate({ custom_tag: next }, { onSuccess: () => setStatus(t.account.saved) });
  };

  /**
   * Save the description, on the same two triggers and with the same two
   * guards as the name above.
   *
   * The comparison is against the normalised form on both sides, not against
   * the raw field: a description that differs from the stored one only by the
   * whitespace somebody left at the end is not a change, and queueing it would
   * put a mutation on the wire and a "Saved" on the screen for nothing.
   */
  const commitDescription = (): void => {
    const next = normaliseGroupDescription(description);
    if (next === (group.data?.description ?? null) || next === sentDescription) return;
    setSentDescription(next);
    updateGroup.mutate({ description: next }, { onSuccess: () => setStatus(t.account.saved) });
  };

  // A group photo is a paid feature; the cover emoji is free. The group may
  // carry a photo if anyone in it is paid (or it holds a pass) — a server-side
  // question, since one member cannot read another's subscription.
  const photoGate = useQuery({
    queryKey: ['photoGate', groupId],
    queryFn: () => canUploadGroupPhoto(photoGateParam(groupId)),
    enabled: groupId.length > 0,
  });
  const photoStatus = photoGateStatus(photoGate.data, photoGate.isLoading);

  const changePhoto = async (): Promise<void> => {
    const picked = await pickGroupPhoto();
    if (!picked) return;
    setStatus(null);
    setUploading(true);
    try {
      await uploadGroupPhoto({ groupId, base64: picked.base64, mimeType: picked.mimeType });
      await group.refetch();
      setStatus(t.group.photoUpdated);
    } catch (caught) {
      setStatus(friendlyError(caught, t.couldNotSave, 'groupSettings.changePhoto'));
    } finally {
      setUploading(false);
    }
  };

  const dropPhoto = async (): Promise<void> => {
    setStatus(null);
    try {
      await removeGroupPhoto(groupId, group.data?.photo_path ?? null);
      await group.refetch();
    } catch (caught) {
      setStatus(friendlyError(caught, t.couldNotSave, 'groupSettings.dropPhoto'));
    }
  };

  // The edit sheet closes itself for a picker route (the Modal would sit over
  // it), and comes back when this screen is focused again.
  const [editOpen, setEditOpen] = useState(false);
  const reopenEdit = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (reopenEdit.current) {
        reopenEdit.current = false;
        setEditOpen(true);
      }
    }, []),
  );
  const leaveEditForPicker = (): void => {
    reopenEdit.current = true;
    setEditOpen(false);
  };
  /** Closing commits whatever is still being typed: a Modal does not always blur its fields. */
  const closeEdit = (): void => {
    Keyboard.dismiss();
    commitName();
    commitDescription();
    setEditOpen(false);
  };
  // A member's ⋮ menu (by member id), and which ⓘ explanation is open.
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [info, setInfo] = useState<'simplify' | 'mute' | null>(null);
  const removeFromGroup = useRemoveMember(groupId);
  const setRole = useSetMemberRole(groupId);
  // "Link to a Waves user" (admin-only, as on the member screen): what this
  // group's admins have asked and are still waiting on, and the ways to act.
  const links = useGroupMemberLinks(groupId);
  const mergeInto = useMergeMemberInto(groupId);
  const requestLink = useRequestMemberLink(groupId);
  const cancelLink = useCancelMemberLink(groupId);
  const [linkFor, setLinkFor] = useState<string | null>(null);

  if (group.isLoading) return <GroupSkeleton />;

  if (!group.data) {
    return <GroupNotFound groupId={groupId} />;
  }

  const settled = ledger.myBalance === 0n;
  const currency = group.data.default_currency;

  // Deleting a group is an admin power (like changing roles). A non-admin never
  // sees the button; the RPC refuses it regardless (NOT_ADMIN).
  const isAdmin = (members.data ?? []).some(
    (member) => isViewer(member, viewerId) && member.role === 'admin',
  );
  const canChangeCurrency = canEditSettlementCurrency(
    isAdmin,
    // `rows`, not `data`: the first expense of an offline session is in the
    // queue and nowhere else, and the server would happily take a currency
    // change queued behind it — leaving one bill counted in a currency the
    // group no longer settles in.
    expenses.rows.length,
    tripRates.data?.length ?? 0,
    // The server freezes the currency on a recorded settlement too.
    (settlements.data ?? []).length,
  );
  const liveSettlementCount = (settlements.data ?? []).filter(
    (row) => row.status !== SettlementStatus.Cancelled,
  ).length;

  const leave = async (): Promise<void> => {
    // A refusal, not a failure — it explains why the tap did nothing, so it
    // keeps its dialog rather than fading past as a toast.
    if (!settled) {
      await notify({ title: t.group.settleFirst, body: t.group.settleFirstBody });
      return;
    }
    const ok = await confirm({
      title: t.group.leaveQuestion,
      body: t.group.leaveBody,
      confirmLabel: t.group.leave,
      tone: 'danger',
    });
    if (!ok || !ledger.myMemberId) return;
    leaveGroup.mutate(ledger.myMemberId, { onSuccess: () => router.replace('/') });
  };

  // Archiving puts a group away; it does not throw anything out, and it can be
  // undone from the archive. So it asks in the ordinary voice — no warning mark,
  // no red door — which is the difference the native alert could not draw.
  const archive = async (): Promise<void> => {
    const ok = await confirm({
      title: t.group.archiveQuestion,
      body: t.group.archiveBody,
      confirmLabel: t.group.archive,
      confirmIcon: 'file-tray-stacked-outline',
      art: ARCHIVE_ART,
    });
    if (ok) {
      updateGroup.mutate(
        { archived_at: new Date().toISOString() },
        { onSuccess: () => router.replace('/') },
      );
    }
  };

  // An archived group can now be opened, so this screen has to offer the way
  // back. Before, the only Unarchive in the app was on the archive shelf in
  // settings, because a group there was the one place you could reach it from;
  // arriving here instead — from a balance on the Friends list, say — and being
  // offered "Archive" on a group that is already archived would be a control
  // that does nothing you can see. No confirmation: putting something back is
  // not a decision that wants a second thought, and it stays on the screen so
  // the row simply flips.
  const archived = Boolean(group.data?.archived_at);
  const unarchive = (): void => {
    updateGroup.mutate({ archived_at: null });
  };

  /**
   * The open debts — "Asha owes Ravi", and ₹500 beside it — for the delete
   * warning. Read off the same `transfers` the who-pays-whom screen shows, so
   * the amounts in the warning are the amounts the group has been looking at,
   * and across every currency rather than only the group default.
   *
   * The money is handed over as money rather than formatted into the sentence.
   * The native alert could be told nothing but strings, so four real debts
   * arrived as one paragraph; a row keeps the name and the amount apart, and
   * `MoneyText` then draws the amount the way every other amount in this app is
   * drawn, with the spoken label it carries everywhere else.
   *
   * Names are the plain member names, never "You": the line has to read the
   * same to whoever is holding the phone, and "You owes Ravi" is not a
   * sentence in any of the four languages. A blocked person keeps the ghost
   * they wear everywhere else (A62) — the block is about not seeing a name all
   * day, and a warning is not the place to hand it back.
   */
  const outstandingDebts = (): DialogRow[] => {
    const nameFor = (memberId: string): string => {
      const member = (members.data ?? []).find((row) => row.id === memberId);
      // The label for a member with no name of their own is passed in rather
      // than left to the default, which is the English word: this dialog is the
      // last thing somebody reads before destroying a record, and half of it
      // arriving in another language is not the moment for it.
      return member ? displayName(member, undefined, blockedIds, t.misc.someone) : t.misc.someone;
    };
    return orderDebtsForWarning(ledger.transfers, currency).map((transfer) => ({
      // Two members and a currency are exactly one debt in `transfers`, so this
      // is stable across a re-render and unique within the list.
      key: `${transfer.from}:${transfer.to}:${transfer.currency}`,
      label: fill(t.group.deleteOwesWho, {
        from: nameFor(transfer.from),
        to: nameFor(transfer.to),
      }),
      amount: { minor: transfer.amount, currency: transfer.currency as CurrencyCode },
    }));
  };

  // Delete removes the group for everyone (A49), immediately and with no undo,
  // so the confirmation is written to be read rather than tapped through.
  //
  // It used to refuse outright unless the whole group was square. That rule is
  // gone — a group whose balances will never reach zero (the trip nobody
  // settled, the group created by mistake) could otherwise never be deleted by
  // anybody, including the person who created it. What replaces it is honesty:
  // when balances are open, the dialog names them and says plainly that
  // deleting throws that record away for every member, not only for the admin
  // tapping. This is the dialog the whole replacement was for: it is the one
  // place in the app where the consequence of a tap is a list of real people
  // and real money, and the native alert rendered it as a wall of prose.
  const confirmDelete = async (): Promise<void> => {
    const debts = ledger.groupSettled ? [] : outstandingDebts();
    // Enough rows to make the loss concrete without turning the dialog into a
    // ledger; the rest are counted, since the point is the size of what goes.
    const warning = groupDeleteWarning({
      groupSettled: ledger.groupSettled,
      debts,
      locale,
      text: t.group,
    });

    const ok = await confirm({
      title: t.group.deleteQuestion,
      body: warning.body,
      rows: warning.rows,
      moreRows: warning.moreRows,
      note: warning.note,
      // "Delete anyway" when there is something to lose, so the button itself
      // admits what the rows above it just showed.
      confirmLabel: ledger.groupSettled ? t.group.delete : t.group.deleteAnyway,
      tone: 'danger',
    });
    if (!ok || deleteGroup.isPending) return;
    setDeleteError(null);

    deleteGroup.mutate(undefined, {
      onSuccess: () => router.replace('/'),
      onError: (caught) => {
        // The one coded refusal left carries a `code` (set in api.deleteGroup);
        // show its localized line directly. Anything else is unknown and goes
        // through friendlyError, which never echoes raw backend text.
        //
        // Neither a second dialog nor a toast: stacking a dialog on the one just
        // dismissed is how somebody taps through a sentence without reading it,
        // and a toast that fades leaves a screen that looks untouched with no
        // explanation on it. It stays under the row that was refused.
        const code = (caught as { code?: string } | null)?.code;
        setDeleteError(
          code === 'NOT_ADMIN'
            ? t.group.deleteAdminOnly
            : friendlyError(caught, t.misc.tryAgainMoment, 'groupSettings.delete'),
        );
      },
    });
  };

  const memberCount = (members.data ?? []).length;
  const created = new Date(group.data.created_at);
  const createdLabel = Number.isNaN(created.getTime())
    ? null
    : fill(t.group.createdOn, {
        date: created.toLocaleDateString(locale, {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        }),
      });
  const groupName = groupLabel(group.data, members.data ?? [], viewerId);
  const menuMember = (members.data ?? []).find((row) => row.id === menuFor) ?? null;
  const linkMember = (members.data ?? []).find((row) => row.id === linkFor) ?? null;
  const tint = (hex: string): string => `${hex}${theme.scheme === 'dark' ? '38' : '24'}`;

  /** The tinted circle on a row's left, as in the mockup. */
  const chip = (icon: keyof typeof Ionicons.glyphMap, hex: string | null): ReactNode => (
    <View
      style={{
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: hex ? tint(hex) : theme.color.brandSoft,
      }}
    >
      <Ionicons name={icon} size={iconSize.lg} color={hex ?? theme.color.brand} />
    </View>
  );

  /** The ⓘ beside a title; the explanation opens under the row. */
  const infoDot = (key: 'simplify' | 'mute', title: string): ReactNode => (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: info === key }}
      accessibilityLabel={t.common.about.replace('{title}', title)}
      hitSlop={8}
      onPress={() => setInfo(info === key ? null : key)}
    >
      <Ionicons
        name={info === key ? 'information-circle' : 'information-circle-outline'}
        size={iconSize.md}
        color={info === key ? theme.color.brand : theme.color.textFaint}
      />
    </Pressable>
  );
  const infoText = (key: 'simplify' | 'mute', body: string): ReactNode =>
    info === key ? (
      <Text variant="caption" tone="muted">
        {body}
      </Text>
    ) : null;

  const removeMember = async (member: MemberRow): Promise<void> => {
    if (removeFromGroup.isPending) return;
    const realName = displayName(member, null, blockedIds, t.misc.someone);
    const ok = await confirm({
      title: fill(t.people.removeConfirmTitle, { name: realName }),
      body: removeMemberBody({
        name: realName,
        balance: ledger.balances.get(member.id) ?? 0n,
        currency,
        locale,
        strings: {
          body: t.people.removeConfirmBody,
          stillOwes: t.people.removeStillOwes,
          isOwed: t.people.removeIsOwed,
        },
      }),
      confirmLabel: t.people.removeFromGroup,
      tone: 'danger',
    });
    if (!ok) return;
    setStatus(null);
    removeFromGroup.mutate(member.id, {
      onError: (caught) =>
        setStatus(friendlyError(caught, t.couldNotSave, 'settings.removeMember')),
    });
  };

  const toggleRole = (member: MemberRow): void => {
    if (setRole.isPending || isGhost(member)) return;
    setStatus(null);
    setRole.mutate(
      { memberId: member.id, role: member.role === 'admin' ? 'member' : 'admin' },
      {
        onSuccess: () => setStatus(t.account.saved),
        onError: (caught) => setStatus(friendlyError(caught, t.couldNotSave, 'settings.setRole')),
      },
    );
  };

  const pendingLinkFor = (memberId: string) =>
    links.data?.find((ask) => ask.member_id === memberId) ?? null;

  /** The same person is already here: fold the placeholder into them. */
  const confirmMerge = async (
    member: MemberRow,
    into: { memberId: string; name: string },
  ): Promise<void> => {
    const placeholderName = member.ghost_name ?? t.misc.someone;
    const balance = ledger.balances.get(member.id) ?? 0n;
    const involved = expenses.rows.filter((expense) =>
      expense.currentVersion?.shares.some((share) => share.member_id === member.id),
    );
    const ok = await confirm({
      title: fill(t.link.mergeConfirmTitle, { name: placeholderName, who: into.name }),
      body: fill(t.link.mergeConfirmBody, {
        name: placeholderName,
        who: into.name,
        expenses: plural(locale, involved.length, t.link.mergeExpenses),
        balance: format(money(balance < 0n ? -balance : balance, currency as CurrencyCode), {
          locale,
        }),
      }),
      confirmLabel: t.link.mergeAction,
      tone: 'danger',
    });
    if (!ok) return;
    setStatus(null);
    mergeInto.mutate(
      { memberId: member.id, intoMemberId: into.memberId },
      {
        onSuccess: (verdict) => {
          if (!verdict.ok) setStatus(linkReasonText(verdict.reason, t));
        },
        onError: (caught) => setStatus(friendlyError(caught, t.link.failed, 'settings.merge')),
      },
    );
  };

  /** The person is not in this group: ask them; nothing attaches until they say yes. */
  const confirmAsk = async (member: MemberRow, person: LinkPerson): Promise<void> => {
    const placeholderName = member.ghost_name ?? t.misc.someone;
    const me = (members.data ?? []).find((row) => isViewer(row, viewerId));
    const ok = await confirm({
      title: fill(t.link.askConfirmTitle, { who: person.name }),
      body: fill(t.link.askConfirmBody, {
        me: me ? displayName(me, null, blockedIds, t.misc.someone) : t.misc.someone,
        name: placeholderName,
        group: groupName,
      }),
      confirmLabel: t.link.askAction,
    });
    if (!ok) return;
    setStatus(null);
    requestLink.mutate(
      { memberId: member.id, targetProfileId: person.profileId },
      {
        onSuccess: (verdict) => {
          if (verdict.ok) {
            setStatus(fill(t.link.askSent, { who: person.name }));
          } else if (verdict.reason === 'ALREADY_IN_GROUP' && verdict.member_id) {
            void confirmMerge(member, { memberId: verdict.member_id, name: person.name });
          } else {
            setStatus(linkReasonText(verdict.reason, t));
          }
        },
        onError: (caught) => setStatus(friendlyError(caught, t.link.failed, 'settings.link')),
      },
    );
  };

  const confirmCancelAsk = async (member: MemberRow): Promise<void> => {
    const ask = pendingLinkFor(member.id);
    if (!ask) return;
    const ok = await confirm({
      title: fill(t.link.waiting, { who: ask.target_name ?? t.misc.someone }),
      body: t.link.waitingHint,
      confirmLabel: t.link.cancelAsk,
      tone: 'danger',
    });
    if (!ok) return;
    cancelLink.mutate(ask.id, {
      onError: (caught) => setStatus(friendlyError(caught, t.link.failed, 'settings.linkCancel')),
    });
  };

  /**
   * The actions in a member's ⋮ menu. Open, role and remove are the ones the
   * member's own screen has always had; anything else a person can do to a
   * member joins this list, so the menu stays the one place to look.
   *
   * "Link to a Waves user" is admin-only and for placeholders only, exactly as
   * on the member screen; while an ask waits the row says so and a tap takes it back.
   */
  const memberActions = (member: MemberRow): MemberAction[] => {
    const isMe = isViewer(member, viewerId);
    const ghost = isGhost(member);
    const actions: MemberAction[] = [
      {
        key: 'open',
        icon: 'person-outline',
        title: t.group.openMember,
        onPress: () => router.push(`/group/${groupId}/member/${member.id}`),
      },
    ];
    if (ghost && isAdmin && !member.left_at) {
      const ask = pendingLinkFor(member.id);
      actions.push(
        ask
          ? {
              key: 'link',
              icon: 'hourglass-outline',
              title: fill(t.link.waiting, { who: ask.target_name ?? t.misc.someone }),
              subtitle: t.link.waitingHint,
              onPress: cancelLink.isPending ? undefined : () => void confirmCancelAsk(member),
            }
          : {
              key: 'link',
              icon: 'link-outline',
              title: t.link.row,
              subtitle: fill(t.link.rowHint, { name: member.ghost_name ?? t.misc.someone }),
              onPress:
                mergeInto.isPending || requestLink.isPending
                  ? undefined
                  : () => setLinkFor(member.id),
            },
      );
    }
    if (isAdmin && !isMe) {
      actions.push({
        key: 'role',
        icon: member.role === 'admin' ? 'shield-outline' : 'shield-checkmark-outline',
        title: t.people.manageRole,
        subtitle: ghost
          ? t.people.adminNeedsAccount
          : member.role === 'admin'
            ? t.people.currentRoleAdmin
            : t.people.currentRoleMember,
        onPress: ghost ? undefined : () => toggleRole(member),
      });
      if (!member.left_at) {
        actions.push({
          key: 'remove',
          icon: 'person-remove-outline',
          title: t.people.removeFromGroup,
          subtitle: t.people.removeFromGroupHint,
          destructive: true,
          onPress: () => void removeMember(member),
        });
      }
    }
    return actions;
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.bg }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: clearance }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <ScenicHeader title={t.group.settings} titleAlign="start" circleBack wash wide>
          <Row style={{ alignItems: 'center', gap: theme.spacing.md, flex: 1 }}>
            <Row style={{ alignItems: 'center', gap: theme.spacing.md, flexShrink: 1 }}>
              <View
                style={{
                  borderRadius: 35,
                  borderWidth: 3,
                  borderColor: theme.scheme === 'dark' ? '#2A2A40' : '#FFFFFF',
                }}
              >
                <GroupPhoto
                  photoPath={group.data.photo_path}
                  emoji={group.data.cover_emoji}
                  color={group.data.cover_color}
                  size={64}
                  round
                  busy={uploading}
                />
              </View>
              <View style={{ flexShrink: 1, gap: 2 }}>
                <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
                  <Text
                    variant="heading"
                    numberOfLines={1}
                    style={{ fontSize: 20, fontWeight: '800', flexShrink: 1 }}
                  >
                    {groupName}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t.group.editGroup}
                    hitSlop={10}
                    onPress={() => setEditOpen(true)}
                  >
                    <Ionicons name="create-outline" size={iconSize.md} color={theme.color.brand} />
                  </Pressable>
                </Row>
                <Text variant="caption" numberOfLines={1}>
                  {[plural(locale, memberCount, t.memberCount), createdLabel]
                    .filter(Boolean)
                    .join('  ·  ')}
                </Text>
              </View>
            </Row>
            <View style={{ flex: 1 }} />
            <PillButton
              label={t.group.changePill}
              icon="image-outline"
              chevron={false}
              accessibilityLabel={t.group.changeCover}
              onPress={() => setCoverOpen(true)}
            />
          </Row>
        </ScenicHeader>

        <ScenicBody>
          {/* ADR-009: simplification is presentation only — the pairwise ledger
              underneath is untouched, so this is safe to toggle at any time.
              Mute is this person's own switch, not the group's: pushes about
              the group stop reaching them, the inbox keeps everything, and the
              others are never told (the `group_mutes` migration). */}
          <StandardCard>
            <ListRow
              leading={chip('swap-horizontal', null)}
              title={t.group.simplifyDebts}
              subtitle={t.group.simplifyDebtsSub}
              subtitleLines={2}
              titleAccessory={infoDot('simplify', t.group.simplifyDebts)}
              footer={infoText('simplify', t.group.simplifyDebtsBody)}
              divider
              trailing={
                <Toggle
                  value={group.data.simplify_debts}
                  onValueChange={(value) => updateGroup.mutate({ simplify_debts: value })}
                  accessibilityLabel={t.group.simplifyDebts}
                />
              }
            />
            <ListRow
              leading={chip('notifications-outline', null)}
              title={t.group.muteNotifications}
              subtitle={t.group.muteSub}
              subtitleLines={2}
              titleAccessory={infoDot('mute', t.group.muteNotifications)}
              footer={infoText('mute', t.group.muteNotificationsBody)}
              trailing={
                <Toggle
                  value={muted}
                  onValueChange={(value) => setGroupMute.mutate({ groupId, muted: value })}
                  accessibilityLabel={t.group.muteNotifications}
                />
              }
            />
          </StandardCard>

          <View style={{ gap: theme.spacing.md }}>
            <SectionHeader
              title={fill(t.group.membersTitle, { n: memberCount })}
              trailing={
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t.group.addMembers}
                  onPress={() => {
                    // Nothing in the sheet should be typing yet: drop any focus
                    // left on the page's own fields so the keyboard does not
                    // open over the sheet. The name field is focused by a tap.
                    Keyboard.dismiss();
                    setAddOpen(true);
                  }}
                  style={{
                    height: 38,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.spacing.sm,
                    paddingHorizontal: theme.spacing.lg,
                    borderRadius: theme.radius.pill,
                    backgroundColor: theme.color.brandSoft,
                  }}
                >
                  <Ionicons
                    name="person-add-outline"
                    size={iconSize.base}
                    color={theme.color.brand}
                  />
                  <Text variant="caption" tone="brand" style={{ fontWeight: '700' }}>
                    {t.group.addMembers}
                  </Text>
                </Pressable>
              }
            />

            {/* The picker routes close the sheet before the people come back, so
                their progress and any refusal are shown here, on the page, where
                the person is looking. While the sheet is open it shows its own. */}
            {!addOpen && addingContacts ? <ActivityIndicator color={theme.color.brand} /> : null}
            {!addOpen && addError ? <Callout tone="negative">{addError}</Callout> : null}

            {/* The roster, so seeing who is in the group costs no tap through to
                the members screen. A row opens the person; ⋮ lists what can be
                done to them. */}
            <StandardCard>
              {(members.data ?? []).map((member) => {
                const isMe = isViewer(member, viewerId);
                const ghost = isGhost(member) || isBlockedMember(member, blockedIds);
                return (
                  <ListRow
                    key={member.id}
                    highlight={isMe ? theme.color.brandSoft : undefined}
                    title={displayName(member, viewerId, blockedIds, t.misc.someone)}
                    subtitle={
                      isGhost(member)
                        ? pendingLinkFor(member.id)
                          ? fill(t.link.waiting, {
                              who: pendingLinkFor(member.id)?.target_name ?? t.misc.someone,
                            })
                          : t.notJoinedYet
                        : // A handle carries a name, an address or a phone number,
                          // so a blocked person's is masked here exactly as it is
                          // on the members screen.
                          isBlockedMember(member, blockedIds)
                          ? t.misc.noUpiYet
                          : // The rail pair, not the legacy UPI column alone.
                            (payableAt(member)?.handle ?? t.misc.noUpiYet)
                    }
                    leading={
                      <Avatar
                        name={displayName(member, null, blockedIds, t.misc.someone)}
                        ghost={ghost}
                      />
                    }
                    onPress={() => router.push(`/group/${groupId}/member/${member.id}`)}
                    divider={!isMe}
                    trailing={
                      <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
                        {member.role === 'admin' && !isGhost(member) ? (
                          <View
                            style={{
                              paddingHorizontal: theme.spacing.md,
                              paddingVertical: 4,
                              borderRadius: theme.radius.pill,
                              backgroundColor: theme.color.brand,
                            }}
                          >
                            <Text variant="caption" style={{ color: '#FFFFFF', fontWeight: '700' }}>
                              {t.group.adminTitle}
                            </Text>
                          </View>
                        ) : null}
                        <MoneyText
                          amount={ledger.balances.get(member.id) ?? 0n}
                          currency={currency}
                          locale={locale}
                          mode="balance"
                        />
                        {isMe ? null : (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`${t.group.memberMenu}: ${displayName(member, null, blockedIds, t.misc.someone)}`}
                            hitSlop={8}
                            onPress={() => setMenuFor(member.id)}
                          >
                            <Ionicons
                              name="ellipsis-vertical"
                              size={iconSize.lg}
                              color={theme.color.textMuted}
                            />
                          </Pressable>
                        )}
                      </Row>
                    }
                  />
                );
              })}

              {/* Inviting is the other way in, and the commonest: send a link,
                  they join themselves. It sits last in the card it adds to. */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${t.group.inviteToGroup}, ${t.group.inviteToGroupHint}`}
                onPress={() => router.push(`/group/${groupId}/invite`)}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.spacing.md,
                  marginTop: theme.spacing.sm,
                  padding: theme.spacing.md,
                  borderRadius: theme.radius.lg,
                  backgroundColor: theme.color.brandSoft,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <View
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 22,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: theme.color.brand,
                  }}
                >
                  <Ionicons name="link" size={iconSize.lg} color="#FFFFFF" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text tone="brand" style={{ fontWeight: '700' }}>
                    {t.group.inviteToGroup}
                  </Text>
                  <Text variant="caption" tone="muted">
                    {t.group.inviteToGroupHint}
                  </Text>
                </View>
                <Ionicons
                  name={directionalIcon('chevron-forward')}
                  size={iconSize.md}
                  color={theme.color.brand}
                />
              </Pressable>
            </StandardCard>
          </View>

          {status ? (
            <Text variant="caption" tone="positive">
              {status}
            </Text>
          ) : null}

          {/* Group actions: everything that is about this group as a whole.
              Archiving is reversible and touches nobody but your own list;
              leaving affects only you; deleting takes the group from everyone,
              at once, with no undo — so it is admin-only (the RPC refuses it
              regardless) and wears the negative colour. */}
          <View style={{ gap: theme.spacing.md }}>
            <SectionHeader title={t.group.groupActions} />
            <StandardCard>
              {group.data?.isDemo ? (
                // The demo group has exactly one way out — archiving and leaving
                // both assume a real membership and a real server row, neither
                // of which this group has.
                <ListRow
                  leading={chip('flask-outline', '#E5384B')}
                  title={t.demo.removeAction}
                  subtitle={t.demo.removeHint}
                  destructive
                  onPress={() =>
                    void removeDemo().then((removed) => {
                      if (removed) router.replace('/');
                    })
                  }
                />
              ) : (
                <>
                  <ListRow
                    leading={chip('copy-outline', '#2F80ED')}
                    title={t.clone.duplicateTitle}
                    subtitle={t.clone.duplicateHint}
                    onPress={() => router.push(`/new-group?from=${groupId}`)}
                    divider
                  />
                  <ListRow
                    leading={chip(isFavorite(groupId) ? 'star' : 'star-outline', '#F5A301')}
                    title={t.clone.favoriteTitle}
                    subtitle={t.clone.favoriteHint}
                    subtitleLines={2}
                    divider
                    trailing={
                      <Toggle
                        value={isFavorite(groupId)}
                        onValueChange={() => toggleFavorite(groupId)}
                        accessibilityLabel={t.clone.favoriteTitle}
                      />
                    }
                  />
                  <ListRow
                    leading={chip('archive-outline', '#E5566D')}
                    title={archived ? t.group.unarchive : t.group.archiveGroup}
                    subtitle={archived ? t.group.unarchiveHint : t.group.archiveHintShort}
                    onPress={archived ? unarchive : () => void archive()}
                    divider
                  />
                  <ListRow
                    leading={chip('person-remove-outline', '#E5566D')}
                    title={t.group.leaveGroup}
                    subtitle={t.group.leaveHint}
                    destructive
                    onPress={() => void leave()}
                    divider={isAdmin}
                  />
                  {isAdmin ? (
                    <View style={{ opacity: deleteGroup.isPending ? 0.45 : 1 }}>
                      <ListRow
                        leading={chip('trash-outline', '#E5384B')}
                        title={t.group.deleteGroup}
                        subtitle={t.group.deleteHintShort}
                        destructive
                        onPress={deleteGroup.isPending ? undefined : () => void confirmDelete()}
                      />
                    </View>
                  ) : null}
                </>
              )}
            </StandardCard>
            {/* Why the group is still here, under the card rather than fading: a
                refused delete leaves the screen looking exactly as it did. The
                unsettled warning lives in the confirm dialog itself. */}
            {deleteError !== null ? <Callout tone="negative">{deleteError}</Callout> : null}
          </View>
        </ScenicBody>
      </ScrollView>

      {/* The "Add someone" sheet, opened from "Add members". */}
      <Sheet
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        title={t.people.addSomeone}
        closeLabel={t.common.close}
      >
        {/* The ways in, each one named.

              This section used to ask you to guess. A text field with nothing
              over it but the words "Add someone", a ghost button under it
              reading "Browse my contacts", and — four rows further down the
              page, in a card of its own — the invite link. Three different ways
              of getting a person into the group, and none of the three said
              where that person was coming from before you pressed it; the one
              most people actually want (send a link, they join themselves) did
              not look like part of adding anybody at all.

              So the doors come first, as rows with a mark, a name and a line
              saying what the tap does, ordered by how often each is the right
              answer rather than alphabetically. Typing a name follows under a
              rule, as the fallback it is — the same shape the members screen
              settled on, drawn in this screen's own row idiom.

              `ListRow` rather than a `DetailRow`: these are entries you *open*,
              each with a name and a subtitle, not facts about the group with a
              value on the right. That is the row this screen already wears for
              duplicate, favourite and the three ways out, so the section reads
              as part of the page instead of introducing a fourth kind of row.

              Missing, and worth saying out loud: the people already in your
              other groups — the same friends, a new trip — which is very likely
              the commonest reason this section is opened. No flow exists for it
              yet, and a row leading nowhere is worse than no row, so none is
              drawn (see `lib/addSomeoneRoutes`). */}
        <View style={{ gap: theme.spacing.md }}>
          {/* The hairline belongs to the gap, not to the row: drawn by the
                row itself it would leave a stray line under the last one. Keyed
                off the position in the list that was actually returned, so a
                row that is absent (no address book) takes its divider with it
                rather than leaving a line with nothing on one side of it. */}
          <View>
            {routes.map((route, index) => (
              <Fragment key={route.key}>
                {index > 0 ? (
                  <View style={{ height: 1, backgroundColor: theme.color.border }} />
                ) : null}
                <PlainListRow
                  title={route.title}
                  subtitle={route.hint}
                  // The name alone says a place, not an act. A reader hears
                  // both halves — "From your contacts, pick names out of this
                  // phone's address book" — which is the whole point of the
                  // rewrite and would be lost to a label of just the title.
                  accessibilityLabel={route.spoken}
                  leading={
                    <Ionicons name={route.icon} size={iconSize.xl} color={theme.color.textMuted} />
                  }
                  onPress={() => openRoute(route)}
                  trailing={
                    <Ionicons
                      // Content, not layout: RN mirrors the row in RTL but
                      // leaves the glyph pointing whichever way it was drawn.
                      name={directionalIcon('chevron-forward')}
                      size={iconSize.md}
                      color={theme.color.textFaint}
                    />
                  }
                />
              </Fragment>
            ))}
          </View>

          {/* A rule with the alternative written into it, so the field below
                reads as the other way rather than as the only way — the same
                divider, and the same string, the members screen uses. */}
          <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
            <View style={{ flex: 1, height: 1, backgroundColor: theme.color.border }} />
            <Text variant="micro" tone="faint">
              {t.people.orByName}
            </Text>
            <View style={{ flex: 1, height: 1, backgroundColor: theme.color.border }} />
          </Row>

          <Row style={{ gap: theme.spacing.sm }}>
            <TextInput
              value={newName}
              autoFocus={false}
              onChangeText={setNewName}
              placeholder={t.people.namePlaceholder}
              placeholderTextColor={theme.color.textFaint}
              accessibilityLabel={t.common.name}
              onSubmitEditing={addMember}
              // Both add flows drive the one `addGhost` mutation and the one
              // `addError`; gate each on the other so a name typed mid-batch
              // cannot race the contacts loop and clobber its result.
              editable={!addGhost.isPending && !addingContacts}
              returnKeyType="done"
              style={{
                flex: 1,
                fontSize: 17,
                fontWeight: '600',
                color: theme.color.text,
                paddingVertical: theme.spacing.sm,
              }}
            />
            <Button
              label={t.add}
              size="sm"
              variant="secondary"
              disabled={!newName.trim() || addGhost.isPending || addingContacts}
              onPress={addMember}
            />
          </Row>

          {/* Every way in is a row above; what is left at the foot of the
                card is the one spinner and the one error line, because all of
                them drive the same mutation and beside-the-button would mean
                three of each. */}
          {addingContacts ? <ActivityIndicator color={theme.color.brand} /> : null}
          {justAdded ? (
            <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
              <Ionicons name="checkmark-circle" size={iconSize.md} color={theme.color.positive} />
              <Text variant="caption" tone="muted">
                {justAdded}
              </Text>
            </Row>
          ) : null}
          {addError ? <Callout tone="negative">{addError}</Callout> : null}
        </View>
      </Sheet>

      {/* One sheet for the cover: icon and colour, or a photo. */}
      <GroupCoverSheet
        visible={coverOpen}
        onClose={() => setCoverOpen(false)}
        value={group.data.cover_emoji}
        color={group.data.cover_color ?? null}
        name={groupName}
        onColorChange={(cover_color) =>
          updateGroup.mutate({ cover_color }, { onSuccess: () => setStatus(t.account.saved) })
        }
        // Says "Saved" like every other setting on this screen. The mark is
        // drawn, so a changed cover has no words of its own to confirm it.
        onChange={(emoji) =>
          updateGroup.mutate(
            { cover_emoji: emoji },
            { onSuccess: () => setStatus(t.account.saved) },
          )
        }
        hasPhoto={Boolean(group.data.photo_path)}
        photoStatus={photoStatus}
        onPickPhoto={() => void changePhoto()}
        onRemovePhoto={() => void dropPhoto()}
        onUpgrade={() => router.push('/settings/upgrade')}
      />

      {/* A member's ⋮ menu: the person's own page, their role, removing them. */}
      <Sheet
        visible={menuMember !== null}
        onClose={() => setMenuFor(null)}
        title={
          menuMember ? displayName(menuMember, viewerId, blockedIds, t.misc.someone) : undefined
        }
        closeLabel={t.common.close}
      >
        {menuMember
          ? memberActions(menuMember).map((action, index, all) => (
              <ListRow
                key={action.key}
                title={action.title}
                subtitle={action.subtitle}
                destructive={action.destructive}
                leading={chip(action.icon, action.destructive ? '#E5384B' : null)}
                divider={index < all.length - 1}
                onPress={
                  action.onPress
                    ? () => {
                        setMenuFor(null);
                        action.onPress?.();
                      }
                    : undefined
                }
              />
            ))
          : null}
      </Sheet>

      {/* "Who is Renny?" — picks a person; what the pick means is decided above. */}
      {linkMember ? (
        <LinkMemberSheet
          visible
          groupId={groupId}
          placeholderName={linkMember.ghost_name ?? t.misc.someone}
          inGroup={membersAsPeople(members.data ?? [], viewerId, linkMember.id)}
          onPick={(person) => {
            setLinkFor(null);
            if (person.memberId) {
              void confirmMerge(linkMember, { memberId: person.memberId, name: person.name });
            } else {
              void confirmAsk(linkMember, person);
            }
          }}
          onClose={() => setLinkFor(null)}
        />
      ) : null}

      {/* Everything that used to be laid out down this page and is not in the
          mockup: name, description, kind and tag, then the group's details —
          country, currency, trip rates, trip dates. One scrolling sheet, opened
          by the pencil. */}
      <Sheet
        visible={editOpen}
        onClose={closeEdit}
        title={t.group.editGroup}
        closeLabel={t.common.close}
        style={{ height: Math.round(windowHeight * 0.92) }}
      >
        <Text variant="caption" tone="muted">
          {t.group.editGroupHint}
        </Text>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingTop: theme.spacing.lg,
            paddingBottom: theme.spacing.xl,
            gap: theme.spacing.xl,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* The group's name and what it is for. Both commit themselves — on the
              keyboard's "done" and when the field loses focus — so there is no
              Save button, and closing the sheet commits whatever is typed. */}
          <View style={{ gap: theme.spacing.lg }}>
            <View style={{ gap: theme.spacing.xs }}>
              <Text variant="caption" tone="muted">
                {t.group.nameOptional}
              </Text>
              <TextInput
                value={name}
                onChangeText={setName}
                onFocus={() => setNaming(true)}
                onBlur={() => {
                  setNaming(false);
                  commitName();
                }}
                onSubmitEditing={commitName}
                returnKeyType="done"
                accessibilityLabel={t.group.groupName}
                placeholder={groupLabel(null, members.data ?? [], viewerId)}
                placeholderTextColor={theme.color.textFaint}
                style={{
                  fontSize: 20,
                  fontWeight: '700',
                  color: theme.color.text,
                  paddingVertical: theme.spacing.sm,
                  borderBottomWidth: 1.5,
                  borderBottomColor: naming ? theme.color.brand : theme.color.border,
                }}
              />
            </View>
            <View style={{ gap: theme.spacing.xs }}>
              <Text variant="caption" tone="muted">
                {t.group.descriptionOptional}
              </Text>
              <TextInput
                value={description}
                onChangeText={setDescription}
                onFocus={() => setDescribing(true)}
                onBlur={() => {
                  setDescribing(false);
                  commitDescription();
                }}
                accessibilityLabel={t.group.groupDescription}
                placeholder={t.group.descriptionPlaceholder}
                placeholderTextColor={theme.color.textFaint}
                maxLength={GROUP_DESCRIPTION_MAX}
                // Multiline, so blur is the only commit here: a return inside a
                // description is a line break, not a save.
                multiline
                style={{
                  fontSize: 15,
                  color: theme.color.text,
                  paddingVertical: theme.spacing.sm,
                  minHeight: 48,
                  textAlignVertical: 'top',
                  borderBottomWidth: 1.5,
                  borderBottomColor: describing ? theme.color.brand : theme.color.border,
                }}
              />
            </View>
          </View>

          {/* The kind of group. Only changes the label, cover default and trip
            affordances — nothing already recorded moves. */}
          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="caption" tone="muted">
              {t.extras.whatKindOfGroup}
            </Text>
            <ChipRow<GroupType>
              // The column is NOT NULL DEFAULT 'other' on the server, so a missing
              // value here only means a mirror row that predates this field syncing
              // — fall back to that same default so the assigned chip always lights.
              value={group.data.type ?? GroupType.Other}
              onChange={(type) =>
                updateGroup.mutate({ type }, { onSuccess: () => setStatus(t.account.saved) })
              }
              options={[
                { value: GroupType.Trip, label: t.extras.typeTrip, icon: iconFor('airplane') },
                { value: GroupType.Home, label: t.extras.typeHome, icon: iconFor('home') },
                { value: GroupType.Couple, label: t.extras.typeCouple, icon: iconFor('heart') },
                { value: GroupType.Event, label: t.extras.typeEvent, icon: iconFor('sparkles') },
                {
                  value: GroupType.Friends,
                  label: t.extras.typeFriends,
                  icon: iconFor('people-circle'),
                },
                { value: GroupType.Other, label: t.extras.typeOther, icon: iconFor('people') },
              ]}
            />
          </View>

          {/* The member's own short tag, shown instead of the automatic type tag
            on Home and the group header. Saved on blur or a chip tap; empty
            clears it back to the type. */}
          <GroupTagField
            type={group.data.type}
            value={tag}
            onChange={setTag}
            onCommit={commitTag}
          />

          <SectionHeader title={t.group.groupDetails} />
          {/* Decides which payment rails the settle screen offers, and what a new
            expense starts in. Nothing already recorded changes. */}
          <CountryRow
            countryCode={group.data.country_code}
            onOpen={leaveEditForPicker}
            onChange={(country_code) =>
              updateGroup.mutate({ country_code }, { onSuccess: () => setStatus(t.account.saved) })
            }
          />

          {/* What the group counts in, and what it converts foreign bills with.
            Only an admin can choose it. It also stops being a control once
            anything depends on it: either entries counted in it, or pinned rates
            whose stored ratios all convert into it. Trip rates themselves can
            be re-pinned at any time, because a bill keeps the rate it was saved
            with (ADR-003). */}
          <View style={{ gap: theme.spacing.sm }}>
            <SectionHeader title={t.fx.section} />
            <SettlesInRow
              currency={currency}
              locked={!canChangeCurrency}
              onChange={(default_currency) =>
                updateGroup.mutate(
                  { default_currency },
                  { onSuccess: () => setStatus(t.account.saved) },
                )
              }
            />
            {/* Whether foreign bills count in this currency at their own saved
              rates (ADR-003 amendment). On for new groups; an existing group
              opts in once every foreign bill has a rate. */}
            <SettleInCurrencyRow
              groupId={groupId}
              currency={currency}
              on={group.data.convert_to_group_currency === true}
              isAdmin={isAdmin}
              settlementCount={liveSettlementCount}
            />
          </View>
          <TripRatesCard store={tripRateStore} groupCurrency={currency} canEdit={isAdmin} />
          <MissingRatesCard groupId={groupId} />

          {/* Trip dates and their nudges only mean anything on a trip, so the
            section appears only for that type and disappears the moment the
            group is changed to another kind. Nothing recorded is touched — the
            stored dates simply stop being shown until it is a trip again. */}
          {(group.data.type ?? GroupType.Other) === GroupType.Trip ||
          (group.data.type ?? GroupType.Other) === GroupType.Event ? (
            <TripDates
              group={group.data}
              locale={locale}
              forEvent={group.data.type === GroupType.Event}
              onChange={(patch) =>
                updateGroup.mutate(patch, { onSuccess: () => setStatus(t.account.saved) })
              }
            />
          ) : null}
        </ScrollView>
      </Sheet>
    </View>
  );
}
