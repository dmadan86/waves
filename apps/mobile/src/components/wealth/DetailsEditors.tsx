/** Edit sheets for the rental Details card: contacts, occupants, maintenance, custom details, multi-line text. */

import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import {
  CONTACTS_MAX,
  CUSTOM_FIELDS_MAX,
  CUSTOM_KEY_MAX,
  CUSTOM_VALUE_MAX,
  MAINTENANCE_FREQUENCIES,
  normaliseContacts,
  normaliseCustomFields,
  OCCUPANTS_MAX,
  type CurrencyCode,
  type MaintenanceFrequency,
} from '@waves/core';
import { AmountField, Button, iconSize, Sheet, Text, useTheme } from '@waves/ui';

import { PersonalNoteField } from '@/components/PersonalNoteField';
import { useStrings } from '@/i18n';

type Contact = { label: string; phone: string };
type Custom = { key: string; value: string };

function Box({
  value,
  onChange,
  label,
  placeholder,
  maxLength,
  multiline,
  phone,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  placeholder?: string;
  maxLength?: number;
  multiline?: boolean;
  phone?: boolean;
}) {
  const theme = useTheme();
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={placeholder ?? label}
      placeholderTextColor={theme.color.textFaint}
      accessibilityLabel={label}
      maxLength={maxLength}
      multiline={multiline}
      keyboardType={phone ? 'phone-pad' : 'default'}
      style={{
        fontSize: 16,
        color: theme.color.text,
        paddingVertical: 10,
        paddingHorizontal: theme.spacing.md,
        borderRadius: theme.radius.md,
        backgroundColor: theme.color.surfaceMuted,
        textAlignVertical: 'top',
        // iOS squeezed an empty single-line box until its placeholder spilled over the next one.
        flexShrink: 0,
        ...(multiline ? { minHeight: 64 } : { minHeight: 44 }),
      }}
    />
  );
}

/** Multi-line text (address, notes) that grows, ~4 lines to start; notes also get the mic. */
export function MultilineSheet({
  title,
  initial,
  dictate,
  onSave,
  onClose,
}: {
  title: string;
  initial: string;
  dictate?: boolean;
  onSave: (v: string) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const [v, setV] = useState(initial);
  return (
    <Sheet visible onClose={onClose} title={title} closeLabel={t.common.close}>
      <View style={{ gap: theme.spacing.lg }}>
        {dictate ? (
          <PersonalNoteField
            value={v}
            onChange={setV}
            placeholder={title}
            accessibilityLabel={title}
            minHeight={96}
          />
        ) : (
          <TextInput
            value={v}
            onChangeText={setV}
            placeholder={title}
            placeholderTextColor={theme.color.textFaint}
            accessibilityLabel={title}
            multiline
            style={{
              minHeight: 96,
              fontSize: 16,
              lineHeight: 22,
              color: theme.color.text,
              padding: theme.spacing.md,
              borderRadius: theme.radius.md,
              backgroundColor: theme.color.surfaceMuted,
              textAlignVertical: 'top',
            }}
          />
        )}
        <Button label={t.common.save} onPress={() => onSave(v.trim())} />
      </View>
    </Sheet>
  );
}

function RemoveButton({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={10} onPress={onPress}>
      <Ionicons name="close-circle-outline" size={iconSize.md} color={theme.color.textMuted} />
    </Pressable>
  );
}

export function ContactsSheet({
  initial,
  onSave,
  onClose,
}: {
  initial: readonly Contact[];
  onSave: (list: Contact[]) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const w = t.wealth;
  const [list, setList] = useState<Contact[]>(
    initial.length ? [...initial] : [{ label: '', phone: '' }],
  );
  const set = (i: number, patch: Partial<Contact>): void =>
    setList((l) => l.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  return (
    <Sheet visible onClose={onClose} title={w.contactsTitle} closeLabel={t.common.close}>
      <View style={{ gap: theme.spacing.lg }}>
        <ScrollView style={{ maxHeight: 360 }} keyboardShouldPersistTaps="handled">
          <View style={{ gap: theme.spacing.md }}>
            {list.map((c, i) => (
              <View
                key={i}
                style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}
              >
                <View style={{ flex: 1, gap: theme.spacing.xs }}>
                  <Box
                    value={c.label}
                    onChange={(v) => set(i, { label: v })}
                    label={w.contactName}
                    maxLength={60}
                  />
                  <Box
                    value={c.phone}
                    onChange={(v) => set(i, { phone: v })}
                    label={w.contactPhone}
                    maxLength={30}
                    phone
                  />
                </View>
                <RemoveButton
                  label={w.removeContact}
                  onPress={() => setList((l) => l.filter((_, j) => j !== i))}
                />
              </View>
            ))}
          </View>
        </ScrollView>
        {list.length < CONTACTS_MAX ? (
          <Button
            label={w.addContact}
            variant="secondary"
            onPress={() => setList((l) => [...l, { label: '', phone: '' }])}
          />
        ) : null}
        <Button label={t.common.save} onPress={() => onSave(normaliseContacts(list))} />
      </View>
    </Sheet>
  );
}

export function OccupantsSheet({
  initial,
  onSave,
  onClose,
}: {
  initial: number | null;
  onSave: (n: number) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const w = t.wealth;
  const [n, setN] = useState(initial ?? 0);
  const step = (label: string, icon: 'remove' | 'add', next: number, off: boolean) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: off }}
      disabled={off}
      onPress={() => setN(next)}
      style={{
        width: 48,
        height: 48,
        borderRadius: 24,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.color.brandSoft,
        opacity: off ? 0.4 : 1,
      }}
    >
      <Ionicons name={icon} size={iconSize.lg} color={theme.color.brand} />
    </Pressable>
  );
  return (
    <Sheet visible onClose={onClose} title={w.occupantsLabel} closeLabel={t.common.close}>
      <View style={{ gap: theme.spacing.lg }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: theme.spacing.xl,
          }}
        >
          {step(w.occupantsFewer, 'remove', n - 1, n <= 0)}
          <Text
            variant="title"
            accessibilityLabel={`${w.occupantsLabel} ${n}`}
            style={{ minWidth: 48, textAlign: 'center' }}
          >
            {String(n)}
          </Text>
          {step(w.occupantsMore, 'add', n + 1, n >= OCCUPANTS_MAX)}
        </View>
        <Button label={t.common.save} onPress={() => onSave(n)} />
      </View>
    </Sheet>
  );
}

export function MaintenanceSheet({
  currency,
  amount,
  frequency,
  onSave,
  onClose,
}: {
  currency: CurrencyCode;
  amount: bigint;
  frequency: MaintenanceFrequency;
  onSave: (amount: bigint | null, frequency: MaintenanceFrequency) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const w = t.wealth;
  const [a, setA] = useState(amount);
  const [f, setF] = useState(frequency);
  return (
    <Sheet visible onClose={onClose} title={w.maintenanceLabel} closeLabel={t.common.close}>
      <View style={{ gap: theme.spacing.lg }}>
        <AmountField currency={currency} value={a} onChange={setA} />
        <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
          {MAINTENANCE_FREQUENCIES.map((x) => (
            <Pressable
              key={x}
              accessibilityRole="button"
              accessibilityState={{ selected: f === x }}
              onPress={() => setF(x)}
              style={{
                flex: 1,
                minHeight: 44,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: theme.radius.lg,
                backgroundColor: f === x ? theme.color.brand : theme.color.surfaceMuted,
              }}
            >
              <Text
                variant="body"
                style={{
                  fontWeight: '600',
                  color: f === x ? theme.color.onBrand : theme.color.text,
                }}
              >
                {w.frequencies[x]}
              </Text>
            </Pressable>
          ))}
        </View>
        <Button label={t.common.save} onPress={() => onSave(a > 0n ? a : null, f)} />
      </View>
    </Sheet>
  );
}

export function CustomFieldsSheet({
  initial,
  onSave,
  onClose,
}: {
  initial: readonly Custom[];
  onSave: (list: Custom[]) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const w = t.wealth;
  const [list, setList] = useState<Custom[]>(
    initial.length ? [...initial] : [{ key: '', value: '' }],
  );
  const set = (i: number, patch: Partial<Custom>): void =>
    setList((l) => l.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  return (
    <Sheet visible onClose={onClose} title={w.customTitle} closeLabel={t.common.close}>
      <View style={{ gap: theme.spacing.lg }}>
        <ScrollView style={{ maxHeight: 360 }} keyboardShouldPersistTaps="handled">
          <View style={{ gap: theme.spacing.md }}>
            {list.map((c, i) => (
              <View
                key={i}
                style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}
              >
                <View style={{ flex: 1, gap: theme.spacing.xs }}>
                  <Box
                    value={c.key}
                    onChange={(v) => set(i, { key: v })}
                    label={w.customKey}
                    maxLength={CUSTOM_KEY_MAX}
                  />
                  <Box
                    value={c.value}
                    onChange={(v) => set(i, { value: v })}
                    label={w.customValue}
                    maxLength={CUSTOM_VALUE_MAX}
                    multiline
                  />
                </View>
                <RemoveButton
                  label={w.removeCustom}
                  onPress={() => setList((l) => l.filter((_, j) => j !== i))}
                />
              </View>
            ))}
          </View>
        </ScrollView>
        {list.length < CUSTOM_FIELDS_MAX ? (
          <Button
            label={w.addCustom}
            variant="secondary"
            onPress={() => setList((l) => [...l, { key: '', value: '' }])}
          />
        ) : null}
        <Button label={t.common.save} onPress={() => onSave(normaliseCustomFields(list))} />
      </View>
    </Sheet>
  );
}
