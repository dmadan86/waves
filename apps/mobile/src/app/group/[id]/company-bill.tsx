import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useLocalSearchParams } from 'expo-router';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import {
  billDueMinor,
  computeDocTotals,
  docNumberLabel,
  format,
  formatQty,
  lineAmount,
  money,
  validatePayment,
  type CurrencyCode,
  type MirrorCompanyDoc,
} from '@waves/core';
import { AmountField, Button, Screen, Sheet, Text, useTheme } from '@waves/ui';
import { useGroupPhotoUrl } from '@/components/GroupPhoto';
import { OverflowMenu, type OverflowMenuItem } from '@/components/OverflowMenu';
import { ListRow, PlainHeader, StandardCard, SectionHeader } from '@/components/standard';
import {
  useCompanyDocs,
  useConvertToBill,
  useRecordDocPayment,
  useSetEstimateStatus,
  useVoidCompanyDoc,
} from '@/data/companyDocuments';
import { useGroup } from '@/data/hooks';
import { todayIso } from '@/data/personal';
import { useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';
import { renderCompanyDocHtml, type CompanyDocPdfOptions } from '@/lib/companyDocPdf';
import { useDialog } from '@/lib/dialog';
import { dateFrom, isoDate, showDate } from '@/lib/expenseDay';
import { router } from '@/lib/navigation';
import { printAvailable, printHtmlToFile } from '@/lib/print';

export async function shareCompanyDocPdf(
  doc: MirrorCompanyDoc,
  options: CompanyDocPdfOptions,
): Promise<boolean> {
  if (!printAvailable()) return false;
  const uri = await printHtmlToFile(renderCompanyDocHtml(doc, options));
  if (!uri) return false;
  const file = new FileSystem.File(uri);
  try {
    if (!(await Sharing.isAvailableAsync())) return false;
    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      UTI: 'com.adobe.pdf',
      dialogTitle: docNumberLabel(doc.docType, doc.number),
    });
    return true;
  } finally {
    try {
      if (file.exists) file.delete();
    } catch {
      /* Best-effort privacy cleanup. */
    }
  }
}

export default function CompanyBillScreen() {
  const { id = '', docId } = useLocalSearchParams<{ id: string; docId?: string }>();
  const view = useCompanyDocs(id);
  const { group } = useGroup(id);
  const logoUrl = useGroupPhotoUrl(group.data?.photo_path);
  const status = useSetEstimateStatus(id);
  const convert = useConvertToBill(id);
  const payment = useRecordDocPayment(id);
  const remove = useVoidCompanyDoc(id);
  const { t, locale } = useStrings();
  const c = t.companyDocs;
  const theme = useTheme();
  const clearance = useBottomClearance();
  const { confirm } = useDialog();
  const [menu, setMenu] = useState(false);
  const [recording, setRecording] = useState(false);
  const [amount, setAmount] = useState(0n);
  const [date, setDate] = useState(todayIso());
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState('');
  const [paymentError, setPaymentError] = useState('');
  const [sharing, setSharing] = useState(false);
  const doc = view.docs.find((d) => d.id === docId && !d.deleted);
  const busy =
    status.isPending || convert.isPending || payment.isPending || remove.isPending || sharing;
  const fmt = (v: bigint) => format(money(v, view.currency as CurrencyCode), { locale });
  const run = async (work: () => Promise<unknown>) => {
    setError('');
    try {
      await work();
    } catch {
      setError(c.failed);
    }
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
  if (!view.canUse) return null;
  if (!doc)
    return (
      <Screen edges={[]}>
        <PlainHeader title={c.title} />
        {view.ready ? <Text>{c.notFound}</Text> : null}
      </Screen>
    );
  const due = billDueMinor(doc.totalMinor, doc.paidMinor);
  const editable = !doc.convertedTo;
  const menuItems: OverflowMenuItem[] = busy
    ? []
    : [
        ...(editable
          ? [
              {
                icon: 'create-outline' as const,
                label: c.edit,
                onPress: () => router.push(`/group/${id}/company-bill-form?docId=${doc.id}`),
              },
            ]
          : []),
        ...(doc.paidMinor === 0n && !doc.convertedTo
          ? [
              {
                icon: 'trash-outline' as const,
                label: c.delete,
                tone: 'danger' as const,
                onPress: () =>
                  void run(async () => {
                    if (
                      await confirm({
                        title: c.deleteTitle,
                        body: c.deleteBody,
                        confirmLabel: c.delete,
                        tone: 'danger',
                      })
                    ) {
                      await remove.mutateAsync({ docId: doc.id });
                      router.back();
                    }
                  }),
              },
            ]
          : []),
      ];
  const linked = doc.convertedTo ?? doc.convertedFrom;
  const record = async () => {
    if (busy) return;
    const code = validatePayment(doc.totalMinor, doc.paidMinor, amount);
    if (code) {
      setPaymentError(c[`${code}Error`]);
      return;
    }
    setPaymentError('');
    try {
      await payment.mutateAsync({ docId: doc.id, amountMinor: amount, paidOn: date });
      setRecording(false);
      setAmount(0n);
    } catch {
      setPaymentError(c.failed);
    }
  };
  return (
    <Screen edges={[]}>
      <PlainHeader
        title={docNumberLabel(doc.docType, doc.number)}
        trailing={
          menuItems.length ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.group.more}
              hitSlop={12}
              onPress={() => setMenu(true)}
            >
              <Ionicons name="ellipsis-vertical" size={24} color={theme.color.text} />
            </Pressable>
          ) : undefined
        }
      />
      <ScrollView
        contentContainerStyle={{
          padding: theme.spacing.lg,
          paddingBottom: clearance,
          gap: theme.spacing.md,
        }}
      >
        <StandardCard>
          <Text variant="heading">{doc.customerName}</Text>
          {doc.customerPhone ? <Text tone="muted">{doc.customerPhone}</Text> : null}
          <Text variant="caption" tone="muted">
            {showDate(doc.docDate, locale)} · {c[doc.status]}
            {doc.number === null ? ` · ${c.syncing}` : ''}
          </Text>
        </StandardCard>
        <StandardCard>
          {doc.items.map((i, index) => (
            <ListRow
              key={index}
              title={i.description}
              subtitle={`${formatQty(i.qtyMilli)} × ${fmt(i.rateMinor)}`}
              amount={fmt(lineAmount(i))}
              divider
            />
          ))}
          <ListRow
            title={c.subtotal}
            amount={fmt(computeDocTotals(doc.items, doc.discountMinor).subtotalMinor)}
          />
          <ListRow title={c.discount} amount={fmt(doc.discountMinor)} />
          <ListRow title={c.total} amount={fmt(doc.totalMinor)} />
          {doc.docType === 'bill' ? (
            <>
              <ListRow title={c.payments} amount={fmt(doc.paidMinor)} />
              <ListRow title={c.amountLeft} amount={fmt(due)} />
            </>
          ) : null}
        </StandardCard>
        {doc.notes ? (
          <StandardCard>
            <Text>{doc.notes}</Text>
          </StandardCard>
        ) : null}
        {doc.docType === 'bill' && doc.payments.length ? (
          <StandardCard>
            <SectionHeader title={c.payments} />
            {doc.payments.map((p) => (
              <ListRow key={p.id} title={showDate(p.paidOn, locale)} amount={fmt(p.amountMinor)} />
            ))}
          </StandardCard>
        ) : null}
        {doc.docType === 'estimate' && !doc.convertedTo ? (
          <View style={{ gap: theme.spacing.sm }}>
            {(doc.status === 'draft'
              ? (['sent'] as const)
              : doc.status === 'sent'
                ? (['accepted', 'declined'] as const)
                : []
            ).map((s) => (
              <Button
                key={s}
                label={c[s]}
                variant="brand"
                disabled={busy}
                onPress={() => void run(() => status.mutateAsync({ docId: doc.id, status: s }))}
              />
            ))}
            <Button
              label={c.convert}
              variant="brand"
              disabled={busy}
              onPress={() =>
                void run(async () => {
                  const billId = await convert.mutateAsync({ docId: doc.id });
                  router.replace(`/group/${id}/company-bill?docId=${billId}`);
                })
              }
            />
          </View>
        ) : null}
        {doc.docType === 'bill' && due > 0n ? (
          <Button
            label={c.recordPayment}
            variant="brand"
            disabled={busy}
            onPress={() => {
              setPaymentError('');
              setRecording(true);
            }}
          />
        ) : null}
        {linked ? (
          <ListRow
            title={doc.convertedTo ? c.linkedBill : c.linkedEstimate}
            onPress={() => router.push(`/group/${id}/company-bill?docId=${linked}`)}
          />
        ) : null}
        <Button
          label={c.sharePdf}
          variant="brand"
          disabled={busy}
          onPress={() =>
            void run(async () => {
              setSharing(true);
              try {
                if (!printAvailable()) {
                  setError(t.groupExport.updateNeeded);
                  return;
                }
                const shared = await shareCompanyDocPdf(doc, {
                  companyName: view.companyName,
                  logoUrl,
                  labels: c,
                  formatMoney: fmt,
                  formatDate: (d) => showDate(d, locale),
                });
                if (!shared) setError(t.groupExport.exportFailed);
              } finally {
                setSharing(false);
              }
            })
          }
        />
        {error ? (
          <Text variant="caption" tone="negative">
            {error}
          </Text>
        ) : null}
      </ScrollView>
      <OverflowMenu visible={menu} onClose={() => setMenu(false)} items={menuItems} />
      <Sheet
        visible={recording}
        onClose={() => {
          if (!payment.isPending) setRecording(false);
        }}
        title={c.recordPayment}
      >
        <View style={{ gap: theme.spacing.md }}>
          <Text>{c.amount}</Text>
          <AmountField
            currency={view.currency as CurrencyCode}
            value={amount}
            onChange={setAmount}
            size="hero"
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
          {paymentError ? (
            <Text variant="caption" tone="negative">
              {paymentError}
            </Text>
          ) : null}
          <Button
            label={c.recordPayment}
            variant="brand"
            disabled={busy}
            onPress={() => void record()}
          />
        </View>
      </Sheet>
    </Screen>
  );
}
