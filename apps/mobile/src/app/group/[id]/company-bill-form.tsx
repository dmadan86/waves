import { useState } from 'react';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useLocalSearchParams } from 'expo-router';
import { Platform, ScrollView, TextInput, View } from 'react-native';
import {
  computeDocTotals,
  format,
  formatQty,
  lineAmount,
  money,
  parseQtyMilli,
  validateDoc,
  type CurrencyCode,
} from '@waves/core';
import { AmountField, Button, Screen, Text, useTheme } from '@waves/ui';
import { ListRow, PlainHeader, SectionHeader, StandardCard } from '@/components/standard';
import { useCompanyDocs, useSaveCompanyDoc } from '@/data/companyDocuments';
import { todayIso } from '@/data/personal';
import { useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';
import { dateFrom, isoDate, showDate } from '@/lib/expenseDay';
import { router } from '@/lib/navigation';

export default function CompanyBillFormScreen() {
  const {
    id = '',
    docId,
    type,
  } = useLocalSearchParams<{ id: string; docId?: string; type?: string }>();
  const view = useCompanyDocs(id);
  const { t } = useStrings();
  const doc = view.docs.find((d) => d.id === docId && !d.deleted);
  if (!view.canUse) return null;
  if (docId && !doc)
    return (
      <Screen>
        <PlainHeader title={t.companyDocs.title} />
        {view.ready ? <Text>{t.companyDocs.notFound}</Text> : null}
      </Screen>
    );
  if (doc?.convertedTo) return null;
  return <DocumentForm key={doc?.id ?? 'new'} groupId={id} doc={doc} type={type} />;
}

function DocumentForm({
  groupId,
  doc,
  type,
}: {
  groupId: string;
  doc?: ReturnType<typeof useCompanyDocs>['docs'][number];
  type?: string;
}) {
  const view = useCompanyDocs(groupId);
  const save = useSaveCompanyDoc(groupId);
  const { t, locale } = useStrings();
  const c = t.companyDocs;
  const theme = useTheme();
  const clearance = useBottomClearance();
  const currency = view.currency as CurrencyCode;
  const docType = doc?.docType ?? (type === 'bill' ? 'bill' : 'estimate');
  const [name, setName] = useState(doc?.customerName ?? '');
  const [phone, setPhone] = useState(doc?.customerPhone ?? '');
  const [date, setDate] = useState(doc?.docDate ?? todayIso());
  const [picking, setPicking] = useState(false);
  const [notes, setNotes] = useState(doc?.notes ?? '');
  const [discount, setDiscount] = useState(doc?.discountMinor ?? 0n);
  const [items, setItems] = useState(
    doc?.items.map((i, index) => ({
      key: index,
      description: i.description,
      qty: formatQty(i.qtyMilli),
      rateMinor: i.rateMinor,
    })) ?? [{ key: 0, description: '', qty: '1', rateMinor: 0n }],
  );
  const [nextKey, setNextKey] = useState(items.length);
  const [error, setError] = useState('');
  const parsed = items.map((i) => ({
    description: i.description,
    qtyMilli: parseQtyMilli(i.qty) ?? 0n,
    rateMinor: i.rateMinor,
  }));
  const total = computeDocTotals(parsed, discount).totalMinor;
  const fmt = (v: bigint) => format(money(v, currency), { locale });
  const input = {
    color: theme.color.text,
    borderBottomColor: theme.color.border,
    borderBottomWidth: 1,
    paddingVertical: theme.spacing.sm,
    fontSize: 16,
  };
  const openDate = () => {
    if (Platform.OS === 'android')
      DateTimePickerAndroid.open({
        value: dateFrom(date),
        mode: 'date',
        onChange: (event, picked) => {
          if (event.type === 'set' && picked) setDate(isoDate(picked));
        },
      });
    else setPicking(!picking);
  };
  const submit = async () => {
    if (save.isPending) return;
    const values = {
      docType,
      customerName: name,
      customerPhone: phone,
      docDate: date,
      items: parsed,
      discountMinor: discount,
      notes,
    };
    const code = validateDoc(values, doc?.paidMinor ?? 0n);
    if (code) {
      setError(c[`${code}Error`]);
      return;
    }
    setError('');
    try {
      const savedId = await save.mutateAsync({ docId: doc?.id, values });
      router.replace(`/group/${groupId}/company-bill?docId=${savedId}`);
    } catch {
      setError(c.failed);
    }
  };
  return (
    <Screen edges={[]}>
      <PlainHeader title={docType === 'bill' ? c.bill : c.estimate} />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          padding: theme.spacing.lg,
          paddingBottom: clearance,
          gap: theme.spacing.md,
        }}
      >
        <StandardCard>
          <Text variant="caption">{c.customer}</Text>
          <TextInput
            accessibilityLabel={c.customer}
            value={name}
            onChangeText={setName}
            maxLength={120}
            style={input}
          />
          <Text variant="caption">{c.phone}</Text>
          <TextInput
            accessibilityLabel={c.phone}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            style={input}
          />
          <ListRow title={c.date} amount={showDate(date, locale)} onPress={openDate} />
          {picking && Platform.OS !== 'android' ? (
            <DateTimePicker
              value={dateFrom(date)}
              mode="date"
              display="inline"
              onChange={(_, picked) => {
                if (picked) setDate(isoDate(picked));
              }}
            />
          ) : null}
        </StandardCard>
        {items.map((item, index) => (
          <StandardCard key={item.key}>
            <Text variant="caption">{c.description}</Text>
            <TextInput
              accessibilityLabel={c.description}
              value={item.description}
              onChangeText={(description) =>
                setItems(items.map((i) => (i.key === item.key ? { ...i, description } : i)))
              }
              style={input}
            />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
              <View style={{ flex: 1 }}>
                <Text variant="caption">{c.qty}</Text>
                <TextInput
                  accessibilityLabel={c.qty}
                  keyboardType="decimal-pad"
                  value={item.qty}
                  onChangeText={(qty) =>
                    setItems(items.map((i) => (i.key === item.key ? { ...i, qty } : i)))
                  }
                  style={input}
                />
              </View>
              <View style={{ flex: 2 }}>
                <Text variant="caption">{c.rate}</Text>
                <AmountField
                  currency={currency}
                  value={item.rateMinor}
                  size="compact"
                  onChange={(rateMinor) =>
                    setItems(items.map((i) => (i.key === item.key ? { ...i, rateMinor } : i)))
                  }
                />
              </View>
            </View>
            <ListRow title={c.amount} amount={fmt(lineAmount(parsed[index]!))} />
            <Button
              label={c.removeItem}
              variant="ghost"
              onPress={() => setItems(items.filter((i) => i.key !== item.key))}
            />
          </StandardCard>
        ))}
        {items.length < 50 ? (
          <Button
            label={c.addItem}
            variant="brand"
            onPress={() => {
              setItems([...items, { key: nextKey, description: '', qty: '1', rateMinor: 0n }]);
              setNextKey(nextKey + 1);
            }}
          />
        ) : null}
        <StandardCard>
          <Text variant="caption">{c.discount}</Text>
          <AmountField currency={currency} value={discount} onChange={setDiscount} size="compact" />
          <Text variant="caption">{c.notes}</Text>
          <TextInput
            accessibilityLabel={c.notes}
            value={notes}
            onChangeText={setNotes}
            multiline
            style={input}
          />
          <SectionHeader title={c.total} trailing={<Text>{fmt(total)}</Text>} />
        </StandardCard>
        {error ? (
          <Text tone="negative" variant="caption">
            {error}
          </Text>
        ) : null}
        <Button
          label={c.save}
          variant="brand"
          disabled={save.isPending}
          onPress={() => void submit()}
        />
      </ScrollView>
    </Screen>
  );
}
