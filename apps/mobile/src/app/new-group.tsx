import { useEffect, useMemo, useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { randomUUID } from 'expo-crypto';
import { useLocalSearchParams } from 'expo-router';
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import {
  currencySymbol,
  guessGroupEmoji,
  guessGroupType,
  minorUnitExponent,
  minorUnitScale,
  MutationKind,
  type EventTemplateId,
} from '@waves/core';
import {
  AmountField,
  Callout,
  directionalIcon,
  iconSize,
  ListRow as PlainListRow,
  Row,
  Screen,
  Sheet,
  Text,
  Toggle,
  useTheme,
} from '@waves/ui';

import { DictateButton } from '@/components/DictateButton';
import { GroupPhoto } from '@/components/GroupPhoto';
import { friendlyError } from '@/lib/errors';
import { GROUP_DESCRIPTION_MAX, normaliseGroupDescription } from '@/lib/groupDescription';
import { router } from '@/lib/navigation';
import { isPhoneCountryError, normaliseContactPhone } from '@/lib/phone';
import { type PickedContact } from '@/components/ContactPicker';
import { GroupCoverSheet } from '@/components/CoverEmojiPicker';
import { DatesSheetBody } from '@/components/DatesSheetBody';
import { EDIT_GROUP_NAME_MAX, GroupFieldCard } from '@/components/EditGroupSheetBody';
import { EventTemplateSheetBody } from '@/components/EventTemplateSheetBody';
import { OtherCurrenciesSheetBody } from '@/components/OtherCurrenciesSheetBody';
import { ListRow, PlainHeader, RowTile, SectionHeader, StandardCard } from '@/components/standard';
import { TagSheetBody } from '@/components/TagSheetBody';
import { type TripDatesValue } from '@/components/TripDates';
import { type TripRateStore } from '@/components/TripRates';
import { gregorianFormatter } from '@/lib/calendarGrid';
import { normaliseGroupTag } from '@/lib/groupTypeTag';
import {
  addCustomTemplate,
  loadCustomTemplates,
  removeCustomTemplate,
  saveCustomTemplates,
} from '@/lib/customEventTemplates';
import { type TripRateRow } from '@/lib/tripRates';
import { tripDateFromIso } from '@/lib/tripDateRange';
import { requestContacts } from '@/lib/contactPickerBridge';
import { useCaptures, useCreateGroup, useGroup, useGroups } from '@/data/hooks';
import { useKnownContacts } from '@/data/knownContacts';
import { sameHuman, suggestPeople } from '@/lib/addFromAnotherGroup';
import { shortPersonNames } from '@/lib/shortPersonName';
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
 * It is the settings screen's one card — cover, name and description, then the
 * type, dates, other currencies and tag rows, each opening the very same sheet
 * body — filled from local state instead of a saved group. Nothing is written
 * until Create is tapped, so backing out leaves no half-made group behind;
 * everything picked here is applied in one ordered burst once the group exists.
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
  const defaultCurrency = useDefaultCurrency();
  // What the group counts in. Follows the account default until somebody picks
  // one in the Other currencies sheet; there is no entry to lock it yet.
  const [pickedCurrency, setPickedCurrency] = useState<string | null>(null);
  const currency = pickedCurrency ?? defaultCurrency;
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
  const [customTag, setCustomTag] = useState('');
  // The group cover is an emoji icon, chosen by tapping the avatar. Photos are
  // a paid feature edited from group settings, not part of creating one.
  const [iconOpen, setIconOpen] = useState(false);
  // Null until somebody picks a kind — until then it is read from the name, the
  // same bargain the icon strikes. So the screen never opens assuming a trip: a
  // group called "Goa" still becomes one, "Dinner" does not, and an untyped
  // name falls back to Other rather than dragging trip fields in behind it.
  const [pickedType, setPickedType] = useState<GroupType | null>(null);
  // Event organizer (docs/event-organizer.md): which fixed sub-event list an
  // Event group starts with. Null until somebody picks one — a group is
  // allowed to stay a plain Event with no template, same as it is allowed to
  // stay untyped.
  const [eventTemplate, setEventTemplate] = useState<EventTemplateId | null>(null);
  // "Other" with the person's own name for it ("Housewarming"). Saved on the
  // group as its custom_tag; remembered on this device per account.
  const [customTemplate, setCustomTemplate] = useState('');
  const [savedTemplates, setSavedTemplates] = useState<string[]>([]);
  useEffect(() => {
    if (!viewerId) return;
    let live = true;
    void loadCustomTemplates(viewerId).then((list) => {
      if (live) setSavedTemplates(list);
    });
    return () => {
      live = false;
    };
  }, [viewerId]);
  const [ghostName, setGhostName] = useState('');
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
    // Nobody is excluded for being picked: a picked face stays on the row with
    // a check, and a second tap takes them back off.
    return suggestPeople(sources, viewerId, []);
  }, [allGroups, membersByGroup, viewerId]);
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
      .map((person, index) => ({
        person,
        label: suggestionLabels[index] ?? person.name,
        picked: ghosts.some((ghost) => sameHuman(ghost, person)),
      }))
      .filter(
        ({ person }) =>
          !needle ||
          person.name.toLowerCase().includes(needle) ||
          (digits.length >= 3 && (person.phone ?? '').replace(/\D/g, '').includes(digits)),
      );
  }, [ghostName, suggestions, suggestionLabels, ghosts]);
  // Added people who are not a face on the Suggested row (typed names, picked
  // contacts) keep their removable chip.
  const chipGhosts = ghosts.filter(
    (ghost) => !suggestions.some((person) => sameHuman(ghost, person)),
  );
  const [error, setError] = useState<string | null>(null);
  // Not asked on this screen — taken from the account country (which the user
  // sets on "Your account"), falling back to the phone's region. Decides the
  // group's currency and settle rails, both changeable later in group settings.
  const country: string | null = profile?.country_code ?? deviceCountry();
  // Null until somebody picks: the icon is otherwise read from the name, so an
  // untouched group still gets a sensible cover.
  const [pickedEmoji, setPickedEmoji] = useState<string | null>(null);
  // The colour behind the icon (a `GROUP_COVER_COLORS` key); null is the app's own.
  const [pickedColor, setPickedColor] = useState<string | null>(null);
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
  // The sheets this screen opens, one at a time, each the settings sheet.
  const [typeOpen, setTypeOpen] = useState(false);
  const [datesOpen, setDatesOpen] = useState(false);
  const [ratesOpen, setRatesOpen] = useState(false);
  const [tagOpen, setTagOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [budgetOpen, setBudgetOpen] = useState(false);

  /**
   * The rate store the Other currencies sheet edits: the same shape settings
   * backs with the mirror, backed here by state. `pendingRates` is written out
   * after Create.
   */
  const rateStore: TripRateStore = {
    rows: liveRates,
    pending: false,
    set: async ({ from, num, den, source }) => {
      setPendingRates((current) => {
        const rest = current.filter((row) => row.from !== from);
        if (num === null || den === null) return rest;
        return [...rest, { from, to: currency, num, den, source: source ?? 'manual' }];
      });
    },
  };

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
      setCustomTag(group.custom_tag ?? '');
      setPickedType(group.type);
      setPickedEmoji(group.cover_emoji ?? null);
      setPickedColor(group.cover_color ?? null);
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

  // The kind is a reading of the name ("Flat rent" reads as Home), unless
  // somebody has chosen one, and Trip when the name says nothing — most new
  // groups are trips, so that is what the picker starts on.
  const type: GroupType =
    pickedType ?? (guessGroupType(name) as GroupType | null) ?? GroupType.Trip;
  // The icon is a reading of the name, unless somebody has chosen one; it
  // changes under the caret as they type "Goa" and again if they change the
  // kind of group.
  const emoji = pickedEmoji ?? guessGroupEmoji(name) ?? EMOJI_FOR_TYPE[type];
  // Trips and events benefit most from simplification; a two-person group does
  // not. Follows the type until somebody says otherwise.
  const effectiveSimplify = simplify ?? (type === GroupType.Trip || type === GroupType.Event);

  // The kinds a group can be: the same six, in the same order, as settings.
  const typeOptions: { value: GroupType; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { value: GroupType.Trip, label: t.extras.typeTrip, icon: 'airplane' },
    { value: GroupType.Home, label: t.extras.typeHome, icon: 'home' },
    { value: GroupType.Couple, label: t.extras.typeCouple, icon: 'heart' },
    { value: GroupType.Event, label: t.extras.typeEvent, icon: 'sparkles' },
    { value: GroupType.Friends, label: t.extras.typeFriends, icon: 'people-circle' },
    { value: GroupType.Other, label: t.extras.typeOther, icon: 'people' },
  ];
  const currentType = typeOptions.find((option) => option.value === type) ?? typeOptions[5]!;
  const hasDates = type === GroupType.Trip || type === GroupType.Event;
  const datesSummary = (() => {
    const from = tripDateFromIso(tripDates.start_date);
    const to = tripDateFromIso(tripDates.end_date);
    if (!from) return t.pickers.notSet;
    const fmt = gregorianFormatter(locale, { weekday: 'short', day: 'numeric', month: 'short' });
    const text = (value: Date): string => fmt?.format(value) ?? value.toDateString();
    return to ? `${text(from)} ${locale === 'ar' ? '←' : '→'} ${text(to)}` : text(from);
  })();

  // The budget for its row, minor units back to a plain major string with the
  // currency symbol — the same maths AmountField does, just for display.
  const budgetSummary = ((): string => {
    if (budget <= 0n) return t.pickers.notSet;
    const scale = minorUnitScale(currency);
    const exponent = minorUnitExponent(currency);
    const whole = (budget / scale).toString();
    const major =
      exponent === 0 ? whole : `${whole}.${(budget % scale).toString().padStart(exponent, '0')}`;
    return `${currencySymbol(currency)}${major}`;
  })();
  const templateSummary =
    eventTemplate === 'other' && normaliseGroupTag(customTemplate)
      ? (normaliseGroupTag(customTemplate) ?? '')
      : eventTemplate
        ? t.eventOrganizer.templateNames[eventTemplate]
        : t.pickers.notSet;

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

      // The event template, if one was picked. Same ordered queue behind the
      // create as the description above — an ordinary member-writable field
      // (docs/event-organizer.md), not admin-gated, so a plain group.update is
      // enough; no new mutation kind earns its keep for one string.
      const ownTemplate =
        type === GroupType.Event && (eventTemplate ?? 'other') === 'other'
          ? normaliseGroupTag(customTemplate)
          : null;
      const templateToSave = eventTemplate ?? (ownTemplate ? 'other' : null);
      if (type === GroupType.Event && templateToSave) {
        await mutate(MutationKind.GroupUpdate, groupId, { event_template: templateToSave });
      }
      if (ownTemplate && viewerId) {
        const next = addCustomTemplate(
          savedTemplates,
          ownTemplate,
          Object.values(t.eventOrganizer.templateNames),
        );
        void saveCustomTemplates(viewerId, next);
      }

      // The member's own tag, if typed — same ordered queue, same reason. The
      // own template name rides in the same column when no tag was typed: it is
      // the word every list and the group header already show for the kind.
      const tagToSave = normaliseGroupTag(customTag) ?? ownTemplate;
      if (tagToSave) {
        await mutate(MutationKind.GroupUpdate, groupId, { custom_tag: tagToSave });
      }

      // The icon colour is not part of the create call either; a picked one
      // rides behind it on the same ordered queue, and none is simply not sent.
      if (pickedColor) {
        await mutate(MutationKind.GroupUpdate, groupId, { cover_color: pickedColor });
      }

      // Trip dates are not part of the create call, so they ride behind it as
      // an update on the same ordered queue — only when a trip was actually
      // given a start and end, since that is what turns the reminders on.
      if (
        (type === GroupType.Trip || type === GroupType.Event) &&
        tripDates.start_date &&
        tripDates.end_date
      ) {
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
      // maker of a group always is. Any kind of group, as in settings.
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
    // Spoken lists arrive as one line ("Anu, Ravi and Priya"), so a comma or a
    // standalone "and" separates people; typing one name works as before.
    const names = ghostName
      .split(/,|\s+and\s+|\s*&\s*/i)
      .map((part) => part.trim())
      .filter(Boolean);
    if (names.length === 0) return;
    setGhosts((current) => [
      ...current,
      ...names.map((name) => ({ name, email: null, phone: null })),
    ]);
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
  const divider = (
    <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.color.border }} />
  );
  const chevron = (
    <Ionicons
      name={directionalIcon('chevron-forward')}
      size={iconSize.md}
      color={theme.color.textMuted}
    />
  );

  return (
    <Screen edges={['bottom']}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: theme.spacing.xl }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <PlainHeader title={cloning ? t.clone.duplicateTitle : t.homeDash.newGroup} />

        <View style={{ paddingHorizontal: theme.spacing.lg, gap: theme.spacing.lg }}>
          {/* One card, as in group settings: the group (cover, name, what it is
              for) and, under hairlines, everything about how it is set up, each
              row a circular tile, a title, a quiet subtitle and a trailing
              control. Each row opens the settings sheet for the same thing. */}
          <StandardCard style={{ paddingVertical: theme.spacing.xs }}>
            <Row
              style={{
                alignItems: 'center',
                gap: theme.spacing.md,
                paddingVertical: theme.spacing.md,
              }}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t.group.changeCover}
                onPress={() => {
                  Keyboard.dismiss();
                  setIconOpen(true);
                }}
              >
                <GroupPhoto
                  photoPath={null}
                  emoji={emoji}
                  color={pickedColor}
                  size={72}
                  busy={false}
                />
                <View
                  style={{
                    position: 'absolute',
                    right: -2,
                    bottom: -2,
                    width: 28,
                    height: 28,
                    borderRadius: 14,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: '#2B2B3A',
                    borderWidth: 2,
                    borderColor: theme.color.surface,
                  }}
                >
                  <Ionicons name="camera" size={14} color="#FFFFFF" />
                </View>
              </Pressable>
              <View style={{ flex: 1, minWidth: 0, gap: theme.spacing.sm }}>
                <GroupFieldCard
                  icon="pencil-outline"
                  value={name}
                  onChangeText={setName}
                  label={t.group.groupName}
                  placeholder={t.newGroupForm.nameExample}
                  maxLength={EDIT_GROUP_NAME_MAX}
                  autoFocus
                />
                <GroupFieldCard
                  icon="text-box-outline"
                  value={description}
                  onChangeText={setDescription}
                  label={t.group.groupDescription}
                  placeholder={t.newGroupForm.descriptionExample}
                  maxLength={GROUP_DESCRIPTION_MAX}
                  multiline
                />
              </View>
            </Row>
            {divider}
            {/* The kind of group. Only changes the label, cover default and trip
              affordances. */}
            <PlainListRow
              leading={
                <RowTile tint={theme.color.brandSoft}>
                  <Ionicons name="people-outline" size={iconSize.lg} color={theme.color.brand} />
                </RowTile>
              }
              title={t.extras.groupTypeTitle}
              trailing={
                <Row
                  style={{
                    alignItems: 'center',
                    gap: theme.spacing.sm,
                    paddingHorizontal: theme.spacing.md,
                    height: 40,
                    borderRadius: theme.radius.pill,
                    backgroundColor: theme.color.brandSoft,
                  }}
                >
                  <Ionicons
                    name={currentType.icon}
                    size={iconSize.base}
                    color={theme.color.brand}
                  />
                  <Text style={{ color: theme.color.text, fontWeight: '700' }}>
                    {currentType.label}
                  </Text>
                </Row>
              }
              onPress={() => {
                Keyboard.dismiss();
                setTypeOpen(true);
              }}
            />
            {/* Trip and event dates appear for a trip or an event and go when the
              type changes. */}
            {hasDates ? (
              <>
                {divider}
                <PlainListRow
                  leading={
                    <RowTile tint={theme.scheme === 'dark' ? '#4CAF5038' : '#E4F5E6'}>
                      <Ionicons name="calendar-outline" size={iconSize.lg} color="#2E9E4F" />
                    </RowTile>
                  }
                  title={t.extras.datesRow}
                  subtitle={datesSummary}
                  trailing={chevron}
                  onPress={() => {
                    Keyboard.dismiss();
                    setDatesOpen(true);
                  }}
                />
              </>
            ) : null}
            {/* Event organizer (docs/event-organizer.md): which fixed sub-event
              list this Event starts with, or none. Event-only. */}
            {type === GroupType.Event ? (
              <>
                {divider}
                <PlainListRow
                  leading={
                    <RowTile tint={theme.color.brandSoft}>
                      <Ionicons
                        name="sparkles-outline"
                        size={iconSize.lg}
                        color={theme.color.brand}
                      />
                    </RowTile>
                  }
                  title={t.eventOrganizer.templateLabel}
                  subtitle={templateSummary}
                  trailing={chevron}
                  onPress={() => {
                    Keyboard.dismiss();
                    setTemplateOpen(true);
                  }}
                />
              </>
            ) : null}
            {/* An optional starting budget; a trip only. Left unset it sets nothing. */}
            {type === GroupType.Trip ? (
              <>
                {divider}
                <PlainListRow
                  leading={
                    <RowTile tint={theme.color.brandSoft}>
                      <Ionicons
                        name="wallet-outline"
                        size={iconSize.lg}
                        color={theme.color.brand}
                      />
                    </RowTile>
                  }
                  title={t.extras.tripBudget}
                  subtitle={budgetSummary}
                  trailing={chevron}
                  onPress={() => {
                    Keyboard.dismiss();
                    setBudgetOpen(true);
                  }}
                />
              </>
            ) : null}
            {divider}
            {/* The group's own currency and the others it is also paid in, one per
              pinned rate. Any kind of group. */}
            <PlainListRow
              leading={
                <RowTile tint={theme.scheme === 'dark' ? '#F5A62338' : '#FDEFD6'}>
                  <Ionicons name="cash-outline" size={iconSize.lg} color="#E8890C" />
                </RowTile>
              }
              title={t.fx.otherCurrencies}
              subtitle={
                liveRates.length > 0
                  ? `${currency} · ${liveRates.map((row) => row.from).join(', ')}`
                  : fill(t.fx.currencyOnly, { currency })
              }
              trailing={chevron}
              onPress={() => {
                Keyboard.dismiss();
                setRatesOpen(true);
              }}
            />
            {divider}
            {/* The member's own short tag, shown instead of the automatic type tag. */}
            <PlainListRow
              leading={
                <RowTile tint={theme.color.brandSoft}>
                  <Ionicons name="pricetag-outline" size={iconSize.lg} color={theme.color.brand} />
                </RowTile>
              }
              title={t.extras.tagLabel}
              subtitle={customTag.trim() || t.extras.tagPlaceholder}
              trailing={chevron}
              onPress={() => {
                Keyboard.dismiss();
                setTagOpen(true);
              }}
            />
            {divider}
            {/* ADR-009: fewer repayments is presentation only — the pairwise
              ledger underneath is untouched. */}
            <PlainListRow
              leading={
                <RowTile tint={theme.color.brandSoft}>
                  <Ionicons name="swap-horizontal" size={iconSize.lg} color={theme.color.brand} />
                </RowTile>
              }
              title={t.group.simplifyDebts}
              subtitle={t.group.simplifyDebtsSub}
              lines={2}
              trailing={
                <Toggle
                  value={effectiveSimplify}
                  onValueChange={setSimplify}
                  accessibilityLabel={t.group.simplifyDebts}
                />
              }
            />
          </StandardCard>

          {/* People: they are the group. "Add members" opens the phone's
              contacts; typing a name is the quieter second way in. Nobody's
              address book is uploaded (ADR-006). */}
          <View style={{ gap: theme.spacing.md }}>
            <SectionHeader
              title={fill(t.group.membersTitle, { n: ghosts.length + 1 })}
              trailing={
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t.group.addMembers}
                  onPress={() => {
                    Keyboard.dismiss();
                    openContactPicker();
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
            <StandardCard style={{ gap: theme.spacing.sm }}>
              <Row
                style={{
                  alignItems: 'center',
                  gap: theme.spacing.sm,
                  height: 44,
                  paddingHorizontal: theme.spacing.md,
                  borderRadius: theme.radius.pill,
                  backgroundColor: theme.color.brandSoft,
                }}
              >
                <Ionicons name="search" size={iconSize.base} color={theme.color.textMuted} />
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
                    fontSize: 16,
                    color: theme.color.text,
                    paddingVertical: 0,
                    includeFontPadding: false,
                    textAlignVertical: 'center',
                  }}
                />
                {/* Say the names instead of typing them: "Anu, Ravi and Priya". */}
                <DictateButton compact value={ghostName} onChange={setGhostName} />
                {ghostName.trim() ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t.add}
                    onPress={addTypedGhost}
                    hitSlop={8}
                    style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
                  >
                    <Text style={{ fontSize: 15, fontWeight: '700', color: theme.color.brand }}>
                      {t.add}
                    </Text>
                  </Pressable>
                ) : null}
              </Row>
              {/* What an added name is: a placeholder until they join. */}
              <Text variant="caption" tone="muted">
                {t.extras.ghostNote}
              </Text>

              {/* People from your other groups, one tap to add — and whoever has
                  already been added, as removable chips. Only placeholders are
                  offered as suggestions: a real account joins a group by invite. */}
              {shownSuggestions.length > 0 || chipGhosts.length > 0 ? (
                <View style={{ gap: theme.spacing.xs }}>
                  {shownSuggestions.length > 0 ? (
                    <Row style={{ alignItems: 'center', justifyContent: 'space-between' }}>
                      <Text variant="caption" tone="muted" style={{ fontWeight: '600' }}>
                        {t.newGroupForm.suggested}
                      </Text>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t.people.browseContacts}
                        onPress={openContactPicker}
                        hitSlop={8}
                        style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
                      >
                        <Text variant="caption" tone="brand" style={{ fontWeight: '600' }}>
                          {t.newGroupForm.seeAll}
                        </Text>
                      </Pressable>
                    </Row>
                  ) : null}
                  {/* Scrolls sideways inside the card, out to the card's own edges. */}
                  {shownSuggestions.length > 0 ? (
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      keyboardShouldPersistTaps="handled"
                      style={{ marginHorizontal: -theme.spacing.lg }}
                      contentContainerStyle={{
                        gap: theme.spacing.sm,
                        paddingHorizontal: theme.spacing.lg,
                      }}
                    >
                      {shownSuggestions.map(({ person, label, picked }, index) => (
                        <SuggestedPersonButton
                          key={person.key}
                          name={label}
                          index={index}
                          picked={picked}
                          label={fill(
                            picked ? t.itemize.removeItem : t.voice.addNamed,
                            picked ? { label: person.name } : { name: person.name },
                          )}
                          onPress={() =>
                            setGhosts((current) =>
                              picked
                                ? current.filter((ghost) => !sameHuman(ghost, person))
                                : [
                                    ...current,
                                    { name: person.name, email: person.email, phone: person.phone },
                                  ],
                            )
                          }
                        />
                      ))}
                    </ScrollView>
                  ) : null}
                  {chipGhosts.length > 0 ? (
                    <Row style={{ flexWrap: 'wrap', gap: theme.spacing.xs }}>
                      {chipGhosts.map((ghost, index) => (
                        <PersonChip
                          key={`${keyOfGhost(ghost)}-${index}`}
                          name={ghost.name}
                          index={index}
                          removeLabel={fill(t.itemize.removeItem, { label: ghost.name })}
                          onRemove={() =>
                            setGhosts((current) => current.filter((it) => it !== ghost))
                          }
                        />
                      ))}
                    </Row>
                  ) : null}
                </View>
              ) : null}
            </StandardCard>
          </View>

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
              <Ionicons name="copy-outline" size={iconSize.base} color={theme.color.brand} />
              <Text variant="body" tone="brand" style={{ fontWeight: '600' }}>
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
          paddingBottom: theme.spacing.sm,
          gap: theme.spacing.xs,
          backgroundColor: theme.color.bg,
        }}
      >
        {error ? <Callout tone="negative">{error}</Callout> : null}
        {createGroup.isPending ? <ActivityIndicator color={theme.color.brand} /> : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.misc.createGroup}
          accessibilityState={{ disabled: createGroup.isPending }}
          disabled={createGroup.isPending}
          onPress={() => {
            Keyboard.dismiss();
            void submit();
          }}
          style={({ pressed }) => ({
            height: 56,
            borderRadius: theme.radius.pill,
            backgroundColor: theme.color.brand,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: createGroup.isPending ? 0.5 : pressed ? 0.85 : 1,
          })}
        >
          <Text variant="subheading" style={{ color: theme.color.onBrand, fontWeight: '700' }}>
            {t.misc.createGroup}
          </Text>
        </Pressable>
      </View>

      {/* The cover: icon and colour. A photo is uploaded under the group's own
          path, so it is added from settings once the group exists. */}
      <GroupCoverSheet
        visible={iconOpen}
        onClose={() => setIconOpen(false)}
        value={emoji}
        color={pickedColor}
        name={name}
        onChange={setPickedEmoji}
        onColorChange={setPickedColor}
        hasPhoto={false}
        photoStatus="locked"
        onPickPhoto={() => undefined}
        onRemovePhoto={() => undefined}
        onUpgrade={() => undefined}
        iconOnly
      />

      <Sheet
        visible={typeOpen}
        onClose={() => setTypeOpen(false)}
        title={t.extras.groupTypeTitle}
        closeLabel={t.common.close}
      >
        {typeOptions.map((option, index) => (
          <ListRow
            key={option.value}
            leading={
              <RowTile tint={theme.color.brandSoft}>
                <Ionicons name={option.icon} size={iconSize.lg} color={theme.color.brand} />
              </RowTile>
            }
            title={option.label}
            trailing={
              option.value === type ? (
                <Ionicons name="checkmark" size={iconSize.lg} color={theme.color.brand} />
              ) : null
            }
            divider={index < typeOptions.length - 1}
            onPress={() => {
              setTypeOpen(false);
              setPickedType(option.value);
            }}
          />
        ))}
      </Sheet>

      <Sheet
        visible={datesOpen}
        onClose={() => setDatesOpen(false)}
        closeLabel={t.common.close}
        style={{ maxHeight: '90%' }}
      >
        {/* Mounted only while open, so each opening starts a fresh draft from
            the chosen range and closing discards it. */}
        {datesOpen ? (
          <DatesSheetBody
            group={tripDates}
            locale={locale}
            forEvent={type === GroupType.Event}
            onClose={() => setDatesOpen(false)}
            onSave={(patch) => setTripDates((current) => ({ ...current, ...patch }))}
          />
        ) : null}
      </Sheet>

      <Sheet
        visible={ratesOpen}
        onClose={() => setRatesOpen(false)}
        closeLabel={t.common.close}
        style={{ maxHeight: '90%' }}
      >
        {/* Nothing is counted yet, so the group currency is still editable here;
            foreign bills convert to it by default (waves_create_group). */}
        <OtherCurrenciesSheetBody
          store={rateStore}
          groupCurrency={currency}
          canEdit
          forTrip={type === GroupType.Trip}
          onClose={() => setRatesOpen(false)}
          groupId=""
          currencyLocked={false}
          onChangeCurrency={(next) => {
            // Rates are quoted against the currency they convert into.
            if (next === currency) return;
            setPickedCurrency(next);
            setPendingRates([]);
          }}
          convertOn
          isAdmin
          settlementCount={0}
        />
      </Sheet>

      <Sheet visible={tagOpen} onClose={() => setTagOpen(false)} closeLabel={t.common.close}>
        {tagOpen ? (
          <TagSheetBody
            value={customTag}
            onClose={() => setTagOpen(false)}
            onSave={(next) => setCustomTag(next)}
          />
        ) : null}
      </Sheet>

      <Sheet
        visible={templateOpen}
        onClose={() => setTemplateOpen(false)}
        closeLabel={t.common.close}
        style={{ maxHeight: '90%' }}
      >
        <EventTemplateSheetBody
          template={eventTemplate}
          onTemplateChange={setEventTemplate}
          custom={customTemplate}
          onCustomChange={setCustomTemplate}
          saved={savedTemplates}
          onRemoveSaved={(name) => {
            const next = removeCustomTemplate(savedTemplates, name);
            setSavedTemplates(next);
            if (viewerId) void saveCustomTemplates(viewerId, next);
          }}
          onClose={() => setTemplateOpen(false)}
        />
      </Sheet>

      <Sheet
        visible={budgetOpen}
        onClose={() => setBudgetOpen(false)}
        title={t.extras.tripBudget}
        closeLabel={t.common.close}
      >
        <View style={{ gap: theme.spacing.lg, paddingBottom: theme.spacing.lg }}>
          <AmountField currency={currency} value={budget} onChange={setBudget} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.common.done}
            onPress={() => {
              Keyboard.dismiss();
              setBudgetOpen(false);
            }}
            style={({ pressed }) => ({
              height: 56,
              borderRadius: theme.radius.pill,
              backgroundColor: theme.color.brand,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Text variant="subheading" style={{ color: theme.color.onBrand, fontWeight: '700' }}>
              {t.common.done}
            </Text>
          </Pressable>
        </View>
      </Sheet>
    </Screen>
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
        backgroundColor: theme.color.brandSoft,
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

/** A suggested person: an initial in a tinted disc with a small + badge, the
 *  name under it. One tap adds them. `more` draws the list's last tile — a
 *  dotted disc that opens the contact picker for everyone else. */
function SuggestedPersonButton({
  name,
  index,
  label,
  onPress,
  picked = false,
  more = false,
}: {
  name: string;
  index: number;
  /** Already in the group: the badge is a check. */
  picked?: boolean;
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
          width: 44,
          height: 44,
          borderRadius: 22,
          backgroundColor: more ? theme.color.surface : tint.bg,
          borderWidth: more ? 1.5 : 0,
          borderStyle: more ? 'dashed' : 'solid',
          borderColor: more ? theme.color.brand : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {more ? (
          <Ionicons name="ellipsis-horizontal" size={18} color={theme.color.brand} />
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
              backgroundColor: picked ? theme.color.positive : theme.color.brand,
              borderWidth: 1.5,
              borderColor: theme.color.surface,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name={picked ? 'checkmark' : 'add'} size={10} color="#FFFFFF" />
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
          color: more ? theme.color.brand : theme.color.text,
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
