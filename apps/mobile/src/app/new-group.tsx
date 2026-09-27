import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { randomUUID } from 'expo-crypto';
import { useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
  directionalIcon,
  IconButton,
  iconSize,
  Row,
  Screen,
  Text,
  Gradient,
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
    <Screen edges={['bottom']}>
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: theme.spacing.xl }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <NewGroupHeader
          title={cloning ? t.clone.duplicateTitle : t.misc.createGroup}
          subtitle={t.newGroupForm.headerSub}
        />

        <View
          style={{
            paddingHorizontal: theme.spacing.lg,
            // The first card rides up over the foot of the header's wash.
            marginTop: -HEADER_OVERLAP,
            gap: theme.spacing.md,
          }}
        >
          {/* The group's own account of itself: its cover — tapped to choose
              an icon — beside the name and the sentence that says what it is
              for, each a labelled, outlined field. */}
          <FormCard style={{ flexDirection: 'row', gap: theme.spacing.md }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.group.chooseIcon}
              onPress={() => setIconOpen(true)}
              style={({ pressed }) => ({
                width: COVER,
                height: COVER,
                borderRadius: 18,
                backgroundColor: theme.color.brandSoft,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <GroupPhoto photoPath={null} emoji={emoji} size={60} />
              <View
                style={{
                  position: 'absolute',
                  end: -6,
                  bottom: -6,
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  backgroundColor: theme.color.surface,
                  alignItems: 'center',
                  justifyContent: 'center',
                  shadowColor: '#1B1340',
                  shadowOpacity: 0.15,
                  shadowRadius: 6,
                  shadowOffset: { width: 0, height: 2 },
                  elevation: 3,
                }}
              >
                <Ionicons name="camera" size={20} color={theme.color.text} />
              </View>
            </Pressable>
            <View style={{ flex: 1, gap: 6 }}>
              <FieldLabel>{t.group.groupName}</FieldLabel>
              <Row style={[fieldBox(theme), { paddingEnd: theme.spacing.sm }]}>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder={t.newGroupForm.nameExample}
                  placeholderTextColor={theme.color.textFaint}
                  accessibilityLabel={t.group.groupName}
                  autoFocus
                  style={{ flex: 1, fontSize: 16, color: theme.color.text, paddingVertical: 0 }}
                />
                {name.length > 0 ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t.entry.clear}
                    onPress={() => setName('')}
                    hitSlop={8}
                    style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
                  >
                    <Ionicons
                      name="close-circle"
                      size={iconSize.md}
                      color={theme.color.textFaint}
                    />
                  </Pressable>
                ) : null}
              </Row>
              <FieldLabel style={{ marginTop: 4 }}>{t.newGroupForm.whatFor}</FieldLabel>
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
                style={[
                  fieldBox(theme),
                  {
                    fontSize: 16,
                    color: theme.color.text,
                    textAlignVertical: 'center',
                    paddingVertical: 12,
                  },
                ]}
              />
            </View>
          </FormCard>

          {/* Controlled by the cover tap above — no trigger of its own. */}
          <CoverEmojiPicker
            value={emoji}
            onChange={setPickedEmoji}
            open={iconOpen}
            onOpenChange={setIconOpen}
          />

          {/* People sit directly under the name — they are the group. Contacts
              is a real button on the title row; typing a name is the quieter
              second way in. Nobody's address book is uploaded (ADR-006). */}
          <FormCard style={{ gap: theme.spacing.md }}>
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
                <Ionicons name="people" size={22} color={accent(theme)} />
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${t.extras.addPeopleByName}. ${t.extras.ghostNote}`}
                onPress={() => setShowGhostNote((open) => !open)}
                style={{ flex: 1 }}
              >
                <Text style={{ fontSize: 19, lineHeight: 24, fontWeight: '600' }}>
                  {t.extras.addPeopleByName}
                </Text>
                <Text style={{ fontSize: 14, lineHeight: 19, color: theme.color.textMuted }}>
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
                  gap: 6,
                  height: 44,
                  paddingHorizontal: theme.spacing.md,
                  borderRadius: 22,
                  borderWidth: 1.5,
                  borderColor: accent(theme),
                  backgroundColor: theme.scheme === 'dark' ? 'transparent' : '#F8F6FF',
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <Ionicons name="person-add-outline" size={18} color={accent(theme)} />
                <Text style={{ fontSize: 15, fontWeight: '600', color: accent(theme) }}>
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
                gap: theme.spacing.md,
                height: 48,
                paddingHorizontal: theme.spacing.lg,
                borderRadius: 24,
                backgroundColor: theme.scheme === 'dark' ? theme.color.surfaceMuted : '#F5F5FA',
              }}
            >
              <Ionicons name="search" size={20} color={theme.color.textMuted} />
              <TextInput
                value={ghostName}
                onChangeText={setGhostName}
                placeholder={t.newGroupForm.personPlaceholder}
                placeholderTextColor={theme.color.textFaint}
                accessibilityLabel={t.misc.personName}
                onSubmitEditing={addTypedGhost}
                returnKeyType="done"
                style={{ flex: 1, fontSize: 16, color: theme.color.text, paddingVertical: 0 }}
              />
              {ghostName.trim() ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t.add}
                  onPress={addTypedGhost}
                  hitSlop={8}
                  style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
                >
                  <Text style={{ fontSize: 16, fontWeight: '700', color: accent(theme) }}>
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
          </FormCard>

          {/* What kind of group, as five tiles in a row: the kind decides which
              settings follow, so it is asked out loud. A name that reads as an
              event ("Birthday party") keeps its kind; Other is lit for it, the
              nearest of the five. */}
          <FormCard style={{ gap: theme.spacing.md }}>
            <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
              <Ionicons name="airplane" size={28} color={accent(theme)} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 19, lineHeight: 24, fontWeight: '600' }}>
                  {t.newGroupForm.groupType}
                </Text>
                <Text style={{ fontSize: 14, lineHeight: 19, color: theme.color.textMuted }}>
                  {t.newGroupForm.groupTypeSub}
                </Text>
              </View>
            </Row>
            <Row style={{ gap: theme.spacing.sm }}>
              {TILE_TYPES.map((kind) => {
                const option = typeOptions.find((it) => it.value === kind);
                if (!option) return null;
                const lit = kind === type || (kind === GroupType.Other && type === GroupType.Event);
                return (
                  <TypeTile
                    key={kind}
                    icon={TILE_ICON[kind]}
                    label={option.label}
                    selected={lit}
                    onPress={() => setPickedType(kind)}
                  />
                );
              })}
            </Row>
          </FormCard>

          {/* The group's settings. Dates and budget are trip-only, so a dinner
              or a flat never sees them; the budget, left at zero, sets nothing.
              ADR-009: fewer repayments is presentation only — the pairwise
              ledger underneath is untouched. */}
          <FormCard style={{ paddingVertical: 0 }}>
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
                    onPress={() =>
                      setOpenAttr((current) => (current === 'budget' ? null : 'budget'))
                    }
                  />
                  {openAttr === 'budget' ? (
                    <View style={{ paddingBottom: theme.spacing.md }}>
                      <AmountField currency={currency} value={budget} onChange={setBudget} />
                    </View>
                  ) : null}
                </View>
              ) : null}

              {/* The currencies this group will be paid in, each with its rate
                  against the group's own — on every group, not only a trip. */}
              <View>
                <SettingRow
                  icon="server-outline"
                  title={t.newGroupForm.tripCurrency}
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
                info
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
          </FormCard>

          {/* Seed the whole form from a group you already have — a quiet link
              at the foot. Hidden once you are already cloning. */}
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
                paddingVertical: theme.spacing.xs,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Ionicons name="copy-outline" size={iconSize.base} color={accent(theme)} />
              <Text variant="body" style={{ color: accent(theme), fontWeight: '600' }}>
                {t.clone.startFromExisting}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>

      {/* Create is pinned rather than parked at the foot of a long scroll. The
          Screen already applies the bottom safe-area inset, so the padding here
          is only the breathing room above it. */}
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

type Theme = ReturnType<typeof useTheme>;

/** The spec's violet, for the lit tile, the Add contacts outline and the
 *  accents; the theme's own brand on dark, where the light violet is too dim. */
const ACCENT = '#6845E8';
const accent = (theme: Theme): string => (theme.scheme === 'dark' ? theme.color.brand : ACCENT);

/** How far the first card rides up over the header's wash. */
const HEADER_OVERLAP = 24;
/** The cover tile's side. */
const COVER = 104;

/** The five kinds offered as tiles, in the spec's order, with their glyphs. */
const TILE_TYPES = [
  GroupType.Trip,
  GroupType.Home,
  GroupType.Couple,
  GroupType.Friends,
  GroupType.Other,
] as const;
const TILE_ICON: Record<(typeof TILE_TYPES)[number], keyof typeof Ionicons.glyphMap> = {
  [GroupType.Trip]: 'airplane',
  [GroupType.Home]: 'home',
  [GroupType.Couple]: 'heart',
  [GroupType.Friends]: 'people',
  [GroupType.Other]: 'ellipsis-horizontal',
};

/** An outlined input box: 50pt tall, 12pt corners, the hairline border. */
function fieldBox(theme: Theme) {
  return {
    alignItems: 'center' as const,
    minHeight: 50,
    borderWidth: 1,
    borderColor: theme.scheme === 'dark' ? theme.color.border : '#E5E5ED',
    borderRadius: 12,
    paddingHorizontal: theme.spacing.md,
    backgroundColor: theme.color.surface,
  };
}

/** A field's label: 15pt, semibold. */
function FieldLabel({ children, style }: { children: ReactNode; style?: object }) {
  return (
    <Text style={[{ fontSize: 15, lineHeight: 20, fontWeight: '600' }, style]}>{children}</Text>
  );
}

/** A white card with the spec's 22pt corners, 16pt padding and a soft lift. */
function FormCard({ children, style }: { children: ReactNode; style?: object }) {
  const theme = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: theme.color.surface,
          borderRadius: 22,
          padding: theme.spacing.lg,
          shadowColor: '#2A1E6B',
          shadowOpacity: 0.06,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
          elevation: 1,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** The header's travel scene: a plane, clouds, a palm and a suitcase on a
 *  transparent ground, 2:1. */
const HEADER_ART = require('../../assets/images/new-group-header.webp') as number;
const HEADER_ART_RATIO = 2;

/**
 * The header on a light-blue wash that fades into the page: close, the title at
 * 28pt over its line, and the travel scene on the right, which the first card
 * overlaps. Decoration only, so it is hidden from screen readers.
 */
function NewGroupHeader({ title, subtitle }: { title: string; subtitle: string }) {
  const theme = useTheme();
  const { t } = useStrings();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const artWidth = Math.round(screenWidth * 0.86);
  const dark = theme.scheme === 'dark';
  return (
    <LinearWash
      colors={dark ? ['#1B2440', theme.color.bg] : ['#DDF0FF', '#F5F4FF']}
      style={{
        paddingTop: insets.top + theme.spacing.sm,
        paddingHorizontal: theme.spacing.lg,
        paddingBottom: HEADER_OVERLAP + theme.spacing.lg,
      }}
    >
      {/* The travel scene, anchored bottom-right under the title's side of the
          wash: its left half is transparent, so the words sit on sky. */}
      <Image
        source={HEADER_ART}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
        contentFit="contain"
        style={{
          position: 'absolute',
          end: 0,
          bottom: HEADER_OVERLAP - 8,
          // Measured sizes, not a percentage and an aspect ratio: on Android an
          // absolutely placed image sized that way lays out at zero height.
          width: artWidth,
          height: artWidth / HEADER_ART_RATIO,
        }}
      />
      <IconButton label={t.common.close} onPress={() => router.back()}>
        <Ionicons name="close" size={24} color={theme.color.text} />
      </IconButton>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
        style={{ fontSize: 28, lineHeight: 34, fontWeight: '700', marginTop: 4, maxWidth: '72%' }}
      >
        {title}
      </Text>
      <Text
        numberOfLines={2}
        style={{
          fontSize: 16,
          lineHeight: 22,
          fontWeight: '500',
          color: theme.color.textMuted,
          maxWidth: '64%',
        }}
      >
        {subtitle}
      </Text>
    </LinearWash>
  );
}

/** A top-to-bottom wash — the Gradient kit sweeps diagonally, a header fades
 *  straight down into the page. */
function LinearWash({
  colors,
  style,
  children,
}: {
  colors: readonly string[];
  style: object;
  children: ReactNode;
}) {
  return (
    <Gradient colors={colors} radius={0} style={style}>
      {children}
    </Gradient>
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
  const dark = theme.scheme === 'dark';
  const ink = selected ? accent(theme) : dark ? theme.color.textMuted : '#52586C';
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        height: 96,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        borderRadius: 16,
        borderWidth: selected ? 1.5 : 1,
        borderColor: selected ? accent(theme) : dark ? theme.color.border : '#E5E5ED',
        backgroundColor: selected
          ? dark
            ? theme.color.brandSoft
            : '#F3EFFF'
          : theme.color.surface,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Ionicons name={icon} size={28} color={ink} />
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.75}
        style={{ fontSize: 14, fontWeight: selected ? '600' : '500', color: ink }}
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
  const tint = theme.tint[CHIP_TINTS[index % CHIP_TINTS.length] ?? 'sky'];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={removeLabel}
      onPress={onRemove}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        paddingStart: 5,
        paddingEnd: theme.spacing.md,
        height: 48,
        borderRadius: 24,
        backgroundColor: theme.scheme === 'dark' ? theme.color.surfaceMuted : '#F5F5FA',
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <View
        style={{
          width: 38,
          height: 38,
          borderRadius: 19,
          backgroundColor: tint.bg,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ fontSize: 17, color: tint.ink, fontWeight: '700' }}>
          {name.trim().charAt(0).toUpperCase()}
        </Text>
      </View>
      <Text style={{ fontSize: 15, fontWeight: '500', color: theme.color.text }}>{name}</Text>
      <Ionicons name="close" size={18} color={theme.color.textMuted} />
    </Pressable>
  );
}

/** Blue, mint, peach and round again — the spec's three people, in order. */
const CHIP_TINTS = ['sky', 'mint', 'peach', 'lilac', 'pink', 'coral'] as const;

/**
 * One setting: an outlined glyph, the name over a line on what it does, and on
 * the end either its value with a chevron, a soft "Add ›" pill while it is
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
  info = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  value?: string | null;
  action?: string;
  expanded?: boolean;
  onPress?: () => void;
  trailing?: ReactNode;
  /** A small ⓘ after the title, for a setting whose name needs its line read. */
  info?: boolean;
}) {
  const theme = useTheme();
  const chevron = expanded ? 'chevron-up' : directionalIcon('chevron-forward');
  const body = (
    <Row
      style={{ alignItems: 'center', gap: theme.spacing.md, minHeight: 68, paddingVertical: 10 }}
    >
      <Ionicons name={icon} size={26} color={theme.color.text} />
      <View style={{ flex: 1 }}>
        <Row style={{ alignItems: 'center', gap: 4 }}>
          <Text style={{ fontSize: 16, lineHeight: 21, fontWeight: '600' }}>{title}</Text>
          {info ? (
            <Ionicons name="information-circle-outline" size={16} color={theme.color.textMuted} />
          ) : null}
        </Row>
        <Text
          numberOfLines={2}
          style={{ fontSize: 13, lineHeight: 18, color: theme.color.textMuted }}
        >
          {subtitle}
        </Text>
      </View>
      {trailing ??
        (value ? (
          <Row style={{ alignItems: 'center', gap: 2, maxWidth: '42%' }}>
            <Text
              numberOfLines={1}
              style={{ fontSize: 14, fontWeight: '600', flexShrink: 1, color: theme.color.text }}
            >
              {value}
            </Text>
            <Ionicons name={chevron} size={16} color={theme.color.textFaint} />
          </Row>
        ) : action ? (
          <Row
            style={{
              alignItems: 'center',
              gap: 4,
              height: 36,
              paddingHorizontal: theme.spacing.md,
              borderRadius: 18,
              backgroundColor: theme.scheme === 'dark' ? theme.color.surfaceMuted : '#F7F6F3',
            }}
          >
            <Text style={{ fontSize: 14, fontWeight: '600', color: theme.color.text }}>
              {action}
            </Text>
            <Ionicons name={chevron} size={16} color={theme.color.text} />
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

/** Create, as a full-width pill in the blue-to-violet wash with an arrow. */
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
      style={({ pressed }) => ({ opacity: disabled ? 0.5 : pressed ? 0.85 : 1 })}
    >
      <Gradient
        colors={CREATE_WASH}
        radius={28}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: theme.spacing.sm,
          height: 56,
        }}
      >
        <Text style={{ fontSize: 18, fontWeight: '600', color: '#FFFFFF' }}>{label}</Text>
        <Ionicons name={directionalIcon('arrow-forward')} size={22} color="#FFFFFF" />
      </Gradient>
    </Pressable>
  );
}

const CREATE_WASH = ['#3D63E8', '#7041E8'] as const;
