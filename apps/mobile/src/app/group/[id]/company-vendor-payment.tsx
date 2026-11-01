import { useRef, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { randomUUID } from 'expo-crypto';

import {
  paymentOutcome,
  vendorOverdue,
  type CurrencyCode,
  type VendorPayMethod,
} from '@waves/core';
import { AmountField, Screen, Text, useTheme } from '@waves/ui';

import { FieldLabel, SaveButton } from '@/components/company/EntryForm';
import {
  PhotoStrip,
  useLinePhotos,
  validIsoDate,
  VendorField,
} from '@/components/company/vendors/forms';
import { Pill, useVendorFormat } from '@/components/company/vendors/parts';
import {
  PillButton,
  PlainHeader,
  ScenicBody,
  SegmentedPills,
  StandardCard,
} from '@/components/standard';
import { useAddVendorLine, useCompanyVendors } from '@/data/companyVendors';
import { todayIso } from '@/data/personal';
import { fill, useStrings } from '@/i18n';
import { useDialog } from '@/lib/dialog';
import { router } from '@/lib/navigation';

/** Record a payment (or an advance) against a vendor. It records; it never sends money. */
export default function CompanyVendorPaymentScreen() {
  const { id = '', vendorId = '' } = useLocalSearchParams<{ id: string; vendorId?: string }>();
  const theme = useTheme();
  const { t } = useStrings();
  const s = t.companyVendors;
  const view = useCompanyVendors(id);
  const { money } = useVendorFormat(view.currency);
  const { notify } = useDialog();
  const add = useAddVendorLine(id);
  const vendor = view.vendors.find((v) => v.id === vendorId);
  const lines = view.lines.filter((l) => l.vendorId === vendorId);
  const balance = view.balances.get(vendorId) ?? 0n;
  const overdue = vendorOverdue(lines, todayIso());
  const [amount, setAmount] = useState(0n);
  const [kind, setKind] = useState<'payment' | 'advance'>('payment');
  const [method, setMethod] = useState<VendorPayMethod>('upi');
  const [date, setDate] = useState(todayIso());
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const { photos, setPhotos, uploadPhotos, pickPhoto } = useLinePhotos(id);
  // One id per form, so a double tap or a retry is the same request to the server.
  const entryId = useRef(randomUUID()).current;
  const out = paymentOutcome(balance, amount);
  const valid = amount > 0n && validIsoDate(date) && !!vendor && view.canManage;
  const submit = () => {
    if (!valid || add.isPending || add.isSuccess) return;
    add.mutate(
      {
        entryId,
        vendorId,
        kind,
        amountMinor: amount,
        occurredOn: date,
        note,
        method: kind === 'payment' ? method : null,
        reference: kind === 'payment' ? reference : null,
      },
      {
        onSuccess: (lineId) => {
          if (photos.length) void uploadPhotos(lineId, photos);
          void notify({ title: s.paymentRecorded });
          // Payments open their receipt; an advance goes back to the vendor.
          if (kind === 'payment')
            router.replace(`/group/${id}/company-vendor-receipt?entryId=${lineId}`);
          else router.back();
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
        <PlainHeader title={s.recordPayment} />
        <ScenicBody flush>
          <StandardCard style={{ gap: theme.spacing.md }}>
            <Text style={{ fontWeight: '600' }}>{vendor?.name ?? s.notFound}</Text>
            <Text variant="caption" tone="muted">
              {`${s.currentOutstanding}: ${money(balance < 0n ? -balance : balance)}`}
            </Text>
            <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
              <SegmentedPills
                options={[
                  { value: 'payment', label: s.payment },
                  { value: 'advance', label: s.advance },
                ]}
                value={kind}
                onChange={setKind}
              />
            </View>
            <FieldLabel>{s.amountLabel}</FieldLabel>
            <AmountField
              currency={view.currency as CurrencyCode}
              value={amount}
              onChange={setAmount}
              size="compact"
            />
            <View style={{ flexDirection: 'row', gap: theme.spacing.sm, flexWrap: 'wrap' }}>
              {balance > 0n ? (
                <PillButton
                  label={fill(s.quickFull, { amount: money(balance) })}
                  chevron={false}
                  onPress={() => setAmount(balance)}
                />
              ) : null}
              {overdue > 0n ? (
                <PillButton
                  label={fill(s.quickOverdue, { amount: money(overdue) })}
                  chevron={false}
                  onPress={() => setAmount(overdue)}
                />
              ) : null}
            </View>
            {amount > 0n ? (
              <View style={{ gap: 4 }}>
                <Text style={{ fontWeight: '600' }}>
                  {fill(s.stillToPay, { amount: money(out.remaining > 0n ? out.remaining : 0n) })}
                </Text>
                {out.advance > 0n ? (
                  <Pill label={fill(s.keptAsAdvance, { amount: money(out.advance) })} tone="warn" />
                ) : null}
              </View>
            ) : null}
          </StandardCard>
          <StandardCard style={{ gap: theme.spacing.md }}>
            {kind === 'payment' ? (
              <>
                <FieldLabel>{s.paidBy}</FieldLabel>
                <View style={{ flexDirection: 'row', gap: theme.spacing.sm, flexWrap: 'wrap' }}>
                  <SegmentedPills
                    options={[
                      { value: 'upi', label: s.mUpi },
                      { value: 'bank', label: s.mBank },
                      { value: 'cash', label: s.mCash },
                      { value: 'other', label: s.mOther },
                    ]}
                    value={method}
                    onChange={setMethod}
                  />
                </View>
              </>
            ) : null}
            <VendorField
              label={`${s.date} (${s.dateHint})`}
              value={date}
              onChange={setDate}
              maxLength={10}
            />
            {kind === 'payment' ? (
              <VendorField
                label={s.reference}
                value={reference}
                onChange={setReference}
                maxLength={64}
              />
            ) : null}
            <VendorField label={s.note} value={note} onChange={setNote} maxLength={500} />
            <FieldLabel>{s.proofPhoto}</FieldLabel>
            <PhotoStrip photos={photos} setPhotos={setPhotos} pickPhoto={pickPhoto} />
          </StandardCard>
          <Text variant="caption" tone="muted" align="center">
            {s.recordsNote}
          </Text>
        </ScenicBody>
      </ScrollView>
      <View
        style={{ position: 'absolute', start: 0, end: 0, bottom: 0, padding: theme.spacing.lg }}
      >
        <SaveButton
          label={s.recordPayment}
          disabled={!valid || add.isPending || add.isSuccess}
          onPress={submit}
        />
      </View>
    </Screen>
  );
}
