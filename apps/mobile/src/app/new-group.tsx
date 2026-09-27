import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { randomUUID } from 'expo-crypto';
import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native';

import {
  currencySymbol,
  guessGroupEmoji,
  guessGroupType,
  minorUnitExponent,
  minorUnitScale,
  MutationKind,
} from '@waves/core';
import {
  AmountField,
  Callout,
  Card,
  directionalIcon,
  IconButton,
  iconSize,
  Row,
  Screen,
  Text,
  tints,
  Toggle,
  useTheme,
} from '@waves/ui';

import { DetailRows } from '@/components/DetailRows';
import { GroupPhoto } from '@/components/GroupPhoto';
import { friendlyError } from '@/lib/errors';
import { GROUP_DESCRIPTION_MAX, normaliseGroupDescription } from '@/lib/groupDescription';
import { router } from '@/lib/navigation';
import { isPhoneCountryError, normaliseContactPhone } from '@/lib/phone';
import { type PickedContact } from '@/components/ContactPicker';
import { CoverEmojiPicker } from '@/components/CoverEmojiPicker';
import { TripDates, type TripDatesValue } from '@/components/TripDates';
import { TripRatesCard, type TripRateStore } from '@/components/TripRates';
import { type TripRateRow } from '@/lib/tripRates';
import { requestContacts } from '@/lib/contactPickerBridge';
import { useCaptures, useCreateGroup, useGroup } from '@/data/hooks';
import { assignCaptureHref } from '@/lib/captureAssign';
import { useAuth, useViewerId } from '@/lib/auth';
import { useDefaultCurrency } from '@/lib/currency';
import { useGuestGuard } from '@/lib/guestGuard';
import { useSync } from '@/sync';
import { displayName, GroupType, isViewer } from '@/data/types';
import { deviceCountry, fill, useStrings } from '@/i18n';

/**
 * A rate pinned before the group exists, with the currency it was quoted
 * against. `TripRateRow` has no destination because a stored rate always
 * converts into its group's own currency — which is exactly what cannot be
 * assumed here, where that currency can still change under the rate.
 */
interface PendingRate extends TripRateRow {
  readonly to: string;
}

/**
 * Where the icon comes from when the name has not said anything yet — which is
 * the state this screen opens in, and the state a group called "Alex and Sam"
 * stays in. The kind of group is a real answer to "what is this", so it is a
 * better fallback than one fixed emoji for everybody.
 */
const EMOJI_FOR_TYPE: Record<GroupType, string> = {
  [GroupType.Trip]: '✈️',
  [GroupType.Home]: '🏠',
  [GroupType.Couple]: '💜',
  [GroupType.Event]: '🎉',
  [GroupType.Friends]: '🧑‍🤝‍🧑',
  [GroupType.Other]: '👥',
};

const deviceZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';

/**
 * Making a group, wearing the same clothes as the settings that edit one.
 *
 * The two screens used to look nothing alike, which made creating a group feel
 * like a different app from configuring it. So this is the settings screen's
 * cards — the name-and-icon card, the flagged country row, the trip-dates
 * editor, the simplify toggle — filled from local state instead of a saved
 * group. Nothing is written until Create is tapped, so backing out leaves no
 * half-made group behind; everything picked here is applied in one ordered
 * burst once the group exists.
 */
export default function NewGroupScreen() {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const createGroup = useCreateGroup();
  const { profile } = useAuth();
  // Identity for "which member am I", from the session rather than the profile:
  // the session is on the device at launch, the profile is a fetch that lands
  // later, and in the gap `profile?.id` is undefined — which `isViewer` refuses
  // to match, but only if it is given the right thing to compare. See
  // `lib/auth.useViewerId`.
  const viewerId = useViewerId();
  const currency = useDefaultCurrency();
  const guard = useGuestGuard();
  const { mutate } = useSync();

  // Cloning: `?from=<groupId>` opens this screen filled from an existing group.
  // The source is read straight from the local mirror (synchronous once
  // hydrated), so nothing here waits on the network — the seed lands as soon as
  // the group is on disk. Everything seeded stays editable, and the people are
  // seeded into the same removable chip list a fresh group uses, which is what
  // lets you drop someone before the group is made.
  // `?assignCaptureId=<id>` means this screen was opened from a capture's group
  // picker with no group to place it in yet: make the group here, then drop that
  // capture straight into it (below), completing the "create one and add this to
  // it" the picker promised rather than stranding the capture back in the inbox.
  const { from, assignCaptureId } = useLocalSearchParams<{
    from?: string;
    assignCaptureId?: string;
  }>();
  const cloning = Boolean(from);
  const source = useGroup(from ?? '');
  const captures = useCaptures();

  const [name, setName] = useState('');
  // A sentence about the group, under its name and in the same card, because it
  // is part of naming the thing rather than a setting about it. Optional, and
  // capped — see `groupDescription.ts` for why at that number.
  const [description, setDescription] = useState('');
  // The group cover is an emoji icon, chosen by tapping the avatar. Photos are
  // a paid feature edited from group settings, not part of creating one.
  const [iconOpen, setIconOpen] = useState(false);
  // Null until somebody picks a kind — until then it is read from the name, the
  // same bargain the icon strikes. So the screen never opens assuming a trip: a
  // group called "Goa" still becomes one, "Dinner" does not, and an untyped
  // name falls back to Other rather than dragging trip fields in behind it.
  const [pickedType, setPickedType] = useState<GroupType | null>(null);
  // Which attribute row of the settings card is unfolded, if any — one at a
  // time, so the card stays a short list until you open the one you want.
  //
  // These used to sit behind a "More options" disclosure, which hid four
  // already-answered facts behind a row that said nothing about any of them. A
  // group has a kind whether or not you open anything, so the screen now states
  // it — the same way the expense screen states who paid and how a bill was
  // split, as a stack of named facts with their values, each one a tap from
  // being changed. Nothing here is required; the point is that the screen reads
  // as already filled in rather than as a form still to be completed.
  const [openAttr, setOpenAttr] = useState<'kind' | 'dates' | 'budget' | 'rates' | null>(null);

  /**
   * Bring an unfolded row back into view.
   *
   * These rows open *in place*, near the foot of a scroll that already has a
   * pinned button under it — and the budget one raises a numeric keypad in the
   * same gesture that reveals the field. Android resizes the window for the
   * keyboard (`adjustResize`), which shrinks this scroll rather than moving it,
   * so the field that just appeared is left underneath the keypad with nothing
   * scrolling it back. Nobody can type into what they cannot see.
   *
   * Scrolling to the end rather than measuring the row: the only thing below
   * any of these is the simplify toggle, so the end *is* the unfolded row plus
   * one row of context, and it needs no layout maths that would go stale the
   * moment a row above it grows. The delay lets the unfolded content lay out
   * and the keyboard finish its own resize first — scrolling to an end that has
   * not happened yet scrolls nowhere.
   */
  const scrollRef = useRef<ScrollView>(null);
  useEffect(() => {
    if (openAttr === null) return;
    const id = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 160);
    return () => clearTimeout(id);
  }, [openAttr]);
  const [ghostName, setGhostName] = useState('');
  // The note on what an added name is (a placeholder until they join), under
  // the Add friends title when its ⓘ is tapped.
  const [showGhostNote, setShowGhostNote] = useState(false);
  // People to add on Create — a typed name carries no address, a contact carries
  // whatever the phone had. Same shape either way, so the create loop treats
  // them alike.
  const [ghosts, setGhosts] = useState<PickedContact[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Not asked on this screen — taken from the account country (which the user
  // sets on "Your account"), falling back to the phone's region. Decides the
  // group's currency and settle rails, both changeable later in group settings.
  const country: string | null = profile?.country_code ?? deviceCountry();
  // Null until somebody picks: the icon is otherwise read from the name, so an
  // untouched group still gets a sensible cover.
  const [pickedEmoji, setPickedEmoji] = useState<string | null>(null);
  // Null until toggled, so it can follow the group type's default until then.
  const [simplify, setSimplify] = useState<boolean | null>(null);
  // Optional starting budget for a trip, minor units. Zero is "not set".
  const [budget, setBudget] = useState<bigint>(0n);
  /**
   * Rates to pin on the group, collected before it exists.
   *
   * The same editor group settings uses (`TripRatesCard`), handed a store made
   * of this state instead of one made of the mirror — there is no group id to
   * write against until Create is pressed. They are written out afterwards,
   * queued behind the create like the dates and the budget, so each lands once
   * the group it belongs to is on disk.
   *
   * Worth asking for here rather than only later because the moment somebody
   * knows they are about to spend in another currency is the moment they are
   * making the group for the trip — and a rate pinned up front is the
   * difference between every entry on that trip being counted the same way and
   * a week of expenses that each need one.
   */
  const [pendingRates, setPendingRates] = useState<readonly PendingRate[]>([]);
  // Only the ones still meaningful. `currency` is read from the profile and can
  // arrive *after* this screen is already open — the account default landing a
  // beat late — so a rate pinned in the meantime was quoted against a currency
  // this group is no longer going to keep its books in. `GroupFxRateSet` never
  // carries a destination (a pinned rate always converts into the group's own
  // currency), so writing that ratio afterwards would file a THB→INR number as
  // THB→AED and quietly misprice the whole trip. Filtered rather than cleared
  // in an effect: it is the same list either way, and this cannot fight a
  // render.
  const liveRates = useMemo(
    () => pendingRates.filter((row) => row.to === currency),
    [pendingRates, currency],
  );
  const rateStore = useMemo<TripRateStore>(
    () => ({
      rows: liveRates,
      pending: false,
      set: async ({ from, num, den, source }) => {
        setPendingRates((rows) => {
          // Drop anything quoted against a currency this group has stopped
          // using, at the same time as dropping the key being rewritten.
          const without = rows.filter((row) => row.to === currency && row.from !== from);
          // Null clears, which here means simply not carrying that currency.
          if (num === null || den === null) return without;
          return [...without, { from, to: currency, num, den, source: source ?? 'manual' }].sort(
            (a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0),
          );
        });
      },
    }),
    [liveRates, currency],
  );
  const ratesSummary =
    liveRates.length === 0 ? t.fx.addRate : liveRates.map((row) => row.from).join(', ');
  const [tripDates, setTripDates] = useState<TripDatesValue>(() => ({
    start_date: null,
    end_date: null,
    time_zone: deviceZone(),
    remind_daily: true,
    remind_morning_at: '09:00:00',
    remind_evening_at: '20:00:00',
  }));

  // Fill the form from the source group, once, the first render it is readable.
  const seeded = useRef(false);
  const sourceGroup = source.group.data;
  const sourceMembers = source.members.data;
  useEffect(() => {
    if (!cloning || seeded.current || !sourceGroup) return;
    seeded.current = true;
    const group = sourceGroup;
    const members = sourceMembers ?? [];
    let budgetMinor: bigint | null = null;
    if (group.budget_minor) {
      try {
        budgetMinor = BigInt(group.budget_minor);
      } catch {
        // A budget that will not parse is simply left unset.
      }
    }
    // The people become the same removable chips a fresh group builds up — minus
    // whoever is making the clone (they are the new group's creator) and anyone
    // who had left. Each carries whatever address the source row held, so the
    // ones already on Waves can be tapped on their shoulder when re-added.
    const seededGhosts: PickedContact[] = members
      .filter((member) => !member.left_at)
      .filter((member) => !isViewer(member, viewerId))
      .map((member) => ({
        name: displayName(member, viewerId),
        email: member.invite_email ?? null,
        phone: member.invite_phone ?? null,
      }));
    // Applied off the effect body, in a microtask: this is a one-time hydrate
    // from the local mirror, and putting the writes in a callback keeps the
    // React Compiler's no-synchronous-setState-in-effect rule satisfied (the
    // same shape GroupPhoto's signed-URL fetch uses).
    void Promise.resolve().then(() => {
      setName(group.name ? fill(t.clone.copyOf, { name: group.name }) : '');
      // The description comes across as-is. It describes what the group is for,
      // and a clone is for the same thing — it is the name that needs "copy of"
      // on it to tell the two apart, not the sentence explaining them both.
      setDescription(group.description ?? '');
      setPickedType(group.type);
      setPickedEmoji(group.cover_emoji ?? null);
      setSimplify(group.simplify_debts);
      if (budgetMinor !== null) setBudget(budgetMinor);
      if (group.start_date && group.end_date) {
        setTripDates((current) => ({
          ...current,
          start_date: group.start_date,
          end_date: group.end_date,
          time_zone: group.time_zone ?? current.time_zone,
          remind_daily: group.remind_daily ?? current.remind_daily,
          remind_morning_at: group.remind_morning_at ?? current.remind_morning_at,
          remind_evening_at: group.remind_evening_at ?? current.remind_evening_at,
        }));
      }
      setGhosts(seededGhosts);
    });
  }, [cloning, sourceGroup, sourceMembers, viewerId, t]);

  // The kind is a reading of the name, unless somebody has chosen one, and
  // Other when the name says nothing — never Trip by default, so the trip-only
  // dates and budget stay out of the way of a dinner or a flat.
  const type: GroupType =
    pickedType ?? (guessGroupType(name) as GroupType | null) ?? GroupType.Other;
  // The icon is a reading of the name, unless somebody has chosen one; it
  // changes under the caret as they type "Goa" and again if they change the
  // kind of group.
  const emoji = pickedEmoji ?? guessGroupEmoji(name) ?? EMOJI_FOR_TYPE[type];
  // Trips and events benefit most from simplification; a two-person group does
  // not. Follows the type until somebody says otherwise.
  const effectiveSimplify = simplify ?? (type === GroupType.Trip || type === GroupType.Event);

  // The kinds of group, one place — the chips inside the picker and the icon on
  // the collapsed pill both read from this.
  const typeOptions: { value: GroupType; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { value: GroupType.Trip, label: t.extras.typeTrip, icon: 'airplane' },
    { value: GroupType.Home, label: t.extras.typeHome, icon: 'home' },
    { value: GroupType.Couple, label: t.extras.typeCouple, icon: 'heart' },
    { value: GroupType.Event, label: t.extras.typeEvent, icon: 'sparkles' },
    { value: GroupType.Friends, label: t.extras.typeFriends, icon: 'people-circle' },
    { value: GroupType.Other, label: t.extras.typeOther, icon: 'people' },
  ];

  // A short "9 Jan" for the date pill; the full weekday form lives inside the
  // picker. Parsed at local noon so a date-only string never slips a day.
  const shortDate = (iso: string): string => {
    const [year, month, day] = iso.split('-').map(Number);
    return new Date(year ?? 2026, (month ?? 1) - 1, day ?? 1, 12).toLocaleDateString(locale, {
      day: 'numeric',
      month: 'short',
    });
  };
  const dateSummary =
    tripDates.start_date && tripDates.end_date
      ? `${shortDate(tripDates.start_date)} - ${shortDate(tripDates.end_date)}`
      : t.add;

  // The budget for its pill, minor units back to a plain major string with the
  // currency symbol — the same maths AmountField does, just for display.
  const budgetSummary = ((): string => {
    if (budget <= 0n) return t.add;
    const scale = minorUnitScale(currency);
    const exponent = minorUnitExponent(currency);
    const whole = (budget / scale).toString();
    const major =
      exponent === 0 ? whole : `${whole}.${(budget % scale).toString().padStart(exponent, '0')}`;
    return `${currencySymbol(currency)}${major}`;
  })();

  const submit = async (): Promise<void> => {
    // A guest gets one group and ten days (ADR-006 addendum). Past either, this
    // sends them to the upgrade screen instead of making a group the server
    // would refuse anyway.
    if (guard.blockAddGroup()) return;
    setError(null);
    try {
      const groupId = await createGroup.mutateAsync({
        // Blank is fine — the group gets labelled by who is in it instead.
        name: name.trim() || null,
        type,
        // Where the phone is, and what that country counts in. A group made in
        // Dubai defaulting to rupees is the small wrongness that makes an app
        // feel written for somewhere else.
        country,
        currency,
        emoji,
        // A group photo is not carried onto a clone: its storage object is
        // scoped to the source group's path, so a copied reference would only
        // render for viewers who are also in the source (emoji for everyone
        // else). The clone keeps the emoji; a photo is set later in settings,
        // where it is uploaded under this group's own path and paid-gated.
        simplify: effectiveSimplify,
      });

      // ADR-006: people who have not installed anything are still participants.
      // Queued behind the create in one ordered pipe, not sent as a direct RPC —
      // the create resolves once it is on disk, not once the server has seen it,
      // so a direct add would race a group the server does not know yet and fail
      // its membership check (NOT_A_MEMBER). Behind the create, each applies
      // after the group it belongs to exists.
      for (const ghost of ghosts) {
        await mutate(MutationKind.MemberAddGhost, groupId, {
          memberId: randomUUID(),
          name: ghost.name,
          email: ghost.email,
          // Read a bare local number in this group's region before queueing it —
          // the country chosen for the group above, else the account/device — so
          // the server is never handed an unroutable number to refuse.
          phone: normaliseContactPhone(ghost.phone, country),
        });
      }

      // The description rides behind the create as an ordinary group.update,
      // the same way the trip dates below do, rather than being added to
      // `waves_create_group`.
      //
      // That is deliberate and is the safer of the two shapes. `group.create`
      // is the one mutation in the app whose refusal takes something away: the
      // queue overlay is the only place a group exists until it syncs, so a
      // create the server will not accept ends with the person dropping it and
      // the group going with it. Giving the create a new argument gives it a new
      // way to be refused — by a server that has not yet learned the column, by
      // a length the client let through — for the sake of a field nobody needs
      // the group to have. Behind the create, the worst case is a description
      // that did not save on a group that did.
      //
      // Only sent when something was actually typed, so the ordinary path
      // (create a group, do not describe it) queues exactly what it did before.
      const trimmedDescription = normaliseGroupDescription(description);
      if (trimmedDescription) {
        await mutate(MutationKind.GroupUpdate, groupId, { description: trimmedDescription });
      }

      // Trip dates are not part of the create call, so they ride behind it as
      // an update on the same ordered queue — only when a trip was actually
      // given a start and end, since that is what turns the reminders on.
      if (type === GroupType.Trip && tripDates.start_date && tripDates.end_date) {
        await mutate(MutationKind.GroupUpdate, groupId, {
          start_date: tripDates.start_date,
          end_date: tripDates.end_date,
          time_zone: tripDates.time_zone,
          remind_daily: tripDates.remind_daily,
          remind_morning_at: tripDates.remind_morning_at,
          remind_evening_at: tripDates.remind_evening_at,
        });
      }

      // A starting budget, if one was typed. Same ordered queue behind the
      // create, so it lands once the group exists (like the dates). Zero means
      // "not set" — the planner shows no cap rather than a ₹0 ceiling.
      if (type === GroupType.Trip && budget > 0n) {
        await mutate(MutationKind.GroupBudgetSet, groupId, {
          amountMinor: budget.toString(),
          currency,
        });
      }

      // The rates, if any were pinned while the group was being made. Behind
      // the create in the same ordered pipe as the dates and the budget, so
      // each lands once the group exists. Admin-only at the RPC, which the
      // maker of a group always is.
      for (const row of liveRates) {
        await mutate(MutationKind.GroupFxRateSet, groupId, {
          from: row.from,
          num: row.num.toString(),
          den: row.den.toString(),
          source: row.source,
        });
      }

      // Made to hold a waiting capture: hand that capture to this group's
      // add-expense form instead of opening the group, so the person lands where
      // they were headed — placing the spend — with the new group already chosen.
      // Replace, not push, so backing out of the form does not return to this
      // half-made-group screen. Any trip nudge yields to this: assigning is the
      // errand they were on.
      if (assignCaptureId) {
        const capture = captures.data?.find((row) => row.id === assignCaptureId);
        if (capture) {
          router.replace(assignCaptureHref(capture, groupId));
          return;
        }
      }

      // A trip made without dates lands on its group with a one-time nudge to
      // plan it — dates turn on the daily reminders, a budget the cap. Only when
      // neither was set here, since the point of moving them off the create
      // screen is that most trips skip them there. Any other kind, or a trip
      // already dated, opens plain.
      const nudgeTrip = type === GroupType.Trip && !(tripDates.start_date && tripDates.end_date);
      router.replace(nudgeTrip ? `/group/${groupId}?welcome=trip` : `/group/${groupId}`);
    } catch (caught) {
      setError(
        isPhoneCountryError(caught)
          ? t.people.phoneNeedsCountryCode
          : friendlyError(caught, t.couldNotSave, 'newGroup.create'),
      );
    }
  };

  // The address first, because that is what tells two people of the same name
  // apart; the name only carries the difference when neither has an address.
  const keyOfGhost = (ghost: PickedContact): string =>
    `${ghost.email ?? ''}|${ghost.phone ?? ''}|${ghost.name}`;

  const addTypedGhost = (): void => {
    const name = ghostName.trim();
    if (!name) return;
    setGhosts((current) => [...current, { name, email: null, phone: null }]);
    setGhostName('');
  };

  // Ticked out of the phone's contacts. Merged rather than replaced — somebody
  // may have typed a name or picked already — and de-duplicated so the same
  // person picked twice is added once.
  const addContacts = (people: readonly PickedContact[]): void => {
    setGhosts((current) => {
      const seen = new Set(current.map(keyOfGhost));
      const merged = [...current];
      for (const person of people) {
        const key = keyOfGhost(person);
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(person);
        }
      }
      return merged;
    });
  };

  // Hand the picker who is already chosen and what to do with the answer, then
  // open it on its own screen. It calls `addContacts` back through the bridge.
  const openContactPicker = (): void => {
    requestContacts({ initial: ghosts, onPicked: addContacts });
    router.push('/contact-picker');
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <NewGroupHeader
        title={cloning ? t.clone.duplicateTitle : t.misc.createGroup}
        subtitle={t.newGroupForm.headerSub}
      />
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingTop: theme.spacing.md,
          paddingBottom: theme.spacing.xl,
          gap: theme.spacing.md,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* The group's own account of itself: its cover — tapped to choose an
            icon — beside the name and the sentence that says what it is for.
            Both are labelled fields in outlined boxes, so the card reads as the
            two questions it asks. */}
        <Card style={{ flexDirection: 'row', gap: theme.spacing.md, padding: theme.spacing.md }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.group.chooseIcon}
            onPress={() => setIconOpen(true)}
            style={({ pressed }) => ({
              width: 104,
              alignSelf: 'stretch',
              minHeight: 120,
              borderRadius: theme.radius.lg,
              backgroundColor: theme.color.brandSoft,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <GroupPhoto photoPath={null} emoji={emoji} size={64} />
            <View
              style={{
                position: 'absolute',
                end: theme.spacing.sm,
                bottom: theme.spacing.sm,
                width: 30,
                height: 30,
                borderRadius: 15,
                backgroundColor: theme.color.surface,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="camera" size={iconSize.sm} color={theme.color.text} />
            </View>
          </Pressable>
          <View style={{ flex: 1, gap: theme.spacing.xs }}>
            <Text variant="caption" style={{ fontWeight: '600' }}>
              {t.group.groupName}
            </Text>
            <Row
              style={{
                alignItems: 'center',
                borderWidth: 1,
                borderColor: theme.color.border,
                borderRadius: theme.radius.md,
                paddingHorizontal: theme.spacing.md,
                minHeight: 44,
              }}
            >
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder={t.newGroupForm.nameExample}
                placeholderTextColor={theme.color.textFaint}
                accessibilityLabel={t.group.groupName}
                autoFocus
                style={{
                  flex: 1,
                  fontSize: 16,
                  fontWeight: '600',
                  color: theme.color.text,
                  paddingVertical: theme.spacing.sm,
                }}
              />
              {name.length > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t.entry.clear}
                  onPress={() => setName('')}
                  hitSlop={8}
                  style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
                >
                  <Ionicons name="close-circle" size={iconSize.md} color={theme.color.textFaint} />
                </Pressable>
              ) : null}
            </Row>
            <Text variant="caption" style={{ fontWeight: '600', marginTop: theme.spacing.xs }}>
              {t.newGroupForm.whatFor}
            </Text>
            {/* Multiline and auto-growing, capped at the column's own limit so
                the field stops taking keystrokes rather than letting somebody
                type a paragraph the database would refuse on Create. */}
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder={t.newGroupForm.descriptionExample}
              placeholderTextColor={theme.color.textFaint}
              accessibilityLabel={t.group.groupDescription}
              maxLength={GROUP_DESCRIPTION_MAX}
              multiline
              style={{
                fontSize: 15,
                color: theme.color.text,
                minHeight: 44,
                textAlignVertical: 'top',
                borderWidth: 1,
                borderColor: theme.color.border,
                borderRadius: theme.radius.md,
                paddingHorizontal: theme.spacing.md,
                paddingVertical: theme.spacing.sm,
              }}
            />
          </View>
        </Card>

        {/* Controlled by the cover tap above — no trigger of its own. */}
        <CoverEmojiPicker
          value={emoji}
          onChange={setPickedEmoji}
          open={iconOpen}
          onOpenChange={setIconOpen}
        />

        {/* People sit directly under the name — they are the group. Contacts is
            a real button on the title row; typing a name is the quieter second
            way in. Nobody's address book is uploaded (ADR-006). */}
        <Card style={{ gap: theme.spacing.md }}>
          <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                backgroundColor: theme.color.brandSoft,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="people" size={iconSize.lg} color={theme.color.brand} />
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${t.extras.addPeopleByName}. ${t.extras.ghostNote}`}
              onPress={() => setShowGhostNote((open) => !open)}
              style={{ flex: 1 }}
            >
              <Row style={{ alignItems: 'center', gap: 4 }}>
                <Text variant="body" style={{ fontWeight: '700' }}>
                  {t.extras.addPeopleByName}
                </Text>
                <Ionicons
                  name="information-circle-outline"
                  size={iconSize.sm}
                  color={theme.color.textMuted}
                />
              </Row>
              <Text variant="caption" tone="muted" numberOfLines={2}>
                {t.newGroupForm.addFriendsSub}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.people.browseContacts}
              onPress={openContactPicker}
              hitSlop={4}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                paddingHorizontal: theme.spacing.md,
                paddingVertical: theme.spacing.sm,
                borderRadius: theme.radius.pill,
                borderWidth: 1,
                borderColor: theme.color.border,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Ionicons name="person-add-outline" size={iconSize.sm} color={theme.color.brand} />
              <Text variant="caption" tone="brand" style={{ fontWeight: '700' }}>
                {t.newGroupForm.addContacts}
              </Text>
            </Pressable>
          </Row>
          {showGhostNote ? (
            <Text variant="caption" tone="muted">
              {t.extras.ghostNote}
            </Text>
          ) : null}

          <Row
            style={{
              alignItems: 'center',
              gap: theme.spacing.sm,
              paddingHorizontal: theme.spacing.md,
              minHeight: 46,
              borderRadius: theme.radius.pill,
              borderWidth: 1,
              borderColor: theme.color.border,
              backgroundColor: theme.color.bg,
            }}
          >
            <Ionicons name="person-add-outline" size={iconSize.md} color={theme.color.textMuted} />
            <TextInput
              value={ghostName}
              onChangeText={setGhostName}
              placeholder={t.newGroupForm.personPlaceholder}
              placeholderTextColor={theme.color.textFaint}
              accessibilityLabel={t.misc.personName}
              onSubmitEditing={addTypedGhost}
              returnKeyType="done"
              style={{
                flex: 1,
                fontSize: 15,
                color: theme.color.text,
                paddingVertical: theme.spacing.sm,
              }}
            />
            {ghostName.trim() ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t.add}
                onPress={addTypedGhost}
                hitSlop={8}
                style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
              >
                <Text variant="body" tone="brand" style={{ fontWeight: '700' }}>
                  {t.add}
                </Text>
              </Pressable>
            ) : null}
          </Row>

          {ghosts.length > 0 ? (
            <Row style={{ flexWrap: 'wrap', gap: theme.spacing.sm }}>
              {ghosts.map((ghost, index) => (
                <PersonChip
                  key={`${keyOfGhost(ghost)}-${index}`}
                  name={ghost.name}
                  index={index}
                  removeLabel={fill(t.itemize.removeItem, { label: ghost.name })}
                  onRemove={() => setGhosts((current) => current.filter((_, i) => i !== index))}
                />
              ))}
            </Row>
          ) : null}
        </Card>

        {/* What kind of group, as a row of tiles rather than a row that unfolds
            into chips: the kind decides which settings follow, so it is asked
            out loud. Scrolls sideways when the tiles do not all fit. */}
        <Card style={{ gap: theme.spacing.md }}>
          <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
            <Ionicons name="airplane" size={iconSize.xl} color={theme.color.text} />
            <View style={{ flex: 1 }}>
              <Text variant="body" style={{ fontWeight: '700' }}>
                {t.newGroupForm.groupType}
              </Text>
              <Text variant="caption" tone="muted">
                {t.newGroupForm.groupTypeSub}
              </Text>
            </View>
          </Row>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: theme.spacing.sm }}
          >
            {typeOptions.map((option) => (
              <TypeTile
                key={option.value}
                icon={option.icon}
                label={option.label}
                selected={option.value === type}
                onPress={() => setPickedType(option.value)}
              />
            ))}
          </ScrollView>
        </Card>

        {/* The group's settings. Dates and budget are trip-only, so a dinner or
            a flat never sees them; the budget, left at zero, sets nothing.
            ADR-009: fewer repayments is presentation only — the pairwise ledger
            underneath is untouched. */}
        <Card padded={false} style={{ paddingHorizontal: theme.spacing.lg }}>
          <DetailRows>
            {type === GroupType.Trip ? (
              <View>
                <SettingRow
                  icon="calendar-outline"
                  title={t.misc.tripDatesTitle}
                  subtitle={t.newGroupForm.datesSub}
                  value={tripDates.start_date && tripDates.end_date ? dateSummary : null}
                  action={t.add}
                  expanded={openAttr === 'dates'}
                  onPress={() => setOpenAttr((current) => (current === 'dates' ? null : 'dates'))}
                />
                {openAttr === 'dates' ? (
                  <View style={{ paddingBottom: theme.spacing.md }}>
                    <TripDates
                      group={tripDates}
                      locale={locale}
                      embedded
                      onChange={(patch) => setTripDates((current) => ({ ...current, ...patch }))}
                    />
                  </View>
                ) : null}
              </View>
            ) : null}

            {type === GroupType.Trip ? (
              <View>
                <SettingRow
                  icon="wallet-outline"
                  title={t.extras.tripBudget}
                  subtitle={t.newGroupForm.budgetSub}
                  value={budget > 0n ? budgetSummary : null}
                  action={t.add}
                  expanded={openAttr === 'budget'}
                  onPress={() => setOpenAttr((current) => (current === 'budget' ? null : 'budget'))}
                />
                {openAttr === 'budget' ? (
                  <View style={{ paddingBottom: theme.spacing.md }}>
                    <AmountField currency={currency} value={budget} onChange={setBudget} />
                  </View>
                ) : null}
              </View>
            ) : null}

            {/* Rates for the currencies this group will be paid in — on every
                group, not only a trip: the group's own currency is the only
                thing that decides whether a rate is needed at all. */}
            <View>
              <SettingRow
                icon="server-outline"
                title={t.fx.tripRates}
                subtitle={t.newGroupForm.ratesSub}
                value={liveRates.length > 0 ? ratesSummary : null}
                action={t.newGroupForm.addCurrency}
                expanded={openAttr === 'rates'}
                onPress={() => setOpenAttr((current) => (current === 'rates' ? null : 'rates'))}
              />
              {openAttr === 'rates' ? (
                <View style={{ paddingBottom: theme.spacing.md }}>
                  <TripRatesCard store={rateStore} groupCurrency={currency} canEdit embedded />
                </View>
              ) : null}
            </View>

            {/* The one row whose control says the value and changes it in the
                same gesture, so it has no chevron. */}
            <SettingRow
              icon="flash-outline"
              title={t.group.simplifyDebts}
              subtitle={t.newGroupForm.simplifySub}
              trailing={
                <Toggle
                  value={effectiveSimplify}
                  onValueChange={setSimplify}
                  accessibilityLabel={t.group.simplifyDebts}
                />
              }
            />
          </DetailRows>
        </Card>

        {/* Seed the whole form from a group you already have — a quiet link at
            the foot. Hidden once you are already cloning. */}
        {!cloning ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.clone.startFromExisting}
            onPress={() => router.push('/clone-group')}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: theme.spacing.sm,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Ionicons name="copy-outline" size={iconSize.base} color={theme.color.brand} />
            <Text variant="body" style={{ color: theme.color.brand, fontWeight: '600' }}>
              {t.clone.startFromExisting}
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>

      {/* The primary action is pinned rather than parked at the foot of a long
          scroll. The Screen already applies the bottom safe-area inset, so the
          padding here is only the breathing room above it. */}
      <View
        style={{
          paddingHorizontal: theme.spacing.lg,
          paddingTop: theme.spacing.sm,
          paddingBottom: theme.spacing.md,
          gap: theme.spacing.sm,
          backgroundColor: theme.color.bg,
        }}
      >
        {error ? <Callout tone="negative">{error}</Callout> : null}
        {createGroup.isPending ? <ActivityIndicator color={theme.color.brand} /> : null}
        <CreateButton
          label={t.misc.createGroup}
          disabled={createGroup.isPending}
          onPress={() => void submit()}
        />
      </View>
    </Screen>
  );
}

/**
 * The header: close, the title over a line on what a group is for, and a small
 * map with a pin drawn at the far end — decoration, hidden from screen readers.
 */
function NewGroupHeader({ title, subtitle }: { title: string; subtitle: string }) {
  const theme = useTheme();
  const { t } = useStrings();
  return (
    <Row
      style={{
        alignItems: 'center',
        gap: theme.spacing.md,
        paddingHorizontal: theme.spacing.lg,
        paddingTop: theme.spacing.md,
      }}
    >
      <IconButton label={t.common.close} onPress={() => router.back()}>
        <Ionicons name="close" size={iconSize.xl} color={theme.color.text} />
      </IconButton>
      <View style={{ flex: 1 }}>
        <Text variant="title" numberOfLines={1}>
          {title}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={2}>
          {subtitle}
        </Text>
      </View>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ width: 64, height: 60 }}
      >
        <View
          style={{
            position: 'absolute',
            start: 0,
            bottom: 0,
            width: 56,
            height: 48,
            borderRadius: 14,
            backgroundColor: theme.scheme === 'dark' ? '#1F3B33' : '#DDF3E6',
            alignItems: 'center',
            justifyContent: 'center',
            transform: [{ rotate: '-6deg' }],
          }}
        >
          <Ionicons name="map-outline" size={28} color="#3E9B6E" />
        </View>
        <Ionicons
          name="location"
          size={26}
          color="#F97316"
          style={{ position: 'absolute', end: 0, top: 0 }}
        />
      </View>
    </Row>
  );
}

/** One kind of group as a tile: its glyph over its name, lit when chosen. */
function TypeTile({
  icon,
  label,
  selected,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 68,
        paddingVertical: theme.spacing.md,
        alignItems: 'center',
        gap: theme.spacing.xs,
        borderRadius: theme.radius.md,
        borderWidth: 1.5,
        borderColor: selected ? theme.color.brand : 'transparent',
        backgroundColor: selected ? theme.color.brandSoft : theme.color.bg,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Ionicons
        name={icon}
        size={iconSize.lg}
        color={selected ? theme.color.brand : theme.color.text}
      />
      <Text
        variant="caption"
        numberOfLines={1}
        style={{
          fontWeight: selected ? '700' : '500',
          color: selected ? theme.color.brand : theme.color.text,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** A person added to the group: an initial in a tinted disc, the name, and ×. */
function PersonChip({
  name,
  index,
  removeLabel,
  onRemove,
}: {
  name: string;
  index: number;
  removeLabel: string;
  onRemove: () => void;
}) {
  const theme = useTheme();
  const tint = theme.tint[tints[index % tints.length] ?? 'lilac'];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={removeLabel}
      onPress={onRemove}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        paddingStart: 4,
        paddingEnd: theme.spacing.md,
        height: 40,
        borderRadius: theme.radius.pill,
        borderWidth: 1,
        borderColor: theme.color.border,
        backgroundColor: theme.color.surface,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <View
        style={{
          width: 30,
          height: 30,
          borderRadius: 15,
          backgroundColor: tint.bg,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text variant="body" style={{ color: tint.ink, fontWeight: '700' }}>
          {name.trim().charAt(0).toUpperCase()}
        </Text>
      </View>
      <Text variant="caption" style={{ fontWeight: '600' }}>
        {name}
      </Text>
      <Ionicons name="close" size={iconSize.sm} color={theme.color.textMuted} />
    </Pressable>
  );
}

/**
 * One setting: an outlined glyph, the name over a line on what it does, and on
 * the end either its value with a chevron, a small "Add ›" pill while it is
 * unset, or a control (`trailing`) that says the value itself.
 */
function SettingRow({
  icon,
  title,
  subtitle,
  value,
  action,
  expanded,
  onPress,
  trailing,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  value?: string | null;
  action?: string;
  expanded?: boolean;
  onPress?: () => void;
  trailing?: ReactNode;
}) {
  const theme = useTheme();
  const body = (
    <Row style={{ alignItems: 'center', gap: theme.spacing.md, paddingVertical: theme.spacing.md }}>
      <Ionicons name={icon} size={iconSize.lg} color={theme.color.text} />
      <View style={{ flex: 1 }}>
        <Text variant="body" style={{ fontWeight: '600' }}>
          {title}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={2}>
          {subtitle}
        </Text>
      </View>
      {trailing ??
        (value ? (
          <Row style={{ alignItems: 'center', gap: 2, maxWidth: '40%' }}>
            <Text variant="caption" numberOfLines={1} style={{ fontWeight: '600', flexShrink: 1 }}>
              {value}
            </Text>
            <Ionicons
              name={expanded ? 'chevron-up' : directionalIcon('chevron-forward')}
              size={iconSize.sm}
              color={theme.color.textFaint}
            />
          </Row>
        ) : action ? (
          <Row
            style={{
              alignItems: 'center',
              gap: 2,
              paddingHorizontal: theme.spacing.sm,
              paddingVertical: 4,
              borderRadius: theme.radius.pill,
              borderWidth: 1,
              borderColor: theme.color.border,
            }}
          >
            <Text variant="caption" style={{ fontWeight: '600' }}>
              {action}
            </Text>
            <Ionicons
              name={expanded ? 'chevron-up' : directionalIcon('chevron-forward')}
              size={iconSize.sm}
              color={theme.color.textMuted}
            />
          </Row>
        ) : null)}
    </Row>
  );
  if (!onPress) return body;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={expanded === undefined ? undefined : { expanded }}
      accessibilityLabel={`${title}, ${value ?? action ?? ''}`}
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      {body}
    </Pressable>
  );
}

/** Create, as a full-width dark pill with an arrow after the word. */
function CreateButton({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.spacing.sm,
        minHeight: 56,
        borderRadius: theme.radius.pill,
        backgroundColor: pressed ? theme.color.buttonPrimaryPressed : theme.color.buttonPrimary,
        opacity: disabled ? 0.5 : 1,
      })}
    >
      <Text variant="subheading" style={{ color: theme.color.onButtonPrimary, fontWeight: '700' }}>
        {label}
      </Text>
      <Ionicons
        name={directionalIcon('arrow-forward')}
        size={iconSize.lg}
        color={theme.color.onButtonPrimary}
      />
    </Pressable>
  );
}
