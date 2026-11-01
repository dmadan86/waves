import { useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import { clientCounts, filterClients, type ClientFilter } from '@waves/core';
import { iconSize, Row, Screen, Text, useTheme } from '@waves/ui';

import { useMoney } from '@/components/company/dashboard/parts';
import { StageChip } from '@/components/company/clients/parts';
import { OverflowMenu } from '@/components/OverflowMenu';
import { PersonAvatar } from '@/components/PersonAvatar';
import { type MenuAnchor } from '@/components/SortMenu';
import {
  ListRow,
  ScenicBody,
  ScenicHeader,
  SegmentedPills,
  StandardCard,
} from '@/components/standard';
import {
  stageChange,
  useClientMoney,
  useCompanyClients,
  useFollowUps,
  useSetClient,
} from '@/data/companyClients';
import { useCompanyEntries, useCompanySuspended } from '@/data/companyEntries';
import { fill, useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';
import { companyOverviewRoute } from '@/lib/companyTab';
import { measureAnchor } from '@/lib/measureAnchor';
import { router } from '@/lib/navigation';

type Filter = ClientFilter | 'unpaid';

/** Clients and inquiries: stat tiles, filter pills, quick actions and one card of rows. */
export function ClientsList({ groupId }: { groupId: string }) {
  const theme = useTheme();
  const { t } = useStrings();
  const s = t.companyClients;
  const clearance = useBottomClearance();
  const view = useCompanyClients(groupId);
  const entries = useCompanyEntries(groupId);
  const suspended = useCompanySuspended(groupId);
  const money = useClientMoney(groupId);
  const followUps = useFollowUps(groupId);
  const setClient = useSetClient(groupId);
  const fmt = useMoney(view.currency);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [menu, setMenu] = useState<{ id: string; anchor: MenuAnchor | null } | null>(null);
  const rowRefs = useRef(new Map<string, View | null>());
  const counts = clientCounts(view.clients);
  const unpaidClients = view.clients.filter(
    (c) => c.stage !== 'lost' && (money.byClient.get(c.id) ?? 0n) > 0n,
  );
  const unpaidCount = unpaidClients.length;
  const unpaidTotal = unpaidClients.reduce((n, c) => n + (money.byClient.get(c.id) ?? 0n), 0n);
  const rows =
    filter === 'unpaid'
      ? filterClients(view.clients, 'all', query).filter(
          (c) => (money.byClient.get(c.id) ?? 0n) > 0n,
        )
      : filterClients(view.clients, filter, query);
  const chips: { value: Filter; label: string }[] = [
    { value: 'all', label: `${s.fAll} ${counts.all}` },
    { value: 'inquiry', label: `${s.fInquiry} ${counts.inquiry}` },
    { value: 'quoted', label: `${s.fQuoted} ${counts.quoted}` },
    { value: 'client', label: `${s.fClient} ${counts.client}` },
    { value: 'unpaid', label: `${s.fUnpaid} ${unpaidCount}` },
    ...(counts.lost ? [{ value: 'lost' as const, label: `${s.fLost} ${counts.lost}` }] : []),
  ];
  const stats = [
    {
      label: s.fClient,
      value: String(counts.all),
      icon: 'people',
      color: '#7C3AED',
      bg: '#F1EBFF',
    },
    {
      label: s.fInquiry,
      value: String(counts.inquiry),
      icon: 'document-text',
      color: '#16A34A',
      bg: '#ECFDF3',
    },
    {
      label: s.fQuoted,
      value: String(counts.quoted),
      icon: 'receipt',
      color: '#EA8A0C',
      bg: '#FFF4E5',
    },
    {
      label: s.fUnpaid,
      value: String(unpaidCount),
      sub: unpaidTotal > 0n ? fmt(unpaidTotal) : undefined,
      icon: 'cash',
      color: '#2563EB',
      bg: '#EAF2FF',
    },
  ] as const;
  const canAdd = view.canAdd && !suspended;
  const docsAllowed = entries.isAdmin && !suspended;
  const actions = [
    ...(canAdd
      ? [
          {
            icon: 'person-add-outline' as const,
            label: s.newInquiry,
            go: () => router.push(`/group/${groupId}/company-client-add`),
          },
        ]
      : []),
    ...(docsAllowed
      ? [
          {
            icon: 'document-text-outline' as const,
            label: s.createQuote,
            go: () => router.push(`/group/${groupId}/company-bill-form?type=estimate`),
          },
          {
            icon: 'receipt-outline' as const,
            label: s.createBill,
            go: () => router.push(`/group/${groupId}/company-bill-form?type=bill`),
          },
        ]
      : []),
  ];
  const menuClient = menu ? view.clients.find((c) => c.id === menu.id) : undefined;
  const menuItems = menuClient
    ? [
        {
          icon: 'open-outline' as const,
          label: s.open,
          route: `/group/${groupId}/company-client?clientId=${menuClient.id}` as const,
        },
        ...(docsAllowed
          ? [
              {
                icon: 'document-text-outline' as const,
                label: s.createQuote,
                route:
                  `/group/${groupId}/company-bill-form?type=estimate&clientId=${menuClient.id}` as const,
              },
              {
                icon: 'receipt-outline' as const,
                label: s.createBill,
                route:
                  `/group/${groupId}/company-bill-form?type=bill&clientId=${menuClient.id}` as const,
              },
            ]
          : []),
        ...(view.canManage &&
        !suspended &&
        menuClient.stage !== 'client' &&
        menuClient.stage !== 'lost'
          ? [
              {
                icon: 'checkmark-circle-outline' as const,
                label: s.markWon,
                onPress: () => setClient.mutate(stageChange(menuClient, 'client')),
              },
            ]
          : []),
      ]
    : [];
  const banner = [
    followUps.dueToday ? fill(s.bannerToday, { n: followUps.dueToday }) : null,
    followUps.overdue ? fill(s.bannerOverdue, { n: followUps.overdue }) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const iconBtn = {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  } as const;
  return (
    <Screen edges={[]}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: clearance + theme.spacing.lg }}
      >
        <ScenicHeader
          title={s.title}
          subtitle={s.subtitle}
          titleAlign="start"
          onBack={() => router.replace(companyOverviewRoute(groupId, 'back') as never)}
          action={
            <Row style={{ alignItems: 'center', gap: theme.spacing.xs }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={s.search}
                onPress={() => {
                  setSearching(!searching);
                  setQuery('');
                }}
                style={iconBtn}
              >
                <Ionicons
                  name={searching ? 'close' : 'search'}
                  size={iconSize.xl}
                  color={theme.color.text}
                />
              </Pressable>
              {canAdd ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={s.newInquiry}
                  onPress={() => router.push(`/group/${groupId}/company-client-add`)}
                  style={{ ...iconBtn, backgroundColor: theme.color.brand }}
                >
                  <Ionicons name="add" size={iconSize.xxl} color="#FFFFFF" />
                </Pressable>
              ) : null}
            </Row>
          }
        />
        <ScenicBody>
          <Row style={{ gap: theme.spacing.sm }}>
            {stats.map((x) => (
              <View
                key={x.label}
                style={{
                  flex: 1,
                  padding: theme.spacing.md,
                  borderRadius: theme.radius.lg,
                  backgroundColor: x.bg,
                  gap: 2,
                }}
              >
                <Ionicons name={x.icon} size={iconSize.md} color={x.color} />
                <Text style={{ fontWeight: '800', color: '#111827' }}>{x.value}</Text>
                <Text variant="micro" numberOfLines={1} style={{ color: '#374151' }}>
                  {x.label}
                </Text>
                {'sub' in x && x.sub ? (
                  <Text
                    variant="micro"
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    style={{ color: '#6B7280' }}
                  >
                    {x.sub}
                  </Text>
                ) : null}
              </View>
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
          {searching ? (
            <TextInput
              accessibilityLabel={s.search}
              autoFocus
              value={query}
              onChangeText={setQuery}
              placeholder={s.search}
              placeholderTextColor={theme.color.textMuted}
              style={{
                color: theme.color.text,
                fontSize: 16,
                minHeight: 44,
                paddingHorizontal: theme.spacing.lg,
                borderRadius: theme.radius.pill,
                backgroundColor: theme.color.surface,
              }}
            />
          ) : null}
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
              <SegmentedPills options={chips} value={filter} onChange={setFilter} />
            </View>
          </ScrollView>
          {actions.length ? (
            <StandardCard style={{ gap: theme.spacing.sm }}>
              <Text style={{ fontWeight: '700' }}>{s.quickActions}</Text>
              <Row>
                {actions.map((a) => (
                  <Pressable
                    key={a.label}
                    accessibilityRole="button"
                    onPress={a.go}
                    style={{
                      flex: 1,
                      alignItems: 'center',
                      gap: 4,
                      paddingVertical: theme.spacing.xs,
                    }}
                  >
                    <Ionicons name={a.icon} size={iconSize.xl} color={theme.color.brand} />
                    <Text variant="micro" numberOfLines={1} style={{ fontWeight: '600' }}>
                      {a.label}
                    </Text>
                  </Pressable>
                ))}
              </Row>
            </StandardCard>
          ) : null}
          <StandardCard style={{ paddingVertical: theme.spacing.xs }}>
            {rows.length === 0 ? (
              <Text tone="muted" style={{ paddingVertical: theme.spacing.md }}>
                {view.clients.length === 0 ? s.empty : s.emptyFilter}
              </Text>
            ) : (
              rows.map((c, index) => {
                const due = money.byClient.get(c.id) ?? 0n;
                const amount = due > 0n ? due : c.expectedValueMinor;
                const mine = money.docs.filter((d) => !d.deleted && d.clientId === c.id);
                const quotes = mine.filter((d) => d.docType === 'estimate').length;
                const bills = mine.filter((d) => d.docType === 'bill').length;
                const caption = [
                  quotes ? fill(s.quotesN, { n: quotes }) : null,
                  bills ? fill(s.billsN, { n: bills }) : null,
                ]
                  .filter(Boolean)
                  .join(' · ');
                return (
                  <ListRow
                    key={c.id}
                    title={c.name}
                    subtitle={caption || c.need || c.phone || undefined}
                    leading={<PersonAvatar name={c.name} size={40} />}
                    trailing={
                      <Row style={{ alignItems: 'center', gap: theme.spacing.xs }}>
                        <View style={{ alignItems: 'flex-end', gap: 2 }}>
                          {amount ? <Text style={{ fontWeight: '700' }}>{fmt(amount)}</Text> : null}
                          <StageChip stage={c.stage} />
                        </View>
                        <Pressable
                          ref={(r) => {
                            rowRefs.current.set(c.id, r);
                          }}
                          accessibilityRole="button"
                          accessibilityLabel={s.more}
                          hitSlop={8}
                          onPress={() =>
                            measureAnchor(
                              { current: rowRefs.current.get(c.id) ?? null },
                              (anchor) => setMenu({ id: c.id, anchor }),
                            )
                          }
                        >
                          <Ionicons
                            name="ellipsis-vertical"
                            size={20}
                            color={theme.color.textMuted}
                          />
                        </Pressable>
                      </Row>
                    }
                    onPress={() => router.push(`/group/${groupId}/company-client?clientId=${c.id}`)}
                    divider={index < rows.length - 1}
                  />
                );
              })
            )}
          </StandardCard>
        </ScenicBody>
      </ScrollView>
      <OverflowMenu
        visible={menu !== null && menuItems.length > 0}
        onClose={() => setMenu(null)}
        items={menuItems}
        anchor={menu?.anchor ?? null}
      />
    </Screen>
  );
}
