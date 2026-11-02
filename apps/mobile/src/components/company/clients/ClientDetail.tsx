import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Linking, Pressable, ScrollView, TextInput, useWindowDimensions, View } from 'react-native';

import {
  clientInquiryStats,
  docNumberLabel,
  inquiryAmount,
  inquiryLabel,
  inquiryStatus,
  sortInquiries,
  type MirrorWorkTask,
} from '@waves/core';
import { Button, Row, Screen, Text, useTheme } from '@waves/ui';

import { useMoney } from '@/components/company/dashboard/parts';
import { useDoneFollowUp } from '@/components/company/clients/FollowUps';
import {
  AssigneeSheet,
  InquirySheet,
  InquiryStatusPill,
  InquiryTile,
} from '@/components/company/clients/InquiryParts';
import { StageChip, useWhen } from '@/components/company/clients/parts';
import { OverflowMenu, type OverflowMenuItem } from '@/components/OverflowMenu';
import { PersonAvatar } from '@/components/PersonAvatar';
import {
  ListRow,
  ScenicBody,
  ScenicHeader,
  SectionHeader,
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
import { displayName } from '@/data/types';
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
  const { t, locale } = useStrings();
  const s = t.companyClients;
  const clearance = useBottomClearance();
  const { width } = useWindowDimensions();
  const { confirm, choose } = useDialog();
  const view = useCompanyClients(groupId);
  const entries = useCompanyEntries(groupId);
  const suspended = useCompanySuspended(groupId);
  const money = useClientMoney(groupId);
  const fmt = useMoney(view.currency);
  const allTasks = useWorkTasks(groupId);
  const followUps = useFollowUps(groupId);
  const when = useWhen();
  const setClient = useSetClient(groupId);
  const removeClient = useRemoveClient(groupId);
  const addNote = useAddClientNote(groupId);
  const addFollowUp = useAddFollowUp(groupId);
  const done = useDoneFollowUp(groupId);
  const [tab, setTab] = useState<Tab>('activity');
  const [menu, setMenu] = useState(false);
  const [note, setNote] = useState('');
  const [newInquiry, setNewInquiry] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const client = view.clients.find((c) => c.id === clientId);
  const today = todayIso();
  const edit = view.canManage && !suspended;
  const canWrite = view.canAdd && !suspended;
  const docs = money.docs.filter((d) => d.clientId === clientId);
  const bills = docs.filter((d) => d.docType === 'bill');
  const openBills = bills.filter((d) => d.paidMinor < d.totalMinor);
  const next: MirrorWorkTask | undefined = followUps.byClient(clientId)[0];
  const docsAllowed = entries.isAdmin && !suspended;
  const inquiries = sortInquiries(view.inquiries.filter((i) => i.clientId === clientId));
  const stats = clientInquiryStats(inquiries, docs);
  const assignees = view.owners.filter((m) => view.assigneeIds(clientId).includes(m.id));
  const shortDay = (day: string) =>
    new Date(`${day}T12:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'short' });

  const move = (stage: 'inquiry' | 'lost', lostReason: string | null = null) =>
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

  const round = {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: theme.scheme === 'dark' ? 'rgba(20,20,34,0.82)' : '#FFFFFF',
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
  const stat = (
    icon: keyof typeof Ionicons.glyphMap,
    color: string,
    label: string,
    value: string,
    first = false,
  ) => (
    <View
      key={label}
      style={{
        flex: 1,
        alignItems: 'center',
        gap: 2,
        borderStartWidth: first ? 0 : 1,
        borderStartColor: theme.color.border,
      }}
    >
      <Ionicons name={icon} size={24} color={color} />
      <Text variant="caption" tone="muted" numberOfLines={1}>
        {label}
      </Text>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        style={{ fontSize: 22, lineHeight: 28, fontWeight: '800', color }}
      >
        {value}
      </Text>
    </View>
  );
  const identity = client ? (
    <View style={{ width: width - 2 * theme.spacing.lg, gap: theme.spacing.md }}>
      <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
        <View
          style={{
            width: 64,
            height: 64,
            borderRadius: 18,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.color.brandSoft,
          }}
        >
          <Ionicons name="storefront-outline" size={34} color={theme.color.brand} />
        </View>
        <View style={{ flex: 1 }}>
          <Text
            accessibilityRole="header"
            numberOfLines={1}
            style={{ fontSize: 26, lineHeight: 32, fontWeight: '800' }}
          >
            {client.name}
          </Text>
          {client.need ? (
            <Text tone="muted" numberOfLines={2}>
              {client.need}
            </Text>
          ) : null}
        </View>
      </Row>
      {assignees.length > 0 ? (
        <Pressable
          accessibilityRole={view.canManage && !suspended ? 'button' : 'text'}
          disabled={!(view.canManage && !suspended)}
          onPress={() => setAssigning(true)}
          style={{
            alignSelf: 'flex-start',
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.sm,
            paddingVertical: 4,
            paddingStart: 4,
            paddingEnd: theme.spacing.md,
            borderRadius: theme.radius.pill,
            backgroundColor: theme.scheme === 'dark' ? 'rgba(20,20,34,0.82)' : '#FFFFFF',
          }}
        >
          <Row>
            {assignees.slice(0, 3).map((m, i) => (
              <View
                key={m.id}
                style={{
                  marginStart: i ? -10 : 0,
                  borderRadius: 18,
                  borderWidth: 2,
                  borderColor: theme.color.surface,
                }}
              >
                <PersonAvatar name={displayName(m)} member={m} size={32} />
              </View>
            ))}
          </Row>
          <Text style={{ fontWeight: '700' }}>
            {fill(s.assignedN, { n: String(assignees.length) })}
          </Text>
          {view.canManage && !suspended ? (
            <Ionicons name="chevron-forward" size={16} color={theme.color.text} />
          ) : null}
        </Pressable>
      ) : null}
    </View>
  ) : null;
  return (
    <Screen edges={[]}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: clearance + theme.spacing.xl }}
      >
        <ScenicHeader
          title={client?.name ?? s.title}
          circleBack
          identity={<View />}
          action={
            client ? (
              <Row style={{ gap: theme.spacing.sm }}>
                {client.phone ? (
                  <>
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
                      style={[round, { backgroundColor: '#25D366' }]}
                    >
                      <Ionicons name="logo-whatsapp" size={22} color="#FFFFFF" />
                    </Pressable>
                  </>
                ) : null}
                {items.length ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={s.more}
                    onPress={() => setMenu(true)}
                    style={round}
                  >
                    <Ionicons name="ellipsis-vertical" size={20} color={theme.color.text} />
                  </Pressable>
                ) : null}
              </Row>
            ) : undefined
          }
        >
          {identity}
        </ScenicHeader>
        <ScenicBody>
          {client ? (
            <>
              <StandardCard style={{ flexDirection: 'row', paddingHorizontal: theme.spacing.sm }}>
                {stat(
                  'document-text-outline',
                  theme.color.brand,
                  s.statInquiries,
                  String(stats.total),
                  true,
                )}
                {stat('trophy-outline', theme.color.positive, s.statWon, String(stats.won))}
                {stat(
                  'close-circle-outline',
                  theme.color.negative,
                  s.statRejected,
                  String(stats.rejected),
                )}
                {docsAllowed
                  ? stat('wallet-outline', theme.color.brand, s.statPayments, fmt(stats.paidMinor))
                  : null}
              </StandardCard>
              {client.stage === 'lost' ? (
                <StandardCard style={{ gap: theme.spacing.sm }}>
                  <StageChip stage="lost" />
                  {client.lostReason ? (
                    <Text variant="caption" tone="muted">
                      {client.lostReason}
                    </Text>
                  ) : null}
                </StandardCard>
              ) : null}
              <View style={{ gap: theme.spacing.md }}>
                <SectionHeader
                  title={s.inqTitle}
                  trailing={
                    canWrite && client.stage !== 'lost' ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={s.inqNew}
                        onPress={() => setNewInquiry(true)}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 4,
                          height: 40,
                          paddingHorizontal: theme.spacing.lg,
                          borderRadius: theme.radius.pill,
                          backgroundColor: theme.color.brandSoft,
                        }}
                      >
                        <Ionicons name="add" size={20} color={theme.color.brand} />
                        <Text style={{ color: theme.color.brand, fontWeight: '700' }}>
                          {s.inqNew}
                        </Text>
                      </Pressable>
                    ) : undefined
                  }
                />
                {inquiries.length === 0 ? (
                  <StandardCard>
                    <Text tone="muted">{s.inqNone}</Text>
                  </StandardCard>
                ) : (
                  inquiries.map((i) => {
                    const status = inquiryStatus(i, docs);
                    const amount = inquiryAmount(i, docs);
                    return (
                      <Pressable
                        key={i.id}
                        accessibilityRole="button"
                        accessibilityLabel={`${i.title}, ${inquiryLabel(i.number)}`}
                        onPress={() =>
                          router.push(`/group/${groupId}/company-inquiry?inquiryId=${i.id}`)
                        }
                      >
                        <StandardCard
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: theme.spacing.md,
                            paddingVertical: theme.spacing.md,
                          }}
                        >
                          <InquiryTile inquiry={i} status={status} />
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text numberOfLines={1} style={{ fontSize: 17, fontWeight: '800' }}>
                              {i.title}
                            </Text>
                            <Text variant="caption" tone="muted">
                              {`${inquiryLabel(i.number)} · ${shortDay(i.inquiryDate)}`}
                            </Text>
                            {amount != null ? (
                              <Text tabular style={{ fontSize: 18, fontWeight: '800' }}>
                                {fmt(amount)}
                              </Text>
                            ) : null}
                          </View>
                          <InquiryStatusPill status={status} />
                          <Ionicons
                            name="chevron-forward"
                            size={18}
                            color={theme.color.textMuted}
                          />
                        </StandardCard>
                      </Pressable>
                    );
                  })
                )}
              </View>
              <StandardCard style={{ gap: theme.spacing.md }}>
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
                {(canWrite && assignee) || docsAllowed ? (
                  <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
                    {canWrite && assignee
                      ? action('time-outline', s.btnFollowUp, () => void addFollow())
                      : null}
                    {docsAllowed ? action('cash-outline', s.btnMoney, receive) : null}
                  </View>
                ) : null}
              </StandardCard>
              <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
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
              </View>
              {tab === 'activity' ? (
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
              {canWrite ? (
                <StandardCard
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.spacing.sm,
                    paddingVertical: theme.spacing.sm,
                  }}
                >
                  <View
                    style={{
                      flex: 1,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: theme.spacing.md,
                      minHeight: 48,
                      paddingHorizontal: theme.spacing.md,
                      borderRadius: theme.radius.lg,
                      backgroundColor: theme.color.brandSoft,
                    }}
                  >
                    <Ionicons name="create-outline" size={22} color={theme.color.textMuted} />
                    <TextInput
                      accessibilityLabel={s.notePh}
                      value={note}
                      onChangeText={setNote}
                      placeholder={s.notePh}
                      placeholderTextColor={theme.color.textMuted}
                      maxLength={1000}
                      style={{ flex: 1, color: theme.color.text, fontSize: 16, minHeight: 44 }}
                    />
                  </View>
                  {note.trim() ? (
                    <Button
                      label={s.noteSave}
                      variant="brand"
                      disabled={addNote.isPending}
                      onPress={() =>
                        addNote.mutate({ clientId, body: note }, { onSuccess: () => setNote('') })
                      }
                    />
                  ) : null}
                </StandardCard>
              ) : null}
            </>
          ) : (
            <StandardCard>
              <Text tone="muted">{s.emptyFilter}</Text>
            </StandardCard>
          )}
        </ScenicBody>
      </ScrollView>
      <OverflowMenu visible={menu} onClose={() => setMenu(false)} items={items} />
      {client && canWrite ? (
        <InquirySheet
          key={`new-${inquiries.length}`}
          visible={newInquiry}
          onClose={() => setNewInquiry(false)}
          groupId={groupId}
          clientId={clientId}
          currency={view.currency}
        />
      ) : null}
      {client && view.canManage && !suspended ? (
        <AssigneeSheet
          key={view.assigneeIds(clientId).join(',')}
          visible={assigning}
          onClose={() => setAssigning(false)}
          groupId={groupId}
          clientId={clientId}
          members={view.owners}
          current={view.assigneeIds(clientId)}
        />
      ) : null}
    </Screen>
  );
}
