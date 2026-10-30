/** Claims waiting for review: an owner sees all, a manager their team's (never their own). */

import { View } from 'react-native';

import { flagsForEntry } from '@waves/core';

import { kindLabel } from '@/components/company/CompanyStatementView';
import { TitleRow, useMoney } from '@/components/company/dashboard/parts';
import { ListRow, StandardCard } from '@/components/standard';
import { useCompanyTags } from '@/data/companyTags';
import type { CompanyView } from '@/data/companyEntries';
import { displayName } from '@/data/types';
import { useStrings } from '@/i18n';
import { awaitingApprovals } from '@/lib/companyPending';
import { router } from '@/lib/navigation';

export function PendingApprovals({
  groupId,
  view,
  teaser = false,
}: {
  groupId: string;
  view: CompanyView;
  /** On Overview: the first few, with "View all" opening the Pending tab. */
  teaser?: boolean;
}) {
  const { t } = useStrings();
  const fmt = useMoney(view.currency);
  const tagLabel = useCompanyTags(groupId, view).label;
  const all = awaitingApprovals(view);
  const awaiting = teaser ? all.slice(0, 3) : all;
  if (awaiting.length === 0) return null;
  return (
    <View style={{ gap: 8 }}>
      <TitleRow
        title={t.company.pendingApprovals}
        onViewAll={
          teaser && all.length > awaiting.length
            ? () => router.replace(`/group/${groupId}/company-pending`)
            : undefined
        }
      />
      <StandardCard>
        {awaiting.map((e, i) => {
          const who = view.members.find((m) => m.id === e.memberId);
          return (
            <ListRow
              key={e.id}
              title={`${who ? displayName(who, null, null, t.misc.someone) : t.misc.someone} · ${kindLabel(t, e, tagLabel)}`}
              subtitle={[
                who?.employee_id,
                flagsForEntry(e, view.entries, view.policies, view.receiptEntryIds).length > 0
                  ? `${t.company.awaiting} · ! ${t.company.policyFlagged}`
                  : t.company.awaiting,
              ]
                .filter(Boolean)
                .join(' · ')}
              amount={fmt(e.amount)}
              onPress={() => router.push(`/group/${groupId}/company-entry-view?entry=${e.id}`)}
              divider={i < awaiting.length - 1}
            />
          );
        })}
      </StandardCard>
    </View>
  );
}
