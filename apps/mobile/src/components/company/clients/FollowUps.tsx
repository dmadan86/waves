import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Linking, Pressable, ScrollView, TextInput, View } from 'react-native';

import { nextFollowUpDay, type MirrorWorkTask, type NextFollowUp } from '@waves/core';
import { Button, directionalIcon, Screen, Sheet, Text, useTheme } from '@waves/ui';

import { useWhen } from '@/components/company/clients/parts';
import { ScenicBody, ScenicHeader, SectionHeader, StandardCard } from '@/components/standard';
import { useCompanyEntries } from '@/data/companyEntries';
import {
  stageChange,
  useAddClientNote,
  useAddFollowUp,
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
import { shiftDay, whatsappUrl } from '@/lib/companyClients';
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

type Filter = 'all' | 'today' | 'upcoming' | 'overdue';
type Pick = 'client' | 'inquiry' | null;

/** Open follow-ups (tasks linked to a client) as cards, filtered All / Today / Upcoming / Overdue. */
export function FollowUps({ groupId }: { groupId: string }) {
  const theme = useTheme();
  const { t } = useStrings();
  const s = t.companyClients;
  const clearance = useBottomClearance();
  const clients = useCompanyClients(groupId);
  const entries = useCompanyEntries(groupId);
  const [scope, setScope] = useState<FollowUpScope>('all');
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [pick, setPick] = useState<Pick>(null);
  const { groups, today } = useFollowUps(groupId, scope);
  const when = useWhen();
  const done = useDoneFollowUp(groupId);
  const addFollowUp = useAddFollowUp(groupId);
  const { choose } = useDialog();
  const byId = new Map(clients.clients.map((c) => [c.id, c]));
  const q = query.trim().toLowerCase();
  const visible = (rows: readonly MirrorWorkTask[]) =>
    rows.filter((r) =>
      byId
        .get(r.clientId ?? '')
        ?.name.toLowerCase()
        .includes(q),
    );
  const sections = [
    { key: 'overdue', label: s.gOverdue, rows: visible(groups.overdue) },
    { key: 'today', label: s.gToday, rows: visible(groups.today) },
    { key: 'week', label: s.gWeek, rows: visible(groups.week) },
    { key: 'later', label: s.gLater, rows: visible(groups.later) },
  ].filter(
    (g) =>
      filter === 'all' ||
      g.key === filter ||
      (filter === 'upcoming' && (g.key === 'week' || g.key === 'later')),
  );
  const empty = sections.every((g) => g.rows.length === 0);
  const canAdd = clients.canAdd && !!clients.myMemberId;
  // The client page's own flow: when, then a task for the client's owner (managers) or the viewer.
  const schedule = async (clientId: string) => {
    const client = byId.get(clientId);
    const owner = client?.ownerMemberId;
    const assignee =
      owner && (entries.isOwner || entries.manageableIds.has(owner) || owner === clients.myMemberId)
        ? owner
        : clients.myMemberId;
    if (!client || !assignee) return;
    const days = await choose({
      title: s.followUp,
      options: [
        { id: '0', label: s.fuToday },
        { id: '1', label: s.fuTomorrow },
        { id: '3', label: s.fuThreeDays },
        { id: '7', label: s.nextWeek },
      ],
    });
    if (days !== null)
      addFollowUp.mutate({
        clientId: client.id,
        clientName: client.name,
        memberId: assignee,
        day: shiftDay(today, Number(days)),
      });
  };
  const roundBtn = (
    icon: 'search-outline' | 'filter-outline',
    label: string,
    onPress: () => void,
    on: boolean,
  ) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={{
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: on ? theme.color.brandSoft : undefined,
      }}
    >
      <Ionicons name={icon} size={24} color={on ? theme.color.brand : theme.color.text} />
    </Pressable>
  );
  const pickRows =
    pick === 'inquiry'
      ? clients.inquiries
          .filter((i) => !i.rejectedAt && byId.has(i.clientId))
          .map((i) => ({
            id: i.clientId,
            key: i.id,
            label: `${i.title} · ${byId.get(i.clientId)!.name}`,
          }))
      : clients.clients.map((c) => ({ id: c.id, key: c.id, label: c.name }));
  const quick = [
    ['client', 'people-outline', s.fuFromClient, s.fuFromClientSub],
    ['inquiry', 'document-text-outline', s.fuFromInquiry, s.fuFromInquirySub],
  ] as const;
  return (
    <Screen edges={[]}>
      <ScrollView contentContainerStyle={{ paddingBottom: clearance + theme.spacing.xl }}>
        <ScenicHeader
          title={s.fuTitle}
          subtitle={s.fuSubtitle}
          action={
            <View style={{ flexDirection: 'row' }}>
              {roundBtn('search-outline', s.search, () => setSearching(!searching), searching)}
              {clients.canManage
                ? roundBtn(
                    'filter-outline',
                    scope === 'mine' ? s.mine : s.everyone,
                    () => setScope(scope === 'mine' ? 'all' : 'mine'),
                    scope === 'mine',
                  )
                : null}
            </View>
          }
        />
        <ScenicBody>
          {searching ? (
            <TextInput
              accessibilityLabel={s.search}
              autoFocus
              value={query}
              onChangeText={setQuery}
              placeholder={s.search}
              placeholderTextColor={theme.color.textMuted}
              style={{
                minHeight: 44,
                color: theme.color.text,
                fontSize: 16,
                paddingHorizontal: theme.spacing.md,
                borderRadius: theme.radius.md,
                backgroundColor: theme.color.surfaceMuted,
              }}
            />
          ) : null}
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View
              accessibilityRole="tablist"
              style={{ flexDirection: 'row', gap: theme.spacing.sm }}
            >
              {(
                [
                  ['all', s.everyone],
                  ['today', s.fuToday],
                  ['upcoming', s.fuUpcoming],
                  ['overdue', s.gOverdue],
                ] as const
              ).map(([value, label]) => {
                const on = filter === value;
                return (
                  <Pressable
                    key={value}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: on }}
                    onPress={() => setFilter(value)}
                    style={{
                      justifyContent: 'center',
                      height: 40,
                      paddingHorizontal: 16,
                      borderRadius: 20,
                      borderWidth: 1,
                      borderColor: on ? theme.color.brand : theme.color.border,
                      backgroundColor: on ? theme.color.brand : theme.color.surface,
                    }}
                  >
                    <Text
                      style={{
                        fontWeight: '600',
                        color: on ? theme.color.onBrand : theme.color.text,
                      }}
                    >
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
          {empty ? (
            <StandardCard
              style={{
                alignItems: 'center',
                gap: theme.spacing.sm,
                paddingVertical: theme.spacing.xl,
              }}
            >
              <View
                accessible={false}
                style={{
                  width: 132,
                  height: 112,
                  borderRadius: 56,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: theme.color.brandSoft,
                  marginBottom: theme.spacing.sm,
                }}
              >
                <Ionicons name="calendar-outline" size={64} color={theme.color.brand} />
                <View style={{ position: 'absolute', bottom: 8, right: 18 }}>
                  <Ionicons name="notifications" size={34} color={theme.color.brand} />
                </View>
              </View>
              <Text variant="title" style={{ fontSize: 22 }}>
                {s.fuEmptyTitle}
              </Text>
              <Text tone="muted" style={{ textAlign: 'center' }}>
                {s.fuEmptyBody}
              </Text>
              {canAdd ? (
                <Button
                  label={s.fuAdd}
                  variant="brand"
                  icon={<Ionicons name="add" size={20} color={theme.color.onBrand} />}
                  onPress={() => setPick('client')}
                />
              ) : null}
            </StandardCard>
          ) : (
            sections.map((g) =>
              g.rows.length ? (
                <View key={g.key} style={{ gap: theme.spacing.sm }}>
                  <SectionHeader title={`${g.label} · ${g.rows.length}`} />
                  {g.rows.map((task) => {
                    const client = byId.get(task.clientId ?? '')!;
                    return (
                      <StandardCard
                        key={task.id}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: theme.spacing.sm,
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
                          {g.key === 'overdue' ? (
                            <Text
                              variant="caption"
                              style={{ fontWeight: '700', color: theme.color.negative }}
                            >
                              {fill(s.fuOverdueDays, { n: daysAgo(task.day, today) })}
                            </Text>
                          ) : (
                            <Text variant="caption" style={{ fontWeight: '700' }}>
                              {when(task.day, today, task.dueTime)}
                            </Text>
                          )}
                        </Pressable>
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
                            <Ionicons name="logo-whatsapp" size={22} color={theme.color.positive} />
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
                      </StandardCard>
                    );
                  })}
                </View>
              ) : null,
            )
          )}
          {canAdd ? (
            <View style={{ gap: theme.spacing.sm }}>
              <SectionHeader title={s.quickActions} />
              <StandardCard style={{ paddingVertical: 0 }}>
                {quick.map(([mode, icon, title, sub], i) => (
                  <Pressable
                    key={mode}
                    accessibilityRole="button"
                    accessibilityLabel={title}
                    onPress={() => setPick(mode)}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: theme.spacing.md,
                      minHeight: 64,
                      paddingVertical: theme.spacing.sm,
                      borderTopWidth: i ? 1 : 0,
                      borderTopColor: theme.color.border,
                    }}
                  >
                    <View
                      accessible={false}
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: theme.radius.md,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: theme.color.brandSoft,
                      }}
                    >
                      <Ionicons name={icon} size={22} color={theme.color.brand} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontWeight: '700' }}>{title}</Text>
                      <Text variant="caption" tone="muted">
                        {sub}
                      </Text>
                    </View>
                    <Ionicons
                      name={directionalIcon('chevron-forward')}
                      size={20}
                      color={theme.color.textMuted}
                    />
                  </Pressable>
                ))}
              </StandardCard>
            </View>
          ) : null}
        </ScenicBody>
      </ScrollView>
      <Sheet visible={pick !== null} onClose={() => setPick(null)} closeLabel={t.common.close}>
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="title">{pick === 'inquiry' ? s.fuFromInquiry : s.fuFromClient}</Text>
          {pickRows.length === 0 ? <Text tone="muted">{s.empty}</Text> : null}
          <ScrollView style={{ maxHeight: 360 }}>
            {pickRows.map((r) => (
              <Pressable
                key={r.key}
                accessibilityRole="button"
                accessibilityLabel={r.label}
                onPress={() => {
                  setPick(null);
                  void schedule(r.id);
                }}
                style={{ minHeight: 48, justifyContent: 'center' }}
              >
                <Text numberOfLines={1}>{r.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </Sheet>
    </Screen>
  );
}
