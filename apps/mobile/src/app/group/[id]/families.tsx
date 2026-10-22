/**
 * Families inside a group: who travels and settles together.
 *
 * One card per family with its people, then everyone on their own, then a
 * "New family" button. Every change is a tap and a small sheet or a choice
 * dialog on this screen — nothing jumps elsewhere. Only an admin may change
 * the families (the server refuses anyone else); everybody can read them.
 *
 * The whole map is one `group.update` write (`groups.units`), so each change
 * is optimistic on this phone and lands on everybody else's with the next
 * sync. The ledger is untouched: a family is a lens over per-person balances.
 */

import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { ScrollView, View } from 'react-native';

import { headOf, type GroupUnits } from '@waves/core';
import { Callout, IconButton, iconSize, Row, Screen, Text, useTheme } from '@waves/ui';

import { EditTextSheet } from '@/components/EditTextSheet';
import { PersonAvatar } from '@/components/PersonAvatar';
import {
  ListRow,
  ScenicBody,
  ScenicHeader,
  SectionHeader,
  StandardCard,
} from '@/components/standard';
import { useBlockedUsers } from '@/data/blocked';
import { useGroup, useUpdateGroup } from '@/data/hooks';
import { displayName, isGhost, isViewer, type MemberRow } from '@/data/types';
import { fill, plural, useStrings } from '@/i18n';
import { useViewerId } from '@/lib/auth';
import { useBottomClearance } from '@/lib/clearance';
import { useDialog } from '@/lib/dialog';
import { friendlyError } from '@/lib/errors';
import { familyRows, placeMember, withFamily } from '@/lib/families';

export default function FamiliesScreen() {
  const theme = useTheme();
  const clearance = useBottomClearance();
  const { t, locale } = useStrings();
  const { id } = useLocalSearchParams<{ id: string }>();
  const groupId = id ?? '';
  const viewerId = useViewerId();
  const { blockedIds } = useBlockedUsers();
  const { choose, confirm } = useDialog();

  const { group, members } = useGroup(groupId);
  const updateGroup = useUpdateGroup(groupId);
  const units = group.data?.units ?? null;
  const people = members.data ?? [];
  const isAdmin = people.some((member) => isViewer(member, viewerId) && member.role === 'admin');
  const { families, onTheirOwn } = familyRows(units, people);

  const [error, setError] = useState<string | null>(null);
  // The name sheet: a new family started with one person from the "on their
  // own" list (a family is never empty), or a rename.
  const [naming, setNaming] = useState<{ familyId: string } | { withMember: string } | null>(null);

  const nameOf = (member: MemberRow): string =>
    displayName(member, viewerId, blockedIds, t.misc.someone);

  const save = (next: GroupUnits | null): void => {
    setError(null);
    updateGroup.mutate(
      { units: next },
      { onError: (caught) => setError(friendlyError(caught, t.families.couldNotSave, 'families')) },
    );
  };

  const saveName = (name: string): void => {
    const trimmed = name.trim();
    if (naming && trimmed) {
      if ('familyId' in naming) {
        const unit = units?.[naming.familyId];
        if (unit) save(withFamily(units, naming.familyId, { ...unit, name: trimmed }));
      } else {
        save(withFamily(units, randomUUID(), { name: trimmed, members: [naming.withMember] }));
      }
    }
    setNaming(null);
  };

  const familyMenu = async (familyId: string, name: string): Promise<void> => {
    const picked = await choose({
      title: name,
      options: [
        { id: 'rename', label: t.families.rename },
        { id: 'delete', label: t.families.deleteFamily },
      ],
    });
    if (picked === 'rename') setNaming({ familyId });
    if (picked === 'delete') {
      const ok = await confirm({
        title: t.families.deleteFamily,
        body: t.families.deleteBody,
        confirmLabel: t.common.delete,
        tone: 'danger',
      });
      if (ok) save(withFamily(units, familyId, null));
    }
  };

  /** What to do with somebody who is in a family: make them its head, move them, take them out. */
  const memberMenu = async (member: MemberRow, familyId: string): Promise<void> => {
    const unit = units?.[familyId];
    if (!unit) return;
    const others = families.filter((family) => family.id !== familyId);
    const picked = await choose({
      title: nameOf(member),
      options: [
        ...(headOf(unit) === member.id ? [] : [{ id: 'head', label: t.families.makeHead }]),
        ...others.map((family) => ({
          id: `move:${family.id}`,
          label: fill(t.families.moveTo, { name: family.unit.name }),
        })),
        { id: 'remove', label: t.families.removeFromFamily },
      ],
    });
    if (picked === 'head') save(withFamily(units, familyId, { ...unit, head: member.id }));
    else if (picked === 'remove') save(placeMember(units, member.id, null));
    else if (picked?.startsWith('move:')) save(placeMember(units, member.id, picked.slice(5)));
  };

  /** Somebody on their own: into one of the families, or into a new one. */
  const addToFamily = async (member: MemberRow): Promise<void> => {
    const picked = await choose({
      title: nameOf(member),
      body: t.families.addToFamily,
      options: [
        ...families.map((family) => ({ id: family.id, label: family.unit.name })),
        { id: 'new', label: t.families.newFamily },
      ],
    });
    if (picked === 'new') setNaming({ withMember: member.id });
    else if (picked) save(placeMember(units, member.id, picked));
  };

  const avatar = (member: MemberRow) => (
    <PersonAvatar member={member} name={displayName(member)} ghost={isGhost(member)} size={36} />
  );

  return (
    <Screen edges={[]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: clearance }}
        showsVerticalScrollIndicator={false}
      >
        <ScenicHeader title={t.families.title} />
        <ScenicBody>
          {error ? <Callout tone="negative">{error}</Callout> : null}
          {!isAdmin ? (
            <Text variant="caption" tone="muted">
              {t.families.adminOnly}
            </Text>
          ) : null}

          {families.map((family) => (
            <StandardCard key={family.id}>
              <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text variant="subheading" numberOfLines={1}>
                    {family.unit.name}
                  </Text>
                  <Text variant="caption" tone="muted">
                    {plural(locale, family.members.length, t.families.people)}
                  </Text>
                </View>
                {isAdmin ? (
                  <IconButton
                    label={t.group.more}
                    onPress={() => void familyMenu(family.id, family.unit.name)}
                  >
                    <Ionicons
                      name="ellipsis-horizontal"
                      size={iconSize.md}
                      color={theme.color.text}
                    />
                  </IconButton>
                ) : null}
              </Row>
              {family.members.map((member, index) => (
                <ListRow
                  key={member.id}
                  leading={avatar(member)}
                  title={nameOf(member)}
                  subtitle={headOf(family.unit) === member.id ? t.families.head : undefined}
                  divider={index < family.members.length - 1}
                  onPress={isAdmin ? () => void memberMenu(member, family.id) : undefined}
                />
              ))}
            </StandardCard>
          ))}

          {onTheirOwn.length > 0 ? (
            <View style={{ gap: theme.spacing.md }}>
              <SectionHeader title={t.families.onTheirOwn} />
              <StandardCard>
                {onTheirOwn.map((member, index) => (
                  <ListRow
                    key={member.id}
                    leading={avatar(member)}
                    title={nameOf(member)}
                    divider={index < onTheirOwn.length - 1}
                    onPress={isAdmin ? () => void addToFamily(member) : undefined}
                  />
                ))}
              </StandardCard>
            </View>
          ) : null}
        </ScenicBody>
      </ScrollView>

      <EditTextSheet
        visible={naming !== null}
        title={naming && 'familyId' in naming ? t.families.rename : t.families.newFamily}
        hint={t.families.nameHint}
        value={naming && 'familyId' in naming ? (units?.[naming.familyId]?.name ?? '') : ''}
        placeholder={t.families.namePlaceholder}
        saving={updateGroup.isPending}
        onSave={saveName}
        onClose={() => setNaming(null)}
      />
    </Screen>
  );
}
