/**
 * "Upcoming time off": leave from today onward (approved and pending), soonest first. One member's on their
 * home and profile; the whole company's next 14 days (max 5 rows) on the owner's and manager's Overview.
 */

import { Pressable, View } from 'react-native';

import { leaveDays } from '@waves/core';
import { Text, useTheme } from '@waves/ui';

import { StandardCard } from '@/components/standard';
import { Pill } from '@/components/company/vendors/parts';
import { useCalendar } from '@/data/companyCalendar';
import { daysText, useLeaveTypes } from '@/data/companyLeave';
import { useCompanyEntries } from '@/data/companyEntries';
import { todayIso } from '@/data/personal';
import { displayName } from '@/data/types';
import { useStrings } from '@/i18n';
import { router } from '@/lib/navigation';
import { upcomingLeave } from '@/lib/leaveRange';

export function UpcomingTimeOff({
  groupId,
  memberId,
  company,
}: {
  groupId: string;
  /** One person's leave; leave out with `company` for everyone the viewer can read. */
  memberId?: string | null;
  company?: boolean;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const cal = useCalendar(groupId);
  const types = useLeaveTypes(groupId);
  const { members } = useCompanyEntries(groupId);
  const today = todayIso();
  if (!company && !memberId) return null;
  const rows = upcomingLeave(
    cal.leave,
    today,
    company ? { withinDays: 14, limit: 5 } : { memberId, limit: 5 },
  );
  if (rows.length === 0) return null;
  const date = (d: string) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString(locale, {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
  return (
    <StandardCard style={{ padding: 14, gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text variant="caption" tone="muted">
          {t.calendar.upcomingTimeOff}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push(`/group/${groupId}/company-calendar`)}
        >
          <Text variant="caption" style={{ color: theme.color.brand, fontWeight: '700' }}>
            {t.calendar.seeAll}
          </Text>
        </Pressable>
      </View>
      {rows.map((l) => {
        const type = types.find((x) => x.id === l.leaveTypeId)?.name;
        const who = company ? members.find((m) => m.id === l.memberId) : null;
        const name =
          type ??
          (l.kind === 'casual'
            ? t.calendar.leaveCasual
            : l.kind === 'sick'
              ? t.calendar.leaveSick
              : t.calendar.leaveOther);
        const range =
          l.startDay === l.endDay ? date(l.startDay) : `${date(l.startDay)} – ${date(l.endDay)}`;
        return (
          <View key={l.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '600' }} numberOfLines={1}>
                {who ? `${displayName(who)} · ${name}` : name}
              </Text>
              <Text variant="caption" tone="muted" numberOfLines={1}>
                {`${range} · ${t.calendar.leaveDaysSelected.replace('{n}', daysText(leaveDays(l)))}`}
              </Text>
            </View>
            <Pill
              label={l.status === 'approved' ? t.calendar.statusApproved : t.calendar.statusPending}
              tone={l.status === 'approved' ? 'good' : 'warn'}
            />
          </View>
        );
      })}
    </StandardCard>
  );
}
