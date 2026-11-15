/**
 * Log a complaint (or edit one): which client, what happened, how urgent, who deals with it. The due time follows
 * the priority and can be changed. One screen, one Save.
 */
import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import { defaultDueAt, TICKET_PRIORITIES, type TicketPriority } from '@waves/core';
import { Screen, Sheet, Text, useTheme } from '@waves/ui';

import { SaveButton } from '@/components/company/EntryForm';
import { useTicketText } from '@/components/company/tickets/parts';
import { PersonAvatar } from '@/components/PersonAvatar';
import { PlainHeader, SegmentedPills, StandardCard } from '@/components/standard';
import { useCompanyClients } from '@/data/companyClients';
import { useCompanyTickets, useSetTicket } from '@/data/companyTickets';
import { displayName } from '@/data/types';
import { fill, useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';
import { useDialog } from '@/lib/dialog';
import { router } from '@/lib/navigation';

const H = 3_600_000;
const DUE_CHOICES = [4 * H, 24 * H, 72 * H, 168 * H, 336 * H];

export function TicketForm({ groupId }: { groupId: string }) {
  const { ticketId, clientId: presetClient } = useLocalSearchParams<{
    ticketId?: string;
    clientId?: string;
  }>();
  const theme = useTheme();
  const { t, locale } = useStrings();
  const s = t.companyTickets;
  const clearance = useBottomClearance();
  const { notify, choose } = useDialog();
  const view = useCompanyTickets(groupId);
  const clients = useCompanyClients(groupId);
  const text = useTicketText();
  const save = useSetTicket(groupId);
  const existing = view.tickets.find((x) => x.id === ticketId);
  const [clientId, setClientId] = useState<string | null>(
    existing ? existing.clientId : (presetClient ?? null),
  );
  const [title, setTitle] = useState(existing?.title ?? '');
  const [details, setDetails] = useState(existing?.details ?? '');
  const [priority, setPriority] = useState<TicketPriority>(existing?.priority ?? 'normal');
  const [assignee, setAssignee] = useState<string | null>(
    existing?.assigneeMemberId ?? view.myMemberId,
  );
  // null: follow the priority (or keep the saved time while the priority is unchanged).
  const [customDue, setCustomDue] = useState<string | null>(null);
  const [pickClient, setPickClient] = useState(false);
  const [query, setQuery] = useState('');
  const [now] = useState(() => Date.now());
  const client = clients.clients.find((c) => c.id === clientId);
  const clientName =
    client?.name ?? (existing && existing.clientId === clientId ? existing.clientName : null);
  const assigneeRow = view.people.find((m) => m.id === assignee);
  const dueAt =
    customDue ??
    (existing && existing.priority === priority ? existing.dueAt : defaultDueAt(priority, now));
  const dueMs = new Date(dueAt).getTime() - now;
  const busy = save.isPending;

  const pickAssignee = async () => {
    const id = await choose({
      title: s.assignTo,
      options: view.people.map((m) => ({
        id: m.id,
        label: m.id === view.myMemberId ? s.you : displayName(m),
      })),
    });
    if (id) setAssignee(id);
  };
  const pickDue = async () => {
    const id = await choose({
      title: s.priority,
      options: DUE_CHOICES.map((ms) => ({
        id: String(ms),
        label: fill(s.dueIn, { t: text.span(ms) }),
      })),
    });
    if (id) setCustomDue(new Date(Date.now() + Number(id)).toISOString());
  };
  const submit = async () => {
    if (busy || !title.trim() || !assignee) return;
    try {
      const savedId = await save.mutateAsync({
        ticketId: existing?.id,
        clientId,
        title,
        details,
        priority,
        assigneeMemberId: assignee,
        dueAt,
      });
      if (existing) router.back();
      else router.replace(`/group/${groupId}/company-ticket?ticketId=${savedId}`);
    } catch {
      await notify({ title: t.companyClients.saveFailed, tone: 'danger' });
    }
  };
  const row = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: theme.spacing.md,
    minHeight: 52,
  };
  const field = {
    flex: 1,
    color: theme.color.text,
    fontSize: 15,
    paddingVertical: 0,
    textAlign: locale.startsWith('ar') ? ('right' as const) : ('left' as const),
  };
  const shown = clients.clients
    .filter(
      (c) => !query.trim() || c.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
    )
    .slice(0, 50);
  return (
    <Screen edges={[]}>
      <PlainHeader title={existing ? s.editComplaint : s.newComplaint} />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          padding: theme.spacing.lg,
          gap: theme.spacing.lg,
          paddingBottom: clearance + 84,
        }}
      >
        <StandardCard style={{ paddingVertical: 0, gap: 0 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={s.clientLabel}
            onPress={() => setPickClient(true)}
            style={row}
          >
            <Ionicons name="person-outline" size={18} color={theme.color.textMuted} />
            <Text style={{ flex: 1, color: clientName ? theme.color.text : theme.color.textMuted }}>
              {clientName ?? s.noClient}
            </Text>
            <Ionicons name="chevron-down" size={16} color={theme.color.textMuted} />
          </Pressable>
          <View style={[row, { borderTopWidth: 1, borderTopColor: theme.color.border }]}>
            <Ionicons name="alert-circle-outline" size={18} color={theme.color.textMuted} />
            <TextInput
              accessibilityLabel={s.titlePh}
              value={title}
              onChangeText={setTitle}
              placeholder={s.titlePh}
              placeholderTextColor={theme.color.textMuted}
              maxLength={120}
              style={field}
            />
          </View>
          <View
            style={[
              row,
              { borderTopWidth: 1, borderTopColor: theme.color.border, paddingVertical: 8 },
            ]}
          >
            <Ionicons name="reader-outline" size={18} color={theme.color.textMuted} />
            <TextInput
              accessibilityLabel={s.detailsPh}
              value={details}
              onChangeText={setDetails}
              placeholder={s.detailsPh}
              placeholderTextColor={theme.color.textMuted}
              maxLength={1000}
              multiline
              style={[field, { minHeight: 44 }]}
            />
          </View>
        </StandardCard>
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="caption" style={{ fontWeight: '700' }}>
            {s.priority}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
            <SegmentedPills
              options={TICKET_PRIORITIES.map((p) => ({ value: p, label: text.priority(p) }))}
              value={priority}
              onChange={(p) => {
                setPriority(p);
                setCustomDue(null);
              }}
            />
          </View>
        </View>
        <StandardCard style={{ paddingVertical: 0, gap: 0 }}>
          <Pressable
            accessibilityRole="button"
            disabled={view.people.length < 2}
            onPress={() => void pickAssignee()}
            style={row}
          >
            <PersonAvatar name={assigneeRow ? displayName(assigneeRow) : '?'} size={28} />
            <Text style={{ flex: 1 }}>
              {`${s.assignedTo} · ${assignee === view.myMemberId ? s.you : assigneeRow ? displayName(assigneeRow) : s.someone}`}
            </Text>
            {view.people.length > 1 ? (
              <Ionicons name="chevron-down" size={16} color={theme.color.textMuted} />
            ) : null}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => void pickDue()}
            style={[row, { borderTopWidth: 1, borderTopColor: theme.color.border }]}
          >
            <Ionicons name="time-outline" size={18} color={theme.color.textMuted} />
            <Text style={{ flex: 1 }}>
              {fill(s.dueIn, { t: text.span(Math.max(dueMs, 60_000)) })}
            </Text>
            <Ionicons name="chevron-down" size={16} color={theme.color.textMuted} />
          </Pressable>
        </StandardCard>
      </ScrollView>
      <View style={{ position: 'absolute', left: 16, right: 16, bottom: clearance }}>
        <SaveButton
          label={existing ? s.save : s.log}
          disabled={!title.trim() || !assignee || busy}
          onPress={() => void submit()}
        />
      </View>
      <Sheet visible={pickClient} onClose={() => setPickClient(false)} closeLabel={t.common.close}>
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="title">{s.pickClient}</Text>
          <TextInput
            accessibilityLabel={s.searchClients}
            value={query}
            onChangeText={setQuery}
            placeholder={s.searchClients}
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
          <ScrollView style={{ maxHeight: 320 }} keyboardShouldPersistTaps="handled">
            {[{ id: null as string | null, name: s.noClient }, ...shown].map((c) => (
              <Pressable
                key={c.id ?? 'none'}
                accessibilityRole="button"
                accessibilityState={{ selected: c.id === clientId }}
                onPress={() => {
                  setClientId(c.id);
                  setPickClient(false);
                  setQuery('');
                }}
                style={{ minHeight: 44, justifyContent: 'center' }}
              >
                <Text style={{ fontWeight: c.id === clientId ? '700' : '400' }}>{c.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </Sheet>
    </Screen>
  );
}
