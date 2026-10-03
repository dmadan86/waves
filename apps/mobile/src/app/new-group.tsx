import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { randomUUID } from 'expo-crypto';
import { useLocalSearchParams } from 'expo-router';
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
  ChipRow,
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

import { DetailRow, DetailRows } from '@/components/DetailRows';
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
import { useCaptures, useCreateGroup, useGroup, useGroups } from '@/data/hooks';
import { useKnownContacts } from '@/data/knownContacts';
import { suggestPeople } from '@/lib/addFromAnotherGroup';
import { HeroScene } from '@/components/home/HeroScene';
import { useHeroStatusBar } from '@/components/ScreenHero';
import { useHeroScene } from '@/lib/heroScenePreference';
import { HERO_THEMES } from '@/lib/scene';
import { shortPersonNames } from '@/lib/shortPersonName';
import { SPEC_ACCENT, SPEC_INK, SPEC_MUTED } from '@/lib/specPalette';
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
  // The few measures that step down on a narrow phone (320–359pt): the cover,
  // and where "Add contacts" sits. Everything else is flex and fits by itself.
  const { width: screenWidth } = useWindowDimensions();
  const narrow = screenWidth < NARROW_WIDTH;
  // Home's scene behind the top of the form — the same one, for the same time
  // of day (or the Background the person picked) — measured so it runs from
  // under the status bar to just into the first card, where it fades out.
  const scene = useHeroScene();
  const [headerHeight, setHeaderHeight] = useState(0);
  const insetsTop = useSafeAreaInsets().top;
  // The scene is under the status bar, so the clock goes white while this
  // screen is in front.
  // The title's ink follows the sky, as Home's greeting does: dark on a pale
  // scene, white on a deep one — and the status bar with it.
  const darkInk = HERO_THEMES[scene].ink === 'dark';
  useHeroStatusBar(darkInk ? 'dark' : 'light');
  // "Add contacts" beside the Add friends title only where both fit whole; on
  // a smaller phone it takes a line of its own rather than truncate the title.
  const contactsInline = screenWidth >= CONTACTS_INLINE_WIDTH;
  // "Add a currency" needs a wide row; elsewhere the pill says "Add", like its
  // neighbours, rather than squeeze the row's title onto two lines.
  const roomyRows = screenWidth >= ROOMY_ROW_WIDTH;
  const cover = narrow ? COVER_NARROW : COVER;
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
  // People from your other groups to offer on the Suggested row: the
  // placeholders this screen can add, the ones in the most groups first, and
  // nobody already picked above.
  const allGroups = useGroups().data;
  const { membersByGroup } = useKnownContacts();
  const suggestions = useMemo(() => {
    const sources = (allGroups ?? []).map((group) => {
      const raw = membersByGroup.get(group.id) ?? [];
      return {
        groupId: group.id,
        groupLabel: group.name ?? '',
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
    return suggestPeople(sources, viewerId, ghosts);
  }, [allGroups, membersByGroup, viewerId, ghosts]);
  // What each suggestion reads under its face: a clean first name, with an
  // initial added where two would otherwise read the same.
  const suggestionLabels = useMemo(
    () => shortPersonNames(suggestions.map((person) => person.name)),
    [suggestions],
  );
  // The search box is a search: what is typed narrows the suggestions by name
  // or by phone number, and Add (or return) still adds the typed name itself.
  const shownSuggestions = useMemo(() => {
    const needle = ghostName.trim().toLowerCase();
    const digits = needle.replace(/\D/g, '');
    return suggestions
      .map((person, index) => ({ person, label: suggestionLabels[index] ?? person.name }))
      .filter(
        ({ person }) =>
          !needle ||
          person.name.toLowerCase().includes(needle) ||
          (digits.length >= 3 && (person.phone ?? '').replace(/\D/g, '').includes(digits)),
      );
  }, [ghostName, suggestions, suggestionLabels]);
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
      // maker of a group always is. Trips only: the row that sets them is only
      // offered on a trip, so rates left over from switching the kind away from
      // Trip are not applied.
      for (const row of type === GroupType.Trip ? liveRates : []) {
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
        {headerHeight > 0 ? (
          <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0 }}>
            <HeroScene
              scene={scene}
              width={screenWidth}
              height={headerHeight + SCENE_INTO_CARD}
              horizon={headerHeight - SCENE_OVERLAP}
              headerBottom={insetsTop + HEADER_ROW}
              pageColor={theme.color.bg}
            />
          </View>
        ) : null}
        <View onLayout={(event) => setHeaderHeight(event.nativeEvent.layout.height)}>
          <NewGroupHeader
            title={cloning ? t.clone.duplicateTitle : t.newGroupForm.title}
            ink={darkInk ? SPEC_INK : '#FFFFFF'}
          />
        </View>

        <View
          style={{
            paddingHorizontal: theme.spacing.lg,
            // The first card rides up over the scene's foot, as Home's balance
            // card does.
            marginTop: -SCENE_OVERLAP,
            gap: theme.spacing.sm,
          }}
        >
          {/* The group's own account of itself: its cover — tapped to choose
              an icon — beside the name and the sentence that says what it is
              for, each a labelled, outlined field. */}
          <FormCard style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.group.chooseIcon}
              onPress={() => setIconOpen(true)}
              style={({ pressed }) => ({
                width: cover,
                height: cover,
                borderRadius: 16,
                backgroundColor: theme.color.brandSoft,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <GroupPhoto photoPath={null} emoji={emoji} size={Math.round(cover * 0.56)} />
              {/* The camera as a white disc inside the cover's corner, its glyph in
                  the accent, lifted by a soft shadow. */}
              <View
                style={{
                  position: 'absolute',
                  end: 6,
                  bottom: 6,
                  width: CAMERA_FAB,
                  height: CAMERA_FAB,
                  borderRadius: CAMERA_FAB / 2,
                  backgroundColor: theme.color.surface,
                  alignItems: 'center',
                  justifyContent: 'center',
                  shadowColor: '#1B1340',
                  shadowOpacity: 0.18,
                  shadowRadius: 8,
                  shadowOffset: { width: 0, height: 3 },
                  elevation: 4,
                }}
              >
                <Ionicons name="camera" size={16} color={accent(theme)} />
              </View>
            </Pressable>
            {/* The name and the (optional) sentence under it, each one dense
                line — the field's own placeholder says what it is, so the
                label that used to sit above each box is gone rather than
                costing a row of its own; the accessibility label underneath
                still names the field for a screen reader. */}
            <View style={{ flex: 1, minWidth: 0, justifyContent: 'center', gap: theme.spacing.xs }}>
              <Row style={[fieldBox(theme), { paddingEnd: theme.spacing.sm }]}>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder={t.newGroupForm.nameExample}
                  placeholderTextColor={theme.color.textFaint}
                  accessibilityLabel={t.group.groupName}
                  autoFocus
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: 16,
                    color: ink(theme),
                    paddingVertical: 0,
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
                    <Ionicons
                      name="close-circle"
                      size={iconSize.md}
                      color={theme.color.textFaint}
                    />
                  </Pressable>
                ) : null}
              </Row>
              {/* One line, like the name above it, capped at the column's own limit
                  so the field stops taking keystrokes rather than letting somebody
                  type a sentence the database would refuse on Create. */}
              <Row style={[fieldBox(theme), { paddingEnd: theme.spacing.sm }]}>
                <TextInput
                  value={description}
                  onChangeText={setDescription}
                  placeholder={t.newGroupForm.descriptionExample}
                  placeholderTextColor={theme.color.textFaint}
                  accessibilityLabel={t.group.groupDescription}
                  maxLength={GROUP_DESCRIPTION_MAX}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: 16,
                    color: ink(theme),
                    paddingVertical: 0,
                  }}
                />
                {description.length > 0 ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t.entry.clear}
                    onPress={() => setDescription('')}
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
          <FormCard style={{ gap: theme.spacing.sm }}>
            <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  backgroundColor: theme.color.brandSoft,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="people" size={18} color={accent(theme)} />
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${t.extras.addPeopleByName}. ${t.extras.ghostNote}`}
                onPress={() => setShowGhostNote((open) => !open)}
                style={{ flex: 1, minWidth: 0 }}
              >
                <Text
                  numberOfLines={1}
                  style={{ fontSize: 16, lineHeight: 20, fontWeight: '600', color: ink(theme) }}
                >
                  {t.extras.addPeopleByName}
                </Text>
              </Pressable>
              {contactsInline ? (
                <AddContactsButton label={t.newGroupForm.addContacts} onPress={openContactPicker} />
              ) : null}
            </Row>
            {/* On a narrow phone the pill would squeeze the title to an
                ellipsis, so it takes a line of its own under it. */}
            {contactsInline ? null : (
              <AddContactsButton
                label={t.newGroupForm.addContacts}
                onPress={openContactPicker}
                fullWidth
              />
            )}
            {showGhostNote ? (
              <Text variant="caption" tone="muted">
                {t.extras.ghostNote}
              </Text>
            ) : null}

            <Row
              style={{
                alignItems: 'center',
                gap: theme.spacing.sm,
                height: 40,
                paddingHorizontal: theme.spacing.md,
                borderRadius: 20,
                backgroundColor: theme.scheme === 'dark' ? theme.color.surfaceMuted : '#F5F5FA',
              }}
            >
              <Ionicons name="search" size={16} color={theme.color.textMuted} />
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
                  minWidth: 0,
                  fontSize: 15,
                  color: ink(theme),
                  paddingVertical: 0,
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
                  <Text style={{ fontSize: 15, fontWeight: '700', color: accent(theme) }}>
                    {t.add}
                  </Text>
                </Pressable>
              ) : null}
            </Row>

            {/* People from your other groups, one tap to add — and whoever has
                already been added, as the same small inline faces — kept to
                one dense strip rather than a tall block. Only placeholders are
                offered as suggestions: a real account joins a group by invite. */}
            {shownSuggestions.length > 0 || ghosts.length > 0 ? (
              <View style={{ gap: theme.spacing.xs }}>
                {shownSuggestions.length > 0 ? (
                  <Row style={{ alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: 13, fontWeight: '600', color: muted(theme) }}>
                      {t.newGroupForm.suggested}
                    </Text>
                    {/* Everyone else is in the address book. */}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t.people.browseContacts}
                      onPress={openContactPicker}
                      hitSlop={8}
                      style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
                    >
                      <Text style={{ fontSize: 13, fontWeight: '600', color: accent(theme) }}>
                        {t.newGroupForm.seeAll}
                      </Text>
                    </Pressable>
                  </Row>
                ) : null}
                {/* Scrolls sideways inside the card: the list runs to the card's
                    own edges (the negative margin undoes the card's padding) so a
                    face is cut by the card, never by the padding, and the page
                    itself never scrolls sideways. */}
                {shownSuggestions.length > 0 ? (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                    style={{ marginHorizontal: -theme.spacing.md }}
                    contentContainerStyle={{
                      gap: theme.spacing.sm,
                      paddingHorizontal: theme.spacing.md,
                    }}
                  >
                    {shownSuggestions.map(({ person, label }, index) => (
                      <SuggestedPersonButton
                        key={person.key}
                        name={label}
                        index={index}
                        label={fill(t.voice.addNamed, { name: person.name })}
                        onPress={() =>
                          setGhosts((current) => [
                            ...current,
                            { name: person.name, email: person.email, phone: person.phone },
                          ])
                        }
                      />
                    ))}
                  </ScrollView>
                ) : null}
                {ghosts.length > 0 ? (
                  <Row style={{ flexWrap: 'wrap', gap: theme.spacing.xs }}>
                    {ghosts.map((ghost, index) => (
                      <PersonChip
                        key={`${keyOfGhost(ghost)}-${index}`}
                        name={ghost.name}
                        index={index}
                        removeLabel={fill(t.itemize.removeItem, { label: ghost.name })}
                        onRemove={() =>
                          setGhosts((current) => current.filter((_, i) => i !== index))
                        }
                      />
                    ))}
                  </Row>
                ) : null}
              </View>
            ) : null}
          </FormCard>

          {/* What kind of group, as one row of compact pills — the same chip
              row group settings wears for the same choice, so picking a kind
              here and changing it later look like the same control. A name
              that reads as an event ("Birthday party") keeps its kind; Other
              is lit for it, the nearest of the six. */}
          <FormCard style={{ gap: theme.spacing.sm }}>
            <FieldLabel icon="briefcase-outline">
              {t.newGroupForm.groupType}
              <Text style={{ fontSize: 13, fontWeight: '400', color: muted(theme) }}>
                {` ${t.newGroupForm.optional}`}
              </Text>
            </FieldLabel>
            <ChipRow<GroupType>
              value={type}
              onChange={setPickedType}
              options={typeOptions.map((option) => ({
                value: option.value,
                label: option.label,
                icon: chipIcon(option.icon),
              }))}
            />
          </FormCard>

          {/* The group's settings. Dates and budget are trip-only, so a dinner
              or a flat never sees them; the budget, left at zero, sets nothing.
              ADR-009: fewer repayments is presentation only — the pairwise
              ledger underneath is untouched. */}
          <FormCard style={{ paddingVertical: 0 }}>
            <DetailRows>
              {type === GroupType.Trip ? (
                <View>
                  <DetailRow
                    icon="calendar-outline"
                    label={t.misc.tripDatesTitle}
                    value={tripDates.start_date && tripDates.end_date ? dateSummary : t.add}
                    placeholder={!(tripDates.start_date && tripDates.end_date)}
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
                  <DetailRow
                    icon="wallet-outline"
                    label={t.extras.tripBudget}
                    value={budget > 0n ? budgetSummary : t.add}
                    placeholder={budget <= 0n}
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

              {/* The currencies a trip will be paid in, each with its rate
                  against the group's own. Trips only, like dates and budget. */}
              {type === GroupType.Trip ? (
                <View>
                  <DetailRow
                    icon="cash-outline"
                    label={t.newGroupForm.tripCurrency}
                    value={
                      liveRates.length > 0
                        ? ratesSummary
                        : roomyRows
                          ? t.newGroupForm.addCurrency
                          : t.add
                    }
                    placeholder={liveRates.length === 0}
                    expanded={openAttr === 'rates'}
                    onPress={() => setOpenAttr((current) => (current === 'rates' ? null : 'rates'))}
                  />
                  {openAttr === 'rates' ? (
                    <View style={{ paddingBottom: theme.spacing.md }}>
                      <TripRatesCard store={rateStore} groupCurrency={currency} canEdit embedded />
                    </View>
                  ) : null}
                </View>
              ) : null}

              {/* The one row whose control says the value and changes it in the
                  same gesture, so it has no chevron. */}
              <DetailRow
                icon="flash-outline"
                label={t.group.simplifyDebts}
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
          paddingTop: theme.spacing.xs,
          paddingBottom: theme.spacing.sm,
          gap: theme.spacing.xs,
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
const ACCENT = SPEC_ACCENT;
const accent = (theme: Theme): string => (theme.scheme === 'dark' ? theme.color.brand : ACCENT);

/** The spec's text colours for this screen, light theme; dark keeps the theme's. */
const INK = SPEC_INK;
const MUTED = SPEC_MUTED;
const ink = (theme: Theme): string => (theme.scheme === 'dark' ? theme.color.text : INK);
const muted = (theme: Theme): string => (theme.scheme === 'dark' ? theme.color.textMuted : MUTED);

/** Home's scene behind the header: the room under the title row where its
 *  landscape shows, how far the first card rides up over its foot, and how far
 *  it runs on under that card before it has faded into the page. */
const SCENE_ROOM = 36;
const SCENE_OVERLAP = 40;
const SCENE_INTO_CARD = 60;
/** The header row's own height (the 44pt back button plus its top padding),
 *  where the scene's readability shade ends. */
const HEADER_ROW = 52;
/** The cover tile's side — a little smaller on a narrow phone, so the two
 *  fields beside it keep a usable width. */
const COVER = 80;
const COVER_NARROW = 68;
/** Below this screen width (pt) the layout takes its narrow measures. */
const NARROW_WIDTH = 360;
/** From this width "Add contacts" fits beside the Add friends title. */
const CONTACTS_INLINE_WIDTH = 380;
/** From this width a setting row has room for "Add a currency ›". */
const ROOMY_ROW_WIDTH = 400;
/** The camera button floating on the cover's corner. */
const CAMERA_FAB = 34;

/** The kind-of-group icon, one place, matching the chip row group settings
 *  wears so changing a group's kind looks like the same control everywhere. */
const chipIcon =
  (name: keyof typeof Ionicons.glyphMap) =>
  // eslint-disable-next-line react/display-name
  (color: string): ReactNode => <Ionicons name={name} size={iconSize.base} color={color} />;

/** An outlined input box: 50pt tall, 12pt corners, the hairline border. */
function fieldBox(theme: Theme) {
  return {
    alignItems: 'center' as const,
    minHeight: 42,
    borderWidth: 1,
    borderColor: theme.scheme === 'dark' ? theme.color.border : '#E5E5ED',
    borderRadius: 12,
    paddingHorizontal: theme.spacing.md,
    backgroundColor: theme.color.surface,
  };
}

/** A field's label: 15pt, semibold. */
function FieldLabel({
  children,
  icon,
  style,
}: {
  children: ReactNode;
  /** A small glyph before the label, saying what the field is at a glance. */
  icon?: keyof typeof Ionicons.glyphMap;
  style?: object;
}) {
  const theme = useTheme();
  return (
    <Row style={[{ alignItems: 'center', gap: theme.spacing.sm }, style]}>
      {icon ? <Ionicons name={icon} size={20} color={muted(theme)} /> : null}
      <Text
        style={{
          flexShrink: 1,
          fontSize: 15,
          lineHeight: 20,
          fontWeight: '600',
          color: muted(theme),
        }}
      >
        {children}
      </Text>
    </Row>
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
          borderRadius: 20,
          padding: theme.spacing.md,
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

/**
 * The header: a back chevron and the title on one line — the Activity screen's
 * shape — over Home's scene in the ink its sky calls for, with room under the row for the scene's
 * landscape to show before the first card rides up over it.
 */
function NewGroupHeader({ title, ink: headerInk }: { title: string; ink: string }) {
  const theme = useTheme();
  const { t } = useStrings();
  const insets = useSafeAreaInsets();
  return (
    <Row
      style={{
        paddingTop: insets.top + theme.spacing.xs,
        paddingHorizontal: theme.spacing.lg,
        // Room under the row for the scene's mountains before the first card
        // rides up over their foot.
        paddingBottom: SCENE_ROOM,
        alignItems: 'center',
        gap: theme.spacing.sm,
      }}
    >
      <IconButton label={t.common.back} onPress={() => router.back()}>
        <Ionicons name={directionalIcon('chevron-back')} size={iconSize.xl} color={headerInk} />
      </IconButton>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
        style={{
          flex: 1,
          fontSize: 19,
          lineHeight: 24,
          fontWeight: '800',
          color: headerInk,
        }}
      >
        {title}
      </Text>
    </Row>
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
        gap: theme.spacing.xs,
        paddingStart: 4,
        paddingEnd: theme.spacing.sm,
        height: 38,
        borderRadius: 19,
        backgroundColor: theme.scheme === 'dark' ? theme.color.surfaceMuted : '#F5F5FA',
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
        <Text style={{ fontSize: 14, color: tint.ink, fontWeight: '700' }}>
          {name.trim().charAt(0).toUpperCase()}
        </Text>
      </View>
      <Text style={{ fontSize: 14, fontWeight: '500', color: theme.color.text }}>{name}</Text>
      <Ionicons name="close" size={15} color={theme.color.textMuted} />
    </Pressable>
  );
}

/** Blue, mint, peach and round again — the spec's three people, in order. */
const CHIP_TINTS = ['sky', 'mint', 'peach', 'lilac', 'pink', 'coral'] as const;

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
        radius={25}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: theme.spacing.sm,
          height: 50,
        }}
      >
        <Text style={{ fontSize: 17, fontWeight: '600', color: '#FFFFFF' }}>{label}</Text>
        <View
          style={{
            width: 1,
            height: 26,
            marginHorizontal: theme.spacing.md,
            backgroundColor: 'rgba(255, 255, 255, 0.45)',
          }}
        />
        <Ionicons name={directionalIcon('arrow-forward')} size={22} color="#FFFFFF" />
      </Gradient>
    </Pressable>
  );
}

const CREATE_WASH = ['#3D63E8', ACCENT] as const;

/** A suggested person: an initial in a tinted disc with a small + badge, the
 *  name under it. One tap adds them. `more` draws the list's last tile — a
 *  dotted disc that opens the contact picker for everyone else. */
function SuggestedPersonButton({
  name,
  index,
  label,
  onPress,
  more = false,
}: {
  name: string;
  index: number;
  label: string;
  onPress: () => void;
  more?: boolean;
}) {
  const theme = useTheme();
  const tint = theme.tint[SUGGEST_TINTS[index % SUGGEST_TINTS.length] ?? 'lilac'];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        width: SUGGEST_WIDTH,
        alignItems: 'center',
        gap: 4,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <View
        style={{
          width: 42,
          height: 42,
          borderRadius: 21,
          backgroundColor: more ? theme.color.surface : tint.bg,
          borderWidth: more ? 1.5 : 0,
          borderStyle: more ? 'dashed' : 'solid',
          borderColor: more ? accent(theme) : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {more ? (
          <Ionicons name="ellipsis-horizontal" size={18} color={accent(theme)} />
        ) : (
          <Text style={{ fontSize: 16, fontWeight: '700', color: tint.ink }}>
            {name.charAt(0).toUpperCase()}
          </Text>
        )}
        {more ? null : (
          <View
            style={{
              position: 'absolute',
              end: -2,
              bottom: -2,
              width: 17,
              height: 17,
              borderRadius: 9,
              backgroundColor: accent(theme),
              borderWidth: 1.5,
              borderColor: theme.color.surface,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="add" size={10} color="#FFFFFF" />
          </View>
        )}
      </View>
      <Text
        numberOfLines={1}
        ellipsizeMode="tail"
        style={{
          maxWidth: SUGGEST_WIDTH,
          fontSize: 12,
          lineHeight: 15,
          color: more ? accent(theme) : ink(theme),
          fontWeight: more ? '600' : '400',
        }}
      >
        {name}
      </Text>
    </Pressable>
  );
}

/** A suggested person's column: room for "Priya" or "Karthik" under the face. */
const SUGGEST_WIDTH = 62;

const SUGGEST_TINTS = ['lilac', 'peach', 'mint', 'sky', 'pink', 'coral'] as const;

/** "Add contacts": outlined in the accent, on the Add friends title row — or a
 *  full-width line of its own under it on a narrow phone. */
function AddContactsButton({
  label,
  onPress,
  fullWidth = false,
}: {
  label: string;
  onPress: () => void;
  fullWidth?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        height: fullWidth ? 36 : 30,
        paddingHorizontal: 12,
        borderRadius: 18,
        borderWidth: 1.5,
        borderColor: accent(theme),
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Ionicons name="person-add-outline" size={13} color={accent(theme)} />
      <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: '600', color: accent(theme) }}>
        {label}
      </Text>
    </Pressable>
  );
}
