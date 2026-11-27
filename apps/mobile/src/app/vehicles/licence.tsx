/** The driving licence: it belongs to the person, so it sits above the vehicles. */
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams } from 'expo-router';
import { randomUUID } from 'expo-crypto';

import { DEFAULT_REMIND_DAYS } from '@waves/core';
import { Button, iconSize, Screen, Text, useTheme } from '@waves/ui';

import { PersonalGuard } from '@/components/PersonalGuard';
import { FieldLabel } from '@/components/company/EntryForm';
import { PlainHeader, StandardCard } from '@/components/standard';
import { DateAnswer, TextAnswer } from '@/components/wealth/parts';
import { DocumentsCard } from '@/components/wealth/RentalExtras';
import { useSpaceName } from '@/data/personalWealth';
import { usePersonalVehicles, useVehicleWrites } from '@/data/vehicles';
import { useStrings } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { useBottomClearance } from '@/lib/clearance';
import { router } from '@/lib/navigation';
import { deleteAllDocs } from '@/lib/propertyDocs';
import { regionOf } from '@/lib/wealthPlan';

function LicenceBody() {
  const theme = useTheme();
  const clearance = useBottomClearance();
  const { t } = useStrings();
  const v = t.vehicles;
  const { profile } = useAuth();
  const { id, space } = useLocalSearchParams<{ id?: string; space?: string }>();
  const subtitle = useSpaceName(space);
  const { vehicles, licences } = usePersonalVehicles(space);
  const writes = useVehicleWrites(space);
  const existing = licences.find((l) => l.id === id);
  const [newId] = useState(() => randomUUID());
  const [holder, setHolder] = useState(existing?.holderName ?? '');
  const [number, setNumber] = useState(existing?.number ?? '');
  const [cls, setCls] = useState(existing?.licenceClass ?? '');
  const [expiry, setExpiry] = useState<string | null>(existing?.expiry ?? null);
  const [linked, setLinked] = useState<readonly string[]>(existing?.vehicleIds ?? []);
  const active = vehicles.filter((x) => x.status === 'active');

  const save = async (): Promise<void> => {
    await writes.saveLicence({
      id: existing?.id ?? newId,
      holderName: holder.trim(),
      number: number.trim() || null,
      licenceClass: cls.trim() || null,
      expiry,
      remindDaysBefore: existing?.remindDaysBefore ?? DEFAULT_REMIND_DAYS,
      vehicleIds: linked,
      carried: existing?.carried,
    });
    router.back();
  };

  return (
    <Screen edges={[]}>
      <PlainHeader title={v.licenceTitle} subtitle={subtitle} />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: theme.spacing.lg,
          gap: theme.spacing.md,
        }}
      >
        <FieldLabel>{v.holderName}</FieldLabel>
        <TextAnswer
          value={holder}
          onChange={setHolder}
          placeholder={profile?.display_name ?? v.holderName}
          label={v.holderName}
          bordered
        />
        <FieldLabel>{v.licenceNumber}</FieldLabel>
        <TextAnswer
          value={number}
          onChange={setNumber}
          placeholder={v.licenceNumber}
          label={v.licenceNumber}
          bordered
        />
        <FieldLabel>{v.licenceClass}</FieldLabel>
        <TextAnswer
          value={cls}
          onChange={setCls}
          placeholder={v.licenceClass}
          label={v.licenceClass}
          bordered
        />
        <DateAnswer
          label={v.licenceExpiry}
          value={expiry}
          onChange={setExpiry}
          clearLabel={v.notSet}
        />
        {active.length > 0 ? (
          <StandardCard style={{ gap: theme.spacing.sm }}>
            <Text variant="body" style={{ fontWeight: '700' }}>
              {v.vehicles}
            </Text>
            {active.map((x) => {
              const on = linked.includes(x.id);
              return (
                <Pressable
                  key={x.id}
                  accessibilityRole="checkbox"
                  accessibilityLabel={x.name}
                  accessibilityState={{ checked: on }}
                  onPress={() =>
                    setLinked(on ? linked.filter((i) => i !== x.id) : [...linked, x.id])
                  }
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.spacing.md,
                    minHeight: 44,
                  }}
                >
                  <Ionicons
                    name={on ? 'checkbox' : 'square-outline'}
                    size={iconSize.md}
                    color={theme.color.brand}
                  />
                  <Text variant="body" style={{ flex: 1 }}>
                    {x.name}
                  </Text>
                </Pressable>
              );
            })}
          </StandardCard>
        ) : null}
        {existing ? (
          <DocumentsCard
            propertyId={existing.id}
            region={regionOf(profile?.country_code)}
            groupId={space}
            slotNames={{ licence: v.docLicence }}
          />
        ) : null}
      </ScrollView>
      <View
        style={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: clearance + theme.spacing.md,
          gap: theme.spacing.sm,
        }}
      >
        {existing ? (
          <Button
            fullWidth
            variant="secondary"
            label={t.common.delete}
            onPress={() =>
              void writes
                .deleteRecord(existing.id)
                .then(() => deleteAllDocs(existing.id))
                .then(() => router.back())
            }
          />
        ) : null}
        <Button
          fullWidth
          label={t.common.save}
          disabled={!holder.trim()}
          onPress={() => void save()}
        />
      </View>
    </Screen>
  );
}

export default function LicenceScreen() {
  return (
    <PersonalGuard>
      <LicenceBody />
    </PersonalGuard>
  );
}
