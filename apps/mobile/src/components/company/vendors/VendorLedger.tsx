import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Linking, Pressable, ScrollView, Share, View } from 'react-native';

import {
  buildVendorStatement,
  lastVendorPayment,
  pendingVendorBills,
  receiptLabel,
  sortVendorLines,
  vendorOverdue,
} from '@waves/core';
import { Button, Screen, Text, useTheme } from '@waves/ui';

import { OrderRow } from '@/components/company/vendors/orderParts';
import { useVendorOrders } from '@/data/companyVendorOrders';
import { todayIso } from '@/data/personal';
import { useMethodLabels, useVendorFormat } from '@/components/company/vendors/parts';
import { renderStatementHtml, shareHtmlAsPdf } from '@/lib/vendorPdf';
import { reminderUrls } from '@/lib/paymentProof';

import { CompanyEntryPhotos } from '@/components/company/CompanyEntryPhotos';
import { useMoney } from '@/components/company/dashboard/parts';
import { VendorForm, VendorLineForm } from '@/components/company/vendors/forms';
import { BankChangedNotice } from '@/components/company/details/DetailsCard';
import { useVendorCard, useBankNotice } from '@/data/companyDetails';
import { VendorHistory, VendorMore } from '@/components/company/vendors/VendorHistory';
import { OverflowMenu, type OverflowMenuItem } from '@/components/OverflowMenu';
import {
  ListRow,
  PlainHeader,
  ScenicBody,
  SectionHeader,
  SegmentedPills,
  StandardCard,
} from '@/components/standard';
import { useCompanyEntries, useCompanySuspended } from '@/data/companyEntries';
import {
  createVendorInviteLink,
  useCompanyVendors,
  useRemoveVendor,
  useReviewVendorLine,
} from '@/data/companyVendors';
import { fill, useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';
import { useDialog } from '@/lib/dialog';
import { friendlyError } from '@/lib/errors';
import { router } from '@/lib/navigation';

function RoundAction({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.color.brandSoft,
      }}
    >
      <Ionicons name={icon} size={20} color={theme.color.brand} />
    </Pressable>
  );
}

export function VendorLedger({ groupId, vendorId }: { groupId: string; vendorId: string }) {
  const theme = useTheme();
  const clearance = useBottomClearance();
  const { t } = useStrings();
  const s = t.companyVendors;
  const raw = useCompanyVendors(groupId);
  const suspended = useCompanySuspended(groupId);
  // A suspended company is read-only: nothing to add, confirm or remove.
  const view = { ...raw, canManage: raw.canManage && !suspended };
  const fmt = useMoney(view.currency);
  const f = useVendorFormat(view.currency);
  const methods = useMethodLabels();
  const company = useCompanyEntries(groupId);
  const { confirm, notify } = useDialog();
  const remove = useRemoveVendor(groupId);
  const review = useReviewVendorLine(groupId);
  const [menu, setMenu] = useState(false);
  const [rename, setRename] = useState(false);
  const [form, setForm] = useState<'bill' | null>(null);
  const [tab, setTab] = useState<'tx' | 'orders' | 'docs'>('tx');
  const [pdfError, setPdfError] = useState(false);
  const [inviting, setInviting] = useState(false);
  const vendor = view.vendors.find((v) => v.id === vendorId);
  const detailView = useVendorCard(groupId, vendorId);
  const bankNotice = useBankNotice(detailView);
  const lines = view.lines.filter((l) => l.vendorId === vendorId);
  const pending = sortVendorLines(pendingVendorBills(lines));
  const balance = view.balances.get(vendorId) ?? 0n;
  const orders = useVendorOrders(groupId).filter((o) => o.vendorId === vendorId);
  const overdue = vendorOverdue(lines, todayIso());
  const last = lastVendorPayment(lines);
  const phoneUrls = reminderUrls(vendor?.phone, '');
  const statement = async () => {
    setPdfError(false);
    if (!vendor) return;
    const st = buildVendorStatement(lines);
    const html = renderStatementHtml(
      vendor.name,
      company.name,
      st.rows,
      st.balance,
      {
        ...s,
        kinds: { bill: s.bill, advance: s.advance, payment: s.payment },
      },
      f,
    );
    try {
      if (!(await shareHtmlAsPdf(html, `${s.statementTitle} ${vendor.name}`))) setPdfError(true);
    } catch {
      setPdfError(true);
    }
  };
  const items: OverflowMenuItem[] =
    vendor && view.canManage
      ? [
          {
            icon: 'document-text-outline' as const,
            label: s.addBill,
            onPress: () => setForm('bill'),
          },
          ...(!vendor.memberId
            ? [
                {
                  icon: 'person-add-outline' as const,
                  label: s.invite,
                  onPress: () => {
                    if (inviting) return;
                    setInviting(true);
                    void (async () => {
                      try {
                        await Share.share({ message: await createVendorInviteLink(vendor.id) });
                      } catch (error) {
                        await notify({
                          title: friendlyError(error, s.inviteFailed, 'vendor.invite'),
                          tone: 'danger',
                        });
                      } finally {
                        setInviting(false);
                      }
                    })();
                  },
                },
              ]
            : []),
          {
            icon: 'business-outline',
            label: t.companyDetails.title,
            route: `/group/${groupId}/company-details`,
          },
          { icon: 'pencil-outline', label: s.rename, onPress: () => setRename(true) },
          {
            icon: 'trash-outline',
            label: s.delete,
            tone: 'danger',
            onPress: () => {
              void confirm({ title: s.deleteConfirm, confirmLabel: s.delete, tone: 'danger' }).then(
                (yes) => {
                  if (yes) remove.mutate(vendor.id, { onSuccess: () => router.back() });
                },
              );
            },
          },
        ]
      : [];
  return (
    <Screen edges={[]}>
      <ScrollView contentContainerStyle={{ paddingBottom: clearance + theme.spacing.xl }}>
        <PlainHeader
          title={t.companyDetails.vendorDetails}
          trailing={items.length ? <VendorMore onPress={() => setMenu(true)} /> : undefined}
        />
        <ScenicBody flush>
          {vendor ? (
            <>
              <StandardCard style={{ gap: theme.spacing.md }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text variant="heading" style={{ fontWeight: '800' }}>
                      {vendor.name}
                    </Text>
                    <Text variant="caption" tone="muted">
                      {[vendor.category, vendor.phone].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  {vendor.phone ? (
                    <>
                      <RoundAction
                        icon="call-outline"
                        label={s.call}
                        onPress={() => void Linking.openURL(`tel:${vendor.phone}`)}
                      />
                      {phoneUrls.length ? (
                        <RoundAction
                          icon="logo-whatsapp"
                          label={s.whatsapp}
                          onPress={() => void Linking.openURL(phoneUrls[1]!)}
                        />
                      ) : null}
                    </>
                  ) : null}
                </View>
                <Text variant="caption" tone="muted">
                  {balance > 0n ? s.statusToPay : balance < 0n ? s.advance : s.settled}
                </Text>
                <Text tabular style={{ fontSize: 28, fontWeight: '800' }}>
                  {fmt(balance < 0n ? -balance : balance)}
                </Text>
                {overdue > 0n ? (
                  <Text variant="caption" tone="negative">
                    {fill(s.overdueLine, { amount: fmt(overdue) })}
                  </Text>
                ) : null}
                <Text variant="caption" tone="muted">
                  {last
                    ? fill(s.lastPayment, {
                        amount: fmt(last.amount),
                        date: `${f.date(last.occurredOn)}${last.method ? ` · ${methods[last.method]}` : ''}`,
                      })
                    : s.noPayments}
                </Text>
                {view.canManage ? (
                  <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
                    <Button
                      label={s.newOrder}
                      onPress={() =>
                        router.push(`/group/${groupId}/company-vendor-order?vendorId=${vendorId}`)
                      }
                    />
                    <Button
                      label={s.recordPayment}
                      variant="brand"
                      onPress={() =>
                        router.push(`/group/${groupId}/company-vendor-payment?vendorId=${vendorId}`)
                      }
                    />
                    <Button label={s.statement} onPress={() => void statement()} />
                  </View>
                ) : (
                  <Button label={s.statement} onPress={() => void statement()} />
                )}
                {pdfError ? (
                  <Text variant="caption" tone="negative">
                    {s.pdfFailed}
                  </Text>
                ) : null}
              </StandardCard>
              {bankNotice.show ? (
                <BankChangedNotice
                  view={{ show: bankNotice.show, at: detailView.card?.bankChangedAt }}
                  onNoted={bankNotice.markNoted}
                />
              ) : null}
              <StandardCard>
                <ListRow
                  title={t.companyDetails.vendorDetails}
                  onPress={() =>
                    router.push(`/group/${groupId}/company-details?vendorId=${vendorId}`)
                  }
                />
              </StandardCard>
              {view.canManage && pending.length ? (
                <>
                  <SectionHeader title={s.pendingBills} />
                  <StandardCard>
                    {pending.map((line) => (
                      <ListRow
                        key={line.id}
                        title={s.bill}
                        subtitle={[line.occurredOn, line.note].filter(Boolean).join(' · ')}
                        subtitleLines={3}
                        amount={fmt(line.amount)}
                        footer={
                          <View style={{ gap: theme.spacing.sm }}>
                            <CompanyEntryPhotos
                              kind="vendor"
                              groupId={groupId}
                              entryId={line.id}
                              canAdd={view.canManage}
                              canRemove={() => view.canManage}
                            />
                            <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
                              <Button
                                label={s.confirm}
                                disabled={review.isPending}
                                onPress={() => review.mutate({ line, to: 'approved' })}
                              />
                              <Button
                                label={s.reject}
                                disabled={review.isPending}
                                onPress={() => review.mutate({ line, to: 'rejected' })}
                              />
                            </View>
                          </View>
                        }
                      />
                    ))}
                  </StandardCard>
                </>
              ) : null}
              <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
                <SegmentedPills
                  options={[
                    { value: 'tx', label: s.transactions },
                    { value: 'orders', label: `${s.ordersTab} ${orders.length}`.trim() },
                    { value: 'docs', label: s.documents },
                  ]}
                  value={tab}
                  onChange={setTab}
                />
              </View>
              {tab === 'tx' ? (
                <VendorHistory groupId={groupId} lines={lines} />
              ) : tab === 'orders' ? (
                <StandardCard>
                  {orders.length === 0 ? (
                    <View style={{ gap: theme.spacing.md }}>
                      <Text tone="muted">{s.noOrders}</Text>
                      {view.canManage ? (
                        <Button
                          label={s.createOrder}
                          variant="brand"
                          onPress={() =>
                            router.push(
                              `/group/${groupId}/company-vendor-order?vendorId=${vendorId}`,
                            )
                          }
                        />
                      ) : null}
                    </View>
                  ) : (
                    orders.map((o, index) => (
                      <OrderRow
                        key={o.id}
                        order={o}
                        money={fmt}
                        divider={index < orders.length - 1}
                        onPress={() =>
                          router.push(
                            `/group/${groupId}/company-vendor-order-detail?orderId=${o.id}`,
                          )
                        }
                      />
                    ))
                  )}
                </StandardCard>
              ) : (
                <>
                  <SectionHeader title={s.receiptsHeading} />
                  <StandardCard>
                    {lines.filter((l) => l.kind === 'payment' && l.receiptNo).length === 0 ? (
                      <Text tone="muted">{s.noDocs}</Text>
                    ) : (
                      sortVendorLines(lines)
                        .filter((l) => l.kind === 'payment' && l.receiptNo)
                        .map((l) => (
                          <ListRow
                            key={l.id}
                            title={`${s.receipt} ${receiptLabel(l.receiptNo)}`}
                            subtitle={f.date(l.occurredOn)}
                            amount={fmt(l.amount)}
                            onPress={() =>
                              router.push(
                                `/group/${groupId}/company-vendor-receipt?entryId=${l.id}`,
                              )
                            }
                          />
                        ))
                    )}
                  </StandardCard>
                  <SectionHeader title={s.billPhotos} />
                  <StandardCard style={{ gap: theme.spacing.md }}>
                    {sortVendorLines(lines)
                      .filter((l) => l.kind === 'bill')
                      .map((l) => (
                        <View key={l.id} style={{ gap: theme.spacing.xs }}>
                          <Text variant="caption" tone="muted">
                            {`${f.date(l.occurredOn)} · ${fmt(l.amount)}`}
                          </Text>
                          <CompanyEntryPhotos
                            kind="vendor"
                            groupId={groupId}
                            entryId={l.id}
                            canAdd={view.canManage}
                            canRemove={() => view.canManage}
                          />
                        </View>
                      ))}
                  </StandardCard>
                </>
              )}
            </>
          ) : (
            <Text tone="muted">{s.notFound}</Text>
          )}
        </ScenicBody>
      </ScrollView>
      <OverflowMenu visible={menu} onClose={() => setMenu(false)} items={items} />
      {rename && vendor ? (
        <VendorForm groupId={groupId} vendor={vendor} onClose={() => setRename(false)} />
      ) : null}
      {form && vendor && view.canManage ? (
        <VendorLineForm
          groupId={groupId}
          vendorId={vendor.id}
          currency={view.currency}
          onClose={() => setForm(null)}
        />
      ) : null}
    </Screen>
  );
}
