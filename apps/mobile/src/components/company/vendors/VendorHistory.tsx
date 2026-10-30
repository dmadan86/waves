import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import { sortVendorLines, type VendorLine } from '@waves/core';
import { Button, Text, useTheme } from '@waves/ui';

import { CompanyEntryPhotos } from '@/components/company/CompanyEntryPhotos';
import { useMoney } from '@/components/company/dashboard/parts';
import { OverflowMenu } from '@/components/OverflowMenu';
import { ListRow, StandardCard } from '@/components/standard';
import {
  useCompanyVendors,
  useMarkVendorPaymentReceived,
  useVoidVendorLine,
} from '@/data/companyVendors';
import { useStrings } from '@/i18n';
import { useDialog } from '@/lib/dialog';

export function VendorMore({ onPress }: { onPress: () => void }) {
  const theme = useTheme();
  const { t } = useStrings();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t.companyVendors.more}
      onPress={onPress}
      style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
    >
      <Ionicons name="ellipsis-vertical" size={20} color={theme.color.text} />
    </Pressable>
  );
}

export function VendorHistory({
  groupId,
  lines,
  vendorView = false,
}: {
  groupId: string;
  lines: readonly VendorLine[];
  vendorView?: boolean;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const s = t.companyVendors;
  const view = useCompanyVendors(groupId);
  const fmt = useMoney(view.currency);
  const { confirm } = useDialog();
  const remove = useVoidVendorLine(groupId);
  const received = useMarkVendorPaymentReceived(groupId);
  const [selected, setSelected] = useState<VendorLine | null>(null);
  const withdraw = vendorView && selected?.status === 'pending';
  return (
    <>
      <StandardCard>
        {lines.length === 0 ? (
          <Text tone="muted">{s.historyEmpty}</Text>
        ) : (
          sortVendorLines(lines).map((line, index) => {
            const ownPendingBill =
              vendorView && line.kind === 'bill' && line.status === 'pending' &&
              line.createdBy === view.myMemberId;
            const canRemove =
              line.createdBy === view.myMemberId &&
              (vendorView
                ? line.kind === 'bill' && line.status === 'pending'
                : view.canManage && line.status !== 'pending');
            const status =
              line.status === 'pending'
                ? s.pending
                : line.status === 'rejected'
                  ? s.rejected
                  : vendorView
                    ? s.confirmed
                    : null;
            return (
              <ListRow
                key={line.id}
                title={s[line.kind]}
                amount={`${line.kind === 'bill' ? '+' : '−'}${fmt(line.amount)}`}
                subtitle={[
                  new Date(`${line.occurredOn}T12:00:00`).toLocaleDateString(locale),
                  line.note,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                subtitleLines={3}
                divider={index < lines.length - 1}
                trailing={canRemove ? <VendorMore onPress={() => setSelected(line)} /> : undefined}
                footer={
                  <View style={{ gap: theme.spacing.sm, alignItems: 'flex-start' }}>
                    <View style={{ alignSelf: 'stretch' }}>
                      <CompanyEntryPhotos
                        kind="vendor"
                        groupId={groupId}
                        entryId={line.id}
                        canAdd={view.canManage || ownPendingBill}
                        canRemove={(uploaderId) =>
                          view.canManage || (ownPendingBill && uploaderId === view.myMemberId)
                        }
                      />
                    </View>
                    {status ? (
                      <View
                        style={{
                          borderRadius: theme.radius.pill,
                          paddingHorizontal: theme.spacing.sm,
                          paddingVertical: theme.spacing.xs,
                          backgroundColor: theme.color.surfaceMuted,
                        }}
                      >
                        <Text variant="micro" tone="muted">
                          {status}
                        </Text>
                      </View>
                    ) : null}
                    {line.receivedAt ? (
                      <Text variant="caption" tone="muted">
                        {s.received}
                      </Text>
                    ) : vendorView && line.kind !== 'bill' && line.status === 'approved' ? (
                      <Button
                        label={s.markReceived}
                        disabled={received.isPending}
                        onPress={() => received.mutate({ entryId: line.id, received: true })}
                      />
                    ) : null}
                  </View>
                }
              />
            );
          })
        )}
      </StandardCard>
      <OverflowMenu
        visible={!!selected}
        onClose={() => setSelected(null)}
        items={[
          {
            icon: 'trash-outline',
            label: withdraw ? s.withdraw : s.removeEntry,
            tone: 'danger',
            onPress: () => {
              if (!selected) return;
              const entryId = selected.id;
              void confirm({
                title: withdraw ? s.withdrawConfirm : s.removeConfirm,
                confirmLabel: withdraw ? s.withdraw : s.removeEntry,
                tone: 'danger',
              }).then((yes) => {
                if (yes) remove.mutate({ entryId });
              });
            },
          },
        ]}
      />
    </>
  );
}
