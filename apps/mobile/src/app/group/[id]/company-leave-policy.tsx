/**
 * Company settings -> Leave policy. The owner defines the leave types (Casual, Sick, Earned ...): days earned
 * each month, carry forward (with a cap), a yearly cap, paid or not. Everyone else only reads the list.
 * Balances are worked out from these rules; approving leave beyond a balance is refused unless allowed here.
 */

import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { randomUUID } from 'expo-crypto';
import { useLocalSearchParams } from 'expo-router';
import { ScrollView, TextInput, View } from 'react-native';

import {
  Button,
  Callout,
  directionalIcon,
  iconSize,
  Row,
  Screen,
  Sheet,
  Text,
  Toggle,
  useTabBarClearance,
  useTheme,
} from '@waves/ui';

import { ListRow, PlainHeader, RowTile, StandardCard } from '@/components/standard';
import { useCompanyEntries, useCompanySuspended } from '@/data/companyEntries';
import {
  daysText,
  useLeaveTypes,
  useRemoveLeaveType,
  useSetLeaveType,
  type MirrorLeaveType,
} from '@/data/companyLeave';
import { useStrings } from '@/i18n';

const num = (s: string): number | null | undefined => {
  const v = s.trim();
  if (v === '') return null; // empty = no limit
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 && n <= 366 ? n : undefined; // undefined = not a valid number
};

function Num({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  placeholder?: string;
}) {
  const theme = useTheme();
  return (
    <View style={{ gap: 4 }}>
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.color.textFaint}
        keyboardType="decimal-pad"
        style={{
          borderWidth: 1,
          borderColor: theme.color.border,
          borderRadius: theme.radius.lg,
          padding: theme.spacing.md,
          color: theme.color.text,
          backgroundColor: theme.color.surface,
        }}
      />
    </View>
  );
}

function TypeSheet({
  groupId,
  type,
  visible,
  onClose,
}: {
  groupId: string;
  type: MirrorLeaveType | null;
  visible: boolean;
  onClose: () => void;
}) {
  const { t } = useStrings();
  const theme = useTheme();
  const save = useSetLeaveType(groupId);
  const remove = useRemoveLeaveType(groupId);
  const suspended = useCompanySuspended(groupId);
  const [name, setName] = useState(type?.name ?? '');
  const [accrual, setAccrual] = useState(type ? daysText(type.accrualPerMonth) : '1');
  const [carry, setCarry] = useState(type?.carryForward ?? true);
  const [carryCap, setCarryCap] = useState(
    type?.carryForwardCap != null ? daysText(type.carryForwardCap) : '',
  );
  const [annualCap, setAnnualCap] = useState(
    type?.annualCap != null ? daysText(type.annualCap) : '',
  );
  const [paid, setPaid] = useState(type?.paid ?? false);
  const [overdraw, setOverdraw] = useState(type?.allowOverdraw ?? false);
  const [active, setActive] = useState(type?.active ?? true);
  const a = num(accrual);
  const cc = num(carryCap);
  const ac = num(annualCap);
  const error = !name.trim()
    ? t.calendar.leaveErrName
    : a === undefined || a === null || a > 5 || (a * 4) % 1 !== 0
      ? t.calendar.leaveErrAccrual
      : cc === undefined || ac === undefined
        ? t.calendar.leaveErrCap
        : null;
  const toggle = (label: string, hint: string | null, value: boolean, on: (v: boolean) => void) => (
    <Row style={{ alignItems: 'center', gap: 12 }}>
      <View style={{ flex: 1 }}>
        <Text>{label}</Text>
        {hint ? (
          <Text variant="caption" tone="muted">
            {hint}
          </Text>
        ) : null}
      </View>
      <Toggle value={value} onValueChange={on} accessibilityLabel={label} />
    </Row>
  );
  return (
    <Sheet visible={visible} onClose={onClose} closeLabel={t.common.close}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: theme.spacing.md }}
      >
        <Text variant="title">{type ? t.calendar.leaveTypeEdit : t.calendar.leaveTypeAdd}</Text>
        <View style={{ gap: 4 }}>
          <Text variant="caption" tone="muted">
            {t.calendar.leaveTypeName}
          </Text>
          <TextInput
            value={name}
            onChangeText={setName}
            maxLength={40}
            placeholderTextColor={theme.color.textFaint}
            style={{
              borderWidth: 1,
              borderColor: theme.color.border,
              borderRadius: theme.radius.lg,
              padding: theme.spacing.md,
              color: theme.color.text,
              backgroundColor: theme.color.surface,
            }}
          />
        </View>
        <Num label={t.calendar.leaveAccrual} value={accrual} onChange={setAccrual} />
        {toggle(t.calendar.leaveCarry, t.calendar.leaveCarryHint, carry, setCarry)}
        {carry ? (
          <Num
            label={t.calendar.leaveCarryCap}
            value={carryCap}
            onChange={setCarryCap}
            placeholder={t.calendar.leaveNoLimit}
          />
        ) : null}
        <Num
          label={t.calendar.leaveAnnualCap}
          value={annualCap}
          onChange={setAnnualCap}
          placeholder={t.calendar.leaveNoLimit}
        />
        {toggle(t.calendar.leavePaid, t.calendar.leavePaidHint, paid, setPaid)}
        {toggle(t.calendar.leaveOverdraw, t.calendar.leaveOverdrawHint, overdraw, setOverdraw)}
        {toggle(t.calendar.leaveActive, null, active, setActive)}
        {error ? <Callout tone="negative">{error}</Callout> : null}
        <Row style={{ gap: 8 }}>
          {type ? (
            <View style={{ flex: 1 }}>
              <Button
                label={t.calendar.remove}
                variant="secondary"
                fullWidth
                disabled={suspended || remove.isPending}
                onPress={() => remove.mutate({ id: type.id }, { onSuccess: onClose })}
              />
            </View>
          ) : null}
          <View style={{ flex: 1 }}>
            <Button label={t.calendar.cancel} variant="secondary" fullWidth onPress={onClose} />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              label={t.calendar.save}
              fullWidth
              disabled={!!error || suspended || save.isPending}
              onPress={() =>
                save.mutate(
                  {
                    id: type?.id ?? randomUUID(),
                    name: name.trim(),
                    accrualPerMonth: a ?? 1,
                    carryForward: carry,
                    carryForwardCap: carry ? (cc ?? null) : null,
                    annualCap: ac ?? null,
                    paid,
                    allowOverdraw: overdraw,
                    active,
                  },
                  { onSuccess: onClose },
                )
              }
            />
          </View>
        </Row>
      </ScrollView>
    </Sheet>
  );
}

export default function CompanyLeavePolicyScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const groupId = id ?? '';
  const theme = useTheme();
  const clearance = useTabBarClearance();
  const { t } = useStrings();
  const view = useCompanyEntries(groupId);
  const types = useLeaveTypes(groupId);
  const [editing, setEditing] = useState<MirrorLeaveType | 'new' | null>(null);
  const summary = (x: MirrorLeaveType) =>
    [
      t.calendar.leavePerMonth.replace('{n}', daysText(x.accrualPerMonth)),
      x.carryForward ? t.calendar.leaveCarries : t.calendar.leaveResets,
      x.paid ? t.calendar.leavePaid : null,
      x.active ? null : t.calendar.leaveParked,
    ]
      .filter(Boolean)
      .join(' · ');
  return (
    <Screen>
      <PlainHeader title={t.calendar.leavePolicy} />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: clearance,
          gap: theme.spacing.sm,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Text variant="caption" tone="muted">
          {t.calendar.leavePolicyHint}
        </Text>
        <StandardCard style={{ paddingHorizontal: 14, paddingVertical: 8 }}>
          {types.map((x, i) => (
            <ListRow
              key={x.id}
              leading={
                <RowTile tint={theme.color.brandSoft}>
                  <Ionicons
                    name={x.kind === 'sick' ? 'medkit-outline' : 'airplane-outline'}
                    size={iconSize.lg}
                    color={theme.color.brand}
                  />
                </RowTile>
              }
              title={x.name}
              subtitle={summary(x)}
              subtitleLines={2}
              trailing={
                view.isOwner ? (
                  <Ionicons
                    name={directionalIcon('chevron-forward')}
                    size={iconSize.sm}
                    color={theme.color.textFaint}
                  />
                ) : undefined
              }
              onPress={view.isOwner ? () => setEditing(x) : undefined}
              divider={i < types.length - 1 || view.isOwner}
            />
          ))}
          {view.isOwner ? (
            <ListRow
              leading={
                <Ionicons name="add-circle-outline" size={iconSize.md} color={theme.color.brand} />
              }
              title={t.calendar.leaveTypeAdd}
              onPress={() => setEditing('new')}
            />
          ) : null}
        </StandardCard>
      </ScrollView>
      {editing ? (
        <TypeSheet
          key={editing === 'new' ? 'new' : editing.id}
          groupId={groupId}
          type={editing === 'new' ? null : editing}
          visible
          onClose={() => setEditing(null)}
        />
      ) : null}
    </Screen>
  );
}
