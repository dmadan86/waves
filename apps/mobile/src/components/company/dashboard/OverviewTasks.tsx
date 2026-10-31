/**
 * "Needs your attention": urgent escalations first, then today's open tasks, at most three, one list.
 * A task's checkbox marks it done through the same queue as the Work screen, and only for people the
 * viewer manages; a suspended company is read-only. Tasks carry no priority, so a chip shows only
 * what is real: a blocked task or escalation, or a task past its due time.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import { directionalIcon, iconSize, Text, useTheme } from '@waves/ui';

import { IconDisc, RED, withAlpha } from '@/components/company/dashboard/overviewKit';
import { GREEN } from '@/components/company/dashboard/parts';
import { PersonAvatar } from '@/components/PersonAvatar';
import { StandardCard } from '@/components/standard';
import type { EscalationRow, Overview } from '@/data/companyOverview';
import { useSetWorkTask } from '@/data/companyWorkday';
import { displayName, isGhost } from '@/data/types';
import { fill, useStrings } from '@/i18n';
import { router } from '@/lib/navigation';
import { agoText, buildAttention, clockText, compactMoney, taskOverdue } from '@/lib/overviewMath';

const TINTS = ['lilac', 'peach', 'sky', 'pink', 'mint', 'coral'] as const;

function Chip({ label, ink }: { label: string; ink: string }) {
  return (
    <View
      style={{
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 10,
        maxWidth: '100%',
        backgroundColor: withAlpha(ink, 0.12),
      }}
    >
      <Text variant="micro" style={{ color: ink, fontWeight: '700' }}>
        {label}
      </Text>
    </View>
  );
}

export function AttentionList({ groupId, o }: { groupId: string; o: Overview }) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const save = useSetWorkTask(groupId);
  const escalations = o.escalations.items;
  const tasks = o.tasks.open;
  const plan = buildAttention(
    escalations,
    tasks.map((x) => ({ id: x.task.id, dueTime: x.task.dueTime ?? null })),
    o.escalations.total,
    o.tasks.openCount,
  );
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
  const seeAll = () =>
    router.push(
      `/group/${groupId}/${plan.seeAll === 'pending' ? 'company-pending' : 'company-work'}`,
    );
  const rowStyle = (i: number) => ({
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 10,
    paddingVertical: 10,
    minHeight: 48,
    borderTopWidth: i === 0 ? 0 : 1,
    borderTopColor: theme.color.border,
  });

  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text
          variant="title"
          accessibilityRole="header"
          style={{ flex: 1, minWidth: 0, fontSize: 18, fontWeight: '700' }}
        >
          {t.company.ovAttention}
        </Text>
        {plan.total > 0 ? (
          <Pressable
            accessibilityRole="button"
            onPress={seeAll}
            hitSlop={12}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 2, flexShrink: 0 }}
          >
            <Text variant="caption" style={{ color: theme.color.brand, fontWeight: '600' }}>
              {t.company.ovSeeAll}
            </Text>
            <Ionicons
              name={directionalIcon('chevron-forward')}
              size={iconSize.sm}
              color={theme.color.brand}
            />
          </Pressable>
        ) : null}
      </View>
      <StandardCard style={{ paddingHorizontal: 12, paddingVertical: 4, borderRadius: 22 }}>
        {plan.items.length === 0 ? (
          <View
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14 }}
          >
            <IconDisc ink={GREEN} size={36}>
              <Ionicons name="checkmark" size={iconSize.base} color={GREEN} />
            </IconDisc>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text variant="body" style={{ fontWeight: '700' }}>
                {t.company.ovAllClear}
              </Text>
              <Text variant="caption" tone="muted">
                {t.company.ovAllClearBody}
              </Text>
            </View>
          </View>
        ) : (
          plan.items.map((it, i) => {
            if (it.type === 'escalation') {
              const r: EscalationRow = escalations[it.index];
              const amount =
                r.amountMinor === null
                  ? null
                  : compactMoney(r.amountMinor, o.currency, locale, t.company.ovCrore);
              return (
                <Pressable
                  key={it.key}
                  accessibilityRole="button"
                  onPress={() =>
                    router.push(
                      `/group/${groupId}/${r.kind === 'absent' ? 'company-attendance' : r.kind === 'blocked' ? 'company-work' : 'company-pending'}`,
                    )
                  }
                  style={rowStyle(i)}
                >
                  {r.member ? (
                    <PersonAvatar
                      member={r.member}
                      name={displayName(r.member)}
                      ghost={isGhost(r.member)}
                      size={36}
                      tint={TINTS[i % 6]}
                    />
                  ) : (
                    <IconDisc ink={theme.color.brand} size={36}>
                      <Ionicons
                        name="receipt-outline"
                        size={iconSize.base}
                        color={theme.color.brand}
                      />
                    </IconDisc>
                  )}
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
                      <Text
                        variant="body"
                        style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: '700' }}
                      >
                        {r.name || t.misc.someone}
                      </Text>
                      <Text variant="micro" tone="muted" style={{ flexShrink: 0 }}>
                        {ago(r.at)}
                      </Text>
                    </View>
                    <Text variant="micro" tone="muted">
                      {reason(r, t, amount)}
                    </Text>
                    {r.kind === 'blocked' ? <Chip label={t.company.ovBlocked} ink={RED} /> : null}
                  </View>
                </Pressable>
              );
            }
            const { task, site } = tasks[it.index];
            return (
              <View key={it.key} style={rowStyle(i)}>
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: false, disabled: o.suspended }}
                  accessibilityLabel={fill(t.company.ovTaskDone, { title: task.title })}
                  disabled={o.suspended}
                  hitSlop={12}
                  onPress={() => done(task)}
                  style={{
                    width: 24,
                    height: 24,
                    marginTop: 6,
                    borderRadius: 7,
                    borderWidth: 1.5,
                    borderColor: o.suspended ? theme.color.border : theme.color.textMuted,
                  }}
                />
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push(`/group/${groupId}/company-work`)}
                  style={{ flex: 1, minWidth: 0, gap: 3, paddingVertical: 4 }}
                >
                  <Text variant="body" style={{ fontSize: 14, fontWeight: '600' }}>
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
                    {taskOverdue(task.dueTime ?? null, o.now) ? (
                      <Chip label={t.company.ovOverdue} ink={RED} />
                    ) : null}
                    {site ? <Chip label={site} ink={theme.color.brand} /> : null}
                  </View>
                </Pressable>
              </View>
            );
          })
        )}
      </StandardCard>
    </View>
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
