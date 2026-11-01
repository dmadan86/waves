import { useLocalSearchParams } from 'expo-router';
import { ScrollView, View } from 'react-native';

import { Button, Screen, Text, useTheme } from '@waves/ui';

import { CompanyEntryPhotos } from '@/components/company/CompanyEntryPhotos';
import { Pill, useMethodLabels, useVendorFormat } from '@/components/company/vendors/parts';
import { PlainHeader, ScenicBody, StandardCard } from '@/components/standard';
import { useCompanySuspended } from '@/data/companyEntries';
import {
  useCompanyVendors,
  useMarkVendorPaymentReceived,
  useReviewVendorLine,
  useVoidVendorLine,
} from '@/data/companyVendors';
import { fill, useStrings } from '@/i18n';
import { useDialog } from '@/lib/dialog';
import { router } from '@/lib/navigation';

/** One vendor bill or advance: its facts, photos, and the actions this viewer may take. */
export default function CompanyVendorLineScreen() {
  const { id = '', entryId = '' } = useLocalSearchParams<{ id: string; entryId?: string }>();
  const theme = useTheme();
  const { t } = useStrings();
  const s = t.companyVendors;
  const raw = useCompanyVendors(id);
  const suspended = useCompanySuspended(id);
  const canManage = raw.canManage && !suspended;
  const f = useVendorFormat(raw.currency);
  const methods = useMethodLabels();
  const { confirm } = useDialog();
  const review = useReviewVendorLine(id);
  const remove = useVoidVendorLine(id);
  const received = useMarkVendorPaymentReceived(id);
  const line = raw.lines.find((l) => l.id === entryId);
  const vendor = line ? raw.vendors.find((v) => v.id === line.vendorId) : undefined;
  if (!line || !vendor)
    return (
      <Screen edges={[]}>
        <PlainHeader title={s.bill} />
        <ScenicBody flush>
          <Text tone="muted">{s.notFound}</Text>
        </ScenicBody>
      </Screen>
    );
  const vendorView = vendor.memberId === raw.myMemberId;
  const pending = line.status === 'pending';
  const ownPendingBill =
    vendorView && line.kind === 'bill' && pending && line.createdBy === raw.myMemberId;
  const canRemove =
    !suspended &&
    line.createdBy === raw.myMemberId &&
    (vendorView ? line.kind === 'bill' && pending : raw.canManage && !pending);
  const status =
    line.pending || pending
      ? s.pending
      : line.status === 'rejected'
        ? s.rejected
        : line.kind === 'bill'
          ? s.confirmed
          : line.receivedAt
            ? s.received
            : s.recorded;
  const rows = [
    [
      s.date,
      [f.date(line.occurredOn), line.dueOn ? fill(s.dueOn, { date: f.date(line.dueOn) }) : null]
        .filter(Boolean)
        .join(' · '),
    ],
    [s.method, line.method ? methods[line.method] : null],
    [s.reference, line.reference],
    [s.note, line.note],
    [s.rejected, line.status === 'rejected' ? line.reviewNote : null],
  ].filter((r): r is [string, string] => !!r[1]);
  const withdraw = vendorView && pending;
  return (
    <Screen edges={[]}>
      <ScrollView contentContainerStyle={{ paddingBottom: theme.spacing.xxl }}>
        <PlainHeader title={s[line.kind]} />
        <ScenicBody flush>
          <StandardCard style={{ gap: theme.spacing.md }}>
            <Text variant="caption" tone="muted">
              {vendor.name}
            </Text>
            <Text tabular style={{ fontSize: 28, fontWeight: '800' }}>
              {`${line.kind === 'bill' ? '+' : '−'}${f.money(line.amount)}`}
            </Text>
            <Pill
              label={status}
              tone={line.status === 'rejected' ? 'bad' : line.receivedAt ? 'good' : undefined}
            />
            {rows.map(([k, v]) => (
              <View key={k} style={{ flexDirection: 'row', gap: theme.spacing.md }}>
                <Text tone="muted" style={{ width: '38%' }}>
                  {k}
                </Text>
                <Text style={{ flex: 1 }}>{v}</Text>
              </View>
            ))}
          </StandardCard>
          <StandardCard>
            <CompanyEntryPhotos
              kind="vendor"
              groupId={id}
              entryId={line.id}
              canAdd={canManage || ownPendingBill}
              canRemove={(uploaderId) =>
                canManage || (ownPendingBill && uploaderId === raw.myMemberId)
              }
            />
          </StandardCard>
          {canManage && line.kind === 'bill' && pending ? (
            <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
              <Button
                label={s.confirm}
                variant="brand"
                disabled={review.isPending}
                onPress={() =>
                  review.mutate({ line, to: 'approved' }, { onSuccess: () => router.back() })
                }
              />
              <Button
                label={s.reject}
                disabled={review.isPending}
                onPress={() =>
                  review.mutate({ line, to: 'rejected' }, { onSuccess: () => router.back() })
                }
              />
            </View>
          ) : null}
          {!line.receivedAt && vendorView && line.kind !== 'bill' && line.status === 'approved' ? (
            <Button
              label={s.markReceived}
              disabled={received.isPending}
              onPress={() => received.mutate({ entryId: line.id, received: true })}
            />
          ) : null}
          {canRemove ? (
            <Button
              label={withdraw ? s.withdraw : s.removeEntry}
              onPress={() =>
                void confirm({
                  title: withdraw ? s.withdrawConfirm : s.removeConfirm,
                  confirmLabel: withdraw ? s.withdraw : s.removeEntry,
                  tone: 'danger',
                }).then((yes) => {
                  if (yes) remove.mutate({ entryId: line.id }, { onSuccess: () => router.back() });
                })
              }
            />
          ) : null}
        </ScenicBody>
      </ScrollView>
    </Screen>
  );
}
