import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, View } from 'react-native';

import { filterTickets, ticketCounts, type TicketTab } from '@waves/core';
import { Button, Screen, Text, useTheme } from '@waves/ui';

import { TicketRow } from '@/components/company/tickets/parts';
import { ScenicBody, ScenicHeader, SegmentedPills, StandardCard } from '@/components/standard';
import { useCompanySuspended } from '@/data/companyEntries';
import { useCompanyTickets, useNow } from '@/data/companyTickets';
import { fill, useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';
import { router } from '@/lib/navigation';

/** Complaints in three tabs: Open, Escalated (past due) and Resolved. `clientId` narrows it to one client. */
export function TicketsList({ groupId, clientId }: { groupId: string; clientId?: string }) {
  const theme = useTheme();
  const { t } = useStrings();
  const s = t.companyTickets;
  const clearance = useBottomClearance();
  const view = useCompanyTickets(groupId);
  const suspended = useCompanySuspended(groupId);
  const now = useNow();
  const [tab, setTab] = useState<TicketTab>('open');
  const scoped = clientId ? view.tickets.filter((x) => x.clientId === clientId) : view.tickets;
  const counts = ticketCounts(scoped, now);
  const rows = filterTickets(scoped, tab, now);
  const canAdd = view.canAdd && !suspended;
  const add = () =>
    router.push(
      `/group/${groupId}/company-ticket-add${clientId ? `?clientId=${clientId}` : ''}` as const,
    );
  return (
    <Screen edges={[]}>
      <ScrollView contentContainerStyle={{ paddingBottom: clearance + theme.spacing.xl }}>
        <ScenicHeader
          title={s.title}
          action={
            canAdd ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={s.newComplaint}
                onPress={add}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: theme.color.surface,
                }}
              >
                <Ionicons name="add" size={22} color={theme.color.brand} />
              </Pressable>
            ) : undefined
          }
        />
        <ScenicBody>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
              <SegmentedPills
                options={[
                  { value: 'open' as const, label: fill(s.tOpen, { n: counts.open }) },
                  {
                    value: 'escalated' as const,
                    label: fill(s.tEscalated, { n: counts.escalated }),
                  },
                  { value: 'resolved' as const, label: fill(s.tResolved, { n: counts.resolved }) },
                ]}
                value={tab}
                onChange={setTab}
              />
            </View>
          </ScrollView>
          {scoped.length === 0 ? (
            <StandardCard style={{ alignItems: 'center', gap: theme.spacing.sm }}>
              <Ionicons name="chatbubbles-outline" size={48} color={theme.color.brand} />
              <Text variant="title" style={{ fontSize: 18 }}>
                {s.emptyTitle}
              </Text>
              <Text tone="muted" style={{ textAlign: 'center' }}>
                {s.emptyBody}
              </Text>
              {canAdd ? (
                <Button label={s.newComplaint} variant="brand" size="sm" onPress={add} />
              ) : null}
            </StandardCard>
          ) : rows.length === 0 ? (
            <StandardCard>
              <Text tone="muted" style={{ paddingVertical: theme.spacing.md, textAlign: 'center' }}>
                {s.emptyTab}
              </Text>
            </StandardCard>
          ) : (
            <StandardCard style={{ paddingVertical: 0 }}>
              {rows.map((tk, i) => (
                <TicketRow
                  key={tk.id}
                  ticket={tk}
                  now={now}
                  view={view}
                  divider={i < rows.length - 1}
                  onPress={() => router.push(`/group/${groupId}/company-ticket?ticketId=${tk.id}`)}
                />
              ))}
            </StandardCard>
          )}
        </ScenicBody>
      </ScrollView>
    </Screen>
  );
}
