/**
 * Pick people out of your other groups, to add to this one.
 *
 * The picker's own screen title on the entry row is `t.people.fromAnotherGroup`,
 * repeated here as the heading — the same rule the contacts screen follows
 * (`app/contact-picker.tsx`), so arriving confirms the tap rather than
 * surprising it.
 *
 * A pushed route, driven by `addFromAnotherGroupBridge` for the same reason
 * `contact-picker.tsx` is: it cannot hand its answer back through a prop, so
 * the caller leaves its intent (which group, and what to do with the pick)
 * before navigating here, and this screen reads it once on mount. Everything
 * it shows — who is in which of your groups — comes off the local mirror
 * (`useKnownContacts`) read fresh on open; nothing is snapshotted into the
 * bridge itself.
 *
 * Confirming hands the ticked people to the bridge's `onPicked`, which group
 * settings has wired to its own `addPicked` — the same failure-tolerant, one
 * mutation per person loop the contacts row already drives. This screen never
 * calls `addGhost` itself: choosing who is its whole job, adding them is not.
 *
 * The selection logic — who is offered, in what order, and who is shown as
 * already here — lives in `lib/addFromAnotherGroup`, pure and tested without
 * a renderer; read its header before changing what this screen draws, since
 * the two are meant to agree about what "offered" means.
 */

import { useEffect, useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { FlashList } from '@shopify/flash-list';
import { Pressable, View } from 'react-native';

import {
  Avatar,
  Button,
  directionalIcon,
  EmptyState,
  IconButton,
  iconSize,
  Row,
  Screen,
  Text,
  useTheme,
} from '@waves/ui';

import { type PickedContact } from '@/components/ContactPicker';
import { useGroups } from '@/data/hooks';
import { useKnownContacts } from '@/data/knownContacts';
import { displayName, groupLabel } from '@/data/types';
import { fill, plural, useStrings } from '@/i18n';
import { offerFromOtherGroups, type OfferedPerson } from '@/lib/addFromAnotherGroup';
import { takeAddFromAnotherGroupRequest } from '@/lib/addFromAnotherGroupBridge';
import { useAuth } from '@/lib/auth';
import { useBottomClearance } from '@/lib/clearance';
import { fold } from '@/lib/contactMatch';
import { useFavorites } from '@/lib/favorites';
import { router } from '@/lib/navigation';

/** One row of the flat list: a group's name, or somebody in it. */
type Entry =
  | { readonly kind: 'heading'; readonly id: string; readonly label: string }
  | { readonly kind: 'person'; readonly id: string; readonly person: OfferedPerson };

const ROW_HEIGHT = 64;
const HEADING_HEIGHT = 38;

/** Collapse the picks to one add per address (or per name, for the address-
 *  less ones) before they reach `addPicked` — the same person ticked under two
 *  different source groups must not queue two identical ghosts in one confirm.
 *  Cross-*session* duplicates are a different, already-accepted question (see
 *  the module header on `lib/addFromAnotherGroup`); this is only about not
 *  sending the same row twice from the same tap. */
function dedupe(people: readonly OfferedPerson[]): PickedContact[] {
  const byIdentity = new Map<string, PickedContact>();
  for (const person of people) {
    const key = `${person.email ?? ''}|${person.phone ?? ''}|${fold(person.name)}`;
    if (!byIdentity.has(key)) {
      byIdentity.set(key, { name: person.name, email: person.email, phone: person.phone });
    }
  }
  return [...byIdentity.values()];
}

export default function AddFromAnotherGroupScreen(): React.JSX.Element {
  const theme = useTheme();
  const clearance = useBottomClearance();
  const { t, locale } = useStrings();
  const { profile } = useAuth();
  const { membersByGroup } = useKnownContacts();
  const groups = useGroups();
  const { isFavorite } = useFavorites();

  // Taken once on mount — captures the request and clears the bridge in one
  // step, the same rule `contact-picker.tsx` follows for the same reason.
  const [request] = useState(() => takeAddFromAnotherGroupRequest());
  useEffect(() => {
    if (!request) router.back();
  }, [request]);
  const groupId = request?.groupId ?? '';

  const sections = useMemo(() => {
    const rows = groups.data ?? [];
    // Favourites first, same as `clone-group` — the group you actually reuse
    // people from every month is the one you starred.
    const ordered = [...rows].sort((a, b) => Number(isFavorite(b.id)) - Number(isFavorite(a.id)));
    const sourceGroups = ordered.map((sourceGroup) => {
      const raw = membersByGroup.get(sourceGroup.id) ?? [];
      return {
        groupId: sourceGroup.id,
        groupLabel: groupLabel(sourceGroup, raw, profile?.id ?? null),
        members: raw.map((member) => ({
          memberId: member.id,
          profileId: member.profile_id,
          name: displayName(member, profile?.id ?? null),
          email: member.invite_email ?? null,
          phone: member.invite_phone ?? null,
          leftAt: member.left_at,
        })),
      };
    });
    return offerFromOtherGroups({
      currentGroupId: groupId,
      viewerProfileId: profile?.id ?? null,
      groups: sourceGroups,
    });
  }, [groups.data, membersByGroup, isFavorite, profile?.id, groupId]);

  const entries = useMemo<Entry[]>(() => {
    const list: Entry[] = [];
    for (const section of sections) {
      list.push({ kind: 'heading', id: `h:${section.groupId}`, label: section.groupLabel });
      for (const person of section.people) {
        list.push({ kind: 'person', id: person.key, person });
      }
    }
    return list;
  }, [sections]);

  const [picked, setPicked] = useState<ReadonlyMap<string, OfferedPerson>>(new Map());
  const toggle = (person: OfferedPerson): void => {
    setPicked((previous) => {
      const next = new Map(previous);
      if (next.has(person.key)) next.delete(person.key);
      else next.set(person.key, person);
      return next;
    });
  };

  const confirm = (): void => {
    if (!request || picked.size === 0) return;
    request.onPicked(dedupe([...picked.values()]));
    router.back();
  };

  return (
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
            <Text variant="heading">{t.people.fromAnotherGroup}</Text>
          </View>
          <View style={{ width: 44 }} />
        </Row>

        {sections.length === 0 ? (
          <View style={{ flex: 1, justifyContent: 'center' }}>
            <EmptyState
              icon={
                <Ionicons name="people-outline" size={iconSize.xxl} color={theme.color.brand} />
              }
              title={t.people.noOtherGroupsTitle}
              body={t.people.noOtherGroupsBody}
            />
          </View>
        ) : (
          <View
            style={{
              flex: 1,
              borderRadius: theme.radius.md,
              backgroundColor: theme.color.surface,
              overflow: 'hidden',
            }}
          >
            <FlashList
              data={entries}
              extraData={picked}
              getItemType={(entry) => entry.kind}
              keyExtractor={(entry) => entry.id}
              drawDistance={1500}
              contentContainerStyle={{ paddingBottom: clearance }}
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => {
                if (item.kind === 'heading') return <Heading label={item.label} />;
                const { person } = item;
                return (
                  <PersonRow
                    person={person}
                    selected={picked.has(person.key)}
                    onPress={() => toggle(person)}
                  />
                );
              }}
            />
          </View>
        )}

        <Text variant="micro" tone="muted">
          {t.pickers.onlyPickedAreSent}
        </Text>

        <Button
          label={
            picked.size === 0
              ? t.pickers.nobodyPickedYet
              : `${t.add} ${plural(locale, picked.size, t.pickers.personCount)}`
          }
          fullWidth
          disabled={picked.size === 0}
          onPress={confirm}
        />
      </View>
    </Screen>
  );
}

/** A source group's name, over its people. Squared to match `ContactPicker`'s
 *  own multi-letter heading — this app's word, not a letter, over each block. */
function Heading({ label }: { label: string }): React.JSX.Element {
  const theme = useTheme();
  return (
    <View
      style={{
        height: HEADING_HEIGHT,
        justifyContent: 'center',
        paddingHorizontal: theme.spacing.lg,
        backgroundColor: theme.color.surface,
      }}
    >
      <Text variant="micro" tone="muted" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function PersonRow({
  person,
  selected,
  onPress,
}: {
  person: OfferedPerson;
  selected: boolean;
  onPress: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const { t } = useStrings();
  const inset = theme.spacing.lg + 40 + theme.spacing.md;
  const locked = person.already;

  // Visible subtitle: what makes the row worth a second look — already here,
  // else the address recorded for them, matching `ContactRow`'s own fallback.
  const subtitle = locked ? t.pickers.alreadyInGroup : (person.email ?? person.phone ?? '');

  // The spoken label always names the source group, even where the sighted
  // layout only says it once in the heading above — a screen reader landing
  // on a row is not guaranteed to have just heard that heading (constraint:
  // every selectable row names who it is and which group they came from).
  const spoken = locked
    ? fill(t.pickers.alreadyAddedName, { name: person.name })
    : `${person.name}, ${fill(t.people.fromGroupLabel, { group: person.groupLabel })}`;

  return (
    <Pressable
      onPress={locked ? undefined : onPress}
      disabled={locked}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected, disabled: locked }}
      accessibilityLabel={spoken}
      style={({ pressed }) => ({
        opacity: locked ? 0.45 : 1,
        backgroundColor: pressed ? theme.color.surfaceMuted : theme.color.surface,
      })}
    >
      <Row
        style={{ height: ROW_HEIGHT, paddingHorizontal: theme.spacing.lg, gap: theme.spacing.md }}
      >
        <Avatar name={person.name} size={40} ghost />
        <View style={{ flex: 1 }}>
          <Text variant="body" numberOfLines={1}>
            {person.name}
          </Text>
          {subtitle ? (
            <Text variant="micro" tone="muted" numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        <Ionicons
          name={selected ? 'checkmark-circle' : 'ellipse-outline'}
          size={iconSize.xxl}
          color={selected ? theme.color.brand : theme.color.border}
        />
      </Row>
      <View style={{ height: 1, marginLeft: inset, backgroundColor: theme.color.border }} />
    </Pressable>
  );
}
