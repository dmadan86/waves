import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Linking, Pressable, ScrollView, View } from 'react-native';

import type { MirrorWorkTask, NextFollowUp } from '@waves/core';
import { Screen, Text, useTheme } from '@waves/ui';

import { useWhen } from '@/components/company/clients/parts';
import {
  ScenicBody,
  ScenicHeader,
  PillButton,
  SectionHeader,
  StandardCard,
} from '@/components/standard';
import {
  useCompanyClients,
  useCompleteFollowUp,
  useFollowUps,
  type FollowUpScope,
} from '@/data/companyClients';
import { useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';
import { useDialog } from '@/lib/dialog';
import { router } from '@/lib/navigation';

/** Ask "When next?" and finish the follow-up; resolves false when the person backs out. */
export function useDoneFollowUp(groupId: string) {
  const { t } = useStrings();
  const { choose } = useDialog();
  const complete = useCompleteFollowUp(groupId);
  return async (task: MirrorWorkTask): Promise<void> => {
    const s = t.companyClients;
    const next = (await choose({
      title: s.whenNext,
      options: [
        { id: 'tomorrow', label: s.nextTomorrow },
        { id: 'next_week', label: s.nextWeek },
        { id: 'none', label: s.nextNone },
      ],
    })) as NextFollowUp | null;
    if (next) await complete.mutateAsync({ task, next });
  };
}

/** Open follow-ups (tasks linked to a client) grouped Overdue / Today / This week / Later. */
export function FollowUps({ groupId }: { groupId: string }) {
  const theme = useTheme();
  const { t } = useStrings();
  const s = t.companyClients;
  const clearance = useBottomClearance();
  const clients = useCompanyClients(groupId);
  const [scope, setScope] = useState<FollowUpScope>('all');
  const { groups, today } = useFollowUps(groupId, scope);
  const when = useWhen();
  const done = useDoneFollowUp(groupId);
  const byId = new Map(clients.clients.map((c) => [c.id, c]));
  const sections = [
    { key: 'overdue', label: s.gOverdue, rows: groups.overdue },
    { key: 'today', label: s.gToday, rows: groups.today },
    { key: 'week', label: s.gWeek, rows: groups.week },
    { key: 'later', label: s.gLater, rows: groups.later },
  ].map((g) => ({ ...g, rows: g.rows.filter((r) => byId.has(r.clientId ?? '')) }));
  const empty = sections.every((g) => g.rows.length === 0);
  return (
    <Screen edges={[]}>
      <ScrollView contentContainerStyle={{ paddingBottom: clearance + theme.spacing.xl }}>
        <ScenicHeader
          title={s.fuTitle}
          trailing={
            clients.canManage ? (
              <PillButton
                label={scope === 'mine' ? s.mine : s.everyone}
                chevron={false}
                onPress={() => setScope(scope === 'mine' ? 'all' : 'mine')}
              />
            ) : undefined
          }
        />
        <ScenicBody>
          {empty ? (
            <StandardCard>
              <Text tone="muted">{s.fuEmpty}</Text>
            </StandardCard>
          ) : (
            sections.map((g) =>
              g.rows.length ? (
                <View key={g.key} style={{ gap: theme.spacing.sm }}>
                  <SectionHeader title={`${g.label} · ${g.rows.length}`} />
                  <StandardCard style={{ paddingVertical: theme.spacing.xs }}>
                    {g.rows.map((task, index) => {
                      const client = byId.get(task.clientId ?? '')!;
                      return (
                        <View
                          key={task.id}
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: theme.spacing.sm,
                            paddingVertical: theme.spacing.sm,
                            borderTopWidth: index ? 1 : 0,
                            borderTopColor: theme.color.border,
                          }}
                        >
                          <Pressable
                            accessibilityRole="button"
                            style={{ flex: 1, minWidth: 0 }}
                            onPress={() =>
                              router.push(`/group/${groupId}/company-client?clientId=${client.id}`)
                            }
                          >
                            <Text numberOfLines={1} style={{ fontWeight: '700' }}>
                              {client.name}
                            </Text>
                            <Text variant="caption" tone="muted" numberOfLines={1}>
                              {task.title}
                            </Text>
                          </Pressable>
                          <Text
                            variant="caption"
                            style={{
                              fontWeight: '700',
                              color: g.key === 'overdue' ? theme.color.negative : theme.color.text,
                            }}
                          >
                            {when(task.day, today, task.dueTime)}
                          </Text>
                          {client.phone ? (
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={s.call}
                              hitSlop={8}
                              onPress={() => void Linking.openURL(`tel:${client.phone}`)}
                            >
                              <Ionicons name="call-outline" size={22} color={theme.color.brand} />
                            </Pressable>
                          ) : null}
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={s.done}
                            hitSlop={8}
                            onPress={() => void done(task)}
                          >
                            <Ionicons
                              name="checkmark-circle-outline"
                              size={26}
                              color={theme.color.positive}
                            />
                          </Pressable>
                        </View>
                      );
                    })}
                  </StandardCard>
                </View>
              ) : null,
            )
          )}
        </ScenicBody>
      </ScrollView>
    </Screen>
  );
}
