/**
 * The archived groups, and the one tap that brings each back.
 *
 * Archiving is the calm way to clear a finished trip or a dead flatshare off
 * the dashboard without deleting its ledger. This screen lists the ones it
 * hid, newest-archived first, and gives each an Unarchive button; unarchiving
 * is an ordinary group.update clearing `archived_at`, so the row drops out of
 * here and back onto the dashboard the instant it is tapped (ADR-005 — the
 * mirror overlay, not a round trip).
 *
 * The row itself opens the group: an archived group's ledger is not deleted,
 * and being unable to read it would make that a technicality.
 *
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Image, ScrollView, View } from 'react-native';
import {} from 'react-native-safe-area-context';

import { MutationKind, rowsFor, SyncTable } from '@waves/core';
import { iconSize, Text, useTabBarClearance, useTheme } from '@waves/ui';

import { useArchivedGroups } from '@/data/hooks';
import { GroupPhoto } from '@/components/GroupPhoto';
import { groupLabel, type MemberRow } from '@/data/types';
import { PlainHeader } from '@/components/standard/PlainHeader';
import { LIST_TILE, ListCard, ListItem, ListPill } from '@/components/standard';
import { fill, useStrings } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { router } from '@/lib/navigation';
import { useSync } from '@/sync/provider';

const ARCHIVED_ART = require('../../../assets/images/archived-empty-art.webp') as number;

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
    <View style={{ flex: 1, backgroundColor: theme.color.bg }}>
      <PlainHeader title={t.group.archivedTitle} subtitle={t.group.archivedSubtitle} />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: clearance,
          gap: theme.spacing.xl,
        }}
        showsVerticalScrollIndicator={false}
      >
        {groups.length === 0 ? (
          <View
            style={{ alignItems: 'center', gap: theme.spacing.md, paddingTop: theme.spacing.xl }}
          >
            {/* The art is 530x360; fixed sizes because a percentage width with
                an aspect ratio renders zoomed and cropped on Android. */}
            <Image
              source={ARCHIVED_ART}
              accessibilityIgnoresInvertColors
              importantForAccessibility="no"
              resizeMode="contain"
              style={{ width: 265, height: 180 }}
            />
            <View style={{ alignItems: 'center', gap: theme.spacing.xs }}>
              <Text variant="title" style={{ textAlign: 'center' }}>
                {t.group.archivedEmpty}
              </Text>
              <Text variant="body" tone="muted" style={{ textAlign: 'center' }}>
                {t.group.archivedEmptyBody}
              </Text>
            </View>
          </View>
        ) : (
          <ListCard>
            {groups.map((group, index) => (
              <ListItem
                key={group.id}
                divider={index > 0}
                accessibilityLabel={groupLabel(
                  group,
                  membersByGroup.get(group.id) ?? [],
                  profile?.id,
                )}
                onPress={() => router.push(`/group/${group.id}`)}
                leading={
                  <GroupPhoto
                    photoPath={group.photo_path}
                    emoji={group.cover_emoji}
                    color={group.cover_color}
                    size={LIST_TILE}
                  />
                }
                title={groupLabel(group, membersByGroup.get(group.id) ?? [], profile?.id)}
                subtitle={
                  group.archived_at ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Ionicons
                        name="archive-outline"
                        size={iconSize.sm}
                        color={theme.color.textMuted}
                      />
                      <Text
                        variant="micro"
                        tone="muted"
                        numberOfLines={1}
                        style={{ flexShrink: 1 }}
                      >
                        {fill(t.group.archivedOn, {
                          date: new Intl.DateTimeFormat(locale, {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          }).format(new Date(group.archived_at)),
                        })}
                      </Text>
                    </View>
                  ) : undefined
                }
                trailing={
                  <ListPill
                    label={t.group.unarchive}
                    accessibilityLabel={t.group.unarchive}
                    onPress={() => unarchive(group.id)}
                  />
                }
              />
            ))}
          </ListCard>
        )}
      </ScrollView>
    </View>
  );
}
