/** Big bills this year: the next twelve months of costs that do not come every month, and a way to save for them. */

import { useMemo, useState } from 'react';
import { randomUUID } from 'expo-crypto';
import { ScrollView, View } from 'react-native';

import { encodeRecurring } from '@waves/core';
import { Button, Row, Screen, Text, useTheme } from '@waves/ui';

import { BIG_ONE_OFF_UNITS, useDueMoney } from '@/components/home/ComingUpHome';
import { EmptyCard, PlainHeader, SectionHeader, StandardCard } from '@/components/standard';
import { useRentalStore } from '@/data/personalWealth';
import { useComingUp } from '@/data/useComingUp';
import { fill, useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';
import { bigBills, bigBillsStatus, FUND_CATEGORY } from '@/lib/moneyCalendar';

export function BigBills({
  groupId,
  ledgerGroupId,
  currency,
}: {
  groupId?: string;
  /** The space whose records hold the saving rule; absent in a space with none (nothing to save into). */
  ledgerGroupId?: string;
  currency?: string;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const c = t.comingUp;
  const clearance = useBottomClearance();
  const { sources, dc, today, fund, fundRules } = useComingUp({ groupId, ledgerGroupId, currency });
  const fmt = useDueMoney(dc);
  const store = useRentalStore(ledgerGroupId);
  const [saving, setSaving] = useState(false);
  const big = useMemo(
    () => bigBills(sources, today, dc, BIG_ONE_OFF_UNITS * 100n),
    [sources, today, dc],
  );
  const status = bigBillsStatus(big.occurrences, fund);
  const started = fundRules.size > 0;
  const canSave = (!groupId || !!ledgerGroupId) && big.perMonth > 0n && !started;
  const peak = big.monthTotals.reduce((m, v) => (v > m ? v : m), 0n);
  const startMonth = Number(today.slice(5, 7)) - 1;
  const initial = new Intl.DateTimeFormat(locale, { month: 'narrow', timeZone: 'UTC' });
  const when = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' });

  const start = async (): Promise<void> => {
    setSaving(true);
    try {
      await store.upsert(
        randomUUID(),
        'recurring',
        encodeRecurring({
          txnKind: 'expense',
          amount: big.perMonth,
          currency: dc as never,
          category: FUND_CATEGORY,
          note: c.fundNote,
          cadence: 'monthly',
          interval: 1,
          secondDay: null,
          anchorDate: today,
          nextDate: today,
          endDate: null,
          autoPost: false,
          active: true,
        }),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen edges={[]}>
      <PlainHeader title={c.bigTitle} subtitle={c.bigScreenSub} />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: clearance + theme.spacing.xl,
          gap: theme.spacing.md,
        }}
        showsVerticalScrollIndicator={false}
      >
        {big.total === 0n ? (
          <EmptyCard icon="umbrella-outline" title={c.nothingBig} helper={c.bigEmptyHelp} />
        ) : (
          <>
            <StandardCard style={{ gap: theme.spacing.md }}>
              <Text variant="caption" tone="muted">
                {c.bigNext12}
              </Text>
              <Text style={{ fontSize: 32, lineHeight: 38, fontWeight: '800' }}>
                {fmt(big.total)}
              </Text>
              <Row
                style={{
                  alignItems: 'center',
                  gap: theme.spacing.md,
                  padding: theme.spacing.md,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.color.positiveSoft,
                }}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text
                    variant="caption"
                    style={{ color: theme.color.positive, fontWeight: '600' }}
                  >
                    {c.setAsideEach}
                  </Text>
                  <Text style={{ fontSize: 20, fontWeight: '800', color: theme.color.positive }}>
                    {fmt(big.perMonth)}
                  </Text>
                </View>
                {started ? (
                  <Text
                    variant="caption"
                    style={{ color: theme.color.positive, fontWeight: '700' }}
                  >
                    {c.savingOn}
                  </Text>
                ) : canSave ? (
                  <Button
                    label={c.startSaving}
                    size="sm"
                    disabled={saving}
                    onPress={() => void start()}
                  />
                ) : null}
              </Row>
              <Text variant="caption" tone="muted">
                {fill(c.setAsideSoFar, { amount: fmt(fund), pct: Math.round(status.ratio * 100) })}
              </Text>
              <View
                accessible
                accessibilityRole="progressbar"
                accessibilityValue={{ min: 0, max: 100, now: Math.round(status.ratio * 100) }}
                style={{
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: theme.color.surfaceMuted,
                  overflow: 'hidden',
                }}
              >
                <View
                  style={{
                    width: `${Math.round(status.ratio * 100)}%`,
                    height: 8,
                    backgroundColor: theme.color.positive,
                  }}
                />
              </View>
            </StandardCard>

            <SectionHeader title={c.byMonth} />
            <StandardCard>
              <Row style={{ alignItems: 'flex-end', gap: 6, height: 124 }}>
                {big.monthTotals.map((v, i) => {
                  const heavy = peak > 0n && v * 10n >= peak * 7n;
                  const h = peak > 0n ? Math.max(Number((v * 100n) / peak), v > 0n ? 4 : 2) : 2;
                  const m = (startMonth + i) % 12;
                  return (
                    <View key={i} style={{ flex: 1, alignItems: 'center', gap: 6 }}>
                      <View
                        accessible
                        accessibilityLabel={`${when.format(new Date(Date.UTC(2024, m, 1)))} ${fmt(v)}`}
                        style={{
                          width: '100%',
                          height: h,
                          borderRadius: 6,
                          backgroundColor: heavy ? theme.color.brand : theme.color.brandSoft,
                        }}
                      />
                      <Text variant="micro" tone="muted">
                        {initial.format(new Date(Date.UTC(2024, m, 1)))}
                      </Text>
                    </View>
                  );
                })}
              </Row>
            </StandardCard>

            <StandardCard style={{ paddingVertical: theme.spacing.xs }}>
              {big.items.map((item, i) => (
                <Row
                  key={item.sourceId}
                  style={{
                    alignItems: 'center',
                    gap: theme.spacing.md,
                    paddingVertical: theme.spacing.sm,
                    borderBottomWidth: i === big.items.length - 1 ? 0 : 1,
                    borderBottomColor: theme.color.border,
                  }}
                >
                  <View
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 18,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: theme.color.brandSoft,
                    }}
                  >
                    <Text style={{ fontSize: 13, fontWeight: '700' }}>
                      {item.title.slice(0, 2).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ fontWeight: '700' }}>
                      {item.title}
                    </Text>
                    <Text variant="caption" tone="muted" numberOfLines={1}>
                      {item.dates.map((d) => when.format(new Date(`${d}T00:00:00Z`))).join(', ')}
                    </Text>
                  </View>
                  <Text style={{ fontWeight: '700' }}>{fmt(item.total)}</Text>
                </Row>
              ))}
            </StandardCard>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
