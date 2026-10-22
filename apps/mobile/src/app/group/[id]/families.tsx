/**
 * Families inside a group: who travels and settles together.
 *
 * One card per family with its people, then everyone on their own; a round +
 * at the top starts a new family. Every change is a tap and a small sheet or a choice
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
import { Pressable, ScrollView, Share, TextInput, View } from 'react-native';

import { familyStatement, formatFamilyStatement, headOf, type GroupUnits } from '@waves/core';
import {
  Button,
  Callout,
  directionalIcon,
  IconButton,
  iconSize,
  Row,
  Screen,
  Sheet,
  Text,
  useTheme,
} from '@waves/ui';

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
import { toLedgerSnapshots, toSettlementSnapshots, useGroup, useUpdateGroup } from '@/data/hooks';
import { displayName, isGhost, isViewer, type MemberRow } from '@/data/types';
import { fill, plural, useStrings } from '@/i18n';
import { useViewerId } from '@/lib/auth';
import { useBottomClearance } from '@/lib/clearance';
import { useDialog } from '@/lib/dialog';
import { friendlyError } from '@/lib/errors';
import {
  createFamily,
  familyEmoji,
  familyOf,
  familyRows,
  placeMember,
  withFamily,
} from '@/lib/families';

export default function FamiliesScreen() {
  const theme = useTheme();
  const clearance = useBottomClearance();
  const { t, locale } = useStrings();
  const { id } = useLocalSearchParams<{ id: string }>();
  const groupId = id ?? '';
  const viewerId = useViewerId();
  const { blockedIds } = useBlockedUsers();
  const { choose, confirm } = useDialog();
  // The two sheets: a family's menu, and "add to a family" for one person on their own.
  const [menuFamily, setMenuFamily] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ member: MemberRow; pick: string | null } | null>(null);

  const { group, members, expenses, settlements } = useGroup(groupId);
  const updateGroup = useUpdateGroup(groupId);
  const units = group.data?.units ?? null;
  const people = members.data ?? [];
  const isAdmin = people.some((member) => isViewer(member, viewerId) && member.role === 'admin');
  const { families, onTheirOwn } = familyRows(units, people);

  const [error, setError] = useState<string | null>(null);
  // The name sheet: a new family started with one person from the "on their
  // own" list (a family is never empty), or a rename.
  const [naming, setNaming] = useState<{ familyId: string } | { withMember: string } | null>(null);
  // The pick-people sheet behind "+" when nobody is on their own: a name and
  // a tick per person, each shown with the family they would leave.
  const [picking, setPicking] = useState<{ name: string; picked: ReadonlySet<string> } | null>(
    null,
  );

  const nameOf = (member: MemberRow): string =>
    displayName(member, viewerId, blockedIds, t.misc.someone);

  const shareStatement = async (unitId: string): Promise<void> => {
    if (!group.data || !units) return;
    try {
      const descriptions = new Map(
        expenses.rows.map((expense) => [expense.id, expense.currentVersion?.description ?? '']),
      );
      const statement = familyStatement(
        { name: group.data.name ?? '', currency: group.data.default_currency ?? 'INR' },
        units,
        unitId,
        toLedgerSnapshots(expenses.rows, group.data).map((expense) => ({
          ...expense,
          description: descriptions.get(expense.id) ?? '',
        })),
        toSettlementSnapshots(settlements.data ?? []),
        (memberId) => {
          const member = people.find((person) => person.id === memberId);
          return member ? nameOf(member) : t.misc.someone;
        },
      );
      await Share.share({ message: formatFamilyStatement(statement) });
    } catch (caught) {
      setError(friendlyError(caught, t.families.couldNotShare, 'families'));
    }
  };

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

  const deleteFamily = async (familyId: string): Promise<void> => {
    const ok = await confirm({
      title: t.families.deleteFamily,
      body: t.families.deleteBody,
      confirmLabel: t.common.delete,
      tone: 'danger',
    });
    if (ok) save(withFamily(units, familyId, null));
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

  const avatar = (member: MemberRow) => (
    <PersonAvatar member={member} name={displayName(member)} ghost={isGhost(member)} size={36} />
  );

  const emojiTile = (count: number, size: number) => (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: theme.radius.lg,
        backgroundColor: theme.color.brandSoft,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ fontSize: size * 0.5 }}>{familyEmoji(count)}</Text>
    </View>
  );

  const closeX = (onPress: () => void) => (
    <IconButton label={t.common.close} onPress={onPress}>
      <Ionicons name="close" size={iconSize.md} color={theme.color.text} />
    </IconButton>
  );

  const menu = families.find((family) => family.id === menuFamily) ?? null;
  const headName = (family: (typeof families)[number]): string => {
    const head = family.members.find((member) => member.id === headOf(family.unit));
    return head ? nameOf(head) : '';
  };

  /** A tinted action row of the family menu. */
  const menuRow = (
    icon: 'pencil' | 'trash-outline' | 'share-outline',
    title: string,
    body: string,
    danger: boolean,
    onPress: () => void,
    disabled = false,
  ) => {
    const ink = danger ? theme.color.negative : theme.color.brand;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${body}`}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.md,
          padding: theme.spacing.md,
          borderRadius: theme.radius.lg,
          backgroundColor: danger ? theme.color.negativeSoft : theme.color.brandSoft,
          opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
        })}
      >
        <Ionicons name={icon} size={iconSize.md} color={ink} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            style={{ fontWeight: '700', color: danger ? theme.color.negative : theme.color.text }}
          >
            {title}
          </Text>
          <Text variant="caption" tone="muted">
            {body}
          </Text>
        </View>
        <Ionicons name={directionalIcon('chevron-forward')} size={iconSize.sm} color={ink} />
      </Pressable>
    );
  };

  return (
    <Screen edges={[]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: clearance }}
        showsVerticalScrollIndicator={false}
      >
        <ScenicHeader
          title={t.families.title}
          subtitle={t.families.subtitle}
          action={
            // A family is never empty: a new one starts with the first person
            // on their own, or — when everyone is already placed — with the
            // people the admin picks out of their families.
            isAdmin ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t.families.newFamily}
                onPress={() =>
                  onTheirOwn[0]
                    ? setNaming({ withMember: onTheirOwn[0].id })
                    : setPicking({ name: '', picked: new Set() })
                }
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: theme.color.buttonPrimary,
                }}
              >
                <Ionicons name="add" size={iconSize.lg} color="#FFFFFF" />
              </Pressable>
            ) : undefined
          }
        />
        <ScenicBody>
          {error ? <Callout tone="negative">{error}</Callout> : null}
          {!isAdmin ? (
            <Text variant="caption" tone="muted">
              {t.families.adminOnly}
            </Text>
          ) : null}

          {families.length > 0 ? (
            <SectionHeader
              title={t.families.title}
              trailing={
                <Text variant="caption" tone="muted">
                  {plural(locale, families.length, t.families.summary)}
                </Text>
              }
            />
          ) : null}
          {families.map((family) => (
            <StandardCard key={family.id}>
              <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
                {emojiTile(family.members.length, 48)}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text variant="subheading" numberOfLines={1}>
                    {family.unit.name}
                  </Text>
                  <Text variant="caption" tone="muted">
                    {plural(locale, family.members.length, t.families.people)}
                  </Text>
                </View>
                {isAdmin ? (
                  <IconButton label={t.group.more} onPress={() => setMenuFamily(family.id)}>
                    <Ionicons
                      name="ellipsis-horizontal"
                      size={iconSize.md}
                      color={theme.color.text}
                    />
                  </IconButton>
                ) : null}
              </Row>
              <View
                style={{
                  marginTop: theme.spacing.sm,
                  paddingHorizontal: theme.spacing.md,
                  borderRadius: theme.radius.lg,
                  backgroundColor: theme.color.surfaceMuted,
                }}
              >
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
              </View>
            </StandardCard>
          ))}

          {onTheirOwn.length > 0 ? (
            <View style={{ gap: theme.spacing.md }}>
              <SectionHeader
                title={t.families.onTheirOwn}
                trailing={
                  <Text variant="caption" tone="muted">
                    {plural(locale, onTheirOwn.length, t.families.people)}
                  </Text>
                }
              />
              <StandardCard>
                {onTheirOwn.map((member, index) => (
                  <ListRow
                    key={member.id}
                    leading={avatar(member)}
                    title={nameOf(member)}
                    divider={index < onTheirOwn.length - 1}
                    onPress={
                      isAdmin
                        ? () => setAdding({ member, pick: families[0]?.id ?? null })
                        : undefined
                    }
                  />
                ))}
              </StandardCard>
            </View>
          ) : null}
        </ScenicBody>
      </ScrollView>

      <Sheet
        visible={menu !== null}
        onClose={() => setMenuFamily(null)}
        closeLabel={t.common.close}
      >
        {menu ? (
          <View style={{ gap: theme.spacing.md }}>
            <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
              {emojiTile(menu.members.length, 64)}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text variant="title" numberOfLines={1}>
                  {menu.unit.name}
                </Text>
                <Text variant="caption" tone="muted">
                  {plural(locale, menu.members.length, t.families.people)}
                </Text>
              </View>
              {closeX(() => setMenuFamily(null))}
            </Row>
            {menuRow(
              'share-outline',
              t.families.shareStatement,
              t.families.shareStatementBody,
              false,
              () => {
                setMenuFamily(null);
                void shareStatement(menu.id);
              },
              group.isLoading || members.isLoading || expenses.isLoading || settlements.isLoading,
            )}
            {menuRow('pencil', t.families.rename, t.families.renameBody, false, () => {
              setMenuFamily(null);
              setNaming({ familyId: menu.id });
            })}
            {menuRow(
              'trash-outline',
              t.families.deleteFamily,
              t.families.deleteRowBody,
              true,
              () => {
                setMenuFamily(null);
                void deleteFamily(menu.id);
              },
            )}
            <Button
              label={t.common.cancel}
              variant="secondary"
              fullWidth
              onPress={() => setMenuFamily(null)}
            />
          </View>
        ) : null}
      </Sheet>

      <Sheet visible={adding !== null} onClose={() => setAdding(null)} closeLabel={t.common.close}>
        {adding ? (
          <View style={{ gap: theme.spacing.md }}>
            <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
              {avatar(adding.member)}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text variant="title" numberOfLines={1}>
                  {nameOf(adding.member)}
                </Text>
                <Text variant="caption" tone="muted">
                  {t.families.addToFamily}
                </Text>
              </View>
              {closeX(() => setAdding(null))}
            </Row>
            {families.map((family) => {
              const on = adding.pick === family.id;
              return (
                <Pressable
                  key={family.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  onPress={() => setAdding({ ...adding, pick: family.id })}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.spacing.md,
                    padding: theme.spacing.md,
                    borderRadius: theme.radius.lg,
                    borderWidth: 1.5,
                    borderColor: on ? theme.color.brand : 'transparent',
                    backgroundColor: on ? theme.color.brandSoft : theme.color.surfaceMuted,
                  }}
                >
                  {emojiTile(family.members.length, 44)}
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ fontWeight: '700' }}>
                      {family.unit.name}
                    </Text>
                    <Text variant="caption" tone="muted" numberOfLines={1}>
                      {fill(t.families.settlesWith, {
                        count: plural(locale, family.members.length, t.families.members),
                        name: headName(family),
                      })}
                    </Text>
                  </View>
                  <Ionicons
                    name={on ? 'checkmark-circle' : 'ellipse-outline'}
                    size={iconSize.xl}
                    color={on ? theme.color.brand : theme.color.border}
                  />
                </Pressable>
              );
            })}
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                const member = adding.member;
                setAdding(null);
                setNaming({ withMember: member.id });
              }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.spacing.md,
                padding: theme.spacing.md,
                borderRadius: theme.radius.lg,
                borderWidth: 1.5,
                borderStyle: 'dashed',
                borderColor: theme.color.brand,
              }}
            >
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: theme.radius.lg,
                  backgroundColor: theme.color.brandSoft,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="add" size={iconSize.lg} color={theme.color.brand} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontWeight: '700', color: theme.color.brand }}>
                  {t.families.newFamily}
                </Text>
                <Text variant="caption" tone="muted" numberOfLines={1}>
                  {fill(t.families.newFamilyBody, { name: nameOf(adding.member) })}
                </Text>
              </View>
              <Ionicons
                name={directionalIcon('chevron-forward')}
                size={iconSize.sm}
                color={theme.color.brand}
              />
            </Pressable>
            <Button
              label={fill(t.families.addTo, {
                name: families.find((family) => family.id === adding.pick)?.unit.name ?? '',
              })}
              fullWidth
              disabled={adding.pick === null}
              onPress={() => {
                if (adding.pick) save(placeMember(units, adding.member.id, adding.pick));
                setAdding(null);
              }}
            />
            <Button
              label={t.common.cancel}
              variant="ghost"
              fullWidth
              onPress={() => setAdding(null)}
            />
          </View>
        ) : null}
      </Sheet>

      <Sheet
        visible={picking !== null}
        onClose={() => setPicking(null)}
        closeLabel={t.common.close}
      >
        {picking ? (
          <View style={{ gap: theme.spacing.md }}>
            <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text variant="title">{t.families.newFamily}</Text>
                <Text variant="caption" tone="muted">
                  {t.families.nameHint}
                </Text>
              </View>
              {closeX(() => setPicking(null))}
            </Row>
            <TextInput
              value={picking.name}
              onChangeText={(name) => setPicking({ ...picking, name })}
              autoCapitalize="words"
              autoCorrect={false}
              accessibilityLabel={t.families.newFamily}
              placeholder={t.families.namePlaceholder}
              placeholderTextColor={theme.color.textFaint}
              style={{
                borderWidth: 1,
                borderColor: theme.color.border,
                borderRadius: theme.radius.lg,
                paddingHorizontal: theme.spacing.md,
                paddingVertical: theme.spacing.sm,
                fontSize: 16,
                color: theme.color.text,
                backgroundColor: theme.color.surface,
              }}
            />
            <Text variant="caption" tone="muted">
              {t.families.whoIsIn}
            </Text>
            <View
              style={{
                paddingHorizontal: theme.spacing.md,
                borderRadius: theme.radius.lg,
                backgroundColor: theme.color.surfaceMuted,
              }}
            >
              {people.map((member, index) => {
                const on = picking.picked.has(member.id);
                return (
                  <ListRow
                    key={member.id}
                    leading={avatar(member)}
                    title={nameOf(member)}
                    subtitle={familyOf(units, member.id)?.name ?? t.families.onTheirOwn}
                    divider={index < people.length - 1}
                    onPress={() => {
                      const picked = new Set(picking.picked);
                      if (on) picked.delete(member.id);
                      else picked.add(member.id);
                      setPicking({ ...picking, picked });
                    }}
                    trailing={
                      <Ionicons
                        name={on ? 'checkmark-circle' : 'ellipse-outline'}
                        size={iconSize.xl}
                        color={on ? theme.color.brand : theme.color.border}
                      />
                    }
                  />
                );
              })}
            </View>
            <Button
              label={t.families.create}
              fullWidth
              disabled={picking.name.trim() === '' || picking.picked.size === 0}
              onPress={() => {
                save(createFamily(units, randomUUID(), picking.name.trim(), [...picking.picked]));
                setPicking(null);
              }}
            />
            <Button
              label={t.common.cancel}
              variant="ghost"
              fullWidth
              onPress={() => setPicking(null)}
            />
          </View>
        ) : null}
      </Sheet>

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
