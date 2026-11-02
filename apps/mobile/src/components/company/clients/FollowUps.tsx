import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Linking, Pressable, ScrollView, View } from 'react-native';

import { nextFollowUpDay, type MirrorWorkTask, type NextFollowUp } from '@waves/core';
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
  stageChange,
  useAddClientNote,
  useCompanyClients,
  useCompleteFollowUp,
  useFollowUps,
  useSetClient,
  type FollowUpScope,
} from '@/data/companyClients';
import { fill, useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';
import { todayIso } from '@/data/personal';
import { useDialog } from '@/lib/dialog';
import { daysAgo } from '@/lib/clientRows';
import { showDate } from '@/lib/expenseDay';
import { whatsappUrl } from '@/lib/companyClients';
import { router } from '@/lib/navigation';

/** Done flow: "How did it go?" (saved as a client note; Not interested moves the client to Lost), then "When next?". */
export function useDoneFollowUp(groupId: string) {
  const { t, locale } = useStrings();
  const { choose } = useDialog();
  const complete = useCompleteFollowUp(groupId);
  const addNote = useAddClientNote(groupId);
  const setClient = useSetClient(groupId);
  const view = useCompanyClients(groupId);
  return async (task: MirrorWorkTask): Promise<void> => {
    const s = t.companyClients;
    const outcome = await choose({
      title: s.howWent,
      options: [
        { id: 'spoke', label: s.outSpoke },
        { id: 'no_answer', label: s.outNoAnswer },
        { id: 'not_interested', label: s.outNotInterested },
      ],
    });
    if (!outcome) return;
    const client = view.clients.find((c) => c.id === task.clientId);
    let next: NextFollowUp = 'none';
    if (outcome !== 'not_interested') {
      const today = todayIso();
      const opt = (id: NextFollowUp, label: string) => {
        const day = nextFollowUpDay(id, today);
        return { id, label: day ? `${label} · ${showDate(day, locale)}` : label };
      };
      const pick = (await choose({
        title: s.whenNext,
        options: [
          opt('tomorrow', s.nextTomorrow),
          opt('three_days', s.fuThreeDays),
          opt('next_week', s.nextWeek),
          opt('none', s.nextNone),
        ],
      })) as NextFollowUp | null;
      if (!pick) return;
      next = pick;
    }
    await complete.mutateAsync({ task, next });
    if (!task.clientId) return;
    const body =
      outcome === 'spoke'
        ? s.noteSpoke
        : outcome === 'no_answer'
          ? s.noteNoAnswer
          : s.noteNotInterested;
    await addNote.mutateAsync({ clientId: task.clientId, body });
    if (outcome === 'not_interested' && client)
      await setClient.mutateAsync(stageChange(client, 'lost', s.outNotInterested));
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
                          {g.key === 'overdue' ? (
                            <View
                              style={{
                                backgroundColor: theme.color.negativeSoft,
                                borderRadius: theme.radius.lg,
                                paddingHorizontal: theme.spacing.sm,
                                paddingVertical: 2,
                              }}
                            >
                              <Text
                                variant="micro"
                                style={{ fontWeight: '700', color: theme.color.negative }}
                              >
                                {fill(s.fuOverdueDays, { n: daysAgo(task.day, today) })}
                              </Text>
                            </View>
                          ) : (
                            <Text variant="caption" style={{ fontWeight: '700' }}>
                              {when(task.day, today, task.dueTime)}
                            </Text>
                          )}
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
                          {client.phone ? (
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={s.whatsapp}
                              hitSlop={8}
                              onPress={() => void Linking.openURL(whatsappUrl(client.phone!))}
                            >
                              <Ionicons
                                name="logo-whatsapp"
                                size={22}
                                color={theme.color.positive}
                              />
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
