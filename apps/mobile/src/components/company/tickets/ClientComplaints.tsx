import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import { isTicketOpen } from '@waves/core';
import { Text, useTheme } from '@waves/ui';

import { TicketRow } from '@/components/company/tickets/parts';
import { StandardCard } from '@/components/standard';
import { useCompanySuspended } from '@/data/companyEntries';
import { useCompanyTickets, useNow } from '@/data/companyTickets';
import { fill, useStrings } from '@/i18n';
import { router } from '@/lib/navigation';

/** A client's complaints on its detail: how many are open, the latest two, and a way to log another. */
export function ClientComplaints({ groupId, clientId }: { groupId: string; clientId: string }) {
  const theme = useTheme();
  const { t } = useStrings();
  const s = t.companyTickets;
  const view = useCompanyTickets(groupId);
  const suspended = useCompanySuspended(groupId);
  const now = useNow();
  const mine = view.tickets
    .filter((x) => x.clientId === clientId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const canAdd = view.canAdd && !suspended;
  if (mine.length === 0 && !canAdd) return null;
  const open = mine.filter(isTicketOpen).length;
  const latest = mine.slice(0, 2);
  return (
    <StandardCard style={{ paddingVertical: theme.spacing.xs, gap: 0 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44 }}>
        <Text style={{ flex: 1, fontWeight: '800', fontSize: 16 }}>
          {mine.length ? `${s.title} · ${fill(s.hubOpen, { n: open })}` : s.title}
        </Text>
        {mine.length > 2 ? (
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => router.push(`/group/${groupId}/company-tickets?clientId=${clientId}`)}
          >
            <Text style={{ color: theme.color.brand, fontWeight: '700' }}>{s.seeAll}</Text>
          </Pressable>
        ) : null}
      </View>
      {latest.map((tk, i) => (
        <TicketRow
          key={tk.id}
          ticket={tk}
          now={now}
          view={view}
          divider={i < latest.length - 1 || canAdd}
          onPress={() => router.push(`/group/${groupId}/company-ticket?ticketId=${tk.id}`)}
        />
      ))}
      {canAdd ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push(`/group/${groupId}/company-ticket-add?clientId=${clientId}`)}
          style={{
            minHeight: 44,
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.xs,
          }}
        >
          <Ionicons name="add" size={18} color={theme.color.brand} />
          <Text style={{ color: theme.color.brand, fontWeight: '700' }}>{s.newComplaint}</Text>
        </Pressable>
      ) : null}
    </StandardCard>
  );
}
