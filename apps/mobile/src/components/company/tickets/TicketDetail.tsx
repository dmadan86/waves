import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Linking, Pressable, ScrollView, TextInput, View } from 'react-native';

import {
  ACTION_TARGET,
  escalatedTo,
  escalationLevel,
  isTicketOpen,
  ticketActions,
  ticketNumber,
  TICKET_WINDOW_MS,
  type TicketAction,
  type TicketEvent,
} from '@waves/core';
import { Button, Screen, Text, useTheme } from '@waves/ui';

import { PriorityChip, StatusPill, useTicketText } from '@/components/company/tickets/parts';
import { OverflowMenu, type OverflowMenuItem } from '@/components/OverflowMenu';
import { PersonAvatar } from '@/components/PersonAvatar';
import { ListRow, ScenicBody, ScenicHeader, StandardCard } from '@/components/standard';
import { useCompanyClients } from '@/data/companyClients';
import { useCompanySuspended } from '@/data/companyEntries';
import {
  ticketInput,
  useAddTicketComment,
  useCompanyTickets,
  useNow,
  useRemoveTicket,
  useSetTicket,
  useTicketStatus,
} from '@/data/companyTickets';
import { displayName } from '@/data/types';
import { fill, useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';
import { whatsappUrl } from '@/lib/companyClients';
import { useDialog } from '@/lib/dialog';
import { router } from '@/lib/navigation';

interface Entry {
  readonly key: string;
  readonly at: string;
  readonly title: string;
  readonly sub?: string;
  readonly icon: keyof typeof Ionicons.glyphMap;
}

export function TicketDetail({ groupId, ticketId }: { groupId: string; ticketId: string }) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const s = t.companyTickets;
  const clearance = useBottomClearance();
  const { confirm, choose } = useDialog();
  const view = useCompanyTickets(groupId);
  const clients = useCompanyClients(groupId);
  const suspended = useCompanySuspended(groupId);
  const text = useTicketText();
  const now = useNow();
  const setTicket = useSetTicket(groupId);
  const setStatus = useTicketStatus(groupId);
  const addComment = useAddTicketComment(groupId);
  const removeTicket = useRemoveTicket(groupId);
  const [menu, setMenu] = useState(false);
  const [comment, setComment] = useState('');
  const [resolving, setResolving] = useState(false);
  const [note, setNote] = useState('');
  const tk = view.tickets.find((x) => x.id === ticketId);
  const canWrite = !!tk && view.canAdd && !suspended;
  const name = (id: string | null) => view.memberName(id) || s.someone;

  const reassign = async () => {
    if (!tk) return;
    const id = await choose({
      title: s.assignTo,
      options: view.people
        .filter((m) => m.id !== tk.assigneeMemberId)
        .map((m) => ({ id: m.id, label: m.id === view.myMemberId ? s.you : displayName(m) })),
    });
    if (id) setTicket.mutate({ ...ticketInput(tk), assigneeMemberId: id });
  };
  const act = (a: TicketAction) => {
    if (!tk) return;
    if (a === 'resolve') setResolving(true);
    else setStatus.mutate({ ticketId: tk.id, status: ACTION_TARGET[a] });
  };
  const resolve = () => {
    if (!tk || !note.trim()) return;
    setStatus.mutate({ ticketId: tk.id, status: 'resolved', note });
    setResolving(false);
    setNote('');
  };

  const items: OverflowMenuItem[] = tk
    ? [
        ...(canWrite
          ? [
              {
                icon: 'pencil-outline' as const,
                label: s.edit,
                route: `/group/${groupId}/company-ticket-add?ticketId=${tk.id}` as const,
              },
            ]
          : []),
        ...(canWrite && view.canRemove
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
                    if (yes) removeTicket.mutate(tk.id, { onSuccess: () => router.back() });
                  });
                },
              },
            ]
          : []),
      ]
    : [];

  const stamp = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? ''
      : `${d.toLocaleDateString(locale, { day: 'numeric', month: 'short' })} ${d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}`;
  };
  const describe = (e: TicketEvent): Entry => {
    const base = { key: e.id, at: e.createdAt };
    if (e.kind === 'comment')
      return { ...base, title: name(e.createdBy), sub: e.body ?? '', icon: 'chatbubble-outline' };
    const by = fill(s.evBy, { name: name(e.createdBy) });
    if (e.kind === 'created')
      return {
        ...base,
        title: fill(s.evCreated, { name: name(e.memberId) }),
        sub: by,
        icon: 'sparkles-outline',
      };
    if (e.kind === 'assigned')
      return {
        ...base,
        title: fill(s.evAssigned, { name: name(e.memberId) }),
        sub: by,
        icon: 'swap-horizontal-outline',
      };
    const st = e.toStatus;
    return {
      ...base,
      title:
        st === 'in_progress'
          ? s.evStarted
          : st === 'resolved'
            ? s.stResolved
            : st === 'closed'
              ? s.stClosed
              : s.evReopened,
      sub: [e.body ? fill(s.solved, { note: e.body }) : null, by].filter(Boolean).join('\n'),
      icon: st === 'resolved' || st === 'closed' ? 'checkmark-circle-outline' : 'play-outline',
    };
  };
  // Escalations are not stored: they follow from the due time, so they are worked out here.
  const escalations: Entry[] = [];
  if (tk && isTicketOpen(tk)) {
    const level = escalationLevel(tk, now);
    const due = new Date(tk.dueAt).getTime();
    for (const l of [1, 2] as const)
      if (level >= l)
        escalations.push({
          key: `esc${l}`,
          at: new Date(due + (l - 1) * TICKET_WINDOW_MS[tk.priority]).toISOString(),
          title: fill(s.evEscalated, {
            name: name(escalatedTo(l, tk.assigneeMemberId, view.hierarchy)) || s.owner,
          }),
          icon: 'trending-up-outline',
        });
  }
  const timeline: Entry[] = tk
    ? [...view.events.filter((e) => e.ticketId === tk.id).map(describe), ...escalations].sort(
        (a, b) => b.at.localeCompare(a.at),
      )
    : [];
  const due = tk ? text.due(tk, now, view) : null;
  const round = {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: theme.color.surface,
  };
  const client = tk?.clientId ? clients.clients.find((c) => c.id === tk.clientId) : undefined;
  return (
    <Screen edges={[]}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: clearance + theme.spacing.xl }}
      >
        <ScenicHeader
          title={tk ? (tk.number > 0 ? ticketNumber(tk.number) : s.title) : s.title}
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
        >
          {tk ? (
            <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
              <StatusPill status={tk.status} />
              <PriorityChip priority={tk.priority} />
            </View>
          ) : null}
        </ScenicHeader>
        <ScenicBody>
          {tk ? (
            <>
              <StandardCard style={{ gap: theme.spacing.sm }}>
                {tk.clientName ? (
                  <View
                    style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}
                  >
                    <PersonAvatar name={tk.clientName} size={40} />
                    <Pressable
                      accessibilityRole={client ? 'button' : 'text'}
                      disabled={!client}
                      onPress={() =>
                        router.push(`/group/${groupId}/company-client?clientId=${tk.clientId}`)
                      }
                      style={{ flex: 1, minWidth: 0 }}
                    >
                      <Text numberOfLines={1} style={{ fontWeight: '700' }}>
                        {tk.clientName}
                      </Text>
                      {tk.clientPhone ? (
                        <Text variant="caption" tone="muted">
                          {tk.clientPhone}
                        </Text>
                      ) : null}
                    </Pressable>
                    {tk.clientPhone ? (
                      <>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={s.call}
                          onPress={() => void Linking.openURL(`tel:${tk.clientPhone}`)}
                          style={round}
                        >
                          <Ionicons name="call-outline" size={20} color={theme.color.brand} />
                        </Pressable>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={s.whatsapp}
                          onPress={() => void Linking.openURL(whatsappUrl(tk.clientPhone!))}
                          style={round}
                        >
                          <Ionicons name="logo-whatsapp" size={20} color={theme.color.positive} />
                        </Pressable>
                      </>
                    ) : null}
                  </View>
                ) : null}
                <Text style={{ fontWeight: '700', fontSize: 17 }}>{tk.title}</Text>
                {tk.details ? <Text tone="muted">{tk.details}</Text> : null}
                {tk.resolution ? (
                  <Text style={{ color: theme.color.positive, fontWeight: '600' }}>
                    {fill(s.solved, { note: tk.resolution })}
                  </Text>
                ) : null}
                {due ? (
                  <Text
                    variant="caption"
                    style={{
                      fontWeight: '700',
                      color: due.late ? theme.color.negative : theme.color.textMuted,
                    }}
                  >
                    {due.text}
                  </Text>
                ) : null}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                  <PersonAvatar name={name(tk.assigneeMemberId)} size={28} />
                  <Text style={{ flex: 1 }} numberOfLines={1}>
                    {`${s.assignedTo} · ${tk.assigneeMemberId === view.myMemberId ? s.you : name(tk.assigneeMemberId)}`}
                  </Text>
                  {canWrite && isTicketOpen(tk) && view.people.length > 1 ? (
                    <Button
                      label={s.reassign}
                      variant="secondary"
                      onPress={() => void reassign()}
                    />
                  ) : null}
                </View>
                {canWrite ? (
                  resolving ? (
                    <View style={{ gap: theme.spacing.sm }}>
                      <Text variant="caption" style={{ fontWeight: '700' }}>
                        {s.resolveTitle}
                      </Text>
                      <TextInput
                        autoFocus
                        accessibilityLabel={s.resolvePh}
                        value={note}
                        onChangeText={setNote}
                        placeholder={s.resolvePh}
                        placeholderTextColor={theme.color.textMuted}
                        maxLength={500}
                        multiline
                        style={{
                          minHeight: 44,
                          color: theme.color.text,
                          fontSize: 15,
                          borderRadius: theme.radius.lg,
                          padding: theme.spacing.md,
                          backgroundColor: theme.color.surfaceMuted,
                        }}
                      />
                      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
                        <Button
                          label={t.common.cancel}
                          variant="secondary"
                          onPress={() => {
                            setResolving(false);
                            setNote('');
                          }}
                        />
                        <Button
                          label={s.actResolve}
                          variant="brand"
                          disabled={!note.trim()}
                          onPress={resolve}
                        />
                      </View>
                    </View>
                  ) : (
                    <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
                      {ticketActions(tk.status).map((a, i) => (
                        <Button
                          key={a}
                          label={
                            {
                              start: s.actStart,
                              resolve: s.actResolve,
                              reopen: s.actReopen,
                              close: s.actClose,
                            }[a]
                          }
                          variant={i === 0 ? 'brand' : 'secondary'}
                          onPress={() => act(a)}
                        />
                      ))}
                    </View>
                  )
                ) : null}
              </StandardCard>
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
                    accessibilityLabel={s.commentPh}
                    value={comment}
                    onChangeText={setComment}
                    placeholder={s.commentPh}
                    placeholderTextColor={theme.color.textMuted}
                    maxLength={1000}
                    style={{ flex: 1, color: theme.color.text, fontSize: 15, minHeight: 44 }}
                  />
                  <Button
                    label={s.send}
                    variant="brand"
                    disabled={!comment.trim() || addComment.isPending}
                    onPress={() =>
                      addComment.mutate(
                        { ticketId: tk.id, body: comment },
                        { onSuccess: () => setComment('') },
                      )
                    }
                  />
                </StandardCard>
              ) : null}
              <StandardCard style={{ paddingVertical: theme.spacing.xs }}>
                {timeline.map((e, index) => (
                  <ListRow
                    key={e.key}
                    title={e.title}
                    subtitle={e.sub}
                    subtitleLines={4}
                    leading={<Ionicons name={e.icon} size={20} color={theme.color.textMuted} />}
                    amount={stamp(e.at)}
                    divider={index < timeline.length - 1}
                  />
                ))}
              </StandardCard>
            </>
          ) : (
            <StandardCard>
              <Text tone="muted">{s.notFound}</Text>
            </StandardCard>
          )}
        </ScenicBody>
      </ScrollView>
      <OverflowMenu visible={menu} onClose={() => setMenu(false)} items={items} />
    </Screen>
  );
}
