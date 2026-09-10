/**
 * The archived groups, and the one tap that brings each back.
 *
 * Archiving is the calm way to clear a finished trip or a dead flatshare off
 * the dashboard without deleting its ledger — but until now it was a one-way
 * door: the group left `useGroups` and there was no screen that read the ones
 * it hid. This is that screen. It lists them newest-archived first and gives
 * each an Unarchive button; unarchiving is an ordinary group.update clearing
 * `archived_at`, so the row drops out of here and back onto the dashboard the
 * instant it is tapped (ADR-005 — the mirror overlay, not a round trip).
 *
 * The row itself now opens the group, which for a long time it could not: the
 * group screen refused an archived group outright, so the only thing you could
 * do with a finished trip was put it back on the dashboard you had deliberately
 * cleared it off. Archiving was always described as not deleting the ledger;
 * being unable to read that ledger made the description a technicality.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, View } from 'react-native';

import { MutationKind, rowsFor, SyncTable } from '@waves/core';
import {
  Button,
  Card,
  directionalIcon,
  EmptyState,
  IconButton,
  iconSize,
  Row,
  Screen,
  Text,
  useTabBarClearance,
  useTheme,
} from '@waves/ui';

import { useArchivedGroups } from '@/data/hooks';
import { GroupPhoto } from '@/components/GroupPhoto';
import { groupLabel, type MemberRow } from '@/data/types';
import { fill, useStrings } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { router } from '@/lib/navigation';
import { useSync } from '@/sync/provider';

export default function ArchivedGroupsScreen() {
  const theme = useTheme();
  const clearance = useTabBarClearance();
  const { t, locale } = useStrings();
  const { profile } = useAuth();
  const { mirror, mutate } = useSync();

  const archived = useArchivedGroups();
  const groups = archived.data ?? [];

  // Members are read from the same mirror so a group with no name still shows
  // "You and Priya" rather than the bare "New group" fallback.
  const membersByGroup = new Map<string, MemberRow[]>();
  for (const member of rowsFor(mirror, SyncTable.GroupMembers) as unknown as MemberRow[]) {
    const list = membersByGroup.get(member.group_id) ?? [];
    list.push(member);
    membersByGroup.set(member.group_id, list);
  }

  const unarchive = (groupId: string): void => {
    void mutate(MutationKind.GroupUpdate, groupId, { archived_at: null });
  };

  return (
    <Screen>
      <Row style={{ paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.md }}>
        <IconButton label={t.common.back} onPress={() => router.back()}>
          <Ionicons
            name={directionalIcon('chevron-back')}
            size={iconSize.lg}
            color={theme.color.text}
          />
        </IconButton>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text variant="heading">{t.group.archivedTitle}</Text>
        </View>
        <View style={{ width: 44 }} />
      </Row>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.xl,
          paddingBottom: clearance,
          paddingTop: theme.spacing.lg,
          gap: theme.spacing.xl,
        }}
        showsVerticalScrollIndicator={false}
      >
        {groups.length === 0 ? (
          <EmptyState title={t.group.archivedEmpty} body={t.group.archivedEmptyBody} />
        ) : (
          <View style={{ gap: theme.spacing.md }}>
            {groups.map((group) => (
              <Card
                key={group.id}
                style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}
              >
                {/* The photo and the name open the group; the button beside them
                    brings it back. This shelf used to offer only the second, so
                    an archived trip's ledger — which archiving explicitly does
                    not delete — could not be read without first putting the
                    group back on the dashboard you had cleared it off. The group
                    screen opens an archived group now, so the row leads
                    somewhere. */}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={groupLabel(
                    group,
                    membersByGroup.get(group.id) ?? [],
                    profile?.id,
                  )}
                  onPress={() => router.push(`/group/${group.id}`)}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.spacing.md,
                    flex: 1,
                    minWidth: 0,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <GroupPhoto photoPath={group.photo_path} emoji={group.cover_emoji} size={44} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text variant="subheading" numberOfLines={1}>
                      {groupLabel(group, membersByGroup.get(group.id) ?? [], profile?.id)}
                    </Text>
                    {group.archived_at ? (
                      <Text variant="micro" tone="muted">
                        {fill(t.group.archivedOn, {
                          date: new Intl.DateTimeFormat(locale, {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          }).format(new Date(group.archived_at)),
                        })}
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
                <Button
                  label={t.group.unarchive}
                  variant="secondary"
                  size="sm"
                  onPress={() => unarchive(group.id)}
                />
              </Card>
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
