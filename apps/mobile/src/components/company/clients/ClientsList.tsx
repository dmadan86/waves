import { useMemo, useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import { docNumberLabel } from '@waves/core';
import { Button, iconSize, Row, Screen, Sheet, Text, useTheme } from '@waves/ui';

import { DashBody, DashHeader, IconButton } from '@/components/company/dashboard/parts';
import { OverflowMenu, type OverflowMenuItem } from '@/components/OverflowMenu';
import { type MenuAnchor } from '@/components/SortMenu';
import { RowMenu, StatTiles } from '@/components/company/listParts';
import { ListRow, RowTile, SegmentedPills, StandardCard } from '@/components/standard';
import { useCompanyClients, useFollowUps } from '@/data/companyClients';
import { useCompanyDocs } from '@/data/companyDocuments';
import { useCompanyEntries, useCompanySuspended } from '@/data/companyEntries';
import { useCompanyTickets } from '@/data/companyTickets';
import { todayIso } from '@/data/personal';
import { fill, useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';
import { useFavorites } from '@/lib/favorites';
import {
  buildClientRows,
  followUpTag,
  nextFollowUpDays,
  daysAgo,
  inTab,
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
  'rejected',
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
  const [filterOpen, setFilterOpen] = useState(false);
  const [menu, setMenu] = useState<'sort' | null>(null);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const sortRef = useRef<View>(null);
  const today = todayIso();
  const fmt = (minor: bigint) => compactMoney(minor, view.currency, locale, t.company.ovCrore);
  const followUps = useFollowUps(groupId);
  const nextDays = useMemo(() => nextFollowUpDays(followUps.all), [followUps.all]);
  const all = useMemo(
    () => buildClientRows(view.clients, docs, view.notes, nextDays, view.inquiries),
    [view.clients, docs, view.notes, nextDays, view.inquiries],
  );
  const counts = tabCounts(all);
  // Three plain states: an open follow-up or fresh inquiry, a lost or rejected client, else active.
  const look = (r: (typeof all)[number]) =>
    r.status === 'lost' || r.status === 'rejected'
      ? 'inactive'
      : r.nextFollowUp || r.status === 'inquiry'
        ? 'followup'
        : 'active';
  // Tiles and the All tab count the same set: lost clients sit outside both (see inTab).
  const listed = all.filter((r) => inTab(r, 'all'));
  const tally = (k: string) => listed.filter((r) => look(r) === k).length;
  // Subtitle for a client with an open follow-up: today, overdue, weekday or date.
  const fuText = (day: string | null): string | null => {
    if (!day) return null;
    const tag = followUpTag(day, today);
    return tag.kind === 'today'
      ? s.fuSubToday
      : tag.kind === 'overdue'
        ? fill(s.fuSubOverdue, { n: tag.n })
        : fill(s.fuSubOn, {
            when: tag.weekday
              ? new Date(`${day}T12:00:00`).toLocaleDateString(locale, { weekday: 'short' })
              : new Date(`${day}T12:00:00`).toLocaleDateString(locale, {
                  day: 'numeric',
                  month: 'short',
                }),
          });
  };
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
  // The header ⋮ holds every add action (client, import, quote, invoice); there is no floating button.
  const addItems: OverflowMenuItem[] = [
    {
      icon: 'person-add-outline',
      label: s.addClient,
      onPress: () => router.push(`/group/${groupId}/company-client-add`),
    },
    {
      icon: 'cloud-upload-outline',
      label: t.companyImport.menuRow,
      onPress: () => router.push(`/group/${groupId}/company-import?entity=client`),
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
      rejected: { label: s.inqStRejected, fg: c.negative, bg: c.negativeSoft },
      lost: { label: s.stLost, fg: c.textMuted, bg: c.surfaceMuted },
    }[st];
  };
  const statusLabel = (st: ClientStatus) => pill(st).label.replace('✓ ', '');
  const circle = {
    width: 44,
    height: 44,
    borderRadius: 22,
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
                badge={followUps.overdue + followUps.dueToday}
                label={s.fuTitle}
                onPress={() => router.push(`/group/${groupId}/company-followups`)}
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
          <StatTiles
            tiles={[
              {
                icon: 'people-outline',
                value: counts.all,
                label: s.statTotal,
                fg: theme.color.brand,
                bg: theme.color.brandSoft,
              },
              {
                icon: 'checkmark-circle-outline',
                value: tally('active'),
                label: s.statActive,
                fg: theme.color.positive,
                bg: theme.color.positiveSoft,
              },
              {
                icon: 'person-outline',
                value: tally('followup'),
                label: s.statFollowUp,
                fg: theme.color.warning,
                bg: theme.color.warningSoft,
              },
              {
                icon: 'information-circle-outline',
                value: tally('inactive'),
                label: s.statInactive,
                fg: theme.color.textMuted,
                bg: theme.color.surfaceMuted,
              },
            ]}
          />
          <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
            <View
              style={{
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.spacing.sm,
                minHeight: 44,
                paddingHorizontal: theme.spacing.md,
                borderRadius: theme.radius.md,
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
              accessibilityLabel={fill(s.sortBy, { by: sortName })}
              onPress={openSort}
              style={circle}
            >
              <Ionicons name="swap-vertical" size={iconSize.md} color={theme.color.text} />
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
                const k = look(r);
                const st = {
                  active: {
                    label: s.statActive,
                    fg: theme.color.positive,
                    bg: theme.color.positiveSoft,
                  },
                  followup: {
                    label: s.statFollowUp,
                    fg: theme.color.warning,
                    bg: theme.color.warningSoft,
                  },
                  inactive: {
                    label: s.statInactive,
                    fg: theme.color.textMuted,
                    bg: theme.color.surfaceMuted,
                  },
                }[k];
                const go = () => router.push(`/group/${groupId}/company-client?clientId=${c.id}`);
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
                    subtitleNegative={!!r.nextFollowUp && r.nextFollowUp < today}
                    subtitle={
                      fuText(r.nextFollowUp) ??
                      `${doc} · ${days === 0 ? s.today : fill(s.daysAgo, { n: days })}`
                    }
                    leading={
                      <RowTile tint={theme.color.brandSoft}>
                        <Ionicons
                          name="business-outline"
                          size={iconSize.md}
                          color={theme.color.brand}
                        />
                      </RowTile>
                    }
                    trailing={
                      <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
                        {r.amountMinor == null ? null : (
                          <Text tabular style={{ fontWeight: '700' }}>
                            {fmt(r.amountMinor)}
                          </Text>
                        )}
                        <View
                          style={{
                            backgroundColor: st.bg,
                            borderRadius: theme.radius.sm,
                            paddingHorizontal: theme.spacing.sm,
                            paddingVertical: 2,
                          }}
                        >
                          <Text variant="micro" style={{ color: st.fg, fontWeight: '700' }}>
                            {st.label}
                          </Text>
                        </View>
                        <RowMenu
                          label={`${s.more}: ${c.name}`}
                          items={[
                            { icon: 'open-outline', label: s.open, onPress: go },
                            {
                              icon: fav.isFavorite(c.id) ? 'star' : 'star-outline',
                              label: fill(fav.isFavorite(c.id) ? t.clone.unstar : t.clone.star, {
                                name: c.name,
                              }),
                              onPress: () => fav.toggle(c.id),
                            },
                          ]}
                        />
                      </Row>
                    }
                    onPress={go}
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
