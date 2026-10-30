import Ionicons from '@expo/vector-icons/Ionicons';
import { View } from 'react-native';

import { Text, iconSize, useTheme } from '@waves/ui';

import { SectionShell } from '@/components/company/bar/SectionShell';
import { PendingApprovals } from '@/components/company/dashboard/PendingApprovals';
import { useMoney } from '@/components/company/dashboard/parts';
import { ListRow, SectionHeader, StandardCard } from '@/components/standard';
import { useCompanyEntries } from '@/data/companyEntries';
import { displayName } from '@/data/types';
import { useStrings } from '@/i18n';
import { awaitingApprovals } from '@/lib/companyPending';

export function CompanyPending({ groupId }: { groupId: string }) {
  const view = useCompanyEntries(groupId);
  const { t } = useStrings();
  const theme = useTheme();
  const fmt = useMoney(view.currency);
  const live = view.members.filter((m) => !m.left_at);
  const requests = view.isOwner
    ? view.entries
        .filter((e) => e.kind === 'pool_request' && !e.deleted)
        .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn))
    : [];
  const empty = awaitingApprovals(view).length === 0 && requests.length === 0;

  // VENDOR BILLS AWAITING CONFIRMATION: add here when the Vendors PR lands
  return (
    <SectionShell groupId={groupId} view={view}>
      <PendingApprovals groupId={groupId} view={view} />
      {requests.length > 0 ? (
        <>
          <SectionHeader title={t.company.budgetRequests} />
          <StandardCard>
            {requests.map((r, i) => {
              const m = live.find((member) => member.id === r.memberId);
              return (
                <ListRow
                  key={r.id}
                  title={m ? displayName(m, null, null, t.misc.someone) : t.misc.someone}
                  subtitle={[m?.employee_id, r.note].filter(Boolean).join(' · ') || undefined}
                  amount={fmt(r.amount)}
                  divider={i < requests.length - 1}
                />
              );
            })}
          </StandardCard>
        </>
      ) : null}
      {empty ? (
        <View
          style={{
            alignItems: 'center',
            gap: theme.spacing.sm,
            padding: theme.spacing.xxl,
          }}
        >
          <Ionicons name="checkmark-circle" size={iconSize.xl} color={theme.color.brand} />
          <Text variant="title" style={{ textAlign: 'center' }}>
            {t.company.pendingNone}
          </Text>
          <Text variant="caption" tone="muted" style={{ textAlign: 'center' }}>
            {t.company.pendingNoneBody}
          </Text>
        </View>
      ) : null}
    </SectionShell>
  );
}
