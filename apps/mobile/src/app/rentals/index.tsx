/** Rentals: what came in this month, who owes now with Remind / Mark paid on the row, and the properties. */

import { useState, type ReactElement } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';

import {
  Button,
  directionalIcon,
  iconSize,
  initialsOf,
  Row,
  Screen,
  Text,
  useTheme,
} from '@waves/ui';

import { FormerCouples, NewPhoneNotice } from '@/components/couple/CoupleRentalsExtras';
import { PersonalGuard } from '@/components/PersonalGuard';
import { isFormer } from '@/e2ee/space';
import { ListCard, ListItem, LIST_TILE, PlainHeader } from '@/components/standard';
import { CalmHeader, CalmIconButton } from '@/components/calm/CalmHeader';
import { DoneLine } from '@/components/calm/DoneLine';
import { NeedRow, NeedsYouCard } from '@/components/calm/NeedsYouCard';
import { NudgeRow } from '@/components/calm/NudgeRow';
import { SummaryLine } from '@/components/calm/SummaryLine';
import { useRentActions } from '@/components/calm/useRentActions';
import { rentItems } from '@/lib/calm/rentDue';
import { dueNow, leaseNudge, nameList, paidTenancies } from '@/lib/calm/rentSummary';
import { monthLabel } from '@/lib/monthNav';
import { StatusPill, useWealthMoney, type PillTone } from '@/components/wealth/parts';
import { todayIso, usePersonalLedger } from '@/data/personal';
import {
  useOwnPropertyCount,
  usePersonalWealth,
  useSpaceName,
  useSpaceType,
} from '@/data/personalWealth';
import { fill, plural, useStrings } from '@/i18n';
import { houseEntering, EASE_OUT, popEntering } from '@/lib/anim';
import { useBottomClearance } from '@/lib/clearance';
import { useDefaultCurrency } from '@/lib/currency';
import { router } from '@/lib/navigation';
import { e2eeNoteFor, spaceParams } from '@/lib/rentalScope';
import { useReducedMotion } from '@/lib/reducedMotion';
import { useEntitlement } from '@/lib/useEntitlement';
import { PROPERTY_ICON } from '@/lib/wizardIcons';
import { atPropertyLimit, monthRent, monthTotals, propertyView } from '@/lib/wealthPlan';

export const STATUS_TONE: Record<string, PillTone> = {
  paid: 'positive',
  part: 'warning',
  due: 'negative',
  overdue: 'negative',
  vacant: 'neutral',
};

const fadeUp = (delay: number) => FadeInDown.duration(260).easing(EASE_OUT).delay(delay);

function RentalsBody() {
  const theme = useTheme();
  const reduce = useReducedMotion();
  const clearance = useBottomClearance();
  const { t, locale } = useStrings();
  const w = t.wealth;
  const fmt = useWealthMoney();
  const dc = useDefaultCurrency();
  const { space } = useLocalSearchParams<{ space?: string }>();
  const subtitle = useSpaceName(space);
  const spaceType = useSpaceType(space);
  const ledger = usePersonalLedger(space);
  const { properties, tenancies } = usePersonalWealth(space);
  const ownCount = useOwnPropertyCount(space);
  const { isPro } = useEntitlement();
  const today = todayIso();
  const actions = useRentActions(space, today);
  const [showAll, setShowAll] = useState(false);

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
  const limit = atPropertyLimit(ownCount, isPro);
  // A former couple is a read-only copy: nothing to add.
  const readOnly = isFormer(space ?? '');
  const add = (): void =>
    router.push(limit ? '/paywall' : { pathname: '/rentals/add', params: spaceParams(space) });
  const statusText: Record<string, string> = {
    paid: w.statusPaid,
    part: w.statusPart,
    due: w.statusDue,
    overdue: w.statusOverdue,
    vacant: w.statusVacant,
  };

  const totals = monthTotals(sum.received, sum.expected);
  const pill = (status: string): ReactElement => (
    <StatusPill label={statusText[status] ?? ''} tone={STATUS_TONE[status] ?? 'neutral'} />
  );
  // Only in a couple/home space: what is said there is read by its members alone.
  const lock = space ? (
    <Row style={{ alignItems: 'center', justifyContent: 'center', gap: theme.spacing.xs }}>
      <Ionicons name="lock-closed-outline" size={iconSize.sm} color={theme.color.textMuted} />
      <Text variant="micro" tone="muted" style={{ flexShrink: 1, textAlign: 'center' }}>
        {e2eeNoteFor(w, spaceType)}
      </Text>
    </Row>
  ) : null;

  if (active.length === 0) {
    return (
      <Screen edges={[]}>
        <PlainHeader title={w.rentals} subtitle={subtitle} />
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            gap: theme.spacing.md,
            paddingHorizontal: theme.spacing.xl,
            paddingBottom: clearance + theme.spacing.xl,
          }}
        >
          <View style={{ width: 120, height: 110 }}>
            <Animated.View entering={reduce ? undefined : houseEntering}>
              <Ionicons name="home-outline" size={96} color={theme.color.brand} />
            </Animated.View>
            <Animated.View
              entering={reduce ? undefined : popEntering(160)}
              style={{
                position: 'absolute',
                end: 0,
                bottom: 0,
                width: 52,
                height: 52,
                borderRadius: 26,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: theme.color.bg,
              }}
            >
              <Ionicons name="key-outline" size={40} color={theme.color.brand} />
            </Animated.View>
          </View>
          <Animated.View entering={reduce ? undefined : fadeUp(240)}>
            <Text variant="title" style={{ fontWeight: '800', textAlign: 'center' }}>
              {w.trackRentTitle}
            </Text>
          </Animated.View>
          <Animated.View entering={reduce ? undefined : fadeUp(300)}>
            <Text variant="body" tone="muted" style={{ textAlign: 'center' }}>
              {w.trackRentSub}
            </Text>
          </Animated.View>
          {readOnly ? null : (
            <Animated.View
              entering={reduce ? undefined : fadeUp(360)}
              style={{ alignSelf: 'center', width: '70%', marginTop: theme.spacing.md }}
            >
              <Button label={w.addProperty} fullWidth onPress={add} />
            </Animated.View>
          )}
          {lock}
          {space ? null : <FormerCouples />}
        </View>
      </Screen>
    );
  }

  const items = rentItems({
    properties: active,
    tenancies,
    recurrings: ledger.recurrings,
    txns: ledger.txns,
    today,
    horizonDays: 7,
    fallbackCurrency: dc,
  });
  const activeTenancies = views.flatMap(({ v }) => (v.tenancy ? [v.tenancy] : []));
  const due = dueNow(items, dc);
  const paid = paidTenancies(activeTenancies, items);
  const lease = readOnly ? null : leaseNudge(activeTenancies, today);
  const c = t.calm;
  const shortDate = (iso: string): string =>
    new Date(`${iso}T12:00:00`).toLocaleDateString(locale, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
  const names = nameList(
    paid.map((x) => x.tenantName),
    (parts) => {
      try {
        return new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(parts);
      } catch {
        return parts.join(', ');
      }
    },
    (n) => fill(c.andMore, { n: String(n) }),
  );
  const open = (id: string): void =>
    router.push({ pathname: '/rentals/[id]', params: { id, ...spaceParams(space) } });
  const shownViews = showAll ? views : views.slice(0, 3);

  return (
    <Screen edges={[]}>
      <CalmHeader
        dateLine={monthLabel(today.slice(0, 7), locale)}
        title={w.rentals}
        onBack={() => router.back()}
      >
        {readOnly ? null : <CalmIconButton icon="add" label={w.addRental} onPress={add} />}
      </CalmHeader>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: clearance + theme.spacing.xl,
          gap: theme.spacing.md,
        }}
      >
        {lock}
        <NewPhoneNotice groupId={space} />
        <SummaryLine
          text={fill(c.rentCollected, {
            received: fmt(sum.received, dc),
            expected: fmt(sum.expected, dc),
            paid: String(paid.length),
            count: String(activeTenancies.length),
          })}
          ratio={totals.percent / 100}
        />

        {items.length > 0 ? (
          <NeedsYouCard title={fill(c.dueNow, { total: fmt(due.total, dc) })}>
            {items.map((r) => {
              const amount = fmt(r.amount, r.currency);
              return (
                <NeedRow
                  key={r.key}
                  icon="person-outline"
                  leading={<Avatar name={r.tenant} />}
                  title={fill(c.rentRowTitle, { tenant: r.tenant, unit: r.unit })}
                  subtitle={
                    r.inDays < 0
                      ? plural(locale, -r.inDays, c.billOverdue).replaceAll('{amount}', amount)
                      : r.inDays === 0
                        ? fill(c.rentRowDue, { amount, date: t.personal.today.toLowerCase() })
                        : fill(c.rentRowDue, { amount, date: shortDate(r.dueDate) })
                  }
                  subtitleTone={r.inDays < 0 ? 'negative' : 'muted'}
                  actions={
                    readOnly
                      ? []
                      : [
                          { label: c.remind, onPress: () => actions.remind(r, amount) },
                          {
                            label: c.markPaid,
                            primary: true,
                            accessibilityLabel: `${c.markPaid}, ${r.tenant}`,
                            onPress: () => actions.markReceived(r),
                          },
                        ]
                  }
                />
              );
            })}
          </NeedsYouCard>
        ) : (
          <View style={{ gap: 2, paddingVertical: theme.spacing.sm }}>
            <Text variant="subheading">{c.allSet}</Text>
            <Text variant="caption" tone="muted">
              {c.allSetHelp}
            </Text>
          </View>
        )}

        {paid.length > 0 ? <DoneLine text={fill(c.paidInFull, { names })} /> : null}

        {lease ? (
          <NudgeRow
            title={fill(c.leaseEnds, {
              unit: lease.tenancy.unit ?? '',
              date: shortDate(lease.tenancy.endDate ?? today),
            })}
            body={plural(locale, lease.days, c.leaseAway).replaceAll(
              '{tenant}',
              lease.tenancy.tenantName,
            )}
            action={c.renew}
            onAction={() => open(lease.tenancy.propertyId)}
          />
        ) : null}

        <Text accessibilityRole="header" variant="subheading">
          {fill(c.properties, { n: String(active.length) })}
        </Text>
        <ListCard>
          {shownViews.map(({ p, v }, i) => (
            <ListItem
              key={p.id}
              divider={i > 0}
              accessibilityLabel={p.name}
              onPress={() => open(p.id)}
              leading={
                <View
                  style={{
                    width: LIST_TILE,
                    height: LIST_TILE,
                    borderRadius: theme.radius.md,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: theme.color.brandSoft,
                  }}
                >
                  <Ionicons
                    name={PROPERTY_ICON[p.type]}
                    size={iconSize.md}
                    color={theme.color.brand}
                  />
                </View>
              }
              title={p.name}
              subtitle={`${w.propertyTypes[p.type]} · ${v.tenancy ? v.tenancy.tenantName : w.vacantNote}`}
              trailing={pill(v.status)}
              chevron
            />
          ))}
        </ListCard>
        {views.length > 3 ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setShowAll((x) => !x)}
            style={{ minHeight: 36, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text variant="body" tone="brand" style={{ fontWeight: '600' }}>
              {showAll ? c.showLess : fill(c.showMore, { n: String(views.length - 3) })}
            </Text>
          </Pressable>
        ) : null}
        {limit ? (
          <Text variant="caption" tone="muted">
            {w.freeRentalLimit}
          </Text>
        ) : null}
        {space ? null : <FormerCouples />}
      </ScrollView>
    </Screen>
  );
}

function Avatar({ name }: { name: string }) {
  const theme = useTheme();
  return (
    <View
      style={{
        width: LIST_TILE,
        height: LIST_TILE,
        borderRadius: LIST_TILE / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.color.brandSoft,
      }}
    >
      <Text variant="caption" tone="brand" style={{ fontWeight: '700' }}>
        {initialsOf(name)}
      </Text>
    </View>
  );
}

export default function RentalsScreen() {
  return (
    <PersonalGuard>
      <RentalsBody />
    </PersonalGuard>
  );
}
