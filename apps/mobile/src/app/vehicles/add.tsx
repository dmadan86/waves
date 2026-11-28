/** Add a vehicle: one form, saved together. */
import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { KeyboardAvoidingView, Pressable, ScrollView, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { randomUUID } from 'expo-crypto';

import {
  DEFAULT_REMIND_DAYS,
  FUEL_TYPES,
  VEHICLE_TYPES,
  type FuelType,
  type VehicleRenewal,
  type VehicleType,
} from '@waves/core';
import { Button, Callout, iconSize, Screen, Sheet, Text, useTheme } from '@waves/ui';

import { PersonalGuard } from '@/components/PersonalGuard';
import { FieldLabel, SelectField } from '@/components/company/EntryForm';
import { PlainHeader } from '@/components/standard';
import { DateAnswer, TextAnswer } from '@/components/wealth/parts';
import { useMyMemberId, useSpaceName } from '@/data/personalWealth';
import { FREE_VEHICLE_CAP_ERROR, useVehicleWrites } from '@/data/vehicles';
import { useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';
import { useDefaultCurrency } from '@/lib/currency';
import { friendlyError } from '@/lib/errors';
import { router } from '@/lib/navigation';
import { writesReady } from '@/lib/rentalScope';
import { VEHICLE_ICON } from '@/lib/wizardIcons';

function AddBody() {
  const theme = useTheme();
  const clearance = useBottomClearance();
  const { t } = useStrings();
  const v = t.vehicles;
  const currency = useDefaultCurrency();
  const { space } = useLocalSearchParams<{ space?: string }>();
  const writes = useVehicleWrites(space);
  const subtitle = useSpaceName(space);
  const memberId = useMyMemberId(space);

  const [type, setType] = useState<VehicleType>('car');
  const [name, setName] = useState('');
  const [reg, setReg] = useState('');
  const [makeModel, setMakeModel] = useState('');
  const [year, setYear] = useState('');
  const [fuel, setFuel] = useState<FuelType>('petrol');
  const [insurance, setInsurance] = useState<string | null>(null);
  const [emission, setEmission] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'type' | 'fuel' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loaded = writesReady(space, memberId);

  const save = async (): Promise<void> => {
    setError(null);
    const renew = (kind: VehicleRenewal['kind'], dueDate: string | null): VehicleRenewal[] =>
      dueDate
        ? [
            {
              id: randomUUID(),
              kind,
              label: null,
              dueDate,
              remindDaysBefore: DEFAULT_REMIND_DAYS,
              policyNumber: null,
              provider: null,
            },
          ]
        : [];
    const y = Number(year);
    try {
      await writes.createVehicle({
        type,
        name: name.trim() || v.types[type],
        registration: reg.trim().toUpperCase() || null,
        makeModel: makeModel.trim() || null,
        year: Number.isInteger(y) && y >= 1900 && y <= 2200 ? y : null,
        fuel,
        currency,
        renewals: [...renew('insurance', insurance), ...renew('emission_test', emission)],
      });
      router.back();
    } catch (e) {
      if (e instanceof Error && e.message === FREE_VEHICLE_CAP_ERROR) {
        router.push('/paywall');
        return;
      }
      setError(friendlyError(e, t.couldNotSave, 'vehicles.add.save'));
    }
  };

  const pick = <T extends string>(
    list: readonly T[],
    value: T,
    label: (x: T) => string,
    set: (x: T) => void,
    icon?: (x: T) => keyof typeof Ionicons.glyphMap,
  ) =>
    list.map((x) => (
      <Pressable
        key={x}
        accessibilityRole="button"
        accessibilityLabel={label(x)}
        accessibilityState={{ selected: x === value }}
        onPress={() => {
          set(x);
          setSheet(null);
        }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, minHeight: 48 }}
      >
        {icon ? <Ionicons name={icon(x)} size={iconSize.md} color={theme.color.brand} /> : null}
        <Text variant="body" style={{ flex: 1, fontWeight: x === value ? '700' : '400' }}>
          {label(x)}
        </Text>
        {x === value ? (
          <Ionicons name="checkmark" size={iconSize.md} color={theme.color.brand} />
        ) : null}
      </Pressable>
    ));

  return (
    <Screen edges={[]}>
      <PlainHeader title={v.addVehicle} subtitle={subtitle} />
      {/* The keyboard lifts the pinned Save bar; dragging the form dismisses it (also on Android: edge-to-edge). */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView
          style={{ flex: 1 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={{
            paddingHorizontal: theme.spacing.lg,
            paddingBottom: theme.spacing.lg,
            gap: theme.spacing.md,
          }}
        >
          <FieldLabel>{v.typeLabel}</FieldLabel>
          <SelectField
            label={v.typeLabel}
            icon={VEHICLE_ICON[type]}
            text={v.types[type]}
            onPress={() => setSheet('type')}
          />
          <FieldLabel>{v.nameLabel}</FieldLabel>
          <TextAnswer
            value={name}
            onChange={setName}
            placeholder={v.namePlaceholder}
            label={v.nameLabel}
            bordered
          />
          <FieldLabel>{v.registrationLabel}</FieldLabel>
          <TextAnswer
            value={reg}
            onChange={setReg}
            placeholder={v.registrationLabel}
            label={v.registrationLabel}
            bordered
          />
          <FieldLabel>{v.makeModelLabel}</FieldLabel>
          <TextAnswer
            value={makeModel}
            onChange={setMakeModel}
            placeholder={v.makeModelLabel}
            label={v.makeModelLabel}
            bordered
          />
          <FieldLabel>{v.yearLabel}</FieldLabel>
          <TextAnswer
            value={year}
            onChange={(x) => setYear(x.replace(/\D/g, '').slice(0, 4))}
            placeholder={v.yearLabel}
            label={v.yearLabel}
            keyboardType="numeric"
            bordered
          />
          <FieldLabel>{v.fuelLabel}</FieldLabel>
          <SelectField
            label={v.fuelLabel}
            icon="flame-outline"
            text={v.fuels[fuel]}
            onPress={() => setSheet('fuel')}
          />
          <DateAnswer
            label={v.insuranceExpiry}
            value={insurance}
            onChange={setInsurance}
            clearLabel={v.notSet}
          />
          <DateAnswer
            label={v.emissionExpiry}
            value={emission}
            onChange={setEmission}
            clearLabel={v.notSet}
          />
        </ScrollView>
        <View
          style={{
            paddingHorizontal: theme.spacing.lg,
            paddingBottom: clearance + theme.spacing.md,
            gap: theme.spacing.sm,
          }}
        >
          {error ? <Callout tone="negative">{error}</Callout> : null}
          <Button
            label={loaded ? v.saveVehicle : t.common.loading}
            disabled={!loaded}
            fullWidth
            onPress={() => void save()}
          />
        </View>
      </KeyboardAvoidingView>
      <Sheet
        visible={sheet === 'type'}
        onClose={() => setSheet(null)}
        title={v.typeLabel}
        closeLabel={t.common.close}
      >
        <ScrollView style={{ maxHeight: 360 }}>
          {pick(
            VEHICLE_TYPES,
            type,
            (x) => v.types[x],
            setType,
            (x) => VEHICLE_ICON[x],
          )}
        </ScrollView>
      </Sheet>
      <Sheet
        visible={sheet === 'fuel'}
        onClose={() => setSheet(null)}
        title={v.fuelLabel}
        closeLabel={t.common.close}
      >
        <ScrollView style={{ maxHeight: 360 }}>
          {pick(FUEL_TYPES, fuel, (x) => v.fuels[x], setFuel)}
        </ScrollView>
      </Sheet>
    </Screen>
  );
}

export default function AddVehicleScreen() {
  return (
    <PersonalGuard>
      <AddBody />
    </PersonalGuard>
  );
}
