/**
 * Add a property to rent out: one form, saved together. When it is rented, the
 * tenant, rent, deposit, rent day and lease end are asked on the same screen.
 */
import { useState, type ReactElement } from 'react';
import DateTimePicker from '@react-native-community/datetimepicker';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { PROPERTY_TYPES, type PropertyType } from '@waves/core';
import { Button, iconSize, Row, Screen, Sheet, Text, useTheme } from '@waves/ui';

import { PersonalGuard } from '@/components/PersonalGuard';
import { FieldLabel, SelectField } from '@/components/company/EntryForm';
import { PlainHeader } from '@/components/standard';
import { MoneyBox, YesNoPills } from '@/components/wealth/FormParts';
import { TextAnswer } from '@/components/wealth/parts';
import type { TenantDraft } from '@/components/wealth/TenantFlow';
import { dateFrom, showDate } from '@/lib/expenseDay';
import { localIsoDate, todayIso } from '@/data/personal';
import {
  FREE_CAP_ERROR,
  useOwnPropertyCount,
  useSpaceName,
  useWealthWrites,
  type RentalDraft,
} from '@/data/personalWealth';
import { fill, useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';
import { useDefaultCurrency } from '@/lib/currency';
import { useEntitlement } from '@/lib/useEntitlement';
import { router } from '@/lib/navigation';
import { reportHandled } from '@/lib/observability';
import { PROPERTY_ICON } from '@/lib/wizardIcons';

const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

function AddBody() {
  const theme = useTheme();
  const clearance = useBottomClearance();
  const { t, locale } = useStrings();
  const w = t.wealth;
  const currency = useDefaultCurrency();
  const { space } = useLocalSearchParams<{ space?: string }>();
  const writes = useWealthWrites(space);
  const ownCount = useOwnPropertyCount(space);
  const subtitle = useSpaceName(space);
  const { isPro } = useEntitlement();
  const [today] = useState(() => todayIso());

  const [type, setType] = useState<PropertyType>('house');
  const [name, setName] = useState('');
  const [rented, setRented] = useState<'yes' | 'no'>('no');
  const [tenant, setTenant] = useState('');
  const [phone, setPhone] = useState('');
  const [rent, setRent] = useState(0n);
  const [deposit, setDeposit] = useState(0n);
  const [day, setDay] = useState<number | null>(null);
  const [end, setEnd] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'type' | 'day' | null>(null);
  const [picking, setPicking] = useState(false);

  const isRented = rented === 'yes';
  const ready = !isRented || (tenant.trim() !== '' && rent > 0n);

  const save = async (): Promise<void> => {
    if (!isPro && ownCount >= 1) {
      router.push('/paywall');
      return;
    }
    const tn: TenantDraft | null = isRented
      ? {
          name: tenant.trim(),
          phone: phone.trim(),
          rent,
          frequency: 'monthly',
          day: day ?? 1,
          deposit,
          startDate: today,
          endDate: end,
          escalationPct: null,
        }
      : null;
    const draft: RentalDraft = {
      type,
      name: name.trim() || w.propertyTypes[type],
      currency,
      today,
      tenant: tn,
    };
    try {
      await writes.createRental(draft);
    } catch (error) {
      if (error instanceof Error && error.message === FREE_CAP_ERROR) {
        router.push('/paywall');
        return;
      }
      // Local-first: the queue retries; nothing is shown as a refusal, but a write
      // that never reached the phone must not vanish unseen.
      reportHandled(error, 'rentals.add.save');
    }
    router.back();
  };

  const row = (label: string, selected: boolean, onPress: () => void, icon?: ReactElement) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        minHeight: 48,
      }}
    >
      {icon}
      <Text variant="body" style={{ flex: 1, fontWeight: selected ? '700' : '400' }}>
        {label}
      </Text>
      {selected ? <Ionicons name="checkmark" size={iconSize.md} color={theme.color.brand} /> : null}
    </Pressable>
  );

  return (
    <Screen edges={[]}>
      <PlainHeader title={w.addProperty} subtitle={subtitle} />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: theme.spacing.lg,
          gap: theme.spacing.md,
        }}
      >
        <FieldLabel>{w.propertyTypeLabel}</FieldLabel>
        <SelectField
          label={w.propertyTypeLabel}
          icon={PROPERTY_ICON[type]}
          text={w.propertyTypes[type]}
          onPress={() => setSheet('type')}
        />
        <FieldLabel>{w.propertyNameLabel}</FieldLabel>
        <TextAnswer
          value={name}
          onChange={setName}
          placeholder={w.propNamePlaceholder}
          label={w.propertyNameLabel}
          bordered
        />
        <FieldLabel>{w.currentlyRentedQ}</FieldLabel>
        <YesNoPills
          value={rented}
          onChange={setRented}
          options={[
            { value: 'yes', label: w.yes },
            { value: 'no', label: w.no },
          ]}
        />
        {isRented ? (
          <>
            <FieldLabel>{w.tenantNameLabel}</FieldLabel>
            <TextAnswer
              value={tenant}
              onChange={setTenant}
              placeholder={w.tenantNameLabel}
              label={w.tenantNameLabel}
              bordered
            />
            <FieldLabel>{w.tenantPhone}</FieldLabel>
            <TextAnswer
              value={phone}
              onChange={setPhone}
              placeholder={w.tenantPhone}
              label={w.tenantPhone}
              keyboardType="phone-pad"
              bordered
            />
            <Row style={{ gap: theme.spacing.md }}>
              <View style={{ flex: 1, gap: theme.spacing.xs }}>
                <FieldLabel>{w.monthlyRent}</FieldLabel>
                <MoneyBox currency={currency} value={rent} onChange={setRent} />
              </View>
              <View style={{ flex: 1, gap: theme.spacing.xs }}>
                <FieldLabel>{w.refundableDeposit}</FieldLabel>
                <MoneyBox currency={currency} value={deposit} onChange={setDeposit} />
              </View>
            </Row>
            <FieldLabel>{w.rentDueDay}</FieldLabel>
            <SelectField
              label={w.rentDueDay}
              icon="calendar-outline"
              text={day === null ? w.selectDay : fill(w.dayOfMonth, { n: day })}
              placeholder={day === null}
              onPress={() => setSheet('day')}
            />
            <FieldLabel>{w.leaseEndOptional}</FieldLabel>
            <SelectField
              label={w.leaseEndOptional}
              icon="calendar-number-outline"
              text={end ? showDate(end, locale) : w.openEnded}
              onPress={() => setPicking(true)}
              trailing={
                end ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={w.openEnded}
                    hitSlop={10}
                    onPress={() => setEnd(null)}
                  >
                    <Ionicons
                      name="close-circle-outline"
                      size={iconSize.md}
                      color={theme.color.textMuted}
                    />
                  </Pressable>
                ) : undefined
              }
            />
            {picking ? (
              <DateTimePicker
                value={dateFrom(end ?? localIsoDate(new Date()))}
                mode="date"
                onChange={(event, picked) => {
                  if (Platform.OS !== 'ios') setPicking(false);
                  if (event.type === 'set' && picked) setEnd(localIsoDate(picked));
                }}
              />
            ) : null}
          </>
        ) : null}
      </ScrollView>
      <View
        style={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: clearance + theme.spacing.md,
        }}
      >
        <Button label={w.savePropertyBtn} disabled={!ready} fullWidth onPress={() => void save()} />
      </View>

      <Sheet
        visible={sheet === 'type'}
        onClose={() => setSheet(null)}
        title={w.propertyTypeLabel}
        closeLabel={t.common.close}
      >
        <ScrollView style={{ maxHeight: 360 }}>
          {PROPERTY_TYPES.map((v) =>
            row(
              w.propertyTypes[v],
              v === type,
              () => {
                setType(v);
                setSheet(null);
              },
              <Ionicons name={PROPERTY_ICON[v]} size={iconSize.md} color={theme.color.brand} />,
            ),
          )}
        </ScrollView>
      </Sheet>
      <Sheet
        visible={sheet === 'day'}
        onClose={() => setSheet(null)}
        title={w.rentDueDay}
        closeLabel={t.common.close}
      >
        <ScrollView style={{ maxHeight: 360 }}>
          {DAYS.map((d) =>
            row(fill(w.dayOfMonth, { n: d }), d === day, () => {
              setDay(d);
              setSheet(null);
            }),
          )}
        </ScrollView>
      </Sheet>
    </Screen>
  );
}

export default function AddRentalScreen() {
  return (
    <PersonalGuard>
      <AddBody />
    </PersonalGuard>
  );
}
