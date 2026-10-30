import { useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';

import {
  cleanDetails,
  invalidDetailKeys,
  type DetailKey,
  type DetailsValues,
} from '../../../../../../packages/core/src/company/details';
import { Sheet, Text, useTheme } from '@waves/ui';

import { SaveButton } from '@/components/company/EntryForm';
import { useStrings } from '@/i18n';
import { useDialog } from '@/lib/dialog';
import { friendlyError } from '@/lib/errors';

export function DetailsForm({
  visible,
  onClose,
  initial,
  onSave,
  title,
}: {
  visible: boolean;
  onClose: () => void;
  initial: DetailsValues;
  onSave: (v: DetailsValues) => Promise<unknown>;
  title: string;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const s = t.companyDetails;
  const { notify } = useDialog();
  const [draft, setDraft] = useState<DetailsValues>(initial);
  const [bad, setBad] = useState<DetailKey[]>([]);
  const [saving, setSaving] = useState(false);
  const fieldLabels: Record<DetailKey, string> = {
    bankName: s.accountName,
    bankAccount: s.accountNumber,
    ifsc: s.ifsc,
    upi: s.upi,
    address: s.address,
    phone: s.phone,
    email: s.email,
    gstin: s.gstin,
    pan: s.pan,
    note: s.note,
  };
  const fields: [DetailKey, string, string?, number?][] = [
    ['bankName', s.accountName],
    ['bankAccount', s.accountNumber, 'numeric'],
    ['ifsc', s.ifsc, undefined],
    ['upi', s.upi],
    ['address', s.address, undefined, 300],
    ['phone', s.phone, 'phone-pad'],
    ['email', s.email, 'email-address'],
    ['gstin', s.gstin],
    ['pan', s.pan],
    ['note', s.note, undefined, 500],
  ];
  const field = ([key, label, keyboard, maxLength]: [DetailKey, string, string?, number?]) => (
    <View key={key} style={{ gap: theme.spacing.xs }}>
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        value={draft[key] ?? ''}
        onChangeText={(value) => setDraft((d) => ({ ...d, [key]: value }))}
        keyboardType={keyboard as never}
        autoCapitalize={
          ['ifsc', 'gstin', 'pan'].includes(key)
            ? 'characters'
            : key === 'email'
              ? 'none'
              : 'sentences'
        }
        multiline={key === 'note'}
        maxLength={maxLength}
        style={{
          color: theme.color.text,
          fontSize: 16,
          paddingVertical: theme.spacing.xs,
          borderBottomWidth: 1,
          borderColor: theme.color.border,
          minHeight: key === 'note' ? 72 : 40,
          textAlign: locale.startsWith('ar') ? 'right' : 'left',
        }}
      />
      {bad.includes(key) ? (
        <Text variant="caption" tone="negative">
          {s.invalidField.replace('{field}', fieldLabels[key])}
        </Text>
      ) : null}
    </View>
  );
  return (
    <Sheet visible={visible} onClose={onClose} closeLabel={t.common.close}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: theme.spacing.md, paddingBottom: theme.spacing.lg }}
      >
        <Text variant="title">{title}</Text>
        <Text variant="subheading">{s.bank}</Text>
        {fields.slice(0, 4).map(field)}
        <Text variant="subheading" style={{ marginTop: theme.spacing.sm }}>
          {s.contact}
        </Text>
        {fields.slice(4).map(field)}
        <SaveButton
          label={s.save}
          disabled={saving}
          onPress={() => {
            const v = cleanDetails(draft);
            const invalid = invalidDetailKeys(v);
            setBad(invalid);
            if (invalid.length || saving) return;
            setSaving(true);
            void onSave(v)
              .then(onClose)
              .catch((error: unknown) =>
                notify({
                  title: friendlyError(error, s.saveFailed, 'company.details.save'),
                  tone: 'danger',
                }),
              )
              .finally(() => setSaving(false));
          }}
        />
      </ScrollView>
    </Sheet>
  );
}
