import { useCompanyEntries, useCompanySuspended } from '@/data/companyEntries';
import { useEffect, useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useLocalSearchParams } from 'expo-router';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Linking, Platform, Pressable, ScrollView, View } from 'react-native';
import {
  billDueMinor,
  billUpiLink,
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
import type { ComponentProps } from 'react';
import { UpiPayCard } from '@/components/company/UpiPayCard';
import { useCompanyCard } from '@/data/companyDetails';
import { useGroupPhotoUrl } from '@/components/GroupPhoto';
import { OverflowMenu, type OverflowMenuItem } from '@/components/OverflowMenu';
import { PersonAvatar } from '@/components/PersonAvatar';
import { ListRow, PlainHeader, StandardCard } from '@/components/standard';
import { stageChange, useCompanyClients, useSetClient } from '@/data/companyClients';
import {
  useCompanyDocs,
  useConvertToBill,
  useRecordDocPayment,
  useSetEstimateStatus,
  useVoidCompanyDoc,
} from '@/data/companyDocuments';
import { useGroup } from '@/data/hooks';
import { displayName, type MemberRow } from '@/data/types';
import { todayIso } from '@/data/personal';
import { fill, useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';
import { renderCompanyDocHtml, type CompanyDocPdfOptions } from '@/lib/companyDocPdf';
import { useDialog } from '@/lib/dialog';
import { closingStamp, docTimeline } from '@/lib/docTimeline';
import { dateFrom, isoDate, showDate, showTime } from '@/lib/expenseDay';
import { router } from '@/lib/navigation';
import { printAvailable, printHtml, printHtmlToFile } from '@/lib/print';

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
  const {
    id = '',
    docId,
    share,
  } = useLocalSearchParams<{ id: string; docId?: string; share?: string }>();
  const view = useCompanyDocs(id);
  const { group } = useGroup(id);
  const logoUrl = useGroupPhotoUrl(group.data?.photo_path);
  const status = useSetEstimateStatus(id);
  const convert = useConvertToBill(id);
  const payment = useRecordDocPayment(id);
  const remove = useVoidCompanyDoc(id);
  const clients = useCompanyClients(id);
  const setClient = useSetClient(id);
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
  const [allEvents, setAllEvents] = useState(false);
  const entries = useCompanyEntries(id);
  const members = entries.members;
  // Bank details (incl. UPI ID) only reach the owner and managers, so nobody else sees the QR.
  const vpa = useCompanyCard(id).card?.values.upi ?? null;
  const qrRef = useRef<{ toDataURL: (cb: (b64: string) => void) => void } | null>(null);
  const doc = view.docs.find((d) => d.id === docId && !d.deleted);
  const suspended = useCompanySuspended(id);
  const busy =
    status.isPending ||
    convert.isPending ||
    payment.isPending ||
    remove.isPending ||
    sharing ||
    suspended; // read-only while suspended
  const fmt = (v: bigint) => format(money(v, view.currency as CurrencyCode), { locale });
  const run = async (work: () => Promise<unknown>) => {
    setError('');
    try {
      await work();
    } catch {
      setError(c.failed);
    }
  };
  const pdfOptions: CompanyDocPdfOptions = {
    companyName: view.companyName,
    logoUrl,
    labels: c,
    formatMoney: fmt,
    formatDate: (d) => showDate(d, locale),
  };
  // The PDF carries the same QR as the screen: read it back off the mounted code.
  const pdfWithUpi = async (): Promise<CompanyDocPdfOptions> => {
    const b64 =
      vpa && upiLink
        ? await new Promise<string | null>((res) =>
            qrRef.current ? qrRef.current.toDataURL(res) : res(null),
          )
        : null;
    return b64 && vpa
      ? {
          ...pdfOptions,
          upi: {
            id: vpa,
            qrDataUrl: `data:image/png;base64,${b64}`,
            scanLabel: fill(c.upiScan, { amount: fmt(due) }),
          },
        }
      : pdfOptions;
  };
  const printDoc = () =>
    run(async () => {
      if (doc && !(await printHtml(renderCompanyDocHtml(doc, await pdfWithUpi()))))
        setError(t.groupExport.updateNeeded);
    });
  const sharePdf = () =>
    run(async () => {
      if (!doc) return;
      setSharing(true);
      try {
        if (!printAvailable()) {
          setError(t.groupExport.updateNeeded);
          return;
        }
        const shared = await shareCompanyDocPdf(doc, await pdfWithUpi());
        if (!shared) setError(t.groupExport.exportFailed);
      } finally {
        setSharing(false);
      }
    });
  // "Save & share" on the form lands here with share=1: open the share sheet once.
  const autoShared = useRef(false);
  useEffect(() => {
    if (share === '1' && doc && view.canUse && !autoShared.current) {
      autoShared.current = true;
      void sharePdf();
    }
  });
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
                onPress: () => router.push(editHref),
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
  const memberOf = (mid: string | null | undefined) => members.find((m) => m.id === mid);
  const nameOf = (mid: string | null | undefined) => {
    const m = memberOf(mid);
    return m ? displayName(m) : '';
  };
  const stamp = (at: string, dayOnly?: boolean) =>
    dayOnly
      ? showDate(at, locale)
      : `${dateFrom(at.slice(0, 10)).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })} · ${showTime(Date.parse(at), locale)}`;
  const editHref = `/group/${id}/company-bill-form?docId=${doc.id}` as const;
  const tone = pillTone(theme, doc.status);
  const closed = closingStamp(doc);
  const events = docTimeline(doc);
  const shownEvents = allEvents ? events : events.slice(0, 3);
  const estimateActions =
    doc.docType === 'estimate' && !doc.convertedTo
      ? doc.status === 'draft'
        ? (['sent'] as const)
        : doc.status === 'sent'
          ? (['accepted', 'declined'] as const)
          : []
      : [];
  const canConvert = doc.docType === 'estimate' && !doc.convertedTo;
  const canPay = doc.docType === 'bill' && due > 0n;
  const upiLink =
    vpa && doc.docType === 'bill'
      ? billUpiLink({
          vpa,
          payeeName: view.companyName,
          totalMinor: doc.totalMinor,
          paidMinor: doc.paidMinor,
          currency: view.currency,
          number: doc.number,
        })
      : null;
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
        title={`${c[doc.docType]} ${docNumberLabel(doc.docType, doc.number)}`}
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
          <View style={{ flexDirection: 'row', gap: theme.spacing.md, alignItems: 'flex-start' }}>
            <Tile icon="storefront-outline" />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="heading" numberOfLines={2}>
                {doc.customerName}
              </Text>
              {doc.customerPhone ? (
                <Pressable
                  accessibilityRole="link"
                  hitSlop={8}
                  onPress={() => void Linking.openURL(`tel:${doc.customerPhone}`).catch(() => {})}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
                >
                  <Ionicons name="call-outline" size={16} color={theme.color.textMuted} />
                  <Text tone="muted">{doc.customerPhone}</Text>
                </Pressable>
              ) : null}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Ionicons name="calendar-outline" size={16} color={theme.color.textMuted} />
                <Text tone="muted">{showDate(doc.docDate, locale)}</Text>
              </View>
            </View>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                paddingHorizontal: theme.spacing.md,
                height: 32,
                borderRadius: theme.radius.sm,
                backgroundColor: tone.bg,
              }}
            >
              <Ionicons name={tone.icon} size={16} color={tone.ink} />
              <Text variant="caption" style={{ color: tone.ink, fontWeight: '700' }}>
                {doc.number === null ? c.syncing : c[doc.status]}
              </Text>
            </View>
          </View>
          {doc.createdAt || closed ? (
            <View
              style={{
                flexDirection: 'row',
                gap: theme.spacing.md,
                marginTop: theme.spacing.md,
                paddingTop: theme.spacing.md,
                borderTopWidth: 1,
                borderTopColor: theme.color.border,
              }}
            >
              {doc.createdAt ? (
                <Who
                  label={c.createdBy}
                  name={nameOf(doc.createdBy)}
                  member={memberOf(doc.createdBy)}
                  at={stamp(doc.createdAt)}
                />
              ) : null}
              {closed ? (
                <Who
                  label={c[closed.kind]}
                  name={nameOf(closed.by)}
                  member={memberOf(closed.by)}
                  at={stamp(closed.at)}
                  check={closed.kind !== 'declined'}
                />
              ) : null}
            </View>
          ) : null}
        </StandardCard>
        <StandardCard>
          <View
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
          >
            <Text variant="heading">{fill(c.itemsCount, { n: doc.items.length })}</Text>
            {editable ? (
              <SmallPill
                label={c.addItem}
                icon="add"
                disabled={busy}
                onPress={() => router.push(editHref)}
              />
            ) : null}
          </View>
          {doc.items.map((i, index) => (
            <View
              key={index}
              style={{
                flexDirection: 'row',
                gap: theme.spacing.md,
                paddingVertical: theme.spacing.sm,
                alignItems: 'center',
              }}
            >
              <Tile icon="cube-outline" size={40} soft />
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '700' }}>{i.description}</Text>
                <Text
                  variant="caption"
                  tone="muted"
                >{`${formatQty(i.qtyMilli)} × ${fmt(i.rateMinor)}`}</Text>
              </View>
              <Text style={{ fontWeight: '700' }}>{fmt(lineAmount(i))}</Text>
            </View>
          ))}
          <ListRow
            title={c.subtotal}
            amount={fmt(computeDocTotals(doc.items, doc.discountMinor).subtotalMinor)}
          />
          <ListRow
            title={c.discount}
            amount={fmt(doc.discountMinor)}
            trailing={
              editable && doc.discountMinor === 0n ? (
                <SmallPill
                  label={c.add}
                  icon="add"
                  disabled={busy}
                  onPress={() => router.push(editHref)}
                />
              ) : undefined
            }
          />
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: theme.spacing.sm,
              padding: theme.spacing.md,
              borderRadius: theme.radius.md,
              backgroundColor: theme.color.brandSoft,
            }}
          >
            <Text variant="heading">{c.total}</Text>
            <Text variant="heading">{fmt(doc.totalMinor)}</Text>
          </View>
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
        {estimateActions.length || canConvert || canPay || linked ? (
          <StandardCard>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                marginBottom: theme.spacing.md,
              }}
            >
              <Ionicons name="flash-outline" size={20} color={theme.color.brand} />
              <Text variant="heading">{c.nextAction}</Text>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
              {estimateActions.map((s) => (
                <ActionButton
                  key={s}
                  label={s === 'sent' ? c.markSent : c[s]}
                  icon={
                    s === 'declined' ? 'close' : s === 'sent' ? 'paper-plane-outline' : 'checkmark'
                  }
                  bg={
                    s === 'declined'
                      ? theme.color.negativeSoft
                      : s === 'sent'
                        ? theme.color.brandSoft
                        : theme.color.positiveSoft
                  }
                  ink={
                    s === 'declined'
                      ? theme.color.negative
                      : s === 'sent'
                        ? theme.color.brand
                        : theme.color.positive
                  }
                  disabled={busy}
                  onPress={() =>
                    void run(async () => {
                      await status.mutateAsync({ docId: doc.id, status: s });
                      // Sending an estimate to a client who is still an inquiry makes them Quoted.
                      const client = clients.clients.find((x) => x.id === doc.clientId);
                      if (s === 'sent' && client?.stage === 'inquiry' && clients.canManage)
                        await setClient.mutateAsync(stageChange(client, 'quoted'));
                    })
                  }
                />
              ))}
              {canConvert ? (
                <ActionButton
                  outlined
                  label={c.convert}
                  icon="document-text-outline"
                  ink={theme.color.brand}
                  disabled={busy}
                  onPress={() =>
                    void run(async () => {
                      const billId = await convert.mutateAsync({ docId: doc.id });
                      router.replace(`/group/${id}/company-bill?docId=${billId}`);
                    })
                  }
                />
              ) : null}
              {canPay ? (
                <ActionButton
                  label={c.markReceived}
                  icon="cash-outline"
                  bg={theme.color.brand}
                  ink={theme.color.onBrand}
                  disabled={busy}
                  onPress={() => {
                    setPaymentError('');
                    setAmount(due);
                    setRecording(true);
                  }}
                />
              ) : null}
              {linked ? (
                <ActionButton
                  outlined
                  label={doc.convertedTo ? c.linkedBill : c.linkedEstimate}
                  icon="link-outline"
                  ink={theme.color.brand}
                  onPress={() => router.push(`/group/${id}/company-bill?docId=${linked}`)}
                />
              ) : null}
            </View>
          </StandardCard>
        ) : null}
        {upiLink && vpa ? (
          <UpiPayCard
            link={upiLink}
            vpa={vpa}
            note={docNumberLabel('bill', doc.number)}
            amountText={fmt(due)}
            qrRef={qrRef}
          />
        ) : canPay && entries.isOwner && view.currency === 'INR' ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push(`/group/${id}/company-details`)}
          >
            <StandardCard>
              <Text tone="brand" style={{ fontWeight: '600' }}>
                {c.upiAdd}
              </Text>
            </StandardCard>
          </Pressable>
        ) : null}
        <StandardCard>
          <View style={{ flexDirection: 'row' }}>
            <QuickAction
              label={c.sharePdf}
              icon="share-social-outline"
              disabled={busy}
              onPress={() => void sharePdf()}
            />
            {editable ? (
              <QuickAction
                label={c.edit}
                icon="create-outline"
                disabled={busy}
                onPress={() => router.push(editHref)}
              />
            ) : null}
            <QuickAction
              label={c.duplicate}
              icon="copy-outline"
              disabled={busy}
              onPress={() => router.push(`/group/${id}/company-bill-form?copyFrom=${doc.id}`)}
            />
            {printAvailable() ? (
              <QuickAction
                label={c.print}
                icon="print-outline"
                disabled={busy}
                onPress={() => void printDoc()}
              />
            ) : null}
          </View>
        </StandardCard>
        {events.length ? (
          <StandardCard>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: theme.spacing.md,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="time-outline" size={20} color={theme.color.brand} />
                <Text variant="heading">{c.activity}</Text>
              </View>
              {events.length > 3 ? (
                <Pressable
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={() => setAllEvents(!allEvents)}
                >
                  <Text variant="caption" tone="brand" style={{ fontWeight: '700' }}>
                    {allEvents ? c.showLess : c.viewAll}
                  </Text>
                </Pressable>
              ) : null}
            </View>
            {shownEvents.map((ev, index) => {
              const who = nameOf(ev.by);
              const done = ev.kind === 'accepted' || ev.kind === 'payment';
              const dot =
                ev.kind === 'declined'
                  ? theme.color.negative
                  : done
                    ? theme.color.positive
                    : theme.color.brand;
              const title =
                ev.kind === 'created'
                  ? `${c.createdBy} ${who}`.trim()
                  : ev.kind === 'payment'
                    ? `${c.paymentEvt} · ${fmt(ev.amountMinor ?? 0n)}`
                    : [c[ev.kind], who].filter(Boolean).join(' · ');
              return (
                <View
                  key={`${ev.kind}${ev.at}${index}`}
                  style={{ flexDirection: 'row', gap: theme.spacing.md }}
                >
                  <View style={{ alignItems: 'center', width: 22 }}>
                    <View
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 11,
                        backgroundColor: ev.kind === 'created' ? theme.color.surface : dot,
                        borderWidth: ev.kind === 'created' ? 2 : 0,
                        borderColor: dot,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {ev.kind === 'created' ? null : (
                        <Ionicons
                          name={
                            ev.kind === 'sent'
                              ? 'paper-plane'
                              : ev.kind === 'declined'
                                ? 'close'
                                : ev.kind === 'payment'
                                  ? 'cash'
                                  : 'checkmark'
                          }
                          size={12}
                          color={theme.color.onBrand}
                        />
                      )}
                    </View>
                    {index < shownEvents.length - 1 ? (
                      <View style={{ flex: 1, width: 2, backgroundColor: theme.color.brandSoft }} />
                    ) : null}
                  </View>
                  <View style={{ flex: 1, paddingBottom: theme.spacing.md }}>
                    <Text style={{ fontWeight: '600' }}>{title}</Text>
                    <Text variant="caption" tone="muted">
                      {stamp(ev.at, ev.dayOnly)}
                    </Text>
                  </View>
                </View>
              );
            })}
          </StandardCard>
        ) : null}
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
            label={c.markReceived}
            variant="brand"
            disabled={busy}
            onPress={() => void record()}
          />
        </View>
      </Sheet>
    </Screen>
  );
}

function Who({
  label,
  name,
  member,
  at,
  check,
}: {
  label: string;
  name: string;
  member?: MemberRow;
  at: string;
  check?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={{ flex: 1, flexDirection: 'row', gap: theme.spacing.sm, alignItems: 'center' }}>
      <PersonAvatar name={name || '?'} member={member} size={32} />
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          {check ? (
            <Ionicons name="checkmark-circle" size={14} color={theme.color.positive} />
          ) : null}
          <Text variant="micro" tone="muted">
            {label}
          </Text>
        </View>
        <Text variant="caption" numberOfLines={1} style={{ fontWeight: '700' }}>
          {name}
        </Text>
        <Text variant="micro" tone="muted">
          {at}
        </Text>
      </View>
    </View>
  );
}

type IconName = ComponentProps<typeof Ionicons>['name'];

function pillTone(theme: ReturnType<typeof useTheme>, status: MirrorCompanyDoc['status']) {
  const k = theme.color;
  switch (status) {
    case 'sent':
      return { bg: k.brandSoft, ink: k.brand, icon: 'paper-plane-outline' as IconName };
    case 'accepted':
    case 'paid':
      return { bg: k.positiveSoft, ink: k.positive, icon: 'checkmark-circle-outline' as IconName };
    case 'declined':
      return { bg: k.negativeSoft, ink: k.negative, icon: 'close-circle-outline' as IconName };
    case 'unpaid':
    case 'part_paid':
      return { bg: k.warningSoft, ink: k.warning, icon: 'time-outline' as IconName };
    default:
      return { bg: k.surfaceMuted, ink: k.textMuted, icon: 'create-outline' as IconName };
  }
}

function Tile({ icon, size = 48, soft }: { icon: IconName; size?: number; soft?: boolean }) {
  const theme = useTheme();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: theme.radius.md,
        backgroundColor: soft ? theme.color.surfaceMuted : theme.color.brandSoft,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Ionicons name={icon} size={size / 2} color={theme.color.brand} />
    </View>
  );
}

function SmallPill({
  label,
  icon,
  onPress,
  disabled,
}: {
  label: string;
  icon?: IconName;
  onPress: () => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: theme.spacing.md,
        height: 32,
        borderRadius: theme.radius.sm,
        borderWidth: 1,
        borderColor: theme.color.brandSoft,
        backgroundColor: theme.color.surface,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {icon ? <Ionicons name={icon} size={16} color={theme.color.brand} /> : null}
      <Text variant="caption" tone="brand" style={{ fontWeight: '700' }}>
        {label}
      </Text>
    </Pressable>
  );
}

function ActionButton({
  label,
  icon,
  bg,
  ink,
  outlined,
  disabled,
  onPress,
}: {
  label: string;
  icon: IconName;
  bg?: string;
  ink: string;
  outlined?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={{
        flexGrow: 1,
        flexBasis: 0,
        minWidth: 100,
        height: 44,
        borderRadius: theme.radius.md,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingHorizontal: theme.spacing.sm,
        backgroundColor: outlined ? theme.color.surface : bg,
        borderWidth: outlined ? 1 : 0,
        borderColor: ink,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Ionicons name={icon} size={18} color={ink} />
      <Text variant="caption" numberOfLines={1} style={{ color: ink, fontWeight: '700' }}>
        {label}
      </Text>
    </Pressable>
  );
}

function QuickAction({
  label,
  icon,
  disabled,
  onPress,
}: {
  label: string;
  icon: IconName;
  disabled?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={{ flex: 1, alignItems: 'center', gap: 6, opacity: disabled ? 0.5 : 1 }}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          backgroundColor: theme.color.brandSoft,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name={icon} size={20} color={theme.color.brand} />
      </View>
      <Text variant="micro" numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}
