import { useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';

import type { CurrencyCode, Vendor, VendorLineKind } from '@waves/core';
import { AmountField, Sheet, Text, useTheme } from '@waves/ui';

import { FieldLabel, SaveButton } from '@/components/company/EntryForm';
import { SegmentedPills } from '@/components/standard';
import { useAddVendorLine, useSetVendor } from '@/data/companyVendors';
import { todayIso } from '@/data/personal';
import { useStrings } from '@/i18n';

export function VendorField({
  label,
  value,
  onChange,
  maxLength = 120,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
}) {
  const theme = useTheme();
  const { locale } = useStrings();
  return (
    <View style={{ gap: theme.spacing.sm }}>
      <FieldLabel>{label}</FieldLabel>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        maxLength={maxLength}
        style={{
          color: theme.color.text,
          fontSize: 16,
          textAlign: locale.startsWith('ar') ? 'right' : 'left',
          paddingVertical: theme.spacing.sm,
          borderBottomWidth: 1,
          borderBottomColor: theme.color.border,
        }}
      />
    </View>
  );
}

export function VendorForm({
  groupId,
  vendor,
  onClose,
  onSaved,
}: {
  groupId: string;
  vendor?: Vendor;
  onClose: () => void;
  onSaved?: (id: string) => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const s = t.companyVendors;
  const save = useSetVendor(groupId);
  const [name, setName] = useState(vendor?.name ?? '');
  const [phone, setPhone] = useState(vendor?.phone ?? '');
  const [category, setCategory] = useState(vendor?.category ?? '');
  return (
    <Sheet visible onClose={onClose} closeLabel={s.close}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: theme.spacing.lg }}
      >
        <Text variant="title">{vendor ? s.rename : s.addVendor}</Text>
        <VendorField label={s.name} value={name} onChange={setName} />
        <VendorField label={s.phone} value={phone} onChange={setPhone} />
        <VendorField label={s.category} value={category} onChange={setCategory} />
        <SaveButton
          label={s.save}
          disabled={!name.trim() || save.isPending}
          onPress={() => {
            if (!name.trim() || save.isPending) return;
            save.mutate(
              { vendorId: vendor?.id, name: name.trim(), phone, category },
              {
                onSuccess: (id) => {
                  onClose();
                  onSaved?.(id);
                },
              },
            );
          }}
        />
      </ScrollView>
    </Sheet>
  );
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function VendorLineForm({
  groupId,
  vendorId,
  currency,
  payment = false,
  submitted = false,
  onClose,
}: {
  groupId: string;
  vendorId: string;
  currency: string;
  payment?: boolean;
  submitted?: boolean;
  onClose: () => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const s = t.companyVendors;
  const add = useAddVendorLine(groupId);
  const [amount, setAmount] = useState(0n);
  const [date, setDate] = useState(todayIso());
  const [note, setNote] = useState('');
  const [kind, setKind] = useState<VendorLineKind>(payment ? 'payment' : 'bill');
  const valid = amount > 0n && validDate(date);
  return (
    <Sheet visible onClose={onClose} closeLabel={s.close}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: theme.spacing.lg }}
      >
        <Text variant="title">{payment ? s.recordPayment : s.addBill}</Text>
        {submitted ? (
          <Text variant="caption" tone="muted">
            {s.billHint}
          </Text>
        ) : null}
        {payment ? (
          <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
            <SegmentedPills
              options={[
                { value: 'advance', label: s.advance },
                { value: 'payment', label: s.payment },
              ]}
              value={kind}
              onChange={setKind}
            />
          </View>
        ) : null}
        <FieldLabel>{s.amount}</FieldLabel>
        <AmountField
          currency={currency as CurrencyCode}
          value={amount}
          onChange={setAmount}
          size="compact"
        />
        <VendorField
          label={`${s.date} (${s.dateHint})`}
          value={date}
          onChange={setDate}
          maxLength={10}
        />
        {!validDate(date) ? (
          <Text variant="caption" tone="negative">
            {s.invalidDate}
          </Text>
        ) : null}
        <VendorField label={s.note} value={note} onChange={setNote} maxLength={500} />
        <SaveButton
          label={payment ? s.recordPayment : s.addBill}
          disabled={!valid || add.isPending}
          onPress={() => {
            if (!valid || add.isPending) return;
            add.mutate(
              { vendorId, kind, amountMinor: amount, occurredOn: date, note },
              { onSuccess: onClose },
            );
          }}
        />
      </ScrollView>
    </Sheet>
  );
}
