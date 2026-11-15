import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, View } from 'react-native';

import { filterTickets, ticketCounts, type TicketTab } from '@waves/core';
import { Button, Screen, Text, useTheme } from '@waves/ui';

import { TicketRow } from '@/components/company/tickets/parts';
import { ScenicBody, ScenicHeader, StandardCard } from '@/components/standard';
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
              <Button
                label={s.newComplaint}
                variant="brand"
                size="sm"
                icon={<Ionicons name="add" size={18} color={theme.color.onBrand} />}
                onPress={add}
              />
            ) : undefined
          }
        />
        <ScenicBody>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View
              accessibilityRole="tablist"
              style={{ flexDirection: 'row', gap: theme.spacing.sm }}
            >
              {(
                [
                  ['open', s.tOpen, counts.open],
                  ['escalated', s.tEscalated, counts.escalated],
                  ['resolved', s.tResolved, counts.resolved],
                ] as const
              ).map(([value, label, n]) => {
                const on = tab === value;
                // Every locale writes these as "<label> · {n}"; the count goes in its own badge here.
                const name = label.split(' · ')[0];
                return (
                  <Pressable
                    key={value}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={fill(label, { n })}
                    onPress={() => setTab(value)}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 8,
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
                      {name}
                    </Text>
                    <View
                      style={{
                        minWidth: 22,
                        height: 22,
                        borderRadius: 11,
                        paddingHorizontal: 6,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: on ? 'rgba(255,255,255,0.25)' : theme.color.brandSoft,
                      }}
                    >
                      <Text
                        variant="caption"
                        style={{
                          fontWeight: '700',
                          color: on ? theme.color.onBrand : theme.color.brand,
                        }}
                      >
                        {n}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
          {scoped.length === 0 ? (
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
                <Ionicons name="clipboard-outline" size={64} color={theme.color.brand} />
                <View style={{ position: 'absolute', top: 10, right: 18 }}>
                  <Ionicons name="alert-circle" size={34} color={theme.color.brand} />
                </View>
              </View>
              <Text variant="title" style={{ fontSize: 22 }}>
                {s.emptyTitle}
              </Text>
              <Text tone="muted" style={{ textAlign: 'center' }}>
                {s.emptyBody}
              </Text>
              {canAdd ? (
                <Button
                  label={s.newComplaint}
                  variant="brand"
                  icon={<Ionicons name="add" size={20} color={theme.color.onBrand} />}
                  onPress={add}
                />
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
