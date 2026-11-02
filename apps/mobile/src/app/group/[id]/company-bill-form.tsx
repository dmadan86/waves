import { SuspendedGate } from '@/components/company/SuspendedBanner';
import { useState, type ComponentProps } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useLocalSearchParams } from 'expo-router';
import { Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import {
  computeDocTotals,
  docNumberLabel,
  format,
  formatQty,
  lineAmount,
  money,
  parseQtyMilli,
  validateDoc,
  type CurrencyCode,
} from '@waves/core';
import { AmountField, Screen, Sheet, Text, useTheme } from '@waves/ui';
import { useGroupPhotoUrl } from '@/components/GroupPhoto';
import { OverflowMenu } from '@/components/OverflowMenu';
import { ListRow, PlainHeader } from '@/components/standard';
import { useCompanyClients } from '@/data/companyClients';
import {
  useCompanyDocs,
  useRecordDocPayment,
  useSaveCompanyDoc,
  useSetEstimateStatus,
} from '@/data/companyDocuments';
import { useGroup } from '@/data/hooks';
import { todayIso } from '@/data/personal';
import { fill, useStrings } from '@/i18n';
import { decideBillPayment, type BillPayChoice } from '@/lib/billPayment';
import { useBottomClearance } from '@/lib/clearance';
import { renderCompanyDocHtml } from '@/lib/companyDocPdf';
import { percentToMinor } from '@/lib/discount';
import { dateFrom, isoDate, showDate } from '@/lib/expenseDay';
import { router } from '@/lib/navigation';
import { printAvailable, printHtml } from '@/lib/print';

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
    inquiryId,
    copyFrom,
  } = useLocalSearchParams<{
    id: string;
    docId?: string;
    type?: string;
    clientId?: string;
    inquiryId?: string;
    copyFrom?: string;
  }>();
  const view = useCompanyDocs(id);
  const { t } = useStrings();
  const doc = view.docs.find((d) => d.id === docId && !d.deleted);
  const copy = view.docs.find((d) => d.id === copyFrom && !d.deleted);
  if (!view.canUse) return null;
  if ((docId && !doc) || (copyFrom && !copy))
    return (
      <Screen>
        <PlainHeader title={t.companyDocs.title} />
        {view.ready ? <Text>{t.companyDocs.notFound}</Text> : null}
      </Screen>
    );
  if (doc?.convertedTo) return null;
  return (
    <DocumentForm
      key={doc?.id ?? 'new'}
      groupId={id}
      doc={doc}
      seed={doc ?? copy}
      type={type}
      clientId={clientId}
      inquiryId={inquiryId}
    />
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
  seed,
  type,
  clientId,
  inquiryId,
}: {
  groupId: string;
  doc?: ReturnType<typeof useCompanyDocs>['docs'][number];
  /** What the fields start from: the doc being edited, or a doc being duplicated into a new one. */
  seed?: ReturnType<typeof useCompanyDocs>['docs'][number];
  type?: string;
  /** A new document started from a client: prefills the name and phone and links it. */
  clientId?: string;
  /** With a client: the inquiry this estimate answers (dropped if another client is picked). */
  inquiryId?: string;
}) {
  const view = useCompanyDocs(groupId);
  const client = useCompanyClients(groupId).clients.find((c) => c.id === clientId);
  const clients = useCompanyClients(groupId).clients;
  const save = useSaveCompanyDoc(groupId);
  const pay = useRecordDocPayment(groupId);
  const setStatus = useSetEstimateStatus(groupId);
  const { group } = useGroup(groupId);
  const logoUrl = useGroupPhotoUrl(group.data?.photo_path);
  const { t, locale } = useStrings();
  const c = t.companyDocs;
  const theme = useTheme();
  const clearance = useBottomClearance();
  const currency = view.currency as CurrencyCode;
  const [docType, setDocType] = useState<'bill' | 'estimate'>(
    seed?.docType ?? (type === 'bill' ? 'bill' : 'estimate'),
  );
  const [pickClient, setPickClient] = useState(false);
  const [linkedClient, setLinkedClient] = useState(client?.id ?? seed?.clientId ?? undefined);
  const [openCustomer, setOpenCustomer] = useState(false);
  const [rowMenu, setRowMenu] = useState<number | null>(null);
  const [statusMenu, setStatusMenu] = useState(false);
  const [moreMenu, setMoreMenu] = useState(false);
  const [statusSel, setStatusSel] = useState(doc?.status ?? 'draft');
  const [pctMode, setPctMode] = useState(false);
  const [pct, setPct] = useState('');
  const [openNotes, setOpenNotes] = useState(!!seed?.notes);
  const [expanded, setExpanded] = useState<number | null>(0);
  const [payChoice, setPayChoice] = useState<BillPayChoice>('unpaid');
  const [partMinor, setPartMinor] = useState(0n);
  const [name, setName] = useState(seed?.customerName ?? client?.name ?? '');
  const [phone, setPhone] = useState(seed?.customerPhone ?? client?.phone ?? '');
  const [date, setDate] = useState(doc?.docDate ?? todayIso());
  const [picking, setPicking] = useState(false);
  const [notes, setNotes] = useState(seed?.notes ?? '');
  const [amountDiscount, setDiscount] = useState(seed?.discountMinor ?? 0n);
  const [items, setItems] = useState(
    seed?.items.map((i, index) => ({
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
  const subtotal = computeDocTotals(parsed, 0n).subtotalMinor;
  // A percentage is turned into minor units here, so the server only ever sees an amount.
  const discount = pctMode ? percentToMinor(subtotal, pct) : amountDiscount;
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
    if (save.isPending || pay.isPending || setStatus.isPending) return;
    const values = {
      docType,
      customerName: name,
      customerPhone: phone,
      docDate: date,
      items: parsed,
      discountMinor: discount,
      notes,
      ...(doc || !linkedClient ? {} : { clientId: linkedClient }),
      ...(doc || !inquiryId || linkedClient !== clientId ? {} : { inquiryId }),
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
    if (doc && docType === 'estimate' && statusSel !== doc.status) {
      try {
        await setStatus.mutateAsync({
          docId: doc.id,
          status: statusSel as 'draft' | 'sent' | 'accepted' | 'declined',
        });
      } catch {
        setError(c.failed);
        return;
      }
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
  const preview = () =>
    doc &&
    void printHtml(
      renderCompanyDocHtml(
        {
          ...doc,
          customerName: name.trim(),
          customerPhone: phone.trim() || null,
          docDate: date,
          items: parsed.map((i, n) => ({ ...i, amountMinor: totals.lines[n]! })),
          discountMinor: discount,
          totalMinor: total,
          notes: notes.trim() || null,
        },
        {
          companyName: view.companyName,
          logoUrl,
          labels: c,
          formatMoney: fmt,
          formatDate: (d) => showDate(d, locale),
        },
      ),
    ).catch(() => setError(t.groupExport.exportFailed));
  const busy = save.isPending || pay.isPending || setStatus.isPending;
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
  const typeLabel = docType === 'bill' ? c.bill : c.estimate;
  const numberLabel = doc ? docNumberLabel(doc.docType, doc.number) : '';
  const box = {
    minHeight: 44,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border,
  };
  const saveAndShare = {
    icon: 'paper-plane-outline' as const,
    label: c.saveShare,
    onPress: () => void submit(true),
  };
  const moreItems = [
    ...(doc
      ? []
      : [
          { icon: 'receipt-outline' as const, label: c.bill, onPress: () => setDocType('bill') },
          {
            icon: 'document-text-outline' as const,
            label: c.estimate,
            onPress: () => setDocType('estimate'),
          },
        ]),
    ...(busy ? [] : [saveAndShare]),
  ];
  const statusOptions = ['draft', 'sent', 'accepted', 'declined'] as const;
  return (
    <Screen edges={[]}>
      <PlainHeader
        title={
          doc
            ? docType === 'bill'
              ? c.editBill
              : c.editEstimate
            : docType === 'bill'
              ? c.newBill
              : c.newEstimate
        }
        subtitle={doc ? `${numberLabel} · ${c[doc.status]}` : undefined}
        trailing={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
            {doc && printAvailable() ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => void preview()}
                style={{
                  height: 36,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  paddingHorizontal: theme.spacing.md,
                  borderRadius: theme.radius.pill,
                  borderWidth: 1,
                  borderColor: theme.color.brandSoft,
                }}
              >
                <Ionicons name="eye-outline" size={18} color={theme.color.brand} />
                <Text style={{ color: theme.color.brand, fontWeight: '700' }}>{c.preview}</Text>
              </Pressable>
            ) : null}
            {moreItems.length ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t.group.more}
                hitSlop={12}
                onPress={() => setMoreMenu(true)}
              >
                <Ionicons name="ellipsis-vertical" size={24} color={theme.color.text} />
              </Pressable>
            ) : null}
          </View>
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
        <View style={card}>
          <View style={rowStyle}>
            <Pressable
              accessibilityRole="button"
              onPress={() => setOpenCustomer(!openCustomer)}
              style={{ ...rowStyle, flex: 1, paddingVertical: theme.spacing.sm }}
            >
              <View
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.color.brandSoft,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="storefront-outline" size={24} color={theme.color.brand} />
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  variant="heading"
                  numberOfLines={1}
                  style={{ fontWeight: '800' }}
                  tone={name ? undefined : 'muted'}
                >
                  {name || c.selectCustomer}
                </Text>
                {phone ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Ionicons name="call-outline" size={16} color={theme.color.textMuted} />
                    <Text tone="muted">{phone}</Text>
                  </View>
                ) : null}
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
        <View style={{ ...card, paddingVertical: theme.spacing.md, gap: theme.spacing.md }}>
          <Text variant="heading" style={{ fontWeight: '800' }}>
            {fill(c.detailsTitle, { type: typeLabel })}
          </Text>
          <View style={{ flexDirection: 'row', gap: theme.spacing.md, flexWrap: 'wrap' }}>
            {doc ? (
              <View style={{ flex: 1, minWidth: 140, gap: 4 }}>
                <Text variant="caption" tone="muted">
                  {docType === 'bill' ? c.billNo : c.estimateNo}
                </Text>
                <View style={box}>
                  <Text>{numberLabel}</Text>
                </View>
              </View>
            ) : null}
            <View style={{ flex: 1, minWidth: 140, gap: 4 }}>
              <Text variant="caption" tone="muted">
                {c.date}
              </Text>
              <Pressable accessibilityRole="button" onPress={openDate} style={box}>
                <Ionicons name="calendar-outline" size={18} color={theme.color.textMuted} />
                <Text>{showDate(date, locale)}</Text>
              </Pressable>
            </View>
            {doc && docType === 'estimate' ? (
              <View style={{ flex: 1, minWidth: 140, gap: 4 }}>
                <Text variant="caption" tone="muted">
                  {c.status}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setStatusMenu(true)}
                  style={{
                    ...box,
                    backgroundColor: theme.color.brandSoft,
                    justifyContent: 'space-between',
                  }}
                >
                  <Ionicons name="create-outline" size={18} color={theme.color.brand} />
                  <Text style={{ flex: 1, color: theme.color.brand }}>{c[statusSel]}</Text>
                  <Ionicons name="chevron-down" size={18} color={theme.color.brand} />
                </Pressable>
              </View>
            ) : null}
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
        <View style={card}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingVertical: theme.spacing.md,
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
                  borderWidth: 1,
                  borderColor: theme.color.brandSoft,
                }}
              >
                <Ionicons name="add" size={18} color={theme.color.brand} />
                <Text style={{ color: theme.color.brand, fontWeight: '700' }}>{c.addItem}</Text>
              </Pressable>
            ) : null}
          </View>
          {items.map((item, index) => (
            <View
              key={item.key}
              style={{
                borderTopWidth: 1,
                borderTopColor: theme.color.border,
                paddingVertical: theme.spacing.sm,
              }}
            >
              <View style={{ ...rowStyle, minHeight: 56, gap: theme.spacing.sm }}>
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: theme.radius.md,
                    backgroundColor: theme.color.surfaceMuted,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Ionicons name="cube-outline" size={20} color={theme.color.brand} />
                </View>
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
                    {`${item.qty} × ${fmt(item.rateMinor)}`}
                  </Text>
                </Pressable>
                <View style={{ ...box, minHeight: 36, paddingHorizontal: theme.spacing.sm }}>
                  <Text style={{ fontWeight: '700' }}>{fmt(lineAmount(parsed[index]!))}</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t.group.more}
                  hitSlop={8}
                  onPress={() => setRowMenu(item.key)}
                >
                  <Ionicons name="ellipsis-vertical" size={20} color={theme.color.textMuted} />
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
        <View style={{ ...card, paddingVertical: theme.spacing.md, gap: theme.spacing.sm }}>
          <ListRow title={c.subtotal} amount={fmt(totals.subtotalMinor)} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
            <Text style={{ fontWeight: '600' }}>{c.discount}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => setPctMode(!pctMode)}
              style={{
                height: 32,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                paddingHorizontal: theme.spacing.md,
                borderRadius: theme.radius.pill,
                backgroundColor: theme.color.brandSoft,
              }}
            >
              <Text style={{ color: theme.color.brand, fontWeight: '700' }}>
                {pctMode ? '%' : currency}
              </Text>
              <Ionicons name="swap-horizontal" size={14} color={theme.color.brand} />
            </Pressable>
            <View style={{ flex: 1, alignItems: 'flex-end' }}>
              {pctMode ? (
                <View style={{ ...box, width: 120 }}>
                  <TextInput
                    accessibilityLabel={c.discount}
                    keyboardType="decimal-pad"
                    value={pct}
                    onChangeText={setPct}
                    placeholder="0"
                    placeholderTextColor={theme.color.textFaint}
                    style={{ flex: 1, textAlign: 'right', color: theme.color.text, fontSize: 16 }}
                  />
                  <Text tone="muted">%</Text>
                </View>
              ) : (
                <View style={{ width: 160 }}>
                  <AmountField
                    currency={currency}
                    value={amountDiscount}
                    onChange={setDiscount}
                    size="compact"
                  />
                </View>
              )}
            </View>
          </View>
          {pctMode && discount > 0n ? (
            <Text variant="caption" tone="muted" style={{ textAlign: 'right' }}>
              {'−'} {fmt(discount)}
            </Text>
          ) : null}
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: theme.spacing.md,
              borderRadius: theme.radius.md,
              backgroundColor: theme.color.brandSoft,
            }}
          >
            <Text variant="heading" style={{ fontWeight: '800' }}>
              {c.total}
            </Text>
            <Text variant="heading" style={{ fontWeight: '800', fontSize: 22 }}>
              {fmt(total)}
            </Text>
          </View>
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
          onPress={() => void submit(false)}
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
          <Ionicons name="checkmark-circle-outline" size={20} color={theme.color.onBrand} />
          <Text style={{ color: theme.color.onBrand, fontWeight: '700' }}>
            {doc ? c.saveChanges : c.save}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.back()}
          style={{
            flex: 1,
            height: 48,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: theme.radius.pill,
            borderWidth: 1.5,
            borderColor: theme.color.brandSoft,
          }}
        >
          <Text style={{ fontWeight: '700' }}>{t.common.cancel}</Text>
        </Pressable>
      </View>
      <OverflowMenu visible={moreMenu} onClose={() => setMoreMenu(false)} items={moreItems} />
      <OverflowMenu
        visible={statusMenu}
        onClose={() => setStatusMenu(false)}
        items={statusOptions.map((s) => ({
          icon: 'create-outline' as const,
          label: c[s],
          onPress: () => setStatusSel(s),
        }))}
      />
      <OverflowMenu
        visible={rowMenu !== null}
        onClose={() => setRowMenu(null)}
        items={[
          {
            icon: 'create-outline',
            label: c.edit,
            onPress: () => setExpanded(rowMenu),
          },
          {
            icon: 'trash-outline',
            label: c.removeItem,
            tone: 'danger',
            onPress: () => setItems(items.filter((i) => i.key !== rowMenu)),
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
