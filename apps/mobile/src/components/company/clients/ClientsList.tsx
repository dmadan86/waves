import { useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import { clientCounts, filterClients, type ClientFilter } from '@waves/core';
import { iconSize, Row, Screen, Text, useTheme } from '@waves/ui';

import { DashBody, DashHeader, IconButton, useMoney } from '@/components/company/dashboard/parts';
import { StageChip } from '@/components/company/clients/parts';
import { OverflowMenu } from '@/components/OverflowMenu';
import { PersonAvatar } from '@/components/PersonAvatar';
import { type MenuAnchor } from '@/components/SortMenu';
import { ListRow, SegmentedPills, StandardCard } from '@/components/standard';
import { useClientMoney, useCompanyClients, useFollowUps } from '@/data/companyClients';
import { useCompanyEntries, useCompanySuspended } from '@/data/companyEntries';
import { fill, useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';
import { measureAnchor } from '@/lib/measureAnchor';
import { router } from '@/lib/navigation';

type Filter = ClientFilter | 'unpaid';

/** Clients and inquiries: stat tiles, filter pills, a search field and one card per client. */
export function ClientsList({ groupId }: { groupId: string }) {
  const theme = useTheme();
  const { t } = useStrings();
  const s = t.companyClients;
  const clearance = useBottomClearance();
  const view = useCompanyClients(groupId);
  const suspended = useCompanySuspended(groupId);
  const entries = useCompanyEntries(groupId);
  const money = useClientMoney(groupId);
  const followUps = useFollowUps(groupId);
  const fmt = useMoney(view.currency);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [byName, setByName] = useState(false);
  const [sortAnchor, setSortAnchor] = useState<MenuAnchor | null>(null);
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef<View>(null);
  const counts = clientCounts(view.clients);
  const owed = (id: string) => money.byClient.get(id) ?? 0n;
  const unpaidClients = view.clients.filter((c) => owed(c.id) > 0n);
  const unpaidTotal = unpaidClients.reduce((n, c) => n + owed(c.id), 0n);
  const q = query.trim().toLocaleLowerCase();
  // Unpaid ignores stage: a lost client's open bills are still owed.
  const listed =
    filter === 'unpaid'
      ? unpaidClients.filter((c) =>
          [c.name, c.phone, c.need].some((v) => !q || v?.toLocaleLowerCase().includes(q)),
        )
      : filterClients(view.clients, filter, query);
  const rows = byName ? [...listed].sort((a, b) => a.name.localeCompare(b.name)) : listed;
  const chips: { value: Filter; label: string }[] = [
    { value: 'all', label: `${s.fAll} ${counts.all}` },
    { value: 'inquiry', label: `${s.fInquiry} ${counts.inquiry}` },
    { value: 'quoted', label: `${s.fQuoted} ${counts.quoted}` },
    { value: 'client', label: `${s.fClient} ${counts.client}` },
    ...(counts.lost ? [{ value: 'lost' as const, label: `${s.fLost} ${counts.lost}` }] : []),
  ];
  const stats = [
    {
      f: 'all',
      label: s.fClient,
      value: counts.all,
      icon: 'people',
      color: '#16A34A',
      bg: '#ECFDF3',
    },
    {
      f: 'inquiry',
      label: s.fInquiry,
      value: counts.inquiry,
      icon: 'document-text',
      color: '#2563EB',
      bg: '#EAF2FF',
    },
    {
      f: 'quoted',
      label: s.fQuoted,
      value: counts.quoted,
      icon: 'time',
      color: '#EA8A0C',
      bg: '#FFF4E5',
    },
    {
      f: 'unpaid',
      label: s.fUnpaid,
      value: unpaidClients.length,
      icon: 'cash',
      color: '#DC2626',
      bg: '#FDECEC',
    },
  ] as const;
  const canAdd = view.canAdd && !suspended;
  const banner = [
    followUps.dueToday ? fill(s.bannerToday, { n: followUps.dueToday }) : null,
    followUps.overdue ? fill(s.bannerOverdue, { n: followUps.overdue }) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const sortItems = [
    { icon: 'time-outline' as const, label: s.sortRecent, onPress: () => setByName(false) },
    { icon: 'text-outline' as const, label: s.sortName, onPress: () => setByName(true) },
  ];
  return (
    <Screen edges={[]}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: clearance + theme.spacing.lg }}
      >
        <DashHeader
          tab
          groupId={groupId}
          view={entries}
          subtitle=""
          showGear={entries.isOwner}
          actions={
            canAdd ? (
              <IconButton
                round
                icon="add"
                label={s.newInquiry}
                onPress={() => router.push(`/group/${groupId}/company-client-add`)}
              />
            ) : undefined
          }
        />
        <DashBody>
          <Row style={{ gap: theme.spacing.sm }}>
            {stats.map((x) => (
              <Pressable
                key={x.f}
                accessibilityRole="button"
                accessibilityLabel={`${x.label} ${x.value}`}
                onPress={() => setFilter(x.f)}
                style={{
                  flex: 1,
                  padding: theme.spacing.md,
                  borderRadius: theme.radius.lg,
                  backgroundColor: x.bg,
                  gap: 2,
                  alignItems: 'center',
                }}
              >
                <Ionicons name={x.icon} size={iconSize.md} color={x.color} />
                <Text style={{ fontWeight: '800', color: '#111827' }}>{x.value}</Text>
                <Row style={{ alignItems: 'center' }}>
                  <Text
                    variant="micro"
                    numberOfLines={1}
                    style={{ color: '#374151', flexShrink: 1 }}
                  >
                    {x.label}
                  </Text>
                  <Ionicons name="chevron-forward" size={12} color="#374151" />
                </Row>
                {x.f === 'unpaid' && unpaidTotal > 0n ? (
                  <Text
                    variant="micro"
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    style={{ color: '#6B7280' }}
                  >
                    {fmt(unpaidTotal)}
                  </Text>
                ) : null}
              </Pressable>
            ))}
          </Row>
          {banner ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push(`/group/${groupId}/company-followups`)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.spacing.sm,
                backgroundColor: theme.color.warningSoft,
                borderRadius: theme.radius.lg,
                paddingHorizontal: theme.spacing.md,
                paddingVertical: theme.spacing.sm,
              }}
            >
              <Ionicons name="time-outline" size={18} color={theme.color.warning} />
              <Text variant="caption" style={{ flex: 1, fontWeight: '700' }}>
                {banner}
              </Text>
              <Ionicons name="chevron-forward" size={16} color={theme.color.warning} />
            </Pressable>
          ) : null}
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
              <SegmentedPills options={chips} value={filter} onChange={setFilter} />
            </View>
          </ScrollView>
          <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
            <View
              style={{
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.spacing.sm,
                minHeight: 44,
                paddingHorizontal: theme.spacing.md,
                borderRadius: theme.radius.pill,
                backgroundColor: theme.color.surface,
              }}
            >
              <Ionicons name="search" size={iconSize.md} color={theme.color.textMuted} />
              <TextInput
                accessibilityLabel={s.search}
                value={query}
                onChangeText={setQuery}
                placeholder={s.search}
                placeholderTextColor={theme.color.textMuted}
                style={{ flex: 1, color: theme.color.text, fontSize: 16 }}
              />
            </View>
            <Pressable
              ref={sortRef}
              accessibilityRole="button"
              accessibilityLabel={s.sortLabel}
              onPress={() =>
                measureAnchor(sortRef, (a) => {
                  setSortAnchor(a);
                  setSortOpen(true);
                })
              }
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: theme.color.surface,
              }}
            >
              <Ionicons name="filter" size={iconSize.md} color={theme.color.text} />
            </Pressable>
          </Row>
          {rows.length === 0 ? (
            <StandardCard>
              <Text tone="muted" style={{ paddingVertical: theme.spacing.md }}>
                {view.clients.length === 0 ? s.empty : s.emptyFilter}
              </Text>
            </StandardCard>
          ) : (
            rows.map((c) => {
              const due = owed(c.id);
              const mine = money.docs.filter((d) => !d.deleted && d.clientId === c.id);
              const bills = mine.filter((d) => d.docType === 'bill');
              // The amount and chip come only from bills linked to this client.
              const amount = due > 0n ? due : (c.expectedValueMinor ?? undefined);
              const status =
                due > 0n
                  ? { label: s.statusDue, fg: theme.color.negative, bg: theme.color.negativeSoft }
                  : bills.length > 0
                    ? {
                        label: s.statusPaid,
                        fg: theme.color.positive,
                        bg: theme.color.positiveSoft,
                      }
                    : null;
              return (
                <StandardCard key={c.id} style={{ paddingVertical: theme.spacing.xs }}>
                  <ListRow
                    title={c.name}
                    leading={<PersonAvatar name={c.name} size={40} />}
                    footer={
                      <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
                        <StageChip stage={c.stage} />
                        {mine.length ? (
                          <Text variant="micro" tone="muted">
                            {fill(mine.length === 1 ? s.itemN : s.itemsN, { n: mine.length })}
                          </Text>
                        ) : null}
                      </Row>
                    }
                    trailing={
                      <Row style={{ alignItems: 'center', gap: theme.spacing.xs }}>
                        <View style={{ alignItems: 'flex-end', gap: 2 }}>
                          {amount ? <Text style={{ fontWeight: '700' }}>{fmt(amount)}</Text> : null}
                          {status ? (
                            <View
                              style={{
                                backgroundColor: status.bg,
                                borderRadius: theme.radius.pill,
                                paddingHorizontal: theme.spacing.sm,
                                paddingVertical: 2,
                              }}
                            >
                              <Text variant="micro" style={{ color: status.fg, fontWeight: '700' }}>
                                {status.label}
                              </Text>
                            </View>
                          ) : null}
                        </View>
                        <Ionicons name="chevron-forward" size={18} color={theme.color.textMuted} />
                      </Row>
                    }
                    onPress={() => router.push(`/group/${groupId}/company-client?clientId=${c.id}`)}
                  />
                </StandardCard>
              );
            })
          )}
        </DashBody>
      </ScrollView>
      <OverflowMenu
        visible={sortOpen}
        onClose={() => setSortOpen(false)}
        items={sortItems}
        anchor={sortAnchor}
      />
    </Screen>
  );
}
