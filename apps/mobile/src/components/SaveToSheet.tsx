/**
 * The voice "Save to" sheet: where a spoken expense goes, chosen and then
 * confirmed with "Save here".
 *
 * One `pick` holds the destination (see `lib/saveToSheetState`), so the two
 * pinned chips, a group and a set of people are mutually exclusive by
 * construction. Groups are single-select; people are a set the parent resolves
 * into an existing 1:1 group or a new one.
 *
 * Layout goal: ~8 rows visible on a 6.5-inch phone. Rows are compact
 * single-line entries (~44-48dp) inside a flat Card with thin Dividers
 * between them, not individual padded cards. Leading icons/avatars are 28-32dp.
 */

import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import {
  Avatar,
  Button,
  Card,
  Divider,
  iconSize,
  Row,
  SegmentedTabs,
  Text,
  tintForKey,
  useTheme,
} from '@waves/ui';

import { GroupMark } from '@/components/GroupMark';
import { PersonAvatar } from '@/components/PersonAvatar';
import type {
  DestinationChoice,
  DestinationSelection,
  PersonChoice,
} from '@/components/DestinationPicker';
import { useGroupLabeller, useHomeSummary } from '@/data/hooks';
import type { GroupRow } from '@/data/types';
import { plural, useStrings } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { matchesAssignGroupQuery } from '@/lib/captureAssign';
import { groupsNewestFirst, initialDestinationTab } from '@/lib/destinationPickerState';
import { usePersonalOffered } from '@/lib/guestGuard';
import {
  canSaveHere,
  groupSubtitle,
  pickPlace,
  seededPerson,
  togglePersonPick,
  unchangedSeedGroupId,
  type SaveToPick,
} from '@/lib/saveToSheetState';
import { useViewerIdentity } from '@/lib/viewerIdentity';

/** A people-tab contact, with what the row needs to draw them. */
export interface SaveToPerson extends PersonChoice {
  avatarUrl?: string | null;
  /** No account yet — the row says so instead of showing a balance. */
  isGhost?: boolean;
}

/** Leading icon circle diameter (32dp) — avatar/icon size for compact rows. */
const LEAD_CIRCLE = 32;

export function SaveToSheet({
  selection,
  groups,
  people,
  createRow = null,
  onChoose,
  onResolvePeople,
}: {
  selection: DestinationSelection;
  groups: readonly GroupRow[];
  people: readonly SaveToPerson[];
  /** The "new group" row, when a group name was heard. */
  createRow?: { label: string } | null;
  onChoose: (choice: DestinationChoice) => void;
  onResolvePeople: (names: string[]) => void;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const { profile } = useAuth();
  const summary = useHomeSummary(profile?.id ?? null);
  const labelFor = useGroupLabeller();
  const personalOffered = usePersonalOffered();
  const viewer = useViewerIdentity();

  const [tab, setTab] = useState<'groups' | 'people'>(() =>
    initialDestinationTab(selection, people),
  );
  // A destination that is really a 1:1 contact reads back as that person.
  const [seed] = useState(() => seededPerson(selection, people));
  const [pick, setPick] = useState<SaveToPick>(() =>
    seed ? { kind: 'people', names: [seed.name] } : selection,
  );
  const [groupQuery, setGroupQuery] = useState('');
  const [query, setQuery] = useState('');

  const pickedNames = pick.kind === 'people' ? pick.names : [];
  const isPicked = (name: string) =>
    pickedNames.some((entry) => entry.toLowerCase() === name.toLowerCase());
  const addTyped = () => {
    const typed = query.trim();
    if (typed && !isPicked(typed)) setPick((current) => togglePersonPick(current, typed));
    setQuery('');
  };

  const formatDay = (iso: string) =>
    new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
      new Date(iso),
    );

  // Radio/check indicator on the trailing edge.
  const radio = (on: boolean, checkbox = false) => (
    <Ionicons
      name={on ? (checkbox ? 'checkmark-circle' : 'checkmark-circle') : 'ellipse-outline'}
      size={iconSize.md}
      color={on ? theme.color.brand : theme.color.border}
    />
  );

  // Pinned shortcut chips (Inbox / Just me) above the tabs — kept as before.
  const chip = (
    key: string,
    on: boolean,
    onPress: () => void,
    label: string,
    lead: React.ReactNode,
  ) => (
    <Pressable
      key={key}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      style={({ pressed }) => ({
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        minHeight: 44,
        paddingHorizontal: theme.spacing.sm,
        borderRadius: theme.radius.pill,
        borderWidth: 1.5,
        borderColor: on ? theme.color.brand : 'transparent',
        backgroundColor: on ? theme.color.brandSoft : theme.color.surfaceMuted,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      {lead}
      <Text
        numberOfLines={1}
        style={{
          flexShrink: 1,
          color: on ? theme.color.brand : theme.color.text,
          fontWeight: '600',
        }}
      >
        {label}
      </Text>
    </Pressable>
  );

  /**
   * Compact single-line row: ~44-48dp tall, 28-32dp leading icon/avatar,
   * name + optional short muted subtitle inline, radio/check on the right.
   * No per-row card or border — rows live inside a flat Card with Dividers.
   */
  const compactRow = (
    key: string,
    on: boolean,
    onPress: () => void,
    lead: React.ReactNode,
    title: string,
    subtitle: string | null,
    checkbox = false,
  ) => (
    <Pressable
      key={key}
      onPress={onPress}
      accessibilityRole={checkbox ? 'checkbox' : 'button'}
      accessibilityState={checkbox ? { checked: on } : { selected: on }}
      accessibilityLabel={title}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        minHeight: 44,
        paddingVertical: theme.spacing.sm,
        paddingHorizontal: theme.spacing.md,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      {lead}
      <Text
        numberOfLines={1}
        style={{
          flex: 1,
          fontWeight: on ? '600' : '400',
          color: on ? theme.color.brand : theme.color.text,
        }}
      >
        {title}
        {subtitle ? (
          <Text variant="caption" tone="muted">
            {'  '}
            {subtitle}
          </Text>
        ) : null}
      </Text>
      {radio(on, checkbox)}
    </Pressable>
  );

  /**
   * 32×32 icon circle for rows that have no avatar (create, typed-name, etc.).
   */
  const iconCircle = (name: React.ComponentProps<typeof Ionicons>['name'], tinted = false) => (
    <View
      style={{
        width: LEAD_CIRCLE,
        height: LEAD_CIRCLE,
        borderRadius: LEAD_CIRCLE / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: tinted ? theme.color.brandSoft : theme.color.surfaceMuted,
      }}
    >
      <Ionicons
        name={name}
        size={iconSize.sm}
        color={tinted ? theme.color.brand : theme.color.textMuted}
      />
    </View>
  );

  const search = (
    value: string,
    onChange: (next: string) => void,
    placeholder: string,
    onSubmit?: () => void,
    trailing?: React.ReactNode,
  ) => (
    <Row
      style={{
        gap: theme.spacing.sm,
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.xs,
        borderRadius: theme.radius.pill,
        borderWidth: 1,
        borderColor: theme.color.border,
        backgroundColor: theme.color.surface,
        alignItems: 'center',
      }}
    >
      <Ionicons name="search" size={iconSize.sm} color={theme.color.brand} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.color.textFaint}
        accessibilityLabel={placeholder}
        onSubmitEditing={onSubmit}
        returnKeyType="done"
        autoCorrect={false}
        style={{ flex: 1, fontSize: 15, color: theme.color.text, paddingVertical: 6 }}
      />
      {trailing}
    </Row>
  );

  const visibleGroups = groupsNewestFirst(groups).filter((group) =>
    matchesAssignGroupQuery(labelFor(group), groupQuery),
  );
  const q = query.trim().toLowerCase();
  const contacts = people.filter((person) => !q || person.name.toLowerCase().includes(q));
  const typedIsNew = q.length > 0 && !people.some((person) => person.name.toLowerCase() === q);

  // Build group rows array so we know where to put Dividers.
  const groupRowItems: { key: string; node: GroupRow | 'create' }[] = [];
  if (createRow) groupRowItems.push({ key: 'create', node: 'create' });
  for (const group of visibleGroups) groupRowItems.push({ key: group.id, node: group });

  const save = () => {
    const keptGroupId = unchangedSeedGroupId(pick, seed);
    if (keptGroupId) onChoose({ kind: 'existing', groupId: keptGroupId });
    else if (pick.kind === 'people') onResolvePeople([...pick.names]);
    else if (pick.kind !== 'none') onChoose(pick);
  };

  return (
    <View style={{ flexShrink: 1, gap: theme.spacing.md }}>
      <ScrollView
        style={{ flexShrink: 1 }}
        contentContainerStyle={{ gap: theme.spacing.sm }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Row style={{ gap: theme.spacing.sm }}>
          {chip(
            'unassigned',
            pick.kind === 'unassigned',
            () => setPick(pickPlace({ kind: 'unassigned' })),
            t.voice.saveForLater,
            <Ionicons
              name={pick.kind === 'unassigned' ? 'checkmark-circle' : 'file-tray-full-outline'}
              size={iconSize.md}
              color={pick.kind === 'unassigned' ? theme.color.brand : theme.color.textMuted}
            />,
          )}
          {personalOffered
            ? chip(
                'me',
                pick.kind === 'me',
                () => setPick(pickPlace({ kind: 'me' })),
                viewer.name,
                <PersonAvatar name={viewer.name} avatarUrl={viewer.avatarUrl} size={28} />,
              )
            : null}
        </Row>

        <SegmentedTabs
          value={tab}
          onChange={setTab}
          tabs={[
            {
              value: 'groups',
              label: t.voice.groupsTab,
              icon: (color) => <Ionicons name="people" size={iconSize.sm} color={color} />,
            },
            {
              value: 'people',
              label: t.voice.peopleTab,
              icon: (color) => <Ionicons name="person" size={iconSize.sm} color={color} />,
            },
          ]}
        />

        {tab === 'groups' ? (
          <View style={{ gap: theme.spacing.sm }}>
            {search(groupQuery, setGroupQuery, t.voice.searchGroups)}
            {groupRowItems.length > 0 ? (
              <Card padded={false} flat style={{ overflow: 'hidden' }}>
                {groupRowItems.map((item, index) => {
                  const isLast = index === groupRowItems.length - 1;
                  if (item.node === 'create') {
                    return (
                      <View key="create">
                        {compactRow(
                          'create',
                          pick.kind === 'create',
                          () => setPick(pickPlace({ kind: 'create' })),
                          iconCircle('add-circle-outline', pick.kind === 'create'),
                          createRow!.label,
                          null,
                        )}
                        {!isLast ? <Divider /> : null}
                      </View>
                    );
                  }
                  const group = item.node as GroupRow;
                  const title = labelFor(group);
                  const isOn = pick.kind === 'existing' && pick.groupId === group.id;
                  return (
                    <View key={group.id}>
                      {compactRow(
                        group.id,
                        isOn,
                        () => setPick(pickPlace({ kind: 'existing', groupId: group.id })),
                        <Avatar
                          name={title}
                          mark={(color) => (
                            <GroupMark emoji={group.cover_emoji} size={18} color={color} />
                          )}
                          size={LEAD_CIRCLE}
                          tint={tintForKey(group.id)}
                        />,
                        title,
                        groupSubtitle(
                          plural(locale, summary.memberCountFor(group.id), t.memberCount),
                          group.start_date,
                          group.end_date,
                          formatDay,
                        ),
                      )}
                      {!isLast ? <Divider /> : null}
                    </View>
                  );
                })}
              </Card>
            ) : null}
            {visibleGroups.length === 0 ? (
              <Text tone="muted" align="center" style={{ paddingVertical: theme.spacing.lg }}>
                {groupQuery.trim() ? t.captures.assignNoMatch : t.voice.noGroups}
              </Text>
            ) : null}
          </View>
        ) : (
          <View style={{ gap: theme.spacing.sm }}>
            {/* A name nobody matches is added as a new person, as it always was. */}
            {search(
              query,
              setQuery,
              t.voice.searchPeopleShort,
              addTyped,
              query.trim() ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t.voice.addPerson}
                  onPress={addTyped}
                  hitSlop={8}
                >
                  <Ionicons name="add-circle" size={iconSize.md} color={theme.color.brand} />
                </Pressable>
              ) : null,
            )}

            {/* Contacts + typed-name rows inside a flat card with Dividers. */}
            {contacts.length > 0 || typedIsNew ? (
              <Card padded={false} flat style={{ overflow: 'hidden' }}>
                {contacts.map((person, index) => {
                  const on = isPicked(person.name);
                  const isLast = index === contacts.length - 1 && !typedIsNew;
                  return (
                    <View key={person.groupId}>
                      {compactRow(
                        person.groupId,
                        on,
                        () => setPick((current) => togglePersonPick(current, person.name)),
                        <PersonAvatar
                          name={person.name}
                          avatarUrl={person.avatarUrl}
                          ghost={person.isGhost}
                          size={LEAD_CIRCLE}
                        />,
                        person.name,
                        person.isGhost ? t.remindSheet.notOnWaves : null,
                        true,
                      )}
                      {!isLast ? <Divider /> : null}
                    </View>
                  );
                })}
                {typedIsNew ? (
                  <View>
                    {contacts.length > 0 ? <Divider /> : null}
                    {compactRow(
                      'add-typed',
                      false,
                      addTyped,
                      iconCircle('person-add-outline'),
                      t.voice.addNamed.replace('{name}', query.trim()),
                      null,
                    )}
                  </View>
                ) : null}
              </Card>
            ) : null}

            {/* Names typed in (nobody in the list) stay visible and removable. */}
            {pickedNames.filter(
              (name) => !people.some((p) => p.name.toLowerCase() === name.toLowerCase()),
            ).length > 0 ? (
              <Card padded={false} flat style={{ overflow: 'hidden' }}>
                {pickedNames
                  .filter(
                    (name) => !people.some((p) => p.name.toLowerCase() === name.toLowerCase()),
                  )
                  .map((name, index, arr) => (
                    <View key={`typed-${name}`}>
                      {compactRow(
                        `typed-${name}`,
                        true,
                        () => setPick((current) => togglePersonPick(current, name)),
                        iconCircle('person-outline', true),
                        name,
                        null,
                        true,
                      )}
                      {index < arr.length - 1 ? <Divider /> : null}
                    </View>
                  ))}
              </Card>
            ) : null}

            {contacts.length === 0 && !typedIsNew && pickedNames.length === 0 ? (
              <Text tone="muted" align="center" style={{ paddingVertical: theme.spacing.lg }}>
                {t.voice.noPeople}
              </Text>
            ) : null}
          </View>
        )}
      </ScrollView>

      <Button
        label={t.voice.saveHere}
        variant="brand"
        fullWidth
        onPress={save}
        disabled={!canSaveHere(pick)}
      />
    </View>
  );
}
