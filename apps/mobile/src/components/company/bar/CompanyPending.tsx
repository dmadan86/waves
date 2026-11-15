import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { View } from 'react-native';

import { Text, iconSize, useTheme } from '@waves/ui';

import { SectionShell } from '@/components/company/bar/SectionShell';
import { PendingApprovals } from '@/components/company/dashboard/PendingApprovals';
import { LeaveDecisionSheet } from '@/components/company/CompanyCalendarSheets';
import { PersonAvatar } from '@/components/PersonAvatar';
import { useMoney } from '@/components/company/dashboard/parts';
import { ListRow, SectionHeader, StandardCard } from '@/components/standard';
import { useCompanyEntries } from '@/data/companyEntries';
import { usePendingLeave, type MirrorLeave } from '@/data/companyCalendar';
import { usePendingVendorBills } from '@/data/companyVendors';
import { useUnpaidBills } from '@/data/companyDocuments';
import { useWorkdayCounts } from '@/data/companyWorkday';
import { displayName } from '@/data/types';
import { fill, useStrings } from '@/i18n';
import { router } from '@/lib/navigation';
import { awaitingApprovals } from '@/lib/companyPending';

export function CompanyPending({ groupId }: { groupId: string }) {
  const [selectedLeave, setSelectedLeave] = useState<MirrorLeave | null>(null);
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
  const vendorBills = usePendingVendorBills(groupId).count;
  const unpaid = useUnpaidBills(groupId).count;
  const { blocked, unmarked } = useWorkdayCounts(groupId);
  const leaveRequests = usePendingLeave(groupId);
  const links = [
    { n: vendorBills, label: t.company.pendingVendorBills, to: 'company-vendors' },
    { n: unpaid, label: t.company.pendingUnpaidBills, to: 'company-bills' },
    { n: blocked, label: t.company.pendingBlockedTasks, to: 'company-work' },
    { n: unmarked, label: t.company.pendingUnmarked, to: 'company-attendance' },
  ].filter((l) => l.n > 0);
  const empty =
    awaitingApprovals(view).length === 0 &&
    requests.length === 0 &&
    links.length === 0 &&
    leaveRequests.length === 0;
  return (
    <SectionShell groupId={groupId} view={view}>
      <PendingApprovals groupId={groupId} view={view} />
      {leaveRequests.length > 0 ? (
        <>
          <SectionHeader
            title={t.calendar.pendingLeaveTitle.replace('{n}', String(leaveRequests.length))}
          />
          <StandardCard>
            {leaveRequests.map((leave, index) => {
              const member = live.find((person) => person.id === leave.memberId);
              const kind =
                leave.kind === 'casual'
                  ? t.calendar.leaveCasual
                  : leave.kind === 'sick'
                    ? t.calendar.leaveSick
                    : t.calendar.leaveOther;
              return (
                <ListRow
                  key={leave.id}
                  leading={
                    member ? (
                      <PersonAvatar member={member} name={displayName(member)} size={40} />
                    ) : undefined
                  }
                  title={member ? displayName(member, null, null, t.misc.someone) : t.misc.someone}
                  subtitle={`${leave.startDay} – ${leave.endDay} · ${kind}${leave.halfDay ? ` · ${t.calendar.halfDay}` : ''}`}
                  onPress={() => setSelectedLeave(leave)}
                  divider={index < leaveRequests.length - 1}
                />
              );
            })}
          </StandardCard>
        </>
      ) : null}
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
      {links.length > 0 ? (
        <StandardCard>
          {links.map((l, i) => (
            <ListRow
              key={l.to}
              title={fill(l.label, { n: String(l.n) })}
              onPress={() => router.push(`/group/${groupId}/${l.to}`)}
              divider={i < links.length - 1}
            />
          ))}
        </StandardCard>
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
      <LeaveDecisionSheet
        groupId={groupId}
        visible={!!selectedLeave}
        onClose={() => setSelectedLeave(null)}
        leave={selectedLeave}
      />
    </SectionShell>
  );
}
