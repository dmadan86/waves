/**
 * Pieces shared by the owner dashboard, the manager home and the employee home:
 * the header (company name, who is in it, gear, +), the stat triple, the quick actions,
 * the recent-activity list and the company switcher. Waves records money, it never moves
 * it, so every action here says "record".
 */

import { useState, type ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams } from 'expo-router';
import { Image, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  format,
  money,
  type CompanyEntry,
  type CurrencyCode,
  type DashboardStats,
} from '@waves/core';
import { Sheet, Text, directionalIcon, iconSize, useTheme, type TintName } from '@waves/ui';

import { BUILDING_ART } from './art';
import { ReportCompanySheet, SuspendedBanner } from '@/components/company/SuspendedBanner';
import { useGroupPhotoUrl } from '@/components/GroupPhoto';
import { OverflowMenu, type OverflowMenuItem } from '@/components/OverflowMenu';
import { PersonAvatar } from '@/components/PersonAvatar';
import { StandardCard } from '@/components/standard';
import { useHeroStatusBar } from '@/components/ScreenHero';
import { kindLabel } from '@/components/company/CompanyStatementView';
import { useCompanyTags } from '@/data/companyTags';
import { useCompanyProjects, useCompanySuspended, type CompanyView } from '@/data/companyEntries';
import { useGroup, useGroups } from '@/data/hooks';
import { displayName, type MemberRow, type GroupRow } from '@/data/types';
import { fill, plural, useStrings } from '@/i18n';
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

/** Paid / reimbursed money reads green on this screen (the mockup), whatever the app's blue. */
export const GREEN = '#15803D';
export const GREEN_SOFT = '#DDF5E5';
export const BLUE = '#2F6FE0';
export const BLUE_SOFT = '#DCEBFF';
const ORANGE = '#F26B1D';
const ORANGE_SOFT = '#FFE6D5';
const BUILDING = require('../../../../assets/images/company/hero-building.webp') as number;
const TEAM = require('../../../../assets/images/company/team.webp') as number;

/** The body under the hero and tabs: standard gutters, tighter gaps than the scenic body. */
export function DashBody({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ paddingHorizontal: theme.spacing.lg, gap: theme.spacing.md, paddingTop: 4 }}>
      {children}
    </View>
  );
}

/** The pill tabs under the hero: the picked one filled violet, the rest soft lavender. */
export function TabPills<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const theme = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{
        paddingHorizontal: theme.spacing.lg,
        paddingVertical: theme.spacing.sm,
        gap: theme.spacing.sm,
      }}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            hitSlop={{ top: 6, bottom: 6 }}
            onPress={() => onChange(o.value)}
            style={{
              height: 36,
              paddingHorizontal: 16,
              borderRadius: theme.radius.pill,
              justifyContent: 'center',
              backgroundColor: on ? theme.color.buttonPrimary : theme.color.brandSoft,
            }}
          >
            <Text
              variant="caption"
              style={{
                fontWeight: '600',
                color: on ? theme.color.onButtonPrimary : theme.color.textMuted,
              }}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function IconButton({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={{ width: 38, height: 38, alignItems: 'center', justifyContent: 'center' }}
    >
      <Ionicons name={icon} size={iconSize.lg} color={theme.color.text} />
    </Pressable>
  );
}

/**
 * The hero: a soft sunset sky and the office building, then back, the company name with
 * its switcher, gear and menu, who is in it. Add and export live on the company bar (FAB, More).
 */
export function DashHeader({
  groupId,
  view,
  subtitle,
  pill,
  showGear,
  voice,
  onBack,
  exportMenu,
}: {
  groupId: string;
  view: CompanyView;
  subtitle: string;
  pill?: string;
  showGear: boolean;
  /** Offer "speak an expense" beside the +. */
  voice?: boolean;
  /** Company-bar screens go to Overview / Home instead of popping. */
  onBack?: () => void;
  /** Employees have no company bar, so Export stays in a ⋮ here. */
  exportMenu?: boolean;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const insets = useSafeAreaInsets();
  const dark = theme.scheme === 'dark';
  useHeroStatusBar(dark ? 'light' : 'dark');
  const [switching, setSwitching] = useState(false);
  const [menu, setMenu] = useState(false);
  const [reporting, setReporting] = useState(false);
  const groups = useGroups().data ?? [];
  const companies = groups.filter((g) => g.type === 'company' && !g.deleted_at);

  const sky = dark ? ['#26264A', '#3A2D45'] : ['#CFCFF7', '#FBE3D1'];
  return (
    <>
      <View style={{ paddingTop: insets.top + 6, paddingBottom: 34 }}>
        <View
          pointerEvents="none"
          style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, overflow: 'hidden' }}
        >
          <LinearGradient colors={sky as [string, string]} style={{ flex: 1 }} />
          <Image
            source={BUILDING}
            accessibilityIgnoresInvertColors
            fadeDuration={0}
            style={{ position: 'absolute', right: 36, bottom: 0, width: 150, height: 140 }}
          />
          <LinearGradient
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            colors={[sky[1] + 'FF', sky[1] + '00']}
            style={{ position: 'absolute', right: 120, bottom: 0, width: 70, height: 140 }}
          />
          <LinearGradient
            colors={['rgba(0,0,0,0)', theme.color.bg]}
            style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 30 }}
          />
        </View>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: theme.spacing.md,
          }}
        >
          <IconButton
            icon={directionalIcon('arrow-back')}
            label={t.common.back}
            onPress={onBack ?? (() => router.back())}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${view.name || t.extras.typeCompany}, ${t.company.switchCompany}`}
            onPress={() => setSwitching(true)}
            style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}
          >
            <Text
              variant="heading"
              accessibilityRole="header"
              numberOfLines={1}
              style={{ fontSize: 22, fontWeight: '800', flexShrink: 1 }}
            >
              {view.name || t.extras.typeCompany}
            </Text>
            <Ionicons name="chevron-down" size={iconSize.md} color={theme.color.text} />
          </Pressable>
          {showGear ? (
            <IconButton
              icon="settings-outline"
              label={t.company.companySettings}
              onPress={() => router.push(`/group/${groupId}/settings`)}
            />
          ) : null}
          {exportMenu ? (
            <IconButton
              icon="ellipsis-vertical"
              label={t.group.more}
              onPress={() => setMenu(true)}
            />
          ) : null}
        </View>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            marginStart: theme.spacing.md + 42,
            marginEnd: 76,
            marginTop: 2,
          }}
        >
          <Ionicons name="people-outline" size={iconSize.base} color={theme.color.text} />
          <Text variant="caption" style={{ fontSize: 12.5 }}>
            {subtitle}
          </Text>
          {pill ? <RolePill label={pill} /> : null}
        </View>
        {voice && !view.suspended ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.company.voiceAdd}
            onPress={() => router.push({ pathname: '/voice', params: { group: groupId } })}
            style={{
              position: 'absolute',
              right: theme.spacing.lg,
              bottom: 10,
              width: 42,
              height: 42,
              borderRadius: 21,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.color.surface,
              borderWidth: 1,
              borderColor: theme.color.border,
              zIndex: 2,
              elevation: 3,
            }}
          >
            <Ionicons name="mic-outline" size={iconSize.lg} color={theme.color.text} />
          </Pressable>
        ) : null}
      </View>
      {view.suspended ? <SuspendedBanner /> : null}
      <ReportCompanySheet groupId={groupId} visible={reporting} onClose={() => setReporting(false)} />
      <Sheet
        visible={switching}
        onClose={() => setSwitching(false)}
        closeLabel={t.common.close}
        title={t.company.switchCompany}
        titleAction={
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setSwitching(false);
              router.push('/new-group?type=company');
            }}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              borderRadius: theme.radius.pill,
              padding: 10,
              backgroundColor: theme.color.brandSoft,
            }}
          >
            <Ionicons name="add-circle" size={18} color={theme.color.brand} />
            <Text variant="caption" style={{ color: theme.color.brand }}>
              {t.company.createCompanyNew}
            </Text>
          </Pressable>
        }
      >
        <ScrollView contentContainerStyle={{ gap: 10 }}>
          <Text variant="caption" tone="muted" style={{ marginBottom: 6 }}>
            {t.company.switchCompanyBody}
          </Text>
          {companies.map((g) => (
            <CompanySwitchRow
              key={g.id}
              group={g}
              current={g.id === groupId}
              onPress={() => {
                setSwitching(false);
                if (g.id !== groupId) router.replace(`/group/${g.id}`);
              }}
            />
          ))}
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setSwitching(false);
              router.push(`/companies?current=${groupId}`);
            }}
            style={{
              marginTop: 12,
              padding: 16,
              borderRadius: theme.radius.lg,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              backgroundColor: theme.color.brandSoft,
            }}
          >
            <Ionicons name="settings-outline" size={22} color={theme.color.brand} />
            <Text style={{ flex: 1, color: theme.color.brand }}>{t.company.manageCompanies}</Text>
            <Ionicons
              name={directionalIcon('chevron-forward')}
              size={20}
              color={theme.color.brand}
            />
          </Pressable>
        </ScrollView>
      </Sheet>
      <OverflowMenu
        visible={menu}
        onClose={() => setMenu(false)}
        items={[
          ...(showGear
            ? [
                {
                  icon: 'settings-outline',
                  label: t.company.companySettings,
                  route: `/group/${groupId}/settings`,
                } as OverflowMenuItem,
              ]
            : []),
          {
            icon: 'download-outline',
            label: t.company.exportAction,
            route: `/group/${groupId}/export`,
          },
          {
            icon: 'flag-outline',
            label: t.company.reportCompany,
            onPress: () => setReporting(true),
          },
        ]}
      />
    </>
  );
}

const SMALL = { fontSize: 11.5, lineHeight: 15 } as const;

function Stat({
  icon,
  tint,
  ink,
  label,
  value,
  caption,
  captionColor,
  trailing,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
  ink: string;
  label: string;
  value: string;
  caption?: string;
  captionColor?: string;
  trailing?: ReactNode;
  onPress?: () => void;
}) {
  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      style={{ flex: 1, gap: 4, paddingHorizontal: 8 }}
    >
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: 16,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: tint,
        }}
      >
        <Ionicons name={icon} size={iconSize.base} color={ink} />
      </View>
      <Text variant="caption" style={[SMALL, { minHeight: 30 }]} numberOfLines={2}>
        {label}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text
          variant="body"
          style={{ fontWeight: '800', fontSize: 17, flexShrink: 1 }}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {value}
        </Text>
        {trailing}
      </View>
      {caption ? (
        <Text
          variant="caption"
          tone={captionColor ? undefined : 'muted'}
          style={[SMALL, captionColor ? { color: captionColor } : null]}
          numberOfLines={2}
        >
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
  showCompanySpend = false,
}: {
  showCompanySpend?: boolean;
  stats: DashboardStats;
  currency: string;
  onOwes?: () => void;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const fmt = useMoney(currency);
  const pct = stats.paidChangePct;
  const line = (
    <View style={{ width: 1, backgroundColor: theme.color.border, marginVertical: 4 }} />
  );
  return (
    <StandardCard style={{ paddingHorizontal: 4, paddingVertical: 12 }}>
      <View style={{ flexDirection: 'row' }}>
        <Stat
          icon="wallet-outline"
          tint={theme.color.brandSoft}
          ink={theme.color.brand}
          label={t.company.statOwes}
          value={fmt(stats.owes)}
          caption={fill(t.company.statPending, { n: String(stats.pendingPayments) })}
          trailing={
            onOwes ? (
              <Ionicons
                name={directionalIcon('chevron-forward')}
                size={iconSize.sm}
                color={theme.color.textMuted}
              />
            ) : undefined
          }
          onPress={onOwes}
        />
        {line}
        <Stat
          icon="arrow-up"
          tint={GREEN_SOFT}
          ink={GREEN}
          label={t.company.statPaidMonth}
          value={fmt(stats.paidThisMonth)}
          // Hidden when last month is zero or unknown: a percentage of nothing means nothing.
          caption={
            pct === null
              ? undefined
              : `${pct >= 0 ? '\u2197' : '\u2198'} ${fill(t.company.statVsLast, { pct: `${pct >= 0 ? '+' : ''}${pct}` })}`
          }
          captionColor={pct === null ? undefined : pct >= 0 ? GREEN : theme.color.negative}
        />
        {line}
        <Stat
          icon="time-outline"
          tint={theme.color.brandSoft}
          ink={theme.color.brand}
          label={t.company.statAdvances}
          value={fmt(stats.advancesOutstanding)}
          caption={plural(locale, stats.advanceHolders, t.company.employeeCount)}
        />
      </View>
      {showCompanySpend || stats.companySpentThisMonth !== 0n ? (
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            gap: 8,
            paddingHorizontal: 8,
            paddingTop: 10,
          }}
        >
          <Text variant="caption" tone="muted" style={{ flex: 1 }}>
            {t.company.companySpentMonth}
          </Text>
          <Text variant="caption" style={{ fontWeight: '700' }}>
            {fmt(stats.companySpentThisMonth)}
          </Text>
        </View>
      ) : null}
    </StandardCard>
  );
}

/** The company screens live under /group/[id]: is that company suspended? */
function useRouteCompanySuspended(): boolean {
  const { id } = useLocalSearchParams<{ id: string }>();
  return useCompanySuspended(id ?? '');
}

export function QuickActions({
  actions,
}: {
  actions: readonly { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }[];
}) {
  const theme = useTheme();
  const suspended = useRouteCompanySuspended();
  const tones = [
    [theme.color.brandSoft, theme.color.brand],
    [BLUE_SOFT, BLUE],
    [GREEN_SOFT, GREEN],
    [ORANGE_SOFT, ORANGE],
  ] as const;
  if (suspended) return null;
  return (
    <StandardCard style={{ flexDirection: 'row', paddingHorizontal: 6, paddingVertical: 12 }}>
      {actions.map((a, i) => (
        <Pressable
          key={a.label}
          accessibilityRole="button"
          accessibilityLabel={a.label}
          onPress={a.onPress}
          style={{ flex: 1, alignItems: 'center', gap: 6 }}
        >
          <View
            style={{
              width: 42,
              height: 42,
              borderRadius: 21,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: tones[i % tones.length]![0],
            }}
          >
            <Ionicons name={a.icon} size={iconSize.md} color={tones[i % tones.length]![1]} />
          </View>
          <Text variant="caption" align="center" numberOfLines={2} style={{ fontSize: 12 }}>
            {a.label}
          </Text>
        </Pressable>
      ))}
    </StandardCard>
  );
}

/** The cream "Invite your team" banner: three faces, one line, a chevron. */
export function InviteBanner({
  title,
  body,
  onPress,
}: {
  title: string;
  body: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  const dark = theme.scheme === 'dark';
  if (useRouteCompanySuspended()) return null;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        padding: 8,
        paddingEnd: 12,
        borderRadius: theme.radius.lg,
        backgroundColor: dark ? theme.color.surface : '#FFF3E1',
      }}
    >
      <Image
        source={TEAM}
        accessibilityIgnoresInvertColors
        fadeDuration={0}
        style={{ width: 92, height: 57, borderRadius: 10 }}
      />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="body" style={{ fontWeight: '700', fontSize: 14 }}>
          {title}
        </Text>
        <Text variant="caption" tone="muted" style={SMALL}>
          {body}
        </Text>
      </View>
      <Ionicons
        name={directionalIcon('chevron-forward')}
        size={iconSize.md}
        color={theme.color.textMuted}
      />
    </Pressable>
  );
}

/** A card with an icon, a title and "View all" on top, then its rows. */
export function SectionCard({
  icon,
  title,
  onViewAll,
  children,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  onViewAll?: () => void;
  children: ReactNode;
}) {
  const { t } = useStrings();
  const theme = useTheme();
  return (
    <StandardCard style={{ paddingHorizontal: 14, paddingVertical: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        {icon ? <Ionicons name={icon} size={iconSize.lg} color={theme.color.text} /> : null}
        <Text variant="title" style={{ flex: 1, fontSize: 16 }}>
          {title}
        </Text>
        {onViewAll ? (
          <Pressable accessibilityRole="button" onPress={onViewAll} hitSlop={8}>
            <Text variant="caption" style={{ color: theme.color.brand, fontWeight: '600' }}>
              {t.company.viewAll}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {children}
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

/** One compact person row: avatar, name (+ accessory), a muted line, then a right-hand slot and chevron. */
export function PersonLine({
  avatar,
  title,
  accessory,
  subtitle,
  right,
  rightColor,
  count,
  onPress,
  divider,
}: {
  avatar: ReactNode;
  title: string;
  accessory?: ReactNode;
  subtitle: string;
  right?: string;
  rightColor?: string;
  /** A grey count pill, as on the hierarchy rows. */
  count?: string;
  onPress: () => void;
  divider?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingVertical: 9,
        borderBottomWidth: divider ? 1 : 0,
        borderBottomColor: theme.color.border,
      }}
    >
      {avatar}
      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text
            variant="body"
            numberOfLines={1}
            style={{ fontWeight: '700', fontSize: 14, flexShrink: 1 }}
          >
            {title}
          </Text>
          {accessory}
        </View>
        <Text variant="caption" tone="muted" numberOfLines={1} style={SMALL}>
          {subtitle}
        </Text>
      </View>
      {count !== undefined ? (
        <View
          style={{
            minWidth: 34,
            height: 24,
            borderRadius: 12,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.color.surfaceMuted,
          }}
        >
          <Text variant="caption" tone="muted" style={{ fontSize: 12 }}>
            {count}
          </Text>
        </View>
      ) : null}
      {right ? (
        <Text
          variant="body"
          numberOfLines={1}
          style={{ fontWeight: '800', fontSize: 14, color: rightColor, flexShrink: 0 }}
        >
          {right}
        </Text>
      ) : null}
      <Ionicons
        name={directionalIcon('chevron-forward')}
        size={iconSize.sm}
        color={theme.color.textMuted}
      />
    </Pressable>
  );
}

const GIVEN = new Set(['advance']);
const TINTS: readonly TintName[] = ['lilac', 'peach', 'sky', 'pink', 'mint', 'coral'];

/** Newest money events first: green when paid or reimbursed, red for an advance. */
export function RecentActivity({
  groupId,
  view,
  entries,
  limit,
  header,
  empty,
}: {
  groupId: string;
  view: CompanyView;
  entries: readonly CompanyEntry[];
  limit?: number;
  /** Wraps the rows in a titled card, as on the owner's overview. */
  header?: { title: string; onViewAll?: () => void; icon?: false };
  /** Shown in the titled card when there are no rows. */
  empty?: ReactNode;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const fmt = useMoney(view.currency);
  const tagLabel = useCompanyTags(groupId, view).label;
  const projects = useCompanyProjects(groupId);
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
  const none = (
    <Text variant="caption" tone="muted">
      {t.company.recentNone}
    </Text>
  );
  if (rows.length === 0 && !header) return none;
  const list = rows.map((e, index) => {
    const owner = view.members.find((m) => m.id === e.memberId);
    const paid = e.kind === 'wage_payment' || e.kind === 'wages' || e.kind === 'reimbursement';
    const label =
      e.kind === 'wage_payment' || e.kind === 'wages'
        ? t.company.salaryPayment
        : kindLabel(t, e, tagLabel);
    return (
      <PersonLine
        key={e.id}
        avatar={
          owner ? (
            <PersonAvatar
              member={owner}
              name={displayName(owner)}
              size={36}
              tint={TINTS[index % TINTS.length]}
            />
          ) : (
            <View style={{ width: 36 }} />
          )
        }
        title={
          e.paidByCompany
            ? t.company.companyPayer
            : owner
              ? displayName(owner, null, null, t.misc.someone)
              : t.misc.someone
        }
        subtitle={[
          e.paidByCompany ? null : owner?.employee_id,
          label,
          projects.find((p) => p.id === e.projectId)?.name,
          showDate(e.occurredOn, locale),
        ]
          .filter(Boolean)
          .join(' · ')}
        right={fmt(e.amount)}
        rightColor={GIVEN.has(e.kind) ? theme.color.negative : paid ? GREEN : theme.color.text}
        onPress={() => router.push(`/group/${groupId}/company-entry-view?entry=${e.id}`)}
        divider={index < rows.length - 1}
      />
    );
  });
  return header ? (
    <SectionCard
      icon={header.icon === false ? undefined : 'document-text-outline'}
      title={header.title}
      onViewAll={header.onViewAll}
    >
      {rows.length === 0 ? (empty ?? none) : list}
    </SectionCard>
  ) : (
    <StandardCard style={{ paddingHorizontal: 14, paddingVertical: 4 }}>{list}</StandardCard>
  );
}

/** A tinted tile with an icon, a title, a line of help and a small chevron (the mockup's two-up actions). */
export function ActionTile({
  icon,
  title,
  body,
  tone,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  tone: 'violet' | 'blue';
  onPress: () => void;
}) {
  const theme = useTheme();
  const dark = theme.scheme === 'dark';
  const color = tone === 'blue' ? BLUE : theme.color.brand;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${body}`}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        gap: 4,
        padding: 12,
        borderRadius: theme.radius.lg,
        backgroundColor: tone === 'blue' && !dark ? BLUE_SOFT : theme.color.brandSoft,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Ionicons name={icon} size={iconSize.lg} color={color} />
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: 11,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.color.surface,
          }}
        >
          <Ionicons name={directionalIcon('chevron-forward')} size={12} color={color} />
        </View>
      </View>
      <Text variant="body" style={{ fontWeight: '700', fontSize: 14 }}>
        {title}
      </Text>
      <Text variant="caption" tone="muted" style={SMALL}>
        {body}
      </Text>
    </Pressable>
  );
}

export function useCompanyCounts() {
  const { t, locale } = useStrings();
  return (members: readonly MemberRow[]) => {
    const live = members.filter((m) => !m.left_at);
    return [
      plural(locale, live.filter((m) => m.role === 'member').length, t.company.employeeCount),
      plural(locale, live.filter((m) => m.role === 'manager').length, t.company.managerCount),
      plural(locale, live.filter((m) => m.role === 'admin').length, t.company.ownerCount),
    ].join(' · ');
  };
}

function CompanySwitchRow({
  group,
  current,
  onPress,
}: {
  group: GroupRow;
  current: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const { members } = useGroup(group.id);
  const counts = useCompanyCounts();
  const logo = useGroupPhotoUrl(group.photo_path);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: current }}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        padding: 12,
        borderRadius: theme.radius.lg,
        borderWidth: 1,
        borderColor: current ? theme.color.brand : theme.color.border,
        backgroundColor: current ? theme.color.brandSoft : theme.color.surface,
      }}
    >
      <Image
        source={logo ? { uri: logo } : BUILDING_ART}
        style={{ width: 54, height: 54, borderRadius: 12 }}
      />
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={{ fontWeight: '700' }}>{group.name || t.extras.typeCompany}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Ionicons name="people-outline" size={14} color={theme.color.textMuted} />
          <Text variant="micro" tone="muted" style={{ flex: 1 }}>
            {counts(members.data ?? [])}
          </Text>
        </View>
      </View>
      {current ? <Ionicons name="checkmark-circle" size={24} color={theme.color.brand} /> : null}
      <Ionicons name={directionalIcon('chevron-forward')} size={20} color={theme.color.textMuted} />
    </Pressable>
  );
}
