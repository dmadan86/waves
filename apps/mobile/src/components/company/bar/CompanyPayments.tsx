/** Payments: record wages / money given, wage runs and recent payments. Records only; Waves never moves money. */

import { useState } from 'react';
import { View } from 'react-native';

import { Text } from '@waves/ui';

import { ReceiptArt } from '@/components/company/dashboard/art';
import { SectionShell } from '@/components/company/bar/SectionShell';
import { ActionTile, RecentActivity } from '@/components/company/dashboard/parts';
import { StandardCard } from '@/components/standard';
import { useCompanyEntries } from '@/data/companyEntries';
import { useStrings } from '@/i18n';
import { router } from '@/lib/navigation';

export function CompanyPayments({ groupId }: { groupId: string }) {
  const { t } = useStrings();
  const view = useCompanyEntries(groupId);
  const [showAllPayments, setShowAllPayments] = useState(false);
  const me = view.me;
  const teamIds = new Set(view.members.filter((m) => m.id !== me?.id).map((m) => m.id));
  const payments = view.entries.filter(
    (e) =>
      (e.kind === 'wage_payment' ||
        e.kind === 'wages' ||
        e.kind === 'advance' ||
        e.kind === 'reimbursement') &&
      (view.isOwner || teamIds.has(e.memberId)),
  );
  return (
    <SectionShell groupId={groupId} view={view}>
      <>
        <StandardCard style={{ paddingHorizontal: 14, paddingVertical: 12, gap: 4 }}>
          <Text variant="title" style={{ fontSize: 16 }}>
            {t.company.recordPayment}
          </Text>
          <Text variant="caption" tone="muted">
            {t.company.recordPaymentBody}
          </Text>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
            <ActionTile
              icon="cash-outline"
              title={t.company.payWages}
              body={t.company.payWagesBody}
              tone="violet"
              onPress={() => router.push(`/group/${groupId}/company-wages`)}
            />
            <ActionTile
              icon="arrow-up-circle-outline"
              title={t.company.gaveMoney}
              body={t.company.gaveMoneyBody}
              tone="blue"
              onPress={() => router.push(`/group/${groupId}/company-entry?kind=advance`)}
            />
          </View>
        </StandardCard>
        <RecentActivity
          groupId={groupId}
          view={view}
          entries={payments}
          limit={showAllPayments ? payments.length : 5}
          header={{
            title: t.company.recentPayments,
            icon: false,
            onViewAll:
              !showAllPayments && payments.length > 5 ? () => setShowAllPayments(true) : undefined,
          }}
          empty={
            <View style={{ alignItems: 'center', gap: 2, paddingVertical: 4 }}>
              <ReceiptArt />
              <Text variant="body" style={{ fontWeight: '700' }}>
                {t.company.paymentsNone}
              </Text>
              <Text variant="caption" tone="muted" align="center">
                {t.company.paymentsNoneBody}
              </Text>
            </View>
          }
        />
      </>
    </SectionShell>
  );
}
