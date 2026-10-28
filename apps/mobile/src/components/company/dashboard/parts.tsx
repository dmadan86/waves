/**
 * Pieces shared by the owner dashboard, the manager home and the employee home:
 * the header (company name, who is in it, gear, +), the stat triple, the quick actions,
 * the recent-activity list and the company switcher. Waves records money, it never moves
 * it, so every action here says "record".
 */

import { useState, type ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import {
  format,
  money,
  type CompanyEntry,
  type CurrencyCode,
  type DashboardStats,
} from '@waves/core';
import { Chip, Sheet, Text, iconSize, useTheme } from '@waves/ui';

import { PersonAvatar } from '@/components/PersonAvatar';
import { ListRow, ScenicHeader, StandardCard } from '@/components/standard';
import { kindLabel } from '@/components/company/CompanyStatementView';
import { useCompanyTags } from '@/data/companyTags';
import type { CompanyView } from '@/data/companyEntries';
import { useGroups } from '@/data/hooks';
import { displayName } from '@/data/types';
import { fill, useStrings } from '@/i18n';
import { showDate } from '@/lib/expenseDay';
import { router } from '@/lib/navigation';

export function useMoney(currency: string): (minor: bigint) => string {
  const { locale } = useStrings();
  return (minor) => format(money(minor, currency as CurrencyCode), { locale });
}

export function RolePill({ label }: { label: string }) {
  const theme = useTheme();
  return (
    <View
      style={{
        paddingHorizontal: theme.spacing.sm,
        paddingVertical: 2,
        borderRadius: theme.radius.pill,
        backgroundColor: theme.color.brandSoft,
      }}
    >
      <Text variant="micro" style={{ color: theme.color.brand }}>
        {label}
      </Text>
    </View>
  );
}

function RoundButton({
  icon,
  label,
  onPress,
  filled = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  filled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        width: filled ? 56 : 40,
        height: filled ? 56 : 40,
        borderRadius: 28,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: filled ? theme.color.buttonPrimary : 'transparent',
      }}
    >
      <Ionicons name={icon} size={filled ? iconSize.xl : iconSize.lg} color="#FFFFFF" />
    </Pressable>
  );
}

/** The scenic header: name with a company switcher, a line about who is in it, gear, menu. */
export function DashHeader({
  groupId,
  view,
  subtitle,
  pill,
  showGear,
  tabs,
}: {
  groupId: string;
  view: CompanyView;
  subtitle: string;
  pill?: string;
  showGear: boolean;
  tabs?: ReactNode;
}) {
  const { t } = useStrings();
  const [switching, setSwitching] = useState(false);
  const [menu, setMenu] = useState(false);
  const groups = useGroups().data ?? [];
  const companies = groups.filter((g) => g.type === 'company' && !g.deleted_at);
  return (
    <>
      <ScenicHeader
        title={view.name || t.extras.typeCompany}
        subtitle={subtitle}
        action={
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {showGear ? (
              <RoundButton
                icon="settings-outline"
                label={t.group.settings}
                onPress={() => router.push(`/group/${groupId}/settings`)}
              />
            ) : null}
            <RoundButton
              icon="ellipsis-vertical"
              label={t.group.more}
              onPress={() => setMenu(true)}
            />
          </View>
        }
      >
        <View style={{ gap: 6 }}>
          {companies.length > 1 ? (
            <Chip
              label={`${t.company.switchCompany} ▾`}
              onPress={() => setSwitching(true)}
              repeatable
            />
          ) : null}
          {pill ? <RolePill label={pill} /> : null}
        </View>
      </ScenicHeader>
      {tabs}
      <Sheet visible={switching} onClose={() => setSwitching(false)} closeLabel={t.common.close}>
        <View style={{ gap: 4 }}>
          {companies.map((g) => (
            <ListRow
              key={g.id}
              title={g.name ?? ''}
              onPress={() => {
                setSwitching(false);
                if (g.id !== groupId) router.replace(`/group/${g.id}`);
              }}
              divider
            />
          ))}
        </View>
      </Sheet>
      <Sheet visible={menu} onClose={() => setMenu(false)} closeLabel={t.common.close}>
        <ListRow
          title={t.company.exportAction}
          leading={<Ionicons name="download-outline" size={iconSize.md} />}
          onPress={() => {
            setMenu(false);
            router.push(`/group/${groupId}/export`);
          }}
        />
      </Sheet>
    </>
  );
}

/** The floating violet + that opens Gave money / They spent / Paid wages. */
export function PlusButton({ groupId, bottom }: { groupId: string; bottom: number }) {
  const theme = useTheme();
  const { t } = useStrings();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t.company.addEntry}
      onPress={() => router.push(`/group/${groupId}/company-entry`)}
      style={{
        position: 'absolute',
        right: theme.spacing.lg,
        bottom,
        width: 60,
        height: 60,
        borderRadius: 30,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.color.buttonPrimary,
      }}
    >
      <Ionicons name="add" size={iconSize.xl} color="#FFFFFF" />
    </Pressable>
  );
}

function Stat({
  icon,
  label,
  value,
  caption,
  captionTone,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  caption?: string;
  captionTone?: 'positive' | 'negative' | 'muted';
  onPress?: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      style={{ flex: 1, gap: 2 }}
    >
      <Ionicons name={icon} size={iconSize.md} color={theme.color.brand} />
      <Text variant="micro" tone="muted" numberOfLines={2}>
        {label}
      </Text>
      <Text variant="body" style={{ fontWeight: '700' }} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      {caption ? (
        <Text variant="micro" tone={captionTone ?? 'muted'} numberOfLines={2}>
          {caption}
        </Text>
      ) : null}
    </Pressable>
  );
}

export function StatTriple({
  stats,
  currency,
  onOwes,
}: {
  stats: DashboardStats;
  currency: string;
  onOwes?: () => void;
}) {
  const { t } = useStrings();
  const fmt = useMoney(currency);
  const pct = stats.paidChangePct;
  return (
    <StandardCard style={{ flexDirection: 'row', gap: 12 }}>
      <Stat
        icon="wallet-outline"
        label={t.company.statOwes}
        value={fmt(stats.owes)}
        caption={fill(t.company.statPending, { n: String(stats.pendingPayments) })}
        onPress={onOwes}
      />
      <Stat
        icon="arrow-up-circle-outline"
        label={t.company.statPaidMonth}
        value={fmt(stats.paidThisMonth)}
        caption={
          pct === null
            ? undefined
            : fill(t.company.statVsLast, { pct: `${pct >= 0 ? '+' : ''}${pct}` })
        }
        captionTone={pct === null ? 'muted' : pct >= 0 ? 'positive' : 'negative'}
      />
      <Stat
        icon="time-outline"
        label={t.company.statAdvances}
        value={fmt(stats.advancesOutstanding)}
        caption={fill(t.company.statEmployeesN, { n: String(stats.advanceHolders) })}
      />
    </StandardCard>
  );
}

export function QuickActions({
  actions,
}: {
  actions: readonly { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }[];
}) {
  const theme = useTheme();
  return (
    <StandardCard style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      {actions.map((a) => (
        <Pressable
          key={a.label}
          accessibilityRole="button"
          accessibilityLabel={a.label}
          onPress={a.onPress}
          style={{ flex: 1, alignItems: 'center', gap: 6 }}
        >
          <View
            style={{
              width: 48,
              height: 48,
              borderRadius: 24,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.color.brandSoft,
            }}
          >
            <Ionicons name={a.icon} size={iconSize.lg} color={theme.color.brand} />
          </View>
          <Text variant="micro" align="center" numberOfLines={2}>
            {a.label}
          </Text>
        </Pressable>
      ))}
    </StandardCard>
  );
}

export function TitleRow({ title, onViewAll }: { title: string; onViewAll?: () => void }) {
  const { t } = useStrings();
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Text variant="title">{title}</Text>
      {onViewAll ? (
        <Pressable accessibilityRole="button" onPress={onViewAll}>
          <Text variant="caption" style={{ color: theme.color.brand }}>
            {t.company.viewAll}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const GIVEN = new Set(['advance']);

/** Newest money events first: green when paid or reimbursed, red for an advance. */
export function RecentActivity({
  groupId,
  view,
  entries,
  limit,
}: {
  groupId: string;
  view: CompanyView;
  entries: readonly CompanyEntry[];
  limit?: number;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const fmt = useMoney(view.currency);
  const tagLabel = useCompanyTags(groupId, view).label;
  const rows = entries
    .filter(
      (e) =>
        !e.deleted &&
        e.kind !== 'allocation' &&
        e.kind !== 'pool_return' &&
        e.kind !== 'pool_adjustment' &&
        e.kind !== 'pool_request',
    )
    .sort((a, b) =>
      a.occurredOn === b.occurredOn
        ? b.createdAt.localeCompare(a.createdAt)
        : b.occurredOn.localeCompare(a.occurredOn),
    )
    .slice(0, limit ?? 20);
  if (rows.length === 0)
    return (
      <Text variant="caption" tone="muted">
        {t.company.recentNone}
      </Text>
    );
  return (
    <StandardCard>
      {rows.map((e, index) => {
        const owner = view.members.find((m) => m.id === e.memberId);
        const paid = e.kind === 'wage_payment' || e.kind === 'wages' || e.kind === 'reimbursement';
        const label =
          e.kind === 'wage_payment' || e.kind === 'wages'
            ? t.company.salaryPayment
            : kindLabel(t, e, tagLabel);
        return (
          <ListRow
            key={e.id}
            leading={
              owner ? (
                <PersonAvatar member={owner} name={displayName(owner)} size={40} />
              ) : undefined
            }
            title={owner ? displayName(owner, null, null, t.misc.someone) : t.misc.someone}
            subtitle={`${label} · ${showDate(e.occurredOn, locale)}`}
            titleAccessory={undefined}
            trailing={
              <Text
                variant="body"
                style={{
                  color: GIVEN.has(e.kind)
                    ? theme.color.negative
                    : paid
                      ? theme.color.positive
                      : theme.color.text,
                }}
              >
                {fmt(e.amount)}
              </Text>
            }
            onPress={() => router.push(`/group/${groupId}/company-entry-view?entry=${e.id}`)}
            divider={index < rows.length - 1}
          />
        );
      })}
    </StandardCard>
  );
}
