import { useState } from 'react';
import { ScrollView, Share, View } from 'react-native';

import { pendingVendorBills, sortVendorLines } from '@waves/core';
import { Button, Screen, Text, useTheme } from '@waves/ui';

import { CompanyEntryPhotos } from '@/components/company/CompanyEntryPhotos';
import { useMoney } from '@/components/company/dashboard/parts';
import { VendorForm, VendorLineForm } from '@/components/company/vendors/forms';
import { VendorHistory, VendorMore } from '@/components/company/vendors/VendorHistory';
import { OverflowMenu, type OverflowMenuItem } from '@/components/OverflowMenu';
import {
  ListRow,
  ScenicBody,
  ScenicHeader,
  SectionHeader,
  StandardCard,
} from '@/components/standard';
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

export function VendorLedger({ groupId, vendorId }: { groupId: string; vendorId: string }) {
  const theme = useTheme();
  const clearance = useBottomClearance();
  const { t } = useStrings();
  const s = t.companyVendors;
  const view = useCompanyVendors(groupId);
  const fmt = useMoney(view.currency);
  const { confirm, notify } = useDialog();
  const remove = useRemoveVendor(groupId);
  const review = useReviewVendorLine(groupId);
  const [menu, setMenu] = useState(false);
  const [rename, setRename] = useState(false);
  const [form, setForm] = useState<'bill' | 'payment' | null>(null);
  const [inviting, setInviting] = useState(false);
  const vendor = view.vendors.find((v) => v.id === vendorId);
  const lines = view.lines.filter((l) => l.vendorId === vendorId);
  const pending = sortVendorLines(pendingVendorBills(lines));
  const balance = view.balances.get(vendorId) ?? 0n;
  const items: OverflowMenuItem[] =
    vendor && view.canManage
      ? [
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
        <ScenicHeader
          title={vendor?.name ?? s.title}
          action={items.length ? <VendorMore onPress={() => setMenu(true)} /> : undefined}
        />
        <ScenicBody>
          {vendor ? (
            <>
              <StandardCard style={{ gap: theme.spacing.lg }}>
                <Text variant="title">
                  {fill(balance > 0n ? s.oweName : balance < 0n ? s.advanceName : s.settledName, {
                    name: vendor.name,
                    amount: fmt(balance < 0n ? -balance : balance),
                  })}
                </Text>
                {view.canManage ? (
                  <View style={{ flexDirection: 'row', gap: theme.spacing.sm, flexWrap: 'wrap' }}>
                    <Button label={s.addBill} onPress={() => setForm('bill')} />
                    <Button label={s.recordPayment} onPress={() => setForm('payment')} />
                  </View>
                ) : null}
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
              <SectionHeader title={s.history} />
              <VendorHistory groupId={groupId} lines={lines} />
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
          payment={form === 'payment'}
          onClose={() => setForm(null)}
        />
      ) : null}
    </Screen>
  );
}
