/** Claims waiting for review: an owner sees all, a manager their team's (never their own). */

import { View } from 'react-native';

import { flagsForEntry } from '@waves/core';
import { Text } from '@waves/ui';

import { kindLabel } from '@/components/company/CompanyStatementView';
import { useMoney } from '@/components/company/dashboard/parts';
import { ListRow, StandardCard } from '@/components/standard';
import { useCompanyTags } from '@/data/companyTags';
import type { CompanyView } from '@/data/companyEntries';
import { displayName } from '@/data/types';
import { useStrings } from '@/i18n';
import { router } from '@/lib/navigation';

export function PendingApprovals({ groupId, view }: { groupId: string; view: CompanyView }) {
  const { t } = useStrings();
  const fmt = useMoney(view.currency);
  const tagLabel = useCompanyTags(groupId, view).label;
  const awaiting = view.entries.filter(
    (e) =>
      !e.deleted &&
      e.status === 'submitted' &&
      (view.isOwner || e.memberId !== view.me?.id) &&
      // A claim waiting for a second owner is not this reviewer's to act on.
      view.canApprove(e),
  );
  if (awaiting.length === 0) return null;
  return (
    <View style={{ gap: 8 }}>
      <Text variant="title">{t.company.pendingApprovals}</Text>
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
