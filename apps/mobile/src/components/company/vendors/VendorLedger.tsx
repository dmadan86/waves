import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Linking, Pressable, ScrollView, Share, View } from 'react-native';

import {
  buildVendorStatement,
  lastVendorPayment,
  pendingVendorBills,
  sortVendorLines,
  vendorOverdue,
} from '@waves/core';
import { Button, Screen, Text, useTheme } from '@waves/ui';

import { todayIso } from '@/data/personal';
import { Pill, useVendorFormat, useMethodLabels } from '@/components/company/vendors/parts';
import { renderStatementHtml, shareHtmlAsPdf } from '@/lib/vendorPdf';
import { reminderUrls } from '@/lib/paymentProof';

import { CompanyEntryPhotos } from '@/components/company/CompanyEntryPhotos';
import { useMoney } from '@/components/company/dashboard/parts';
import { VendorForm, VendorLineForm } from '@/components/company/vendors/forms';
import { BankChangedNotice } from '@/components/company/details/DetailsCard';
import { useVendorCard, useBankNotice } from '@/data/companyDetails';
import { VendorActivity } from '@/components/company/vendors/VendorActivity';
import { VendorMore } from '@/components/company/vendors/VendorHistory';
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
import { useStrings } from '@/i18n';
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

function ActionTile({
  icon,
  label,
  onPress,
  filled = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  filled?: boolean;
}) {
  const theme = useTheme();
  const ink = filled ? theme.color.onBrand : theme.color.text;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={{
        flex: filled ? 1.4 : 1,
        minHeight: 72,
        gap: theme.spacing.xs,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: theme.radius.lg,
        backgroundColor: filled ? theme.color.brand : theme.color.brandSoft,
      }}
    >
      <Ionicons name={icon} size={22} color={filled ? ink : theme.color.brand} />
      <Text variant="caption" style={{ color: ink, fontWeight: '700' }}>
        {label}
      </Text>
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
  const [tab, setTab] = useState<'tx' | 'bills'>('tx');
  const [pdfError, setPdfError] = useState(false);
  const [inviting, setInviting] = useState(false);
  const vendor = view.vendors.find((v) => v.id === vendorId);
  const detailView = useVendorCard(groupId, vendorId);
  const bankNotice = useBankNotice(detailView);
  const lines = view.lines.filter((l) => l.vendorId === vendorId);
  const pending = sortVendorLines(pendingVendorBills(lines));
  const balance = view.balances.get(vendorId) ?? 0n;
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
  const items: OverflowMenuItem[] = vendor
    ? [
        { icon: 'download-outline' as const, label: s.statement, onPress: () => void statement() },
        ...(view.canManage
          ? ([
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
                  void confirm({
                    title: s.deleteConfirm,
                    confirmLabel: s.delete,
                    tone: 'danger',
                  }).then((yes) => {
                    if (yes) remove.mutate(vendor.id, { onSuccess: () => router.back() });
                  });
                },
              },
            ] as OverflowMenuItem[])
          : []),
      ]
    : [];
  return (
    <Screen edges={[]}>
      <ScrollView contentContainerStyle={{ paddingBottom: clearance + theme.spacing.xl }}>
        <PlainHeader
          title={s.vendorTitle}
          trailing={items.length ? <VendorMore onPress={() => setMenu(true)} /> : undefined}
        />
        <ScenicBody flush>
          {vendor ? (
            <>
              <StandardCard style={{ gap: theme.spacing.md }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
                  <View
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: theme.radius.lg,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: theme.color.brandSoft,
                    }}
                  >
                    <Ionicons name="storefront-outline" size={24} color={theme.color.brand} />
                  </View>
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
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
                  <View style={{ flex: 1, gap: theme.spacing.xs }}>
                    {overdue > 0n ? (
                      <Pill
                        icon="alert-circle"
                        tone="bad"
                        label={`${s.statusOverdue} ${fmt(overdue)}`}
                      />
                    ) : balance > 0n ? (
                      <Pill label={s.statusToPay} />
                    ) : balance < 0n ? (
                      <Pill label={s.advance} tone="warn" />
                    ) : (
                      <Pill icon="checkmark-circle" tone="good" label={s.settled} />
                    )}
                    <Text tabular style={{ fontSize: 28, fontWeight: '800' }}>
                      {fmt(balance < 0n ? -balance : balance)}
                    </Text>
                  </View>
                  {last ? (
                    <>
                      <View
                        style={{
                          width: 1,
                          alignSelf: 'stretch',
                          backgroundColor: theme.color.border,
                        }}
                      />
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text variant="caption" tone="muted">
                          {s.lastPaymentLabel}
                        </Text>
                        <Text tabular style={{ fontWeight: '700' }}>
                          {fmt(last.amount)}
                        </Text>
                        <Text variant="caption" tone="muted">
                          {`${f.date(last.occurredOn)}${last.method ? ` · ${methods[last.method]}` : ''}`}
                        </Text>
                      </View>
                    </>
                  ) : null}
                </View>
                {pdfError ? (
                  <Text variant="caption" tone="negative">
                    {s.pdfFailed}
                  </Text>
                ) : null}
              </StandardCard>
              {view.canManage ? (
                <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
                  {/* New order joins here with the orders PR. */}
                  <ActionTile
                    icon="receipt-outline"
                    label={s.recordPayment}
                    filled
                    onPress={() =>
                      router.push(`/group/${groupId}/company-vendor-payment?vendorId=${vendorId}`)
                    }
                  />
                  <ActionTile
                    icon="scan-outline"
                    label={s.addBill}
                    onPress={() => setForm('bill')}
                  />
                </View>
              ) : null}
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
                        onPress={() =>
                          router.push(`/group/${groupId}/company-vendor-line?entryId=${line.id}`)
                        }
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
                    { value: 'tx', label: s.activityTab },
                    {
                      value: 'bills',
                      label: `${s.billsTab} (${lines.filter((l) => l.kind === 'bill').length})`,
                    },
                  ]}
                  value={tab}
                  onChange={setTab}
                />
              </View>
              <VendorActivity
                groupId={groupId}
                lines={lines}
                money={fmt}
                date={f.date}
                billsOnly={tab === 'bills'}
              />
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
