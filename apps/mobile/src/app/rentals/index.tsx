/** Rentals: what came in this month, and one card per property. */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, View } from 'react-native';

import { leaseEndsIn } from '@waves/core';
import { Button, IconButton, iconSize, Row, Screen, Text, useTheme } from '@waves/ui';

import { PersonalGuard } from '@/components/PersonalGuard';
import { PlainHeader, StandardCard } from '@/components/standard';
import { StatusPill, useWealthMoney, type PillTone } from '@/components/wealth/parts';
import { todayIso, usePersonalLedger } from '@/data/personal';
import { usePersonalWealth } from '@/data/personalWealth';
import { fill, useStrings } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { useBottomClearance } from '@/lib/clearance';
import { useDefaultCurrency } from '@/lib/currency';
import { router } from '@/lib/navigation';
import { useEntitlement } from '@/lib/useEntitlement';
import { atPropertyLimit, depositTerm, monthRent, propertyView, regionOf } from '@/lib/wealthPlan';

export const STATUS_TONE: Record<string, PillTone> = {
  paid: 'positive',
  part: 'warning',
  due: 'neutral',
  overdue: 'negative',
  vacant: 'neutral',
};

function RentalsBody() {
  const theme = useTheme();
  const clearance = useBottomClearance();
  const { t } = useStrings();
  const w = t.wealth;
  const fmt = useWealthMoney();
  const dc = useDefaultCurrency();
  const { profile } = useAuth();
  const term = w.depositNouns[depositTerm(regionOf(profile?.country_code))];
  const ledger = usePersonalLedger();
  const { properties, tenancies } = usePersonalWealth();
  const { isPro } = useEntitlement();
  const today = todayIso();

  const active = properties.filter((p) => p.status === 'active');
  const views = active.map((p) => ({
    p,
    v: propertyView(p, tenancies, ledger.recurrings, ledger.txns, today),
  }));
  const sum = monthRent(
    views.filter((x) => (x.p.currency || dc) === dc).map((x) => x.v),
    ledger.txns,
    today.slice(0, 7),
  );
  const limit = atPropertyLimit(active.length, isPro);
  const add = (): void => router.push(limit ? '/paywall' : '/rentals/add');
  const statusText: Record<string, string> = {
    paid: w.statusPaid,
    part: w.statusPart,
    due: w.statusDue,
    overdue: w.statusOverdue,
    vacant: w.statusVacant,
  };

  return (
    <Screen edges={[]}>
      <PlainHeader
        title={w.rentals}
        trailing={
          <IconButton label={w.addRental} onPress={add}>
            <Ionicons name="add" size={iconSize.xl} color={theme.color.brand} />
          </IconButton>
        }
      />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: clearance + theme.spacing.xl,
          gap: theme.spacing.md,
        }}
      >
        {active.length > 0 ? (
          <StandardCard>
            <Text variant="body" style={{ fontWeight: '700' }}>
              {fill(w.receivedOf, { received: fmt(sum.received, dc), due: fmt(sum.expected, dc) })}
            </Text>
          </StandardCard>
        ) : (
          <StandardCard style={{ gap: theme.spacing.md }}>
            <Text variant="caption" tone="muted">
              {w.emptyRentals}
            </Text>
            <Button label={w.addRental} onPress={add} />
          </StandardCard>
        )}

        {views.map(({ p, v }) => {
          const cur = p.currency || dc;
          const tn = v.tenancy;
          const lease = tn ? leaseEndsIn(tn.endDate, today, 60) : null;
          const part = v.balance.lines.find((l) => l.status === 'part');
          return (
            <Pressable
              key={p.id}
              accessibilityRole="button"
              accessibilityLabel={p.name}
              onPress={() => router.push({ pathname: '/rentals/[id]', params: { id: p.id } })}
            >
              <StandardCard style={{ gap: theme.spacing.sm }}>
                <Row style={{ alignItems: 'center', justifyContent: 'space-between' }}>
                  <View style={{ flex: 1 }}>
                    <Text variant="body" style={{ fontWeight: '700' }}>
                      {p.name}
                    </Text>
                    <Text variant="caption" tone="muted">
                      {tn ? tn.tenantName : w.vacantNote}
                    </Text>
                  </View>
                  <StatusPill
                    label={statusText[v.status] ?? ''}
                    tone={STATUS_TONE[v.status] ?? 'neutral'}
                  />
                </Row>
                {part ? (
                  <Text variant="caption">
                    {fill(w.partLine, {
                      paid: fmt(part.paid, cur),
                      due: fmt(part.amount, cur),
                      left: fmt(part.amount - part.paid, cur),
                    })}
                  </Text>
                ) : null}
                {tn && v.balance.balance > 0n ? (
                  <Text variant="caption">
                    {fill(w.rentOwed, { amount: fmt(v.balance.balance, cur) })}
                  </Text>
                ) : null}
                {tn && tn.depositHeld > 0n ? (
                  <Text variant="caption" tone="muted">
                    {fill(w.depositLine, { amount: fmt(tn.depositHeld, cur), term })}
                  </Text>
                ) : null}
                {lease !== null ? (
                  <StatusPill label={fill(w.leaseEndsIn, { n: lease })} tone="warning" />
                ) : null}
              </StandardCard>
            </Pressable>
          );
        })}
        {limit ? (
          <Text variant="caption" tone="muted">
            {w.freeRentalLimit}
          </Text>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

export default function RentalsScreen() {
  return (
    <PersonalGuard>
      <RentalsBody />
    </PersonalGuard>
  );
}
