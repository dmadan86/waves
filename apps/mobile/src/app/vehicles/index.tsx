/** Vehicles: the driving licence, this month's spend, and one card per vehicle. */

import { useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, View } from 'react-native';

import { Button, directionalIcon, iconSize, Row, Screen, Text, useTheme } from '@waves/ui';

import { PersonalGuard } from '@/components/PersonalGuard';
import { PlainHeader, StandardCard } from '@/components/standard';
import { StatusPill, useWealthMoney } from '@/components/wealth/parts';
import { todayIso, usePersonalLedger } from '@/data/personal';
import { useSpaceName } from '@/data/personalWealth';
import { useOwnVehicleCount, usePersonalVehicles } from '@/data/vehicles';
import { fill, useStrings } from '@/i18n';
import { PressableScale, Stagger } from '@/lib/anim';
import { useAuth } from '@/lib/auth';
import { useBottomClearance } from '@/lib/clearance';
import { useDefaultCurrency } from '@/lib/currency';
import { showDate } from '@/lib/expenseDay';
import { router } from '@/lib/navigation';
import { isFormer } from '@/e2ee/space';
import { spaceParams } from '@/lib/rentalScope';
import { useEntitlement } from '@/lib/useEntitlement';
import { dueSoon, monthSpend, atVehicleLimit } from '@/lib/vehiclePlan';
import { dueText } from '@/lib/vehicleText';
import { regionOf } from '@/lib/wealthPlan';
import { VEHICLE_ICON } from '@/lib/wizardIcons';

function VehiclesBody() {
  const theme = useTheme();
  const clearance = useBottomClearance();
  const { t, locale } = useStrings();
  const v = t.vehicles;
  const fmt = useWealthMoney();
  const dc = useDefaultCurrency();
  const { profile } = useAuth();
  const region = regionOf(profile?.country_code);
  const { space } = useLocalSearchParams<{ space?: string }>();
  const subtitle = useSpaceName(space);
  const ledger = usePersonalLedger(space);
  const { vehicles, licences } = usePersonalVehicles(space);
  const ownCount = useOwnVehicleCount(space);
  const { isPro } = useEntitlement();
  const today = todayIso();
  const month = today.slice(0, 7);
  const active = vehicles.filter((x) => x.status === 'active');
  const limit = atVehicleLimit(ownCount, isPro);
  const readOnly = isFormer(space ?? '');
  const add = (): void =>
    router.push(limit ? '/paywall' : { pathname: '/vehicles/add', params: spaceParams(space) });
  const total = monthSpend(ledger.txns, null, month, dc);
  const licence = licences[0] ?? null;

  const addButton = readOnly ? undefined : (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={v.addVehicle}
      hitSlop={10}
      onPress={add}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}
    >
      <Ionicons name="add" size={iconSize.lg} color={theme.color.brand} />
      <Text variant="body" style={{ color: theme.color.brand, fontWeight: '700' }}>
        {v.addShort}
      </Text>
    </Pressable>
  );
  const openLicence = (): void =>
    router.push({
      pathname: '/vehicles/licence',
      params: { ...(licence ? { id: licence.id } : {}), ...spaceParams(space) },
    });
  const licenceRow = (
    <PressableScale
      pressedScale={0.98}
      accessibilityRole="button"
      accessibilityLabel={
        licence?.expiry
          ? fill(v.licenceExpires, { date: showDate(licence.expiry, locale) })
          : v.addLicence
      }
      onPress={openLicence}
    >
      <StandardCard>
        <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
          <Ionicons name="card-outline" size={iconSize.lg} color={theme.color.brand} />
          <Text variant="body" numberOfLines={2} style={{ flex: 1, fontWeight: '600' }}>
            {licence
              ? licence.expiry
                ? fill(v.licenceExpires, { date: showDate(licence.expiry, locale) })
                : v.licence
              : v.addLicence}
          </Text>
          <Ionicons
            name={directionalIcon('chevron-forward')}
            size={iconSize.md}
            color={theme.color.textMuted}
          />
        </Row>
      </StandardCard>
    </PressableScale>
  );

  if (active.length === 0) {
    return (
      <Screen edges={[]}>
        <PlainHeader title={v.vehicles} subtitle={subtitle} />
        <ScrollView
          contentContainerStyle={{
            padding: theme.spacing.lg,
            paddingBottom: clearance + theme.spacing.xl,
            gap: theme.spacing.md,
          }}
        >
          {licenceRow}
          <View
            style={{ alignItems: 'center', gap: theme.spacing.md, paddingTop: theme.spacing.xl }}
          >
            <Ionicons name="car-outline" size={88} color={theme.color.brand} />
            <Text variant="title" style={{ fontWeight: '800', textAlign: 'center' }}>
              {v.trackTitle}
            </Text>
            <Text variant="body" tone="muted" style={{ textAlign: 'center' }}>
              {v.trackSub}
            </Text>
            {readOnly ? null : <Button label={v.addVehicle} onPress={add} />}
          </View>
        </ScrollView>
      </Screen>
    );
  }

  return (
    <Screen edges={[]}>
      <PlainHeader title={v.vehicles} subtitle={subtitle} trailing={addButton} />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: clearance + theme.spacing.xl,
          gap: theme.spacing.md,
        }}
      >
        <Stagger index={0}>{licenceRow}</Stagger>
        <Stagger index={1}>
          <StandardCard style={{ gap: theme.spacing.xs }}>
            <Text variant="body" style={{ fontWeight: '700' }}>
              {v.thisMonth}
            </Text>
            <Text variant="title" style={{ fontWeight: '800' }}>
              {fmt(total, dc)}
            </Text>
            <Text variant="caption" tone="muted">
              {fill(v.vehiclesCount, { n: active.length })}
            </Text>
          </StandardCard>
        </Stagger>
        {active.map((x, i) => {
          const cur = x.currency || dc;
          const due = dueSoon(x, today)[0];
          return (
            <Stagger key={x.id} index={i + 2}>
              <PressableScale
                pressedScale={0.98}
                accessibilityRole="button"
                accessibilityLabel={x.name}
                onPress={() =>
                  router.push({
                    pathname: '/vehicles/[id]',
                    params: { id: x.id, ...spaceParams(space) },
                  })
                }
              >
                <StandardCard style={{ gap: theme.spacing.md }}>
                  <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
                    <View
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: theme.radius.sm,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: theme.color.brandSoft,
                      }}
                    >
                      <Ionicons
                        name={VEHICLE_ICON[x.type]}
                        size={iconSize.lg}
                        color={theme.color.brand}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text variant="body" numberOfLines={1} style={{ fontWeight: '700' }}>
                        {x.name}
                      </Text>
                      <Text variant="caption" tone="muted" numberOfLines={1}>
                        {[x.registration, v.types[x.type]].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text variant="caption" tone="muted">
                        {v.thisMonth}
                      </Text>
                      <Text variant="body" style={{ fontWeight: '700' }}>
                        {fmt(monthSpend(ledger.txns, x.id, month, cur), cur)}
                      </Text>
                    </View>
                  </Row>
                  {due ? (
                    <StatusPill
                      label={dueText(v, due, region)}
                      tone={due.inDays < 0 ? 'negative' : 'warning'}
                    />
                  ) : null}
                </StandardCard>
              </PressableScale>
            </Stagger>
          );
        })}
        {limit ? (
          <Text variant="caption" tone="muted">
            {v.freeLimit}
          </Text>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

export default function VehiclesScreen() {
  return (
    <PersonalGuard>
      <VehiclesBody />
    </PersonalGuard>
  );
}
