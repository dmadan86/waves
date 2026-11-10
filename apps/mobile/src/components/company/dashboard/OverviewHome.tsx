/**
 * The owner's Home blocks, as drawn in the mockup: three stat tiles, "needs your attention", money actions
 * and "coming up". Each is its own Overview card (reorder or hide from Edit layout); all numbers come from
 * what the phone already holds. Waves records money; it never moves it.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import { directionalIcon, iconSize, Text, useTheme } from '@waves/ui';

import { AMBER, IconDisc, RED, Skeleton } from '@/components/company/dashboard/overviewKit';
import { GREEN } from '@/components/company/dashboard/parts';
import { StandardCard } from '@/components/standard';
import { useUpcomingItems } from '@/data/companyCalendarItems';
import { useCompanyEntries } from '@/data/companyEntries';
import { useOverview } from '@/data/companyOverview';
import { usePendingVendorBills, useCompanyVendors } from '@/data/companyVendors';
import { useWorkdayAccess, useWorkTasks } from '@/data/companyWorkday';
import { todayIso } from '@/data/personal';
import { plural, useStrings, fill } from '@/i18n';
import { router } from '@/lib/navigation';
import { awaitingApprovals } from '@/lib/companyPending';
import { buildComingUp, buildNeedRows, taskFacts } from '@/lib/overviewHome';
import { clockText, compactMoney } from '@/lib/overviewMath';

const LAVENDER = '#7C5CE0';
const BLUE = '#2F6FE0';

/** Everything the blocks read, once per block: the viewer's tasks, claims awaiting them and what the company owes. */
function useHome(groupId: string) {
  const view = useCompanyEntries(groupId);
  const access = useWorkdayAccess(groupId);
  const tasks = useWorkTasks(groupId);
  const vendors = useCompanyVendors(groupId);
  const bills = usePendingVendorBills(groupId);
  const o = useOverview(groupId, todayIso());
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const ids = new Set(access.people.map((m) => m.id));
  const facts = taskFacts(
    tasks.filter((x) => ids.has(x.memberId)),
    todayIso(),
    hhmm,
  );
  const claims = awaitingApprovals(view);
  const approvals = {
    count: claims.length + bills.count,
    total: [...claims.map((e) => e.amount), ...bills.bills.map((b) => b.amount)].reduce(
      (a, b) => a + b,
      0n,
    ),
  };
  let toVendors = 0n;
  for (const v of vendors.balances.values()) if (v > 0n) toVendors += v;
  return { view, o, facts, approvals, toVendors };
}

function useFmt(currency: string) {
  const { t, locale } = useStrings();
  return (minor: bigint) => compactMoney(minor, currency, locale, t.company.ovCrore);
}

function Tile({
  ink,
  icon,
  value,
  label,
  onPress,
}: {
  ink: string;
  icon: keyof typeof Ionicons.glyphMap;
  value: string;
  label: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      onPress={onPress}
      style={{
        flex: 1,
        minWidth: 0,
        gap: 6,
        padding: 10,
        borderRadius: 12,
        backgroundColor: theme.color.surface,
        borderWidth: 1,
        borderColor: theme.color.border,
      }}
    >
      <IconDisc ink={ink} size={30}>
        <Ionicons name={icon} size={iconSize.sm} color={ink} />
      </IconDisc>
      <Text
        variant="title"
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.6}
        style={{ fontSize: 20, fontWeight: '800' }}
      >
        {value}
      </Text>
      <Text variant="micro" numberOfLines={2} style={{ color: theme.color.textMuted }}>
        {label}
      </Text>
    </Pressable>
  );
}

export function GlanceTiles({ groupId }: { groupId: string }) {
  const { t } = useStrings();
  const { o, facts, toVendors } = useHome(groupId);
  const fmt = useFmt(o.currency);
  if (!o.ready || !o.money)
    return (
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} height={104} flex={1} />
        ))}
      </View>
    );
  const go = (screen: string) => () => router.push(`/group/${groupId}/${screen}`);
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      <Tile
        ink={LAVENDER}
        icon="wallet-outline"
        value={fmt(o.money.owes + toVendors)}
        label={t.company.ovTilePayments}
        onPress={go('company-payments')}
      />
      <Tile
        ink={GREEN}
        icon="checkbox-outline"
        value={String(facts.open)}
        label={t.company.ovTileTasks}
        onPress={go('company-work')}
      />
      <Tile
        ink={AMBER}
        icon="time-outline"
        value={fmt(o.money.advances)}
        label={t.company.ovTileAdvances}
        onPress={go('company-people')}
      />
    </View>
  );
}

function Header({
  icon,
  title,
  badge,
  onSeeAll,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  badge?: number;
  onSeeAll?: () => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Ionicons name={icon} size={iconSize.md} color={LAVENDER} />
      <Text variant="title" accessibilityRole="header" style={{ fontSize: 17, fontWeight: '700' }}>
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
            {badge}
          </Text>
        </View>
      ) : null}
      <View style={{ flex: 1 }} />
      {onSeeAll ? (
        <Pressable
          accessibilityRole="button"
          onPress={onSeeAll}
          hitSlop={12}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}
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
  );
}

/** `approvalsOnly`: just the claims-awaiting row (the task block above already shows tasks). */
export function NeedsAttention({
  groupId,
  approvalsOnly = false,
}: {
  groupId: string;
  approvalsOnly?: boolean;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const { o, facts, approvals } = useHome(groupId);
  const fmt = useFmt(o.currency);
  if (!o.ready) return <Skeleton height={150} />;
  const rows = buildNeedRows(facts, approvals).filter(
    (r) => !approvalsOnly || r.kind === 'approve',
  );
  if (approvalsOnly && rows.length === 0) return null;
  const c = t.company;
  const go = (screen: string) => () => router.push(`/group/${groupId}/${screen}`);
  const line = (r: (typeof rows)[number]) => {
    if (r.kind === 'blocked')
      return {
        icon: 'warning-outline' as const,
        ink: RED,
        title: plural(locale, r.n, c.ovNeedBlockedN),
        detail: r.titles.slice(0, 2).join(', ') + (r.n > 2 ? '…' : ''),
        screen: 'company-work',
      };
    if (r.kind === 'approve')
      return {
        icon: 'cash-outline' as const,
        ink: AMBER,
        title: plural(locale, r.n, c.ovNeedApproveN),
        detail: fill(c.ovNeedTotal, { amount: fmt(r.total) }),
        screen: 'company-pending',
      };
    return {
      icon: 'alarm-outline' as const,
      ink: LAVENDER,
      title: plural(locale, r.n, c.ovNeedOverdueN),
      detail: r.first.dueTime
        ? fill(c.ovNeedDue, { title: r.first.title, time: clockText(r.first.dueTime, locale) })
        : r.first.title,
      screen: 'company-work',
    };
  };
  return (
    <StandardCard style={{ paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, gap: 4 }}>
      <Header
        icon="radio-button-on-outline"
        title={c.ovAttention}
        badge={rows.length}
        onSeeAll={rows.length > 0 ? go('company-pending') : undefined}
      />
      {rows.length === 0 ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 }}>
          <IconDisc ink={GREEN} size={34}>
            <Ionicons name="checkmark" size={iconSize.base} color={GREEN} />
          </IconDisc>
          <Text variant="body" style={{ fontWeight: '700' }}>
            {c.ovAllClear}
          </Text>
        </View>
      ) : (
        rows.map((r, i) => {
          const l = line(r);
          return (
            <Pressable
              key={r.kind}
              accessibilityRole="button"
              accessibilityLabel={`${l.title}, ${l.detail}`}
              onPress={go(l.screen)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                minHeight: 52,
                borderTopWidth: i === 0 ? 0 : 1,
                borderTopColor: theme.color.border,
              }}
            >
              <IconDisc ink={l.ink} size={36}>
                <Ionicons name={l.icon} size={iconSize.base} color={l.ink} />
              </IconDisc>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text variant="body" style={{ fontSize: 14, fontWeight: '700' }}>
                  {l.title}
                </Text>
                <Text variant="micro" tone="muted" numberOfLines={1}>
                  {l.detail}
                </Text>
              </View>
              <Ionicons
                name={directionalIcon('chevron-forward')}
                size={iconSize.sm}
                color={theme.color.textMuted}
              />
            </Pressable>
          );
        })
      )}
    </StandardCard>
  );
}

export function MoneyActions({ groupId }: { groupId: string }) {
  const theme = useTheme();
  const { t } = useStrings();
  const view = useCompanyEntries(groupId);
  const go = (screen: string) => () => router.push(`/group/${groupId}/${screen}`);
  // "New order" is left out until vendor orders ship (PR #1565).
  const actions = [
    { icon: 'card-outline', label: t.company.qaRecord, ink: GREEN, onPress: go('company-wages') },
    {
      icon: 'document-attach-outline',
      label: t.company.ovAddBill,
      ink: LAVENDER,
      onPress: go('company-vendors'),
    },
    {
      icon: 'document-text-outline',
      label: t.company.ovCreateInvoice,
      ink: BLUE,
      onPress: go('company-bill-form?type=bill'),
    },
  ] as const;
  if (view.suspended) return null;
  return (
    <StandardCard style={{ paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, gap: 8 }}>
      <Header icon="layers-outline" title={t.company.ovCardMoney} />
      <View>
        {actions.map((a, i) => (
          <Pressable
            key={a.label}
            accessibilityRole="button"
            onPress={a.onPress}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              minHeight: 48,
              borderTopWidth: i === 0 ? 0 : 1,
              borderTopColor: theme.color.border,
            }}
          >
            <Ionicons name={a.icon} size={iconSize.md} color={a.ink} />
            <Text variant="body" style={{ flex: 1 }}>
              {a.label}
            </Text>
            <Ionicons
              name={directionalIcon('chevron-forward')}
              size={iconSize.sm}
              color={theme.color.textMuted}
            />
          </Pressable>
        ))}
      </View>
    </StandardCard>
  );
}

export function ComingUpRow({ groupId }: { groupId: string }) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const { facts, approvals, view } = useHome(groupId);
  const items = useUpcomingItems(groupId, 400);
  const today = todayIso();
  const ahead = items.filter((it) => it.day >= today);
  const pick = (kind: string) => ahead.find((it) => it.subKind === kind) ?? null;
  const next = ahead.find((it) => it.subKind === 'event' || it.subKind === 'holiday') ?? null;
  const cards = buildComingUp(
    view.isOwner ? pick('wage') : null,
    next,
    facts.dueThisWeek,
    approvals.count,
  );
  if (cards.length === 0) return null;
  const c = t.company;
  const when = (day: string, time: string | null) =>
    day === today
      ? [t.calendar.today, time ? clockText(time, locale) : null].filter(Boolean).join(', ')
      : new Date(`${day}T00:00:00Z`).toLocaleDateString(locale, {
          month: 'short',
          day: 'numeric',
          timeZone: 'UTC',
        });
  return (
    <StandardCard style={{ paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, gap: 8 }}>
      <Header
        icon="calendar-outline"
        title={c.ovComingUp}
        onSeeAll={() => router.push(`/group/${groupId}/company-calendar`)}
      />
      <View>
        {cards.map((card, i) => {
          const spec =
            card.kind === 'payroll' || card.kind === 'event'
              ? {
                  icon: card.kind === 'payroll' ? 'cash-outline' : 'calendar-outline',
                  ink: GREEN,
                  title: card.kind === 'payroll' ? c.ovPayrollRun : card.title,
                  detail: when(card.day, card.time),
                  screen: 'company-calendar',
                }
              : card.kind === 'tasks'
                ? {
                    icon: 'calendar-outline',
                    ink: LAVENDER,
                    title: plural(locale, card.n, c.ovCdTasksN),
                    detail: c.ovCdThisWeek,
                    screen: 'company-work',
                  }
                : {
                    icon: 'cash-outline',
                    ink: RED,
                    title: plural(locale, card.n, c.ovCdApprovalsN),
                    detail: c.ovCdWaiting,
                    screen: 'company-pending',
                  };
          return (
            <Pressable
              key={card.kind}
              accessibilityRole="button"
              accessibilityLabel={`${spec.title}, ${spec.detail}`}
              onPress={() => router.push(`/group/${groupId}/${spec.screen}`)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                minHeight: 48,
                borderTopWidth: i === 0 ? 0 : 1,
                borderTopColor: theme.color.border,
              }}
            >
              <Ionicons name={spec.icon as 'cash-outline'} size={iconSize.md} color={spec.ink} />
              <Text variant="body" numberOfLines={1} style={{ flex: 1 }}>
                {spec.title}
              </Text>
              <Text variant="caption" tone="muted" numberOfLines={1}>
                {spec.detail}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </StandardCard>
  );
}
