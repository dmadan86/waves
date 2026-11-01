import { useRef, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import {
  orderLineTotal,
  orderTotal,
  qtyThousandths,
  VENDOR_ORDER_UNITS,
  type CurrencyCode,
  type VendorOrderUnit,
} from '@waves/core';
import { AmountField, ChipRow, Screen, Text, useTheme } from '@waves/ui';

import { FieldLabel, SaveButton } from '@/components/company/EntryForm';
import { useOrderLabels } from '@/components/company/vendors/orderParts';
import { validIsoDate, VendorField } from '@/components/company/vendors/forms';
import { useVendorFormat } from '@/components/company/vendors/parts';
import {
  PillButton,
  PlainHeader,
  ScenicBody,
  SegmentedPills,
  StandardCard,
} from '@/components/standard';
import { useCompanyVendors } from '@/data/companyVendors';
import { useSetVendorOrder, useVendorOrders } from '@/data/companyVendorOrders';
import { fill, useStrings } from '@/i18n';
import { useDialog } from '@/lib/dialog';
import { router } from '@/lib/navigation';

interface Row {
  key: string;
  name: string;
  qty: string;
  unit: VendorOrderUnit;
  price: bigint;
}
const blank = (): Row => ({ key: randomUUID(), name: '', qty: '1', unit: 'pieces', price: 0n });

/** New material order (or edit one that is still sent). */
export default function CompanyVendorOrderScreen() {
  const {
    id = '',
    vendorId: vendorParam,
    orderId,
  } = useLocalSearchParams<{
    id: string;
    vendorId?: string;
    orderId?: string;
  }>();
  const theme = useTheme();
  const { t } = useStrings();
  const s = t.companyVendors;
  const view = useCompanyVendors(id);
  const orders = useVendorOrders(id);
  const existing = orderId ? orders.find((o) => o.id === orderId) : undefined;
  const { money } = useVendorFormat(view.currency);
  const labels = useOrderLabels();
  const { notify } = useDialog();
  const save = useSetVendorOrder(id);
  const [vendorId, setVendorId] = useState(existing?.vendorId ?? vendorParam ?? '');
  const [rows, setRows] = useState<Row[]>(
    existing
      ? existing.items.map((i) => ({
          key: randomUUID(),
          name: i.name,
          qty: i.qty.includes('.') ? i.qty.replace(/\.?0+$/, '') : i.qty,
          unit: i.unit,
          price: i.unitPrice,
        }))
      : [blank()],
  );
  const [expectedOn, setExpectedOn] = useState(existing?.expectedOn ?? '');
  const [note, setNote] = useState(existing?.note ?? '');
  // One id per form: a double tap or a retry is the same request to the server.
  const newId = useRef(randomUUID()).current;
  const patch = (key: string, p: Partial<Row>) =>
    setRows((r) => r.map((x) => (x.key === key ? { ...x, ...p } : x)));
  const items = rows.map((r) => ({ name: r.name, qty: r.qty, unit: r.unit, unitPrice: r.price }));
  const valid =
    !!vendorId &&
    rows.length > 0 &&
    rows.every((r) => r.name.trim() && qtyThousandths(r.qty) !== null) &&
    (!expectedOn || validIsoDate(expectedOn)) &&
    view.canManage;
  const submit = () => {
    if (!valid || save.isPending || save.isSuccess) return;
    save.mutate(
      { orderId: existing?.id ?? newId, vendorId, expectedOn, note, items },
      {
        onSuccess: (oid) => {
          void notify({ title: s.orderSent });
          router.replace(`/group/${id}/company-vendor-order-detail?orderId=${oid}`);
        },
      },
    );
  };
  return (
    <Screen edges={[]}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 120 }}
      >
        <PlainHeader title={existing ? s.editOrder : s.orderTitle} />
        <ScenicBody flush>
          <StandardCard style={{ gap: theme.spacing.md }}>
            <FieldLabel>{s.vendorLabel}</FieldLabel>
            {existing ? (
              <Text style={{ fontWeight: '600' }}>
                {view.vendors.find((v) => v.id === vendorId)?.name}
              </Text>
            ) : (
              <ChipRow
                variant="brand"
                wrap
                value={vendorId}
                onChange={setVendorId}
                options={view.vendors.map((v) => ({ value: v.id, label: v.name }))}
              />
            )}
          </StandardCard>
          {rows.map((r) => (
            <StandardCard key={r.key} style={{ gap: theme.spacing.md }}>
              <VendorField
                label={s.itemName}
                value={r.name}
                onChange={(name) => patch(r.key, { name })}
                maxLength={120}
              />
              <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
                <View style={{ width: 96, gap: theme.spacing.sm }}>
                  <FieldLabel>{s.itemQty}</FieldLabel>
                  <TextInput
                    accessibilityLabel={s.itemQty}
                    value={r.qty}
                    onChangeText={(qty) => patch(r.key, { qty: qty.replace(',', '.') })}
                    keyboardType="decimal-pad"
                    maxLength={13}
                    style={{
                      color: theme.color.text,
                      fontSize: 16,
                      paddingVertical: theme.spacing.sm,
                      borderBottomWidth: 1,
                      borderBottomColor:
                        qtyThousandths(r.qty) === null ? theme.color.negative : theme.color.border,
                    }}
                  />
                </View>
                <View style={{ flex: 1, gap: theme.spacing.sm }}>
                  <FieldLabel>{s.itemPrice}</FieldLabel>
                  <AmountField
                    currency={view.currency as CurrencyCode}
                    value={r.price}
                    onChange={(price) => patch(r.key, { price })}
                    size="compact"
                  />
                </View>
              </View>
              <FieldLabel>{s.itemUnit}</FieldLabel>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
                <SegmentedPills
                  options={VENDOR_ORDER_UNITS.map((u) => ({ value: u, label: labels.unit[u]! }))}
                  value={r.unit}
                  onChange={(unit) => patch(r.key, { unit })}
                />
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text tabular tone="muted">
                  {`${r.qty || '0'} × ${money(r.price)} =`}
                </Text>
                <Text tabular style={{ fontWeight: '700' }}>
                  {money(orderLineTotal(r.qty, r.price))}
                </Text>
              </View>
              {rows.length > 1 ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setRows((x) => x.filter((y) => y.key !== r.key))}
                >
                  <Text variant="caption" tone="negative">
                    {s.removeItem}
                  </Text>
                </Pressable>
              ) : null}
            </StandardCard>
          ))}
          {rows.length < 50 ? (
            <View style={{ flexDirection: 'row' }}>
              <PillButton
                label={s.addItem}
                icon="add"
                chevron={false}
                onPress={() => setRows((r) => [...r, blank()])}
              />
            </View>
          ) : null}
          <StandardCard style={{ gap: theme.spacing.md }}>
            <VendorField
              label={`${s.expectedDelivery} (${s.dateHint})`}
              value={expectedOn}
              onChange={setExpectedOn}
              maxLength={10}
            />
            <VendorField label={s.note} value={note} onChange={setNote} maxLength={500} />
          </StandardCard>
          <StandardCard style={{ gap: theme.spacing.sm }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text>{fill(s.orderTotalItems, { n: String(rows.length) })}</Text>
              <Text tabular style={{ fontWeight: '800' }}>
                {money(orderTotal(items))}
              </Text>
            </View>
            <Text variant="caption" tone="muted">
              {s.orderNotBill}
            </Text>
          </StandardCard>
        </ScenicBody>
      </ScrollView>
      <View
        style={{ position: 'absolute', start: 0, end: 0, bottom: 0, padding: theme.spacing.lg }}
      >
        <SaveButton
          label={existing ? s.save : s.sendOrder}
          disabled={!valid || save.isPending || save.isSuccess}
          onPress={submit}
        />
      </View>
    </Screen>
  );
}
