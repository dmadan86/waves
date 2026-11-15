import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';
import { directionalIcon, Text, tintForKey, useTheme } from '@waves/ui';
import { PersonAvatar } from '@/components/PersonAvatar';
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
  const name = displayName(member, null, undefined, t.misc.someone);
  const tint = tintForKey(name);
  const color = theme.tint[tint];
  if (dismissed !== false) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={fill(t.departedExpenses.decideFor, { name })}
      onPress={() => router.push(`/group/${groupId}/departed/${member.id}`)}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        minHeight: 56,
        paddingVertical: 10,
        paddingHorizontal: 12,
        marginBottom: theme.spacing.xl,
        borderRadius: theme.radius.lg,
        backgroundColor: `${color.bg}40`,
        borderColor: `${color.bg}99`,
        borderWidth: StyleSheet.hairlineWidth,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <PersonAvatar name={name} tint={tint} size={28} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} ellipsizeMode="tail" style={{ fontSize: 15, fontWeight: '600' }}>
          {fill(t.departedExpenses.bannerTitle, { name })}
        </Text>
        <Text numberOfLines={1} ellipsizeMode="tail" tone="muted" style={{ fontSize: 13 }}>
          {plural(locale, count, t.departedExpenses.banner)}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t.departedExpenses.keepAsIs}
        hitSlop={8}
        onPress={(event) => {
          event.stopPropagation();
          dismiss();
        }}
        style={{ alignItems: 'center', justifyContent: 'center', width: 28, height: 28 }}
      >
        <Ionicons name="close" size={16} color={theme.color.textMuted} />
      </Pressable>
      <Ionicons name={directionalIcon('chevron-forward')} size={18} color={theme.color.textMuted} />
    </Pressable>
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
