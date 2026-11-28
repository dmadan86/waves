/** One vehicle: expenses, what is due, details, renewals and papers. */

import { useEffect, useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSharedValue } from 'react-native-reanimated';

import type { PersonalVehicle, VehicleRenewal } from '@waves/core';
import { Button, IconButton, iconSize, Row, Screen, Text, useTheme } from '@waves/ui';

import { OverflowMenu, type OverflowMenuItem } from '@/components/OverflowMenu';
import { PersonalGuard } from '@/components/PersonalGuard';
import {
  ListCard,
  ListItem,
  PlainHeader,
  RowTile,
  SectionHeader,
  StandardCard,
} from '@/components/standard';
import { StatusPill, RenameSheet, useWealthMoney } from '@/components/wealth/parts';
import { DocumentsCard } from '@/components/wealth/RentalExtras';
import { ExpenseSheet, FieldsSheet, RenewalSheet } from '@/components/wealth/VehicleSheets';
import { todayIso, usePersonalLedger } from '@/data/personal';
import { useGroups } from '@/data/hooks';
import { useRentalStore, useSpaceName, type RentalStore } from '@/data/personalWealth';
import { moveVehicle, usePersonalVehicles, useVehicleWrites } from '@/data/vehicles';
import { isFormer } from '@/e2ee/space';
import { fill, useStrings } from '@/i18n';
import { PressableScale } from '@/lib/anim';
import { useAuth } from '@/lib/auth';
import { useBottomClearance } from '@/lib/clearance';
import { useDefaultCurrency } from '@/lib/currency';
import { useDialog } from '@/lib/dialog';
import { showDate } from '@/lib/expenseDay';
import { router } from '@/lib/navigation';
import { deleteAllDocs } from '@/lib/propertyDocs';
import { hasGroupRentals } from '@/lib/rentalScope';
import { distanceUnit, dueSoon, monthSpend, spendStrip, vehicleTxns } from '@/lib/vehiclePlan';
import { dueText, kindName } from '@/lib/vehicleText';
import { regionOf } from '@/lib/wealthPlan';
import { VEHICLE_ICON, type IconName } from '@/lib/wizardIcons';

type Sheet =
  | { k: 'expense' }
  | { k: 'rename' }
  | { k: 'renewal'; r: VehicleRenewal | null }
  | { k: 'odometer' | 'notes' | 'regField' | 'makeModel' | 'year' }
  | { k: 'detail'; i: number | null }
  | null;

/** Runs one move once its target store is mounted (resumable: see lib/vehicleMove). */
function MoveRunner({
  vehicle,
  source,
  sourceSpace,
  space,
  from,
  onDone,
  onFail,
}: {
  vehicle: PersonalVehicle;
  source: RentalStore;
  sourceSpace: string | undefined;
  space: string | undefined;
  from: string;
  onDone: () => void;
  onFail: () => void;
}) {
  const target = useRentalStore(space);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    moveVehicle(vehicle, {
      source,
      target,
      sourceSpace: sourceSpace ?? null,
      targetSpace: space ?? null,
      from,
    }).then(onDone, onFail);
  }, [vehicle, source, target, sourceSpace, space, from, onDone, onFail]);
  return null;
}

function Line({
  icon,
  label,
  value,
  onPress,
  divider = true,
}: {
  icon: IconName;
  label: string;
  value: string;
  onPress?: () => void;
  divider?: boolean;
}) {
  const theme = useTheme();
  return (
    <ListItem
      divider={divider}
      accessibilityLabel={`${label} ${value}`}
      onPress={onPress}
      leading={
        <RowTile tint={theme.color.surfaceMuted}>
          <Ionicons name={icon} size={iconSize.md} color={theme.color.textMuted} />
        </RowTile>
      }
      title={label}
      subtitle={
        <Text variant="caption" tone="muted" numberOfLines={3}>
          {value}
        </Text>
      }
      chevron={!!onPress}
    />
  );
}

function DetailBody() {
  const theme = useTheme();
  const clearance = useBottomClearance();
  const { t, locale } = useStrings();
  const v = t.vehicles;
  const { confirm, choose } = useDialog();
  const fmt = useWealthMoney();
  const dc = useDefaultCurrency();
  const { profile } = useAuth();
  const region = regionOf(profile?.country_code);
  const { id, space } = useLocalSearchParams<{ id: string; space?: string }>();
  const spaceName = useSpaceName(space);
  const ledger = usePersonalLedger(space);
  const { vehicles } = usePersonalVehicles(space);
  const writes = useVehicleWrites(space);
  const store = useRentalStore(space);
  const groups = useGroups().data;
  const [sheet, setSheet] = useState<Sheet>(null);
  const [menu, setMenu] = useState(false);
  const [jumpDocs, setJumpDocs] = useState(0);
  const [moveTo, setMoveTo] = useState<{ space: string | undefined } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scroll = useRef<ScrollView>(null);
  const docsY = useSharedValue(0);
  const [today] = useState(() => todayIso());

  useEffect(() => {
    if (jumpDocs === 0) return;
    scroll.current?.scrollTo({ y: docsY.get(), animated: true });
  }, [jumpDocs, docsY]);
  const veh = vehicles.find((x) => x.id === id);
  // No orphan sweep: records hydrate store by store and skip rows that cannot be read, so an
  // incomplete list is indistinguishable from "deleted". Folders go only on an explicit delete.
  if (!veh) {
    return (
      <Screen edges={[]}>
        <PlainHeader title={v.vehicles} />
      </Screen>
    );
  }
  const cur = veh.currency || dc;
  const unit = distanceUnit(region);
  const none = v.notSet;
  const due = dueSoon(veh, today);
  const txns = vehicleTxns(ledger.txns, veh.id).sort((a, b) => (a.date < b.date ? 1 : -1));
  const month = today.slice(0, 7);
  const strip = spendStrip(ledger.txns, veh.id, today, cur);
  const peak = strip.reduce((m, x) => (x.total > m ? x.total : m), 0n);
  const save = (patch: Partial<PersonalVehicle>): void =>
    void writes.saveVehicle({ ...veh, ...patch });
  const setRenewals = (renewals: VehicleRenewal[]): void => save({ renewals });
  const monthLetter = (m: string): string =>
    new Date(`${m}-01T12:00:00`).toLocaleDateString(locale, { month: 'narrow' });

  const destinations = [
    ...(space ? [{ id: '', name: v.personal }] : []),
    ...groups
      .filter((g) => hasGroupRentals(g.type) && g.id !== space && !isFormer(g.id))
      .map((g) => ({ id: g.id, name: g.name ?? '' })),
  ];
  const startMove = async (): Promise<void> => {
    if (destinations.length === 0) {
      setError(v.noSpaces);
      return;
    }
    const pick = await choose({
      title: v.moveTo,
      options: destinations.map((d) => ({ id: d.id || 'personal', label: d.name })),
    });
    const dest = destinations.find((d) => (d.id || 'personal') === pick);
    if (!dest) return;
    const ok = await confirm({
      title: fill(v.moveConfirm, { name: dest.name }),
      body: fill(v.moveBody, { where: space ? (spaceName ?? '') : v.personal }),
      confirmLabel: v.moveTo.replace('...', ''),
    });
    if (ok) setMoveTo({ space: dest.id || undefined });
  };

  const items: OverflowMenuItem[] = [
    {
      icon: 'create-outline',
      label: t.personal.editDetails,
      onPress: () => setSheet({ k: 'rename' }),
    },
    { icon: 'swap-horizontal-outline', label: v.moveTo, onPress: () => void startMove() },
    {
      icon: 'pricetag-outline',
      label: veh.status === 'active' ? v.markSold : v.markActive,
      onPress: () => save({ status: veh.status === 'active' ? 'sold' : 'active' }),
    },
    {
      icon: 'trash-outline',
      label: t.common.delete,
      tone: 'danger',
      onPress: () =>
        void (async () => {
          if (
            !(await confirm({
              title: t.common.delete,
              body: v.deleteBody,
              confirmLabel: t.common.delete,
              tone: 'danger',
            }))
          )
            return;
          await store.del(veh.id);
          await deleteAllDocs(veh.id);
          router.back();
        })(),
    },
  ];

  const card = { gap: theme.spacing.md } as const;
  return (
    <Screen edges={[]}>
      <PlainHeader
        title={veh.name}
        subtitle={[v.types[veh.type], spaceName].filter(Boolean).join(' · ')}
        subtitleIcon={
          <Ionicons name={VEHICLE_ICON[veh.type]} size={iconSize.sm} color={theme.color.brand} />
        }
        trailing={
          <IconButton label={t.personalHome.toolMore} onPress={() => setMenu(true)}>
            <Ionicons name="ellipsis-vertical" size={iconSize.md} color={theme.color.text} />
          </IconButton>
        }
      />
      <ScrollView
        ref={scroll}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: clearance + theme.spacing.lg,
          gap: theme.spacing.md,
        }}
      >
        <Row style={{ gap: theme.spacing.sm }}>
          {(
            [
              [
                v.addExpense,
                'document-text-outline',
                theme.color.brandSoft,
                theme.color.brand,
                () => setSheet({ k: 'expense' }),
              ],
              [
                v.documents,
                'folder-open-outline',
                theme.color.surfaceMuted,
                theme.color.text,
                () => setJumpDocs((n) => n + 1),
              ],
            ] as const
          ).map(([label, icon, bg, fg, onPress]) => (
            <PressableScale
              key={label}
              accessibilityRole="button"
              accessibilityLabel={label}
              onPress={onPress}
              style={{
                flex: 1,
                minHeight: 44,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: theme.spacing.sm,
                borderRadius: theme.radius.lg,
                backgroundColor: bg,
              }}
            >
              <Ionicons name={icon} size={iconSize.md} color={fg} />
              <Text variant="body" style={{ fontWeight: '700', color: fg }}>
                {label}
              </Text>
            </PressableScale>
          ))}
        </Row>
        {error ? (
          <Text variant="caption" style={{ color: theme.color.negativeText }}>
            {error}
          </Text>
        ) : null}

        {due.length > 0 ? (
          <StandardCard style={{ gap: theme.spacing.sm }}>
            <Text variant="body" style={{ fontWeight: '700' }}>
              {v.dueSoonTitle}
            </Text>
            {due.map((d) => (
              <StatusPill
                key={d.key}
                label={dueText(v, d, region)}
                tone={d.inDays < 0 ? 'negative' : 'warning'}
              />
            ))}
          </StandardCard>
        ) : null}

        <StandardCard style={card}>
          <Text variant="body" style={{ fontWeight: '700' }}>
            {v.thisMonth}
          </Text>
          <Text variant="title" style={{ fontWeight: '800' }}>
            {fmt(monthSpend(ledger.txns, veh.id, month, cur), cur)}
          </Text>
          <Text variant="caption" tone="muted">
            {v.last12}
          </Text>
          <Row style={{ alignItems: 'flex-end', height: 64, gap: 4 }}>
            {strip.map((m, i) => (
              <View
                key={m.month}
                accessible
                accessibilityLabel={`${monthLetter(m.month)} ${fmt(m.total, cur)}`}
                style={{
                  flex: 1,
                  alignItems: 'center',
                  gap: 4,
                  justifyContent: 'flex-end',
                  height: '100%',
                }}
              >
                <View
                  style={{
                    width: '100%',
                    height:
                      peak > 0n
                        ? Math.max(m.total > 0n ? 4 : 2, Number((m.total * 40n) / peak))
                        : 2,
                    borderRadius: 3,
                    backgroundColor:
                      i === strip.length - 1 ? theme.color.brand : theme.color.surfaceMuted,
                  }}
                />
                <Text variant="micro" tone="muted">
                  {monthLetter(m.month)}
                </Text>
              </View>
            ))}
          </Row>
        </StandardCard>

        <SectionHeader title={v.detailsTitle} />
        <ListCard>
          <Line
            divider={false}
            icon="id-card-outline"
            label={v.registrationLabel}
            value={veh.registration ?? none}
            onPress={() => setSheet({ k: 'regField' })}
          />
          <Line
            icon="car-sport-outline"
            label={v.makeModelLabel}
            value={veh.makeModel ?? none}
            onPress={() => setSheet({ k: 'makeModel' })}
          />
          <Line
            icon="calendar-outline"
            label={v.yearLabel}
            value={veh.year ? String(veh.year) : none}
            onPress={() => setSheet({ k: 'year' })}
          />
          <Line icon="flame-outline" label={v.fuelLabel} value={v.fuels[veh.fuel]} />
          <Line
            icon="speedometer-outline"
            label={fill(v.odometer, { unit })}
            value={veh.odometer !== null ? `${veh.odometer.toLocaleString(locale)} ${unit}` : none}
            onPress={() => setSheet({ k: 'odometer' })}
          />
          {veh.customFields.map((f, i) => (
            <Line
              key={`${f.key}:${i}`}
              icon="pricetag-outline"
              label={f.key}
              value={f.value || none}
              onPress={() => setSheet({ k: 'detail', i })}
            />
          ))}
          <Line
            icon="reader-outline"
            label={v.notes}
            value={veh.notes ?? none}
            onPress={() => setSheet({ k: 'notes' })}
          />
          <ListItem
            divider
            accessibilityLabel={v.addDetail}
            onPress={() => setSheet({ k: 'detail', i: null })}
            leading={
              <RowTile tint={theme.color.brandSoft}>
                <Ionicons name="add" size={iconSize.md} color={theme.color.brand} />
              </RowTile>
            }
            title={v.addDetail}
          />
        </ListCard>

        <SectionHeader
          title={v.renewalsTitle}
          trailing={
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={v.addRenewal}
              hitSlop={10}
              onPress={() => setSheet({ k: 'renewal', r: null })}
            >
              <Ionicons name="add" size={iconSize.lg} color={theme.color.brand} />
            </Pressable>
          }
        />
        {veh.renewals.length === 0 ? (
          <StandardCard>
            <Button
              label={v.addRenewal}
              variant="secondary"
              onPress={() => setSheet({ k: 'renewal', r: null })}
            />
          </StandardCard>
        ) : (
          <ListCard>
            {[...veh.renewals]
              .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))
              .map((r, i) => (
                <ListItem
                  key={r.id}
                  divider={i > 0}
                  accessibilityLabel={`${kindName(v, r.kind, region, r.label)} ${showDate(r.dueDate, locale)}`}
                  onPress={() => setSheet({ k: 'renewal', r })}
                  title={kindName(v, r.kind, region, r.label)}
                  subtitle={
                    r.provider || r.policyNumber
                      ? [r.provider, r.policyNumber].filter(Boolean).join(' · ')
                      : undefined
                  }
                  amount={showDate(r.dueDate, locale)}
                  chevron
                />
              ))}
          </ListCard>
        )}

        <View onLayout={(e) => docsY.set(e.nativeEvent.layout.y)}>
          <DocumentsCard
            propertyId={veh.id}
            region={region}
            groupId={space}
            slotNames={{
              rc: v.docRc,
              insurance: v.docInsurance,
              emission: v.docEmission,
              licence: v.docLicence,
            }}
          />
        </View>

        <SectionHeader title={v.recentExpenses} />
        {veh.movedFrom || txns.length === 0 ? (
          <StandardCard style={card}>
            {veh.movedFrom ? (
              <Text variant="caption" tone="muted">
                {fill(v.earlierExpenses, { where: veh.movedFrom })}
              </Text>
            ) : null}
            {txns.length === 0 ? (
              <Text variant="caption" tone="muted">
                {v.noExpenses}
              </Text>
            ) : null}
          </StandardCard>
        ) : null}
        {txns.length > 0 ? (
          <ListCard>
            {txns.slice(0, 8).map((x, i) => (
              <ListItem
                key={x.id}
                divider={i > 0}
                title={v.expenseKinds[x.vehicleKind ?? 'other']}
                subtitle={showDate(x.date, locale)}
                amount={fmt(x.amount, x.currency)}
              />
            ))}
          </ListCard>
        ) : null}
      </ScrollView>

      {sheet?.k === 'expense' ? (
        <ExpenseSheet
          currency={cur}
          onClose={() => setSheet(null)}
          onSave={(kind, amount, date, note) => {
            void writes.addExpense(veh, kind, amount, date, note, v.expenseKinds[kind]);
            setSheet(null);
          }}
        />
      ) : null}
      <RenameSheet
        visible={sheet?.k === 'rename'}
        title={t.personal.editDetails}
        placeholder={v.namePlaceholder}
        initial={veh.name}
        onClose={() => setSheet(null)}
        onSave={(name) => {
          save({ name });
          setSheet(null);
        }}
      />
      {sheet?.k === 'renewal' ? (
        <RenewalSheet
          initial={sheet.r}
          onClose={() => setSheet(null)}
          onSave={(r) => {
            setRenewals(
              sheet.r ? veh.renewals.map((x) => (x.id === r.id ? r : x)) : [...veh.renewals, r],
            );
            setSheet(null);
          }}
          onDelete={
            sheet.r
              ? () => {
                  setRenewals(veh.renewals.filter((x) => x.id !== sheet.r?.id));
                  setSheet(null);
                }
              : undefined
          }
        />
      ) : null}
      {sheet && ['odometer', 'notes', 'regField', 'makeModel', 'year'].includes(sheet.k) ? (
        <FieldsSheet
          title={
            sheet.k === 'odometer'
              ? fill(v.odometer, { unit })
              : sheet.k === 'notes'
                ? v.notes
                : sheet.k === 'regField'
                  ? v.registrationLabel
                  : sheet.k === 'makeModel'
                    ? v.makeModelLabel
                    : v.yearLabel
          }
          first={{
            label: sheet.k === 'notes' ? v.notes : v.detailValue,
            value:
              sheet.k === 'odometer'
                ? String(veh.odometer ?? '')
                : sheet.k === 'notes'
                  ? (veh.notes ?? '')
                  : sheet.k === 'regField'
                    ? (veh.registration ?? '')
                    : sheet.k === 'makeModel'
                      ? (veh.makeModel ?? '')
                      : String(veh.year ?? ''),
          }}
          note={sheet.k === 'notes'}
          numeric={sheet.k === 'odometer' || sheet.k === 'year'}
          onClose={() => setSheet(null)}
          onSave={(a) => {
            const n = Number(a.replace(/\D/g, ''));
            if (sheet.k === 'odometer') save({ odometer: a && Number.isSafeInteger(n) ? n : null });
            else if (sheet.k === 'year') save({ year: n >= 1900 && n <= 2200 ? n : null });
            else if (sheet.k === 'notes') save({ notes: a || null });
            else if (sheet.k === 'regField') save({ registration: a.toUpperCase() || null });
            else save({ makeModel: a || null });
            setSheet(null);
          }}
        />
      ) : null}
      {sheet?.k === 'detail' ? (
        <FieldsSheet
          title={v.customDetails}
          first={{
            label: v.detailName,
            value: sheet.i === null ? '' : (veh.customFields[sheet.i]?.key ?? ''),
          }}
          second={{
            label: v.detailValue,
            value: sheet.i === null ? '' : (veh.customFields[sheet.i]?.value ?? ''),
          }}
          onClose={() => setSheet(null)}
          onSave={(key, value) => {
            const rest = veh.customFields.filter((_, j) => j !== sheet.i);
            if (!key) save({ customFields: rest });
            else
              save({
                customFields:
                  sheet.i === null
                    ? [...veh.customFields, { key, value }]
                    : veh.customFields.map((f, j) => (j === sheet.i ? { key, value } : f)),
              });
            setSheet(null);
          }}
        />
      ) : null}
      {moveTo ? (
        <MoveRunner
          vehicle={veh}
          source={store}
          sourceSpace={space}
          space={moveTo.space}
          from={space ? (spaceName ?? '') : v.personal}
          onDone={() => router.back()}
          onFail={() => {
            setMoveTo(null);
            setError(v.moveFailed);
          }}
        />
      ) : null}
      <OverflowMenu visible={menu} onClose={() => setMenu(false)} items={items} />
    </Screen>
  );
}

export default function VehicleDetailScreen() {
  return (
    <PersonalGuard>
      <DetailBody />
    </PersonalGuard>
  );
}
