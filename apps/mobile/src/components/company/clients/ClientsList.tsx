import { useMemo, useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import { docNumberLabel } from '@waves/core';
import { Button, iconSize, Row, Screen, Sheet, Text, useTheme } from '@waves/ui';

import { DashBody, DashHeader, IconButton } from '@/components/company/dashboard/parts';
import { OverflowMenu, type OverflowMenuItem } from '@/components/OverflowMenu';
import { PersonAvatar } from '@/components/PersonAvatar';
import { type MenuAnchor } from '@/components/SortMenu';
import { ListRow, SegmentedPills, StandardCard } from '@/components/standard';
import { useCompanyClients } from '@/data/companyClients';
import { useCompanyDocs } from '@/data/companyDocuments';
import { useCompanyEntries, useCompanySuspended } from '@/data/companyEntries';
import { useCompanyTickets } from '@/data/companyTickets';
import { todayIso } from '@/data/personal';
import { fill, useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';
import { useFavorites } from '@/lib/favorites';
import {
  buildClientRows,
  daysAgo,
  listClientRows,
  tabCounts,
  type ClientSort,
  type ClientStatus,
  type ClientTab,
  type DateRange,
} from '@/lib/clientRows';
import { measureAnchor } from '@/lib/measureAnchor';
import { router } from '@/lib/navigation';
import { compactMoney } from '@/lib/overviewMath';

const BLUE = { fg: '#2563EB', bg: '#EAF2FF' };
const FILTER_STATUSES: readonly ClientStatus[] = [
  'inquiry',
  'quoted',
  'unpaid',
  'part_paid',
  'paid',
  'lost',
];

/** Clients and inquiries: KPI tiles, tabs with counts, a sort and filter row, and one divided card of clients. */
export function ClientsList({ groupId }: { groupId: string }) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const s = t.companyClients;
  const clearance = useBottomClearance();
  const view = useCompanyClients(groupId);
  const suspended = useCompanySuspended(groupId);
  const entries = useCompanyEntries(groupId);
  const { docs, canUse: canDocs } = useCompanyDocs(groupId);
  const tickets = useCompanyTickets(groupId);
  const [tab, setTab] = useState<ClientTab>('all');
  const [status, setStatus] = useState<ClientStatus | null>(null);
  const [range, setRange] = useState<DateRange>('all');
  const [sort, setSort] = useState<ClientSort>('recent');
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [menu, setMenu] = useState<'sort' | null>(null);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const sortRef = useRef<View>(null);
  const today = todayIso();
  const fmt = (minor: bigint) => compactMoney(minor, view.currency, locale, t.company.ovCrore);
  const all = useMemo(
    () => buildClientRows(view.clients, docs, view.notes),
    [view.clients, docs, view.notes],
  );
  const counts = tabCounts(all);
  // Client stars share the device-local favourites set with group stars (ids never collide).
  const fav = useFavorites();
  const rows = listClientRows(all, { tab, status, range, sort, query, today }).sort(
    (a, b) => Number(fav.isFavorite(b.client.id)) - Number(fav.isFavorite(a.client.id)),
  );
  const filtered = status !== null || range !== 'all';
  const canAdd = view.canAdd && !suspended;
  const openSort = () =>
    measureAnchor(sortRef, (a) => {
      setAnchor(a);
      setMenu('sort');
    });
  const sortName = { recent: s.sortUpdated, amount: s.sortAmount, name: s.sortName }[sort];
  const items: OverflowMenuItem[] = [
    { icon: 'time-outline', label: s.sortUpdated, onPress: () => setSort('recent') },
    { icon: 'cash-outline', label: s.sortAmount, onPress: () => setSort('amount') },
    { icon: 'text-outline', label: s.sortName, onPress: () => setSort('name') },
  ];
  // The header ⋮: add actions the FAB does not offer (quote, invoice) live here, not in a duplicate pill.
  const addItems: OverflowMenuItem[] = [
    {
      icon: 'person-add-outline',
      label: s.addClient,
      onPress: () => router.push(`/group/${groupId}/company-client-add`),
    },
    ...(canDocs
      ? ([
          {
            icon: 'document-text-outline',
            label: s.createQuote,
            onPress: () => router.push(`/group/${groupId}/company-bill-form?type=estimate`),
          },
          {
            icon: 'receipt-outline',
            label: s.createInvoice,
            onPress: () => router.push(`/group/${groupId}/company-bill-form?type=bill`),
          },
        ] as const)
      : []),
  ];
  // Complaints open from this ⋮ for anyone who can log them, even when they cannot add clients.
  const menuItems: OverflowMenuItem[] = [
    ...(canAdd ? addItems : []),
    ...(tickets.canAdd
      ? [
          {
            icon: 'chatbubbles-outline' as const,
            label: t.companyTickets.title,
            onPress: () => router.push(`/group/${groupId}/company-tickets`),
          },
        ]
      : []),
  ];
  const pill = (st: ClientStatus) => {
    const c = theme.color;
    return {
      inquiry: { label: s.docInquiry, fg: BLUE.fg, bg: BLUE.bg },
      quoted: { label: s.stQuoted, fg: c.warning, bg: c.warningSoft },
      unpaid: { label: s.stUnpaid, fg: c.negative, bg: c.negativeSoft },
      part_paid: { label: s.stPartPaid, fg: c.warning, bg: c.warningSoft },
      paid: { label: `✓ ${s.stPaid}`, fg: c.positive, bg: c.positiveSoft },
      client: { label: s.stClient, fg: c.positive, bg: c.positiveSoft },
      lost: { label: s.stLost, fg: c.textMuted, bg: c.surfaceMuted },
    }[st];
  };
  const statusLabel = (st: ClientStatus) => pill(st).label.replace('✓ ', '');
  const circle = {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.color.surface,
  } as const;
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
          menuItems={menuItems.length ? menuItems : undefined}
          actions={
            <>
              <IconButton
                round
                icon="checkbox-outline"
                label={s.fuTitle}
                onPress={() => router.push(`/group/${groupId}/company-followups`)}
              />
              <IconButton
                round
                icon={searching ? 'close' : 'search-outline'}
                label={s.search}
                onPress={() => {
                  if (searching) setQuery('');
                  setSearching(!searching);
                }}
              />
            </>
          }
        />
        <DashBody>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
              <SegmentedPills
                options={[
                  { value: 'all' as const, label: fill(s.tAll, { n: counts.all }) },
                  { value: 'inquiry' as const, label: fill(s.tInquiries, { n: counts.inquiry }) },
                  { value: 'quote' as const, label: fill(s.tQuotes, { n: counts.quote }) },
                  { value: 'invoice' as const, label: fill(s.tInvoices, { n: counts.invoice }) },
                ]}
                value={tab}
                onChange={(v) => {
                  setTab(v);
                }}
              />
            </View>
          </ScrollView>
          {searching ? (
            <View
              style={{
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
                autoFocus
                accessibilityLabel={s.search}
                value={query}
                onChangeText={setQuery}
                placeholder={s.search}
                placeholderTextColor={theme.color.textMuted}
                style={{ flex: 1, color: theme.color.text, fontSize: 16 }}
              />
            </View>
          ) : null}
          <Row style={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <Pressable
              ref={sortRef}
              accessibilityRole="button"
              accessibilityLabel={s.sortLabel}
              onPress={openSort}
              style={{
                height: 40,
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.spacing.xs,
                paddingHorizontal: theme.spacing.md,
                borderRadius: 20,
                backgroundColor: theme.color.surface,
              }}
            >
              <Text variant="caption" style={{ fontWeight: '600' }}>
                {fill(s.sortBy, { by: sortName })}
              </Text>
              <Ionicons name="chevron-down" size={iconSize.sm} color={theme.color.textMuted} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={s.filterTitle}
              onPress={() => setFilterOpen(true)}
              style={circle}
            >
              <Ionicons name="filter" size={iconSize.md} color={theme.color.text} />
              {filtered ? (
                <View
                  style={{
                    position: 'absolute',
                    top: 8,
                    end: 8,
                    width: 9,
                    height: 9,
                    borderRadius: 5,
                    backgroundColor: theme.color.brand,
                    borderWidth: 1.5,
                    borderColor: theme.color.surface,
                  }}
                />
              ) : null}
            </Pressable>
          </Row>
          {all.length === 0 ? (
            <StandardCard style={{ alignItems: 'center', gap: theme.spacing.sm }}>
              <Ionicons name="clipboard-outline" size={48} color={theme.color.brand} />
              <Text variant="title" style={{ fontSize: 18 }}>
                {s.emptyTitle}
              </Text>
              <Text tone="muted" style={{ textAlign: 'center' }}>
                {s.emptyBody}
              </Text>
              {canAdd ? (
                <Row style={{ gap: theme.spacing.sm, flexWrap: 'wrap', justifyContent: 'center' }}>
                  <Button
                    label={s.addClient}
                    variant="brand"
                    size="sm"
                    onPress={() => router.push(`/group/${groupId}/company-client-add`)}
                  />
                </Row>
              ) : null}
            </StandardCard>
          ) : rows.length === 0 ? (
            <StandardCard>
              <Text tone="muted" style={{ paddingVertical: theme.spacing.md, textAlign: 'center' }}>
                {s.noMatches}
              </Text>
            </StandardCard>
          ) : (
            <StandardCard style={{ paddingVertical: 0 }}>
              {rows.map((r, i) => {
                const c = r.client;
                const st = pill(r.status);
                const word = r.latest?.type === 'bill' ? s.docInvoice : s.docQuote;
                const doc = r.latest
                  ? r.latest.number == null
                    ? word
                    : `${word} #${docNumberLabel(r.latest.type, r.latest.number)}`
                  : s.docInquiry;
                const days = daysAgo(r.lastDay, today);
                return (
                  <ListRow
                    key={c.id}
                    divider={i < rows.length - 1}
                    title={c.name}
                    subtitle={`${doc} · ${days === 0 ? s.today : fill(s.daysAgo, { n: days })}`}
                    leading={<PersonAvatar name={c.name} size={40} />}
                    trailing={
                      <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={fill(
                            fav.isFavorite(c.id) ? t.clone.unstar : t.clone.star,
                            { name: c.name },
                          )}
                          hitSlop={8}
                          onPress={() => fav.toggle(c.id)}
                        >
                          <Ionicons
                            name={fav.isFavorite(c.id) ? 'star' : 'star-outline'}
                            size={18}
                            color={
                              fav.isFavorite(c.id) ? theme.color.warning : theme.color.textMuted
                            }
                          />
                        </Pressable>
                        <View
                          style={{
                            backgroundColor: st.bg,
                            borderRadius: theme.radius.pill,
                            paddingHorizontal: theme.spacing.sm,
                            paddingVertical: 2,
                          }}
                        >
                          <Text variant="micro" style={{ color: st.fg, fontWeight: '700' }}>
                            {st.label}
                          </Text>
                        </View>
                        <Text
                          tabular
                          style={{ fontWeight: '700', minWidth: 52, textAlign: 'right' }}
                        >
                          {r.amountMinor == null ? '—' : fmt(r.amountMinor)}
                        </Text>
                        <Ionicons name="chevron-forward" size={18} color={theme.color.textMuted} />
                      </Row>
                    }
                    onPress={() => router.push(`/group/${groupId}/company-client?clientId=${c.id}`)}
                  />
                );
              })}
            </StandardCard>
          )}
        </DashBody>
      </ScrollView>
      <OverflowMenu
        visible={menu !== null}
        onClose={() => setMenu(null)}
        items={items}
        anchor={anchor}
      />
      <Sheet visible={filterOpen} onClose={() => setFilterOpen(false)} closeLabel={t.common.close}>
        <View style={{ gap: theme.spacing.md }}>
          <Text variant="title">{s.filterTitle}</Text>
          <Text variant="caption" tone="muted">
            {s.fStatus}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
            {FILTER_STATUSES.map((st) => (
              <SegmentedPills
                key={st}
                options={[{ value: st, label: statusLabel(st) }]}
                value={status ?? ('' as ClientStatus)}
                onChange={(v) => setStatus(status === v ? null : v)}
              />
            ))}
          </View>
          <Text variant="caption" tone="muted">
            {s.fDate}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
            <SegmentedPills
              options={[
                { value: 'all' as const, label: s.rAll },
                { value: 'month' as const, label: s.rMonth },
                { value: 'quarter' as const, label: s.rQuarter },
              ]}
              value={range}
              onChange={setRange}
            />
          </View>
          <Row style={{ gap: theme.spacing.sm }}>
            <Button
              label={s.fClear}
              variant="secondary"
              onPress={() => {
                setStatus(null);
                setRange('all');
              }}
            />
            <Button label={t.common.done} variant="brand" onPress={() => setFilterOpen(false)} />
          </Row>
        </View>
      </Sheet>
    </Screen>
  );
}
