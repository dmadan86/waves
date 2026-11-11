/**
 * Leave balances of one person, one block per leave type: what is left in a large number, a bar of how much
 * of the year's allowance is taken, and Earned / Taken / Requested underneath. The employee sees their own
 * on their home; the owner sees a member's on that member's profile.
 */

import { View } from 'react-native';

import { Text, useTheme } from '@waves/ui';

import { StandardCard } from '@/components/standard';
import { daysText, useLeaveBalances } from '@/data/companyLeave';
import { useStrings } from '@/i18n';

export function LeaveBalanceCard({
  groupId,
  memberId,
}: {
  groupId: string;
  memberId: string | null;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const rows = useLeaveBalances(groupId, memberId);
  if (rows.length === 0) return null;
  const track = theme.scheme === 'dark' ? theme.color.surfaceMuted : '#E8E8ED';
  return (
    <StandardCard style={{ padding: 14, gap: 14 }}>
      <Text variant="caption" tone="muted">
        {t.calendar.leaveBalances}
      </Text>
      {rows.map(({ type, balance, requested }) => {
        const earned = balance.carriedIn + balance.accrued;
        const taken = Math.min(balance.used, earned);
        const pct = earned > 0 ? Math.round((taken / earned) * 100) : balance.used > 0 ? 100 : 0;
        const negative = balance.balance < 0;
        return (
          <View key={type.id} style={{ gap: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
              <Text style={{ flex: 1, fontWeight: '700' }} numberOfLines={1}>
                {type.name}
              </Text>
              <Text
                style={{
                  fontSize: 18,
                  fontWeight: '800',
                  color: negative ? theme.color.negative : theme.color.brand,
                }}
              >
                {t.calendar.leaveDaysAvailable.replace('{n}', daysText(balance.balance))}
              </Text>
            </View>
            <View
              style={{ height: 6, borderRadius: 3, backgroundColor: track, overflow: 'hidden' }}
            >
              <View
                style={{
                  width: `${Math.min(100, pct)}%`,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: negative ? theme.color.negative : theme.color.brand,
                }}
              />
            </View>
            <Text variant="caption" tone="muted">
              {[
                `${t.calendar.leaveEarned} ${daysText(earned)}`,
                `${t.calendar.leaveTaken} ${daysText(balance.used)}`,
                requested > 0 ? `${t.calendar.leaveRequested} ${daysText(requested)}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
        );
      })}
    </StandardCard>
  );
}
