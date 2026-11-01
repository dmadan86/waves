import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import { clientCounts, filterClients, type ClientFilter } from '@waves/core';
import { Screen, Text, useTheme } from '@waves/ui';

import { SaveButton } from '@/components/company/EntryForm';
import { useMoney } from '@/components/company/dashboard/parts';
import { StageChip } from '@/components/company/clients/parts';
import { PersonAvatar } from '@/components/PersonAvatar';
import {
  ListRow,
  ScenicBody,
  ScenicHeader,
  SegmentedPills,
  StandardCard,
} from '@/components/standard';
import { useClientMoney, useCompanyClients, useFollowUps } from '@/data/companyClients';
import { useCompanySuspended } from '@/data/companyEntries';
import { fill, useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';
import { companyOverviewRoute } from '@/lib/companyTab';
import { router } from '@/lib/navigation';

/** Clients and inquiries: one list with a stage chip per row and filter chips on top. */
export function ClientsList({ groupId }: { groupId: string }) {
  const theme = useTheme();
  const { t } = useStrings();
  const s = t.companyClients;
  const clearance = useBottomClearance();
  const view = useCompanyClients(groupId);
  const suspended = useCompanySuspended(groupId);
  const money = useClientMoney(groupId);
  const followUps = useFollowUps(groupId);
  const fmt = useMoney(view.currency);
  const [filter, setFilter] = useState<ClientFilter>('all');
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const counts = clientCounts(view.clients);
  const rows = filterClients(view.clients, filter, query);
  const chips: { value: ClientFilter; label: string }[] = [
    { value: 'all', label: `${s.fAll} ${counts.all}` },
    { value: 'inquiry', label: `${s.fInquiry} ${counts.inquiry}` },
    { value: 'quoted', label: `${s.fQuoted} ${counts.quoted}` },
    { value: 'client', label: `${s.fClient} ${counts.client}` },
    ...(counts.lost ? [{ value: 'lost' as const, label: `${s.fLost} ${counts.lost}` }] : []),
  ];
  const banner = [
    followUps.dueToday ? fill(s.bannerToday, { n: followUps.dueToday }) : null,
    followUps.overdue ? fill(s.bannerOverdue, { n: followUps.overdue }) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Screen edges={[]}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: clearance + 84 }}
      >
        <ScenicHeader
          title={s.title}
          onBack={() => router.replace(companyOverviewRoute(groupId, 'back') as never)}
          action={
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={s.search}
              hitSlop={8}
              onPress={() => {
                setSearching(!searching);
                setQuery('');
              }}
            >
              <Ionicons name="search" size={22} color={theme.color.text} />
            </Pressable>
          }
        />
        <ScenicBody>
          {money.total > 0n || banner ? (
            <StandardCard style={{ gap: theme.spacing.sm }}>
              {money.total > 0n ? (
                <View>
                  <Text variant="caption" tone="muted" style={{ fontWeight: '600' }}>
                    {s.toReceive}
                  </Text>
                  <Text variant="heading">{fmt(money.total)}</Text>
                </View>
              ) : null}
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
                  {banner || s.bannerNone}
                </Text>
                <Ionicons name="chevron-forward" size={16} color={theme.color.warning} />
              </Pressable>
            </StandardCard>
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
          <StandardCard style={{ paddingVertical: theme.spacing.xs }}>
            {rows.length === 0 ? (
              <Text tone="muted" style={{ paddingVertical: theme.spacing.md }}>
                {view.clients.length === 0 ? s.empty : s.emptyFilter}
              </Text>
            ) : (
              rows.map((c, index) => {
                const due = money.byClient.get(c.id);
                const amount = due ?? c.expectedValueMinor ?? undefined;
                return (
                  <ListRow
                    key={c.id}
                    title={c.name}
                    subtitle={[c.need ?? c.phone, view.memberName(c.ownerMemberId)]
                      .filter(Boolean)
                      .join(' · ')}
                    leading={<PersonAvatar name={c.name} size={40} />}
                    amount={amount ? fmt(amount) : undefined}
                    trailing={<StageChip stage={c.stage} />}
                    onPress={() => router.push(`/group/${groupId}/company-client?clientId=${c.id}`)}
                    divider={index < rows.length - 1}
                  />
                );
              })
            )}
          </StandardCard>
        </ScenicBody>
      </ScrollView>
      {view.canAdd && !suspended ? (
        <View style={{ position: 'absolute', left: 16, right: 16, bottom: clearance }}>
          <SaveButton
            label={s.newInquiry}
            disabled={false}
            onPress={() => router.push(`/group/${groupId}/company-client-add`)}
          />
        </View>
      ) : null}
    </Screen>
  );
}
