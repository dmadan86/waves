import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Linking, Pressable, ScrollView, TextInput, View } from 'react-native';

import { docNumberLabel, type ClientStage, type MirrorWorkTask } from '@waves/core';
import { Button, Screen, Text, useTheme } from '@waves/ui';

import { useMoney } from '@/components/company/dashboard/parts';
import { useDoneFollowUp } from '@/components/company/clients/FollowUps';
import { StageChip, useSourceLabel, useWhen } from '@/components/company/clients/parts';
import { OverflowMenu, type OverflowMenuItem } from '@/components/OverflowMenu';
import {
  ListRow,
  ScenicBody,
  ScenicHeader,
  SegmentedPills,
  StandardCard,
} from '@/components/standard';
import {
  stageChange,
  useAddClientNote,
  useAddFollowUp,
  useClientMoney,
  useCompanyClients,
  useFollowUps,
  useRemoveClient,
  useSetClient,
} from '@/data/companyClients';
import { useCompanyEntries, useCompanySuspended } from '@/data/companyEntries';
import { useWorkTasks } from '@/data/companyWorkday';
import { todayIso } from '@/data/personal';
import { fill, useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';
import { shiftDay, whatsappUrl } from '@/lib/companyClients';
import { useDialog } from '@/lib/dialog';
import { router } from '@/lib/navigation';

type Tab = 'activity' | 'bills' | 'docs';
interface Event {
  readonly key: string;
  readonly at: string;
  readonly title: string;
  readonly sub?: string;
  readonly icon: keyof typeof Ionicons.glyphMap;
}

export function ClientDetail({ groupId, clientId }: { groupId: string; clientId: string }) {
  const theme = useTheme();
  const { t } = useStrings();
  const s = t.companyClients;
  const clearance = useBottomClearance();
  const { confirm, choose } = useDialog();
  const view = useCompanyClients(groupId);
  const entries = useCompanyEntries(groupId);
  const suspended = useCompanySuspended(groupId);
  const money = useClientMoney(groupId);
  const fmt = useMoney(view.currency);
  const allTasks = useWorkTasks(groupId);
  const followUps = useFollowUps(groupId);
  const when = useWhen();
  const sourceLabel = useSourceLabel();
  const setClient = useSetClient(groupId);
  const removeClient = useRemoveClient(groupId);
  const addNote = useAddClientNote(groupId);
  const addFollowUp = useAddFollowUp(groupId);
  const done = useDoneFollowUp(groupId);
  const [tab, setTab] = useState<Tab>('activity');
  const [menu, setMenu] = useState(false);
  const [note, setNote] = useState('');
  const client = view.clients.find((c) => c.id === clientId);
  const today = todayIso();
  const edit = view.canManage && !suspended;
  const canWrite = view.canAdd && !suspended;
  const docs = money.docs.filter((d) => d.clientId === clientId);
  const bills = docs.filter((d) => d.docType === 'bill');
  const openBills = bills.filter((d) => d.paidMinor < d.totalMinor);
  const due = money.byClient.get(clientId) ?? 0n;
  const next: MirrorWorkTask | undefined = followUps.byClient(clientId)[0];
  const docsAllowed = entries.isAdmin && !suspended;

  const move = (stage: ClientStage, lostReason: string | null = null) =>
    client && setClient.mutate(stageChange(client, stage, lostReason));
  const markLost = async () => {
    const reason = await choose({
      title: s.lostWhy,
      options: [
        { id: s.lostPrice, label: s.lostPrice },
        { id: s.lostOther, label: s.lostOther },
        { id: s.lostSilent, label: s.lostSilent },
        { id: '', label: s.lostSkip },
      ],
    });
    if (reason !== null) move('lost', reason || null);
  };
  // Whoever follows up: the client's owner when this viewer can hand work to them, else the viewer.
  const assignee =
    client?.ownerMemberId &&
    (entries.isOwner ||
      entries.manageableIds.has(client.ownerMemberId) ||
      client.ownerMemberId === view.myMemberId)
      ? client.ownerMemberId
      : view.myMemberId;
  const addFollow = async () => {
    if (!client || !assignee) return;
    const pick = await choose({
      title: s.followUp,
      options: [
        { id: '0', label: s.fuToday },
        { id: '1', label: s.fuTomorrow },
        { id: '3', label: s.fuThreeDays },
        { id: '7', label: s.nextWeek },
      ],
    });
    if (pick !== null)
      addFollowUp.mutate({
        clientId: client.id,
        clientName: client.name,
        memberId: assignee,
        day: shiftDay(today, Number(pick)),
      });
  };
  const receive = () => {
    if (openBills.length === 1)
      router.push(`/group/${groupId}/company-bill?docId=${openBills[0]!.id}`);
    else if (openBills.length > 1) setTab('bills');
    else router.push(`/group/${groupId}/company-bills`);
  };

  const items: OverflowMenuItem[] = client
    ? [
        ...(edit || (canWrite && client.stage === 'inquiry')
          ? [
              {
                icon: 'pencil-outline' as const,
                label: s.editClient,
                route: `/group/${groupId}/company-client-add?clientId=${client.id}` as const,
              },
            ]
          : []),
        ...(edit && client.stage !== 'lost'
          ? [
              {
                icon: 'close-circle-outline' as const,
                label: s.markLost,
                onPress: () => void markLost(),
              },
            ]
          : []),
        ...(edit && client.stage === 'lost'
          ? [{ icon: 'refresh-outline' as const, label: s.reopen, onPress: () => move('inquiry') }]
          : []),
        ...(edit
          ? [
              {
                icon: 'trash-outline' as const,
                label: s.remove,
                tone: 'danger' as const,
                onPress: () => {
                  void confirm({
                    title: s.removeConfirm,
                    confirmLabel: s.remove,
                    tone: 'danger',
                  }).then((yes) => {
                    if (yes) removeClient.mutate(client.id, { onSuccess: () => router.back() });
                  });
                },
              },
            ]
          : []),
      ]
    : [];

  const events: Event[] = client
    ? [
        {
          key: 'created',
          at: client.createdAt.slice(0, 10),
          title: s.evCreated,
          icon: 'sparkles-outline' as const,
        },
        ...view.notes
          .filter((n) => n.clientId === clientId)
          .map((n) => ({
            key: n.id,
            at: n.createdAt.slice(0, 10),
            title: s.evNote,
            sub: n.body,
            icon: 'create-outline' as const,
          })),
        ...allTasks
          .filter((x) => x.clientId === clientId)
          .map((x) => ({
            key: x.id,
            at: x.day,
            title: x.status === 'done' ? s.evFollowUpDone : s.evFollowUp,
            sub: x.title,
            icon: (x.status === 'done'
              ? 'checkmark-circle-outline'
              : 'time-outline') as keyof typeof Ionicons.glyphMap,
          })),
        ...docs.map((d) => ({
          key: d.id,
          at: d.docDate,
          title: docNumberLabel(d.docType, d.number),
          sub: fmt(d.totalMinor),
          icon: 'document-text-outline' as const,
        })),
        ...docs.flatMap((d) =>
          d.payments.map((p) => ({
            key: p.id,
            at: p.paidOn,
            title: s.evReceipt,
            sub: fmt(p.amountMinor),
            icon: 'cash-outline' as const,
          })),
        ),
      ].sort((a, b) => b.at.localeCompare(a.at))
    : [];

  const stages: ClientStage[] = ['inquiry', 'quoted', 'client'];
  const stageName = {
    inquiry: s.stInquiry,
    quoted: s.stQuoted,
    client: s.stClient,
    lost: s.stLost,
  };
  const round = {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: theme.color.surface,
  };
  const action = (icon: keyof typeof Ionicons.glyphMap, label: string, onPress: () => void) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      onPress={onPress}
      style={{
        flex: 1,
        height: 52,
        borderRadius: theme.radius.lg,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        backgroundColor: theme.color.brandSoft,
      }}
    >
      <Ionicons name={icon} size={18} color={theme.color.brand} />
      <Text variant="micro" style={{ color: theme.color.brand, fontWeight: '700' }}>
        {label}
      </Text>
    </Pressable>
  );
  return (
    <Screen edges={[]}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: clearance + theme.spacing.xl }}
      >
        <ScenicHeader
          title={client?.name ?? s.title}
          subtitle={
            client
              ? [
                  client.need,
                  fill(s.viaSource, { source: sourceLabel(client.source) }),
                  client.ownerMemberId
                    ? fill(s.follows, { name: view.memberName(client.ownerMemberId) })
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')
              : undefined
          }
          action={
            items.length ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={s.more}
                onPress={() => setMenu(true)}
                style={round}
              >
                <Ionicons name="ellipsis-vertical" size={20} color={theme.color.text} />
              </Pressable>
            ) : undefined
          }
        />
        <ScenicBody>
          {client ? (
            <>
              <StandardCard style={{ gap: theme.spacing.md }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                  {client.stage === 'lost' ? (
                    <StageChip stage="lost" />
                  ) : (
                    stages.map((st, i) => (
                      <View
                        key={st}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: theme.spacing.sm,
                        }}
                      >
                        {i ? (
                          <Ionicons
                            name="chevron-forward"
                            size={12}
                            color={theme.color.textMuted}
                          />
                        ) : null}
                        {st === client.stage ? (
                          <StageChip stage={st} />
                        ) : (
                          <Text variant="caption" tone="muted">
                            {stageName[st]}
                          </Text>
                        )}
                      </View>
                    ))
                  )}
                  <View style={{ flex: 1 }} />
                  {edit && (client.stage === 'inquiry' || client.stage === 'quoted') ? (
                    <Button label={s.markWon} variant="brand" onPress={() => move('client')} />
                  ) : null}
                </View>
                {client.lostReason ? (
                  <Text variant="caption" tone="muted">
                    {client.lostReason}
                  </Text>
                ) : null}
                {due > 0n ? (
                  <Text style={{ fontWeight: '700' }}>{fill(s.owes, { amount: fmt(due) })}</Text>
                ) : null}
                {client.phone ? (
                  <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={s.call}
                      onPress={() => void Linking.openURL(`tel:${client.phone}`)}
                      style={round}
                    >
                      <Ionicons name="call-outline" size={20} color={theme.color.brand} />
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={s.whatsapp}
                      onPress={() => void Linking.openURL(whatsappUrl(client.phone!))}
                      style={round}
                    >
                      <Ionicons name="logo-whatsapp" size={20} color={theme.color.positive} />
                    </Pressable>
                  </View>
                ) : null}
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.spacing.sm,
                    backgroundColor: theme.color.warningSoft,
                    borderRadius: theme.radius.lg,
                    padding: theme.spacing.md,
                  }}
                >
                  <Ionicons name="time-outline" size={18} color={theme.color.warning} />
                  <View style={{ flex: 1 }}>
                    <Text variant="caption" style={{ fontWeight: '700' }}>
                      {next
                        ? fill(next.day < today ? s.overdueSince : s.dueAt, {
                            when: when(next.day, today, next.dueTime),
                          })
                        : s.noFollowUp}
                    </Text>
                    {next ? (
                      <Text variant="caption" tone="muted" numberOfLines={1}>
                        {next.title}
                      </Text>
                    ) : null}
                  </View>
                  {next &&
                  canWrite &&
                  (entries.isOwner ||
                    next.memberId === view.myMemberId ||
                    entries.manageableIds.has(next.memberId)) ? (
                    <Button label={s.done} variant="brand" onPress={() => void done(next)} />
                  ) : null}
                </View>
                <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
                  {canWrite && assignee
                    ? action('time-outline', s.btnFollowUp, () => void addFollow())
                    : null}
                  {docsAllowed
                    ? action('document-text-outline', s.btnEstimate, () =>
                        router.push(
                          `/group/${groupId}/company-bill-form?type=estimate&clientId=${clientId}`,
                        ),
                      )
                    : null}
                  {docsAllowed ? action('cash-outline', s.btnMoney, receive) : null}
                </View>
              </StandardCard>
              <SegmentedPills
                options={[
                  { value: 'activity' as Tab, label: s.tabActivity },
                  ...(docsAllowed
                    ? [
                        { value: 'bills' as Tab, label: s.tabBills },
                        { value: 'docs' as Tab, label: s.tabDocs },
                      ]
                    : []),
                ]}
                value={tab}
                onChange={setTab}
              />
              {tab === 'activity' ? (
                <>
                  {canWrite ? (
                    <StandardCard
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: theme.spacing.sm,
                        paddingVertical: theme.spacing.xs,
                      }}
                    >
                      <TextInput
                        accessibilityLabel={s.notePh}
                        value={note}
                        onChangeText={setNote}
                        placeholder={s.notePh}
                        placeholderTextColor={theme.color.textMuted}
                        maxLength={1000}
                        style={{ flex: 1, color: theme.color.text, fontSize: 15, minHeight: 44 }}
                      />
                      <Button
                        label={s.noteSave}
                        variant="brand"
                        disabled={!note.trim() || addNote.isPending}
                        onPress={() =>
                          addNote.mutate({ clientId, body: note }, { onSuccess: () => setNote('') })
                        }
                      />
                    </StandardCard>
                  ) : null}
                  <StandardCard style={{ paddingVertical: theme.spacing.xs }}>
                    {events.map((e, index) => (
                      <ListRow
                        key={e.key}
                        title={e.title}
                        subtitle={e.sub}
                        subtitleLines={3}
                        leading={<Ionicons name={e.icon} size={20} color={theme.color.textMuted} />}
                        amount={when(e.at, today)}
                        divider={index < events.length - 1}
                      />
                    ))}
                  </StandardCard>
                </>
              ) : (
                <StandardCard style={{ paddingVertical: theme.spacing.xs }}>
                  {(tab === 'bills' ? bills : docs).length === 0 ? (
                    <Text tone="muted" style={{ paddingVertical: theme.spacing.md }}>
                      {tab === 'bills' ? s.billsEmpty : s.docsEmpty}
                    </Text>
                  ) : (
                    (tab === 'bills' ? bills : docs).map((d, index, list) => (
                      <ListRow
                        key={d.id}
                        title={docNumberLabel(d.docType, d.number)}
                        subtitle={`${t.companyDocs[d.status]} · ${when(d.docDate, today)}`}
                        amount={fmt(d.totalMinor)}
                        leading={
                          <Ionicons
                            name="document-text-outline"
                            size={20}
                            color={theme.color.textMuted}
                          />
                        }
                        onPress={() => router.push(`/group/${groupId}/company-bill?docId=${d.id}`)}
                        divider={index < list.length - 1}
                      />
                    ))
                  )}
                </StandardCard>
              )}
            </>
          ) : (
            <StandardCard>
              <Text tone="muted">{s.emptyFilter}</Text>
            </StandardCard>
          )}
        </ScenicBody>
      </ScrollView>
      <OverflowMenu visible={menu} onClose={() => setMenu(false)} items={items} />
    </Screen>
  );
}
