/** Sheets for a vehicle: an expense with kind chips, a renewal, a custom detail, and a text/number edit. */

import { useState } from 'react';
import { View } from 'react-native';
import { randomUUID } from 'expo-crypto';

import {
  DEFAULT_REMIND_DAYS,
  RENEWAL_KINDS,
  VEHICLE_EXPENSE_KINDS,
  type CurrencyCode,
  type RenewalKind,
  type VehicleExpenseKind,
  type VehicleRenewal,
} from '@waves/core';
import { AmountField, Button, ChipRow, Sheet, Text, useTheme } from '@waves/ui';

import { DateAnswer, TextAnswer } from '@/components/wealth/parts';
import { PersonalNoteField } from '@/components/PersonalNoteField';
import { localIsoDate } from '@/data/personal';
import { fill, useStrings } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { kindName } from '@/lib/vehicleText';
import { regionOf } from '@/lib/wealthPlan';

export function ExpenseSheet({
  currency,
  initialKind = 'fuel',
  onSave,
  onClose,
}: {
  currency: CurrencyCode;
  initialKind?: VehicleExpenseKind;
  onSave: (kind: VehicleExpenseKind, amount: bigint, date: string, note: string) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const v = t.vehicles;
  const [kind, setKind] = useState<VehicleExpenseKind>(initialKind);
  const [amount, setAmount] = useState(0n);
  const [date, setDate] = useState(() => localIsoDate(new Date()));
  const [note, setNote] = useState('');
  return (
    <Sheet visible onClose={onClose} title={v.expenseTitle} closeLabel={t.common.close}>
      <View style={{ gap: theme.spacing.lg }}>
        <ChipRow
          wrap
          variant="brand"
          options={VEHICLE_EXPENSE_KINDS.map((k) => ({ value: k, label: v.expenseKinds[k] }))}
          value={kind}
          onChange={setKind}
        />
        <AmountField currency={currency} value={amount} onChange={setAmount} />
        <DateAnswer label={t.wealth.today} value={date} onChange={(d) => d && setDate(d)} />
        <TextAnswer value={note} onChange={setNote} placeholder={v.expenseNote} label={v.expenseNote} />
        <Button
          fullWidth
          label={t.common.save}
          disabled={amount <= 0n}
          onPress={() => onSave(kind, amount, date, note)}
        />
      </View>
    </Sheet>
  );
}

const REMIND_CHOICES = [7, 15, 30, 60] as const;

export function RenewalSheet({
  initial,
  onSave,
  onDelete,
  onClose,
}: {
  initial: VehicleRenewal | null;
  onSave: (r: VehicleRenewal) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const { profile } = useAuth();
  const region = regionOf(profile?.country_code);
  const v = t.vehicles;
  const [kind, setKind] = useState<RenewalKind>(initial?.kind ?? 'insurance');
  const [label, setLabel] = useState(initial?.label ?? '');
  const [due, setDue] = useState<string | null>(initial?.dueDate ?? null);
  const [days, setDays] = useState(initial?.remindDaysBefore ?? DEFAULT_REMIND_DAYS);
  const [policy, setPolicy] = useState(initial?.policyNumber ?? '');
  const [provider, setProvider] = useState(initial?.provider ?? '');
  const choices = [...new Set([...REMIND_CHOICES, days])].sort((a, b) => a - b);
  return (
    <Sheet visible onClose={onClose} title={v.renewalsTitle} closeLabel={t.common.close}>
      <View style={{ gap: theme.spacing.md }}>
        <ChipRow
          wrap
          variant="brand"
          options={RENEWAL_KINDS.map((k) => ({ value: k, label: kindName(v, k, region) }))}
          value={kind}
          onChange={setKind}
        />
        {kind === 'other' ? (
          <TextAnswer value={label} onChange={setLabel} placeholder={v.renewalLabel} label={v.renewalLabel} />
        ) : null}
        <DateAnswer label={v.dueDate} value={due} onChange={setDue} clearLabel={v.notSet} />
        <Text variant="caption" tone="muted">
          {v.remindDays}
        </Text>
        <ChipRow
          wrap
          variant="brand"
          options={choices.map((n) => ({ value: String(n), label: fill(v.remindDaysValue, { n }) }))}
          value={String(days)}
          onChange={(x) => setDays(Number(x))}
        />
        <TextAnswer value={policy} onChange={setPolicy} placeholder={v.policyNumber} label={v.policyNumber} />
        <TextAnswer value={provider} onChange={setProvider} placeholder={v.provider} label={v.provider} />
        <Button
          fullWidth
          label={t.common.save}
          disabled={!due}
          onPress={() =>
            due &&
            onSave({
              id: initial?.id ?? randomUUID(),
              kind,
              label: kind === 'other' ? label.trim() || null : null,
              dueDate: due,
              remindDaysBefore: days,
              policyNumber: policy.trim() || null,
              provider: provider.trim() || null,
            })
          }
        />
        {onDelete ? (
          <Button fullWidth variant="secondary" label={t.common.delete} onPress={onDelete} />
        ) : null}
      </View>
    </Sheet>
  );
}

/** One or two text fields in a sheet: a custom detail (name + value), or a single value. */
export function FieldsSheet({
  title,
  first,
  second,
  note = false,
  numeric = false,
  onSave,
  onClose,
}: {
  title: string;
  first: { label: string; value: string };
  second?: { label: string; value: string };
  /** The first field is a multi-line note with a mic. */
  note?: boolean;
  numeric?: boolean;
  onSave: (a: string, b: string) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const [a, setA] = useState(first.value);
  const [b, setB] = useState(second?.value ?? '');
  return (
    <Sheet visible onClose={onClose} title={title} closeLabel={t.common.close}>
      <View style={{ gap: theme.spacing.md }}>
        {note ? (
          <PersonalNoteField
            value={a}
            onChange={setA}
            placeholder={first.label}
            accessibilityLabel={first.label}
          />
        ) : (
          <TextAnswer
            value={a}
            onChange={setA}
            placeholder={first.label}
            label={first.label}
            keyboardType={numeric ? 'numeric' : undefined}
          />
        )}
        {second ? (
          <TextAnswer value={b} onChange={setB} placeholder={second.label} label={second.label} />
        ) : null}
        <Button fullWidth label={t.common.save} onPress={() => onSave(a.trim(), b.trim())} />
      </View>
    </Sheet>
  );
}
