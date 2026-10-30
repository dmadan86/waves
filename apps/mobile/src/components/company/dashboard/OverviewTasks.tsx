/**
 * Today's tasks beside the urgent escalations, as drawn in the owner's mockup. Below ~380dp the two
 * cards stack. A task's checkbox marks it done through the same queue as the Work screen, and only
 * for people the viewer manages; a suspended company is read-only.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, useWindowDimensions, View } from 'react-native';

import { directionalIcon, iconSize, Text, useTheme } from '@waves/ui';

import { IconDisc, RED, withAlpha } from '@/components/company/dashboard/overviewKit';
import { BLUE, GREEN } from '@/components/company/dashboard/parts';
import { PersonAvatar } from '@/components/PersonAvatar';
import type { EscalationRow, Overview } from '@/data/companyOverview';
import { useSetWorkTask } from '@/data/companyWorkday';
import { displayName, isGhost } from '@/data/types';
import { fill, useStrings } from '@/i18n';
import { router } from '@/lib/navigation';
import { agoText, clockText, compactMoney } from '@/lib/overviewMath';
import { StandardCard } from '@/components/standard';

export function TasksAndUrgent({ groupId, o }: { groupId: string; o: Overview }) {
  const { width } = useWindowDimensions();
  const stacked = width < 380;
  return (
    <View style={{ flexDirection: stacked ? 'column' : 'row', gap: 10, alignItems: 'stretch' }}>
      <TasksCard groupId={groupId} o={o} />
      <UrgentCard groupId={groupId} o={o} />
    </View>
  );
}

function CardHead({
  icon,
  ink,
  title,
  badge,
  action,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  ink: string;
  title: string;
  badge?: number;
  action?: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={badge ? `${title}, ${badge}` : title}
      onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
    >
      <IconDisc ink={ink} size={36}>
        <Ionicons name={icon} size={iconSize.base} color={ink} />
      </IconDisc>
      <Text
        variant="title"
        numberOfLines={2}
        style={{ flexShrink: 1, fontSize: 15, fontWeight: '700' }}
      >
        {title}
      </Text>
      {badge ? (
        <View
          style={{
            minWidth: 22,
            height: 22,
            borderRadius: 11,
            paddingHorizontal: 6,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: RED,
          }}
        >
          <Text variant="micro" style={{ color: '#FFFFFF', fontWeight: '700' }}>
            {badge > 99 ? '99+' : badge}
          </Text>
        </View>
      ) : null}
      <View style={{ flex: 1 }} />
      {action ? (
        <Text
          variant="caption"
          numberOfLines={1}
          style={{ color: theme.color.brand, fontWeight: '600' }}
        >
          {action}
        </Text>
      ) : null}
      <Ionicons
        name={directionalIcon('chevron-forward')}
        size={iconSize.sm}
        color={action ? theme.color.brand : theme.color.textMuted}
      />
    </Pressable>
  );
}

function TasksCard({ groupId, o }: { groupId: string; o: Overview }) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const save = useSetWorkTask(groupId);
  const done = (task: Overview['tasks']['open'][number]['task']) => {
    if (o.suspended || save.isPending) return;
    // A silent retry is the queue's job; there is nothing to refuse here.
    save.mutate({
      taskId: task.id,
      memberId: task.memberId,
      day: task.day,
      title: task.title,
      projectId: task.projectId,
      status: 'done',
      blockedReason: null,
      note: task.note,
      dueTime: task.dueTime ?? null,
    });
  };
  return (
    <StandardCard style={{ flex: 1, minWidth: 0, padding: 12, borderRadius: 22, gap: 6 }}>
      <CardHead
        icon="clipboard-outline"
        ink={BLUE}
        title={t.company.ovTasksTitle}
        action={t.company.ovSeeAll}
        onPress={() => router.push(`/group/${groupId}/company-work`)}
      />
      {o.tasks.open.length === 0 ? (
        <Text variant="caption" tone="muted" style={{ paddingVertical: 14, paddingHorizontal: 4 }}>
          {o.tasks.total > 0 ? t.company.ovTasksAllDone : t.company.ovTasksNone}
        </Text>
      ) : (
        o.tasks.open.map(({ task, site }, i) => (
          <View
            key={task.id}
            style={{
              flexDirection: 'row',
              alignItems: 'flex-start',
              gap: 10,
              paddingVertical: 8,
              borderTopWidth: i === 0 ? 0 : 1,
              borderTopColor: theme.color.border,
            }}
          >
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: false, disabled: o.suspended }}
              accessibilityLabel={fill(t.company.ovTaskDone, { title: task.title })}
              disabled={o.suspended}
              hitSlop={10}
              onPress={() => done(task)}
              style={{
                width: 22,
                height: 22,
                marginTop: 2,
                borderRadius: 6,
                borderWidth: 1.5,
                borderColor: o.suspended ? theme.color.border : theme.color.textMuted,
              }}
            />
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push(`/group/${groupId}/company-work`)}
              style={{ flex: 1, minWidth: 0, gap: 3 }}
            >
              <Text variant="body" numberOfLines={2} style={{ fontSize: 14, fontWeight: '500' }}>
                {task.title}
              </Text>
              <View
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}
              >
                {task.dueTime ? (
                  <Text variant="micro" tone="muted">
                    {clockText(task.dueTime, locale)}
                  </Text>
                ) : null}
                {site ? (
                  <View
                    style={{
                      maxWidth: '100%',
                      paddingHorizontal: 8,
                      paddingVertical: 2,
                      borderRadius: 10,
                      backgroundColor: withAlpha(task.status === 'blocked' ? RED : BLUE, 0.12),
                    }}
                  >
                    <Text
                      variant="micro"
                      numberOfLines={1}
                      style={{ color: task.status === 'blocked' ? RED : BLUE, fontWeight: '600' }}
                    >
                      {site}
                    </Text>
                  </View>
                ) : null}
              </View>
            </Pressable>
          </View>
        ))
      )}
    </StandardCard>
  );
}

function reason(
  r: EscalationRow,
  t: ReturnType<typeof useStrings>['t'],
  amount: string | null,
): string {
  const base =
    r.kind === 'advance'
      ? t.company.ovEscAdvance
      : r.kind === 'expense'
        ? t.company.ovEscExpense
        : r.kind === 'poolRequest'
          ? t.company.ovEscPool
          : r.kind === 'vendorBill'
            ? t.company.ovEscBill
            : r.kind === 'absent'
              ? fill(t.company.ovEscAbsent, { n: r.days ?? 3 })
              : fill(t.company.ovEscBlocked, { title: r.detail ?? '' });
  return amount ? `${base} ${amount}` : base;
}

function UrgentCard({ groupId, o }: { groupId: string; o: Overview }) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const { items, total } = o.escalations;
  const ago = (at: number): string => {
    const a = agoText(at, o.now);
    return a.unit === 'now'
      ? t.company.ovAgoNow
      : fill(
          a.unit === 'min'
            ? t.company.ovAgoMin
            : a.unit === 'hour'
              ? t.company.ovAgoHour
              : t.company.ovAgoDay,
          { n: a.n },
        );
  };
  return (
    <StandardCard style={{ flex: 1, minWidth: 0, padding: 12, borderRadius: 22, gap: 6 }}>
      <CardHead
        icon="warning-outline"
        ink={RED}
        title={t.company.ovUrgent}
        badge={total}
        onPress={() => router.push(`/group/${groupId}/company-pending`)}
      />
      {items.length === 0 ? (
        <View style={{ alignItems: 'center', gap: 6, paddingVertical: 14 }}>
          <IconDisc ink={GREEN} size={40}>
            <Ionicons name="checkmark-circle-outline" size={iconSize.lg} color={GREEN} />
          </IconDisc>
          <Text variant="caption" align="center" style={{ fontWeight: '700' }}>
            {t.company.ovAllClear}
          </Text>
          <Text variant="micro" tone="muted" align="center">
            {t.company.ovAllClearBody}
          </Text>
        </View>
      ) : (
        items.map((r, i) => {
          const amount =
            r.amountMinor === null
              ? null
              : compactMoney(r.amountMinor, o.currency, locale, t.company.ovCrore);
          return (
            <Pressable
              key={r.key}
              accessibilityRole="button"
              onPress={() =>
                router.push(
                  `/group/${groupId}/${r.kind === 'absent' ? 'company-attendance' : r.kind === 'blocked' ? 'company-work' : 'company-pending'}`,
                )
              }
              style={{
                flexDirection: 'row',
                alignItems: 'flex-start',
                gap: 10,
                paddingVertical: 8,
                borderTopWidth: i === 0 ? 0 : 1,
                borderTopColor: theme.color.border,
              }}
            >
              {r.member ? (
                <PersonAvatar
                  member={r.member}
                  name={displayName(r.member)}
                  ghost={isGhost(r.member)}
                  size={36}
                  tint={(['lilac', 'peach', 'sky', 'pink', 'mint', 'coral'] as const)[i % 6]}
                />
              ) : (
                <IconDisc ink={theme.color.brand} size={36}>
                  <Ionicons name="receipt-outline" size={iconSize.base} color={theme.color.brand} />
                </IconDisc>
              )}
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
                  <Text
                    variant="body"
                    numberOfLines={1}
                    style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: '700' }}
                  >
                    {r.name || t.misc.someone}
                  </Text>
                  <Text variant="micro" tone="muted" numberOfLines={1} style={{ flexShrink: 0 }}>
                    {ago(r.at)}
                  </Text>
                </View>
                <Text variant="micro" tone="muted" numberOfLines={3}>
                  {reason(r, t, amount)}
                </Text>
              </View>
            </Pressable>
          );
        })
      )}
    </StandardCard>
  );
}
