import { Button, Card, Row, Text, useTheme } from '@waves/ui';
import { useGroup, useGroupLedger } from '@/data/hooks';
import { displayName, type MemberRow } from '@/data/types';
import { fill, plural, useStrings } from '@/i18n';
import { useViewerId } from '@/lib/auth';
import { classifyDepartedExpenses } from '@/lib/departedExpenses';
import { useDismissed } from '@/lib/dismissed';
import { router } from '@/lib/navigation';

function DepartedBanner({
  groupId,
  member,
  count,
}: {
  groupId: string;
  member: MemberRow;
  count: number;
}) {
  const theme = useTheme();
  const viewerId = useViewerId();
  const { dismissed, dismiss } = useDismissed(`departed.${groupId}.${member.id}`, viewerId);
  const { t, locale } = useStrings();
  if (dismissed !== false) return null;
  return (
    <Card style={{ gap: theme.spacing.xs }}>
      <Text>
        {fill(plural(locale, count, t.departedExpenses.banner), {
          name: displayName(member, null, undefined, t.misc.someone),
        })}
      </Text>
      <Row style={{ gap: theme.spacing.sm }}>
        <Button
          size="sm"
          label={t.departedExpenses.decide}
          onPress={() => router.push(`/group/${groupId}/departed/${member.id}`)}
        />
        <Button size="sm" variant="ghost" label={t.departedExpenses.keepAsIs} onPress={dismiss} />
      </Row>
    </Card>
  );
}

export function DepartedExpensesBanner({ groupId }: { groupId: string }) {
  const viewerId = useViewerId();
  const { members, everyone, expenses } = useGroup(groupId);
  const ledger = useGroupLedger(groupId, viewerId);
  if (!members.data?.some((m) => m.id === ledger.myMemberId && m.role === 'admin' && !m.left_at))
    return null;
  return (
    <>
      {everyone.data
        ?.filter(
          (m) =>
            m.left_at &&
            [...ledger.net.values()].some((balances) => (balances.get(m.id) ?? 0n) !== 0n),
        )
        .map((member) => {
          const { equal, custom } = classifyDepartedExpenses(expenses.rows, member.id);
          const count = equal.length + custom.filter((c) => !c.noneRemaining).length;
          return count ? (
            <DepartedBanner key={member.id} groupId={groupId} member={member} count={count} />
          ) : null;
        })}
    </>
  );
}
