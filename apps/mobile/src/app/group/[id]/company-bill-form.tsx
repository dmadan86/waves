import { SuspendedGate } from '@/components/company/SuspendedBanner';
import { useState, type ComponentProps } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useLocalSearchParams } from 'expo-router';
import { Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import {
  computeDocTotals,
  format,
  formatQty,
  lineAmount,
  money,
  parseQtyMilli,
  validateDoc,
  currencySymbol,
  type CurrencyCode,
} from '@waves/core';
import { AmountField, Screen, Sheet, Text, useTheme } from '@waves/ui';
import { OverflowMenu } from '@/components/OverflowMenu';
import { ListRow, PlainHeader, StandardCard } from '@/components/standard';
import { useCompanyClients } from '@/data/companyClients';
import { useCompanyDocs, useRecordDocPayment, useSaveCompanyDoc } from '@/data/companyDocuments';
import { todayIso } from '@/data/personal';
import { fill, useStrings } from '@/i18n';
import { decideBillPayment, type BillPayChoice } from '@/lib/billPayment';
import { useBottomClearance } from '@/lib/clearance';
import { dateFrom, isoDate, showDate } from '@/lib/expenseDay';
import { router } from '@/lib/navigation';
import { printAvailable } from '@/lib/print';

export default function CompanyBillFormScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  return (
    <SuspendedGate groupId={id}>
      <BillForm />
    </SuspendedGate>
  );
}

function BillForm() {
  const {
    id = '',
    docId,
    type,
    clientId,
  } = useLocalSearchParams<{ id: string; docId?: string; type?: string; clientId?: string }>();
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
  return (
    <DocumentForm key={doc?.id ?? 'new'} groupId={id} doc={doc} type={type} clientId={clientId} />
  );
}

type IconName = ComponentProps<typeof Ionicons>['name'];

function IconCircle({ name }: { name: IconName }) {
  const theme = useTheme();
  return (
    <View
      style={{
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: theme.color.brandSoft,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Ionicons name={name} size={18} color={theme.color.brand} />
    </View>
  );
}

function DocumentForm({
  groupId,
  doc,
  type,
  clientId,
}: {
  groupId: string;
  doc?: ReturnType<typeof useCompanyDocs>['docs'][number];
  type?: string;
  /** A new document started from a client: prefills the name and phone and links it. */
  clientId?: string;
}) {
  const view = useCompanyDocs(groupId);
  const client = useCompanyClients(groupId).clients.find((c) => c.id === clientId);
  const clients = useCompanyClients(groupId).clients;
  const save = useSaveCompanyDoc(groupId);
  const pay = useRecordDocPayment(groupId);
  const { t, locale } = useStrings();
  const c = t.companyDocs;
  const theme = useTheme();
  const clearance = useBottomClearance();
  const currency = view.currency as CurrencyCode;
  const [docType, setDocType] = useState<'bill' | 'estimate'>(
    doc?.docType ?? (type === 'bill' ? 'bill' : 'estimate'),
  );
  const [typeMenu, setTypeMenu] = useState(false);
  const [pickClient, setPickClient] = useState(false);
  const [linkedClient, setLinkedClient] = useState(client?.id);
  const [openCustomer, setOpenCustomer] = useState(false);
  const [openDiscount, setOpenDiscount] = useState(false);
  const [openNotes, setOpenNotes] = useState(!!doc?.notes);
  const [expanded, setExpanded] = useState<number | null>(doc ? null : 0);
  const [payChoice, setPayChoice] = useState<BillPayChoice>('unpaid');
  const [partMinor, setPartMinor] = useState(0n);
  const [name, setName] = useState(doc?.customerName ?? client?.name ?? '');
  const [phone, setPhone] = useState(doc?.customerPhone ?? client?.phone ?? '');
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
  const totals = computeDocTotals(parsed, discount);
  const total = totals.totalMinor;
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
  const submit = async (share: boolean) => {
    if (save.isPending || pay.isPending) return;
    const values = {
      docType,
      customerName: name,
      customerPhone: phone,
      docDate: date,
      items: parsed,
      discountMinor: discount,
      notes,
      ...(doc || !linkedClient ? {} : { clientId: linkedClient }),
    };
    const code = validateDoc(values, doc?.paidMinor ?? 0n);
    if (code) {
      setError(c[`${code}Error`]);
      return;
    }
    const owed = !doc && docType === 'bill' ? decideBillPayment(payChoice, total, partMinor) : null;
    if (typeof owed === 'string') {
      setError(c[`${owed}Error`]);
      return;
    }
    setError('');
    let savedId: string;
    try {
      savedId = await save.mutateAsync({ docId: doc?.id, values });
    } catch {
      setError(c.failed);
      return;
    }
    // The doc is saved; a failed payment is recorded later from the doc screen.
    if (owed !== null)
      await pay
        .mutateAsync({ docId: savedId, amountMinor: owed, paidOn: todayIso() })
        .catch(() => undefined);
    router.replace(
      `/group/${groupId}/company-bill?docId=${savedId}${share && printAvailable() ? '&share=1' : ''}`,
    );
  };
  const patch = (key: number, p: Partial<(typeof items)[number]>) =>
    setItems(items.map((i) => (i.key === key ? { ...i, ...p } : i)));
  const step = (key: number, delta: bigint) => {
    const item = items.find((i) => i.key === key)!;
    const cur = parseQtyMilli(item.qty) ?? 1000n;
    // Minus never goes below 1 and never raises a fractional qty (0.5 stays 0.5).
    if (delta < 0n && cur <= 1000n) return;
    const next = cur + delta;
    patch(key, { qty: formatQty(next < 1000n ? 1000n : next) });
  };
  const busy = save.isPending || pay.isPending;
  const card = {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    paddingHorizontal: theme.spacing.md,
  };
  const rowStyle = {
    minHeight: 52,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: theme.spacing.md,
  };
  const pill = (active: boolean) => ({
    flex: 1,
    height: 40,
    borderRadius: theme.radius.pill,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: active ? theme.color.brand : theme.color.surfaceMuted,
  });
  const payOptions: [BillPayChoice, string][] = [
    ['unpaid', c.unpaid],
    ['part', c.part_paid],
    ['paid', c.paid],
  ];
  return (
    <Screen edges={[]}>
      <PlainHeader
        title={
          doc
            ? docType === 'bill'
              ? c.bill
              : c.estimate
            : docType === 'bill'
              ? c.createBill
              : c.createEstimate
        }
        trailing={
          doc ? undefined : (
            <Pressable
              accessibilityRole="button"
              onPress={() => setTypeMenu(true)}
              style={{
                height: 36,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                paddingHorizontal: theme.spacing.md,
                borderRadius: theme.radius.pill,
                backgroundColor: theme.color.surface,
              }}
            >
              <Text style={{ fontWeight: '700' }}>{docType === 'bill' ? c.bill : c.estimate}</Text>
              <Ionicons name="chevron-down" size={16} color={theme.color.text} />
            </Pressable>
          )
        }
      />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          padding: theme.spacing.lg,
          paddingTop: 0,
          paddingBottom: theme.spacing.lg,
          gap: theme.spacing.md,
        }}
      >
        <Text variant="caption" tone="muted">
          {docType === 'bill' ? c.billSubtitle : c.estimateSubtitle}
        </Text>
        <View style={card}>
          <View style={rowStyle}>
            <Pressable
              accessibilityRole="button"
              onPress={() => setOpenCustomer(!openCustomer)}
              style={{ ...rowStyle, flex: 1 }}
            >
              <IconCircle name="person-outline" />
              <View style={{ flex: 1 }}>
                <Text variant="caption" tone="muted">
                  {c.customer}
                </Text>
                <Text
                  numberOfLines={1}
                  style={{ fontWeight: '700' }}
                  tone={name ? undefined : 'muted'}
                >
                  {name || c.selectCustomer}
                </Text>
              </View>
              <Ionicons
                name={openCustomer ? 'chevron-down' : 'chevron-forward'}
                size={18}
                color={theme.color.textMuted}
              />
            </Pressable>
            {clients.length > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={c.pickClient}
                hitSlop={8}
                onPress={() => setPickClient(true)}
                style={{
                  borderStartWidth: 1,
                  borderStartColor: theme.color.border,
                  paddingStart: theme.spacing.md,
                  height: 36,
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="people-outline" size={22} color={theme.color.brand} />
              </Pressable>
            ) : null}
          </View>
          {openCustomer ? (
            <View style={{ paddingBottom: theme.spacing.md }}>
              <Text variant="caption">{c.customer}</Text>
              <TextInput
                accessibilityLabel={c.customer}
                value={name}
                onChangeText={(v) => {
                  setName(v);
                  setLinkedClient(undefined);
                }}
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
            </View>
          ) : null}
        </View>
        <View style={{ ...card, flexDirection: 'row' }}>
          <Pressable accessibilityRole="button" onPress={openDate} style={{ ...rowStyle, flex: 1 }}>
            <IconCircle name="calendar-outline" />
            <View>
              <Text variant="caption" tone="muted">
                {c.billDate}
              </Text>
              <Text style={{ fontWeight: '700' }}>{showDate(date, locale)}</Text>
            </View>
          </Pressable>
          <View style={{ ...rowStyle, flex: 1 }}>
            <IconCircle name="cash-outline" />
            <View>
              <Text variant="caption" tone="muted">
                {c.currency}
              </Text>
              <Text style={{ fontWeight: '700' }}>
                {currency} {currencySymbol(currency, locale)}
              </Text>
            </View>
          </View>
        </View>
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
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: theme.spacing.sm,
          }}
        >
          <Text variant="heading" style={{ fontWeight: '800' }}>
            {fill(c.itemsCount, { n: items.length })}
          </Text>
          {items.length < 50 ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setItems([...items, { key: nextKey, description: '', qty: '1', rateMinor: 0n }]);
                setExpanded(nextKey);
                setNextKey(nextKey + 1);
              }}
              style={{
                height: 36,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                paddingHorizontal: theme.spacing.md,
                borderRadius: theme.radius.pill,
                backgroundColor: theme.color.brandSoft,
              }}
            >
              <Ionicons name="add" size={18} color={theme.color.brand} />
              <Text style={{ color: theme.color.brand, fontWeight: '700' }}>{c.addItem}</Text>
            </Pressable>
          ) : null}
        </View>
        <View style={card}>
          {items.map((item, index) => (
            <View
              key={item.key}
              style={{
                borderTopWidth: index ? 1 : 0,
                borderTopColor: theme.color.border,
                paddingVertical: theme.spacing.sm,
              }}
            >
              <View style={{ ...rowStyle, minHeight: 56, gap: theme.spacing.sm }}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setExpanded(expanded === item.key ? null : item.key)}
                  style={{ flex: 1 }}
                >
                  <Text
                    numberOfLines={1}
                    style={{ fontWeight: '700' }}
                    tone={item.description ? undefined : 'muted'}
                  >
                    {item.description || c.description}
                  </Text>
                  <Text variant="caption" tone="muted" numberOfLines={1}>
                    {fill(c.rateEach, { rate: fmt(item.rateMinor) })}
                  </Text>
                </Pressable>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    borderRadius: theme.radius.pill,
                    backgroundColor: theme.color.surfaceMuted,
                  }}
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="-"
                    hitSlop={6}
                    onPress={() => step(item.key, -1000n)}
                    style={{ padding: 6 }}
                  >
                    <Ionicons name="remove" size={16} color={theme.color.brand} />
                  </Pressable>
                  <Text style={{ minWidth: 24, textAlign: 'center', fontWeight: '700' }}>
                    {item.qty}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="+"
                    hitSlop={6}
                    onPress={() => step(item.key, 1000n)}
                    style={{ padding: 6 }}
                  >
                    <Ionicons name="add" size={16} color={theme.color.brand} />
                  </Pressable>
                </View>
                <Text style={{ fontWeight: '700', minWidth: 64, textAlign: 'right' }}>
                  {fmt(lineAmount(parsed[index]!))}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={c.removeItem}
                  hitSlop={8}
                  onPress={() => setItems(items.filter((i) => i.key !== item.key))}
                >
                  <Ionicons name="close" size={18} color={theme.color.textMuted} />
                </Pressable>
              </View>
              {expanded === item.key ? (
                <View style={{ paddingBottom: theme.spacing.sm }}>
                  <Text variant="caption">{c.description}</Text>
                  <TextInput
                    accessibilityLabel={c.description}
                    value={item.description}
                    onChangeText={(description) => patch(item.key, { description })}
                    style={input}
                  />
                  <View
                    style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text variant="caption">{c.qty}</Text>
                      <TextInput
                        accessibilityLabel={c.qty}
                        keyboardType="decimal-pad"
                        value={item.qty}
                        onChangeText={(qty) => patch(item.key, { qty })}
                        style={input}
                      />
                    </View>
                    <View style={{ flex: 2 }}>
                      <Text variant="caption">{c.rate}</Text>
                      <AmountField
                        currency={currency}
                        value={item.rateMinor}
                        size="compact"
                        onChange={(rateMinor) => patch(item.key, { rateMinor })}
                      />
                    </View>
                  </View>
                </View>
              ) : null}
            </View>
          ))}
        </View>
        <View style={card}>
          <Pressable
            accessibilityRole="button"
            onPress={() => setOpenDiscount(!openDiscount)}
            style={rowStyle}
          >
            <IconCircle name="pricetag-outline" />
            <Text style={{ flex: 1, fontWeight: '700' }}>{c.discount}</Text>
            {discount > 0n ? <Text tone="muted">{fmt(discount)}</Text> : null}
            <Ionicons
              name={openDiscount ? 'chevron-down' : 'chevron-forward'}
              size={18}
              color={theme.color.textMuted}
            />
          </Pressable>
          {openDiscount ? (
            <View style={{ paddingBottom: theme.spacing.md }}>
              <AmountField
                currency={currency}
                value={discount}
                onChange={setDiscount}
                size="compact"
              />
            </View>
          ) : null}
        </View>
        <View style={card}>
          <Pressable
            accessibilityRole="button"
            onPress={() => setOpenNotes(!openNotes)}
            style={rowStyle}
          >
            <IconCircle name="document-text-outline" />
            <Text style={{ flex: 1, fontWeight: '700' }}>{c.notesOptional}</Text>
            <Ionicons
              name={openNotes ? 'chevron-down' : 'chevron-forward'}
              size={18}
              color={theme.color.textMuted}
            />
          </Pressable>
          {openNotes ? (
            <TextInput
              accessibilityLabel={c.notes}
              value={notes}
              onChangeText={setNotes}
              multiline
              style={{ ...input, marginBottom: theme.spacing.md }}
            />
          ) : null}
        </View>
        <View style={{ ...card, paddingVertical: theme.spacing.md, gap: theme.spacing.sm }}>
          <ListRow title={c.subtotal} amount={fmt(totals.subtotalMinor)} />
          {discount > 0n ? (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: theme.color.positive }}>{c.discount}</Text>
              <Text style={{ color: theme.color.positive }}>
                {'\u2212'} {fmt(totals.subtotalMinor - total)}
              </Text>
            </View>
          ) : null}
          <View style={{ height: 1, backgroundColor: theme.color.border }} />
          <View
            style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <Text variant="heading" style={{ fontWeight: '800' }}>
              {c.total}
            </Text>
            <Text
              variant="heading"
              style={{ color: theme.color.brand, fontWeight: '800', fontSize: 22 }}
            >
              {fmt(total)}
            </Text>
          </View>
        </View>
        {!doc && docType === 'bill' ? (
          <View style={{ ...card, paddingVertical: theme.spacing.md, gap: theme.spacing.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
              <IconCircle name="wallet-outline" />
              <Text style={{ fontWeight: '700' }}>{c.paymentStatus}</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
              {payOptions.map(([k, label]) => (
                <Pressable
                  key={k}
                  accessibilityRole="button"
                  accessibilityState={{ selected: payChoice === k }}
                  onPress={() => setPayChoice(k)}
                  style={pill(payChoice === k)}
                >
                  <Text
                    style={{
                      fontWeight: '700',
                      color: payChoice === k ? theme.color.onBrand : theme.color.text,
                    }}
                  >
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>
            {payChoice === 'part' ? (
              <AmountField
                currency={currency}
                value={partMinor}
                onChange={setPartMinor}
                size="compact"
              />
            ) : null}
          </View>
        ) : null}
        {error ? (
          <Text tone="negative" variant="caption">
            {error}
          </Text>
        ) : null}
      </ScrollView>
      <View
        style={{
          flexDirection: 'row',
          gap: theme.spacing.md,
          padding: theme.spacing.lg,
          paddingBottom: clearance,
          backgroundColor: theme.color.bg,
        }}
      >
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => void submit(true)}
          style={{
            flex: 2,
            height: 48,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: theme.spacing.sm,
            borderRadius: theme.radius.pill,
            backgroundColor: theme.color.brand,
            opacity: busy ? 0.45 : 1,
          }}
        >
          <Ionicons name="paper-plane-outline" size={18} color={theme.color.onBrand} />
          <Text style={{ color: theme.color.onBrand, fontWeight: '700' }}>{c.saveShare}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => void submit(false)}
          style={{
            flex: 1,
            height: 48,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: theme.radius.pill,
            borderWidth: 1.5,
            borderColor: theme.color.brand,
            opacity: busy ? 0.45 : 1,
          }}
        >
          <Text style={{ color: theme.color.brand, fontWeight: '700' }}>{c.save}</Text>
        </Pressable>
      </View>
      <OverflowMenu
        visible={typeMenu}
        onClose={() => setTypeMenu(false)}
        items={[
          { icon: 'receipt-outline', label: c.bill, onPress: () => setDocType('bill') },
          {
            icon: 'document-text-outline',
            label: c.estimate,
            onPress: () => setDocType('estimate'),
          },
        ]}
      />
      <Sheet visible={pickClient} onClose={() => setPickClient(false)} title={c.pickClient}>
        <ScrollView style={{ maxHeight: 360 }}>
          {clients.map((cl) => (
            <ListRow
              key={cl.id}
              title={cl.name}
              subtitle={cl.phone ?? undefined}
              onPress={() => {
                setName(cl.name);
                setPhone(cl.phone ?? '');
                setLinkedClient(cl.id);
                setPickClient(false);
              }}
            />
          ))}
        </ScrollView>
      </Sheet>
    </Screen>
  );
}
