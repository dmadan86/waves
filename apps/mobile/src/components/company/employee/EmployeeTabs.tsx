/** The employee screen's tab bodies: Overview (summary cards, calendar, expenses, dates) and Details (every field). */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View, useWindowDimensions } from 'react-native';

import { format, money, type CurrencyCode, type MirrorMemberDates } from '@waves/core';
import { directionalIcon, iconSize, Text, useTheme } from '@waves/ui';

import { AttendanceMonth } from '@/components/company/AttendanceMonth';
import { StandardCard } from '@/components/standard';
import { monthCounts } from '@/data/employeeDetail';
import { useAttendance } from '@/data/companyWorkday';
import { fill, plural, useStrings } from '@/i18n';

export type EmployeeTab = 'overview' | 'attendance' | 'expenses' | 'details';

type Icon = keyof typeof Ionicons.glyphMap;

/** Birthday shown as "12 Mar"; only when the person opted in (or it is their own). */
export function birthdayText(dates: MirrorMemberDates | undefined, locale: string, own: boolean) {
  if (!dates?.birthDay || !dates.birthMonth || !(dates.showBirthday || own)) return null;
  return new Date(Date.UTC(2000, dates.birthMonth - 1, dates.birthDay)).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

function IconDot({ icon, tint, color }: { icon: Icon; tint: string; color: string }) {
  return (
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
      <Ionicons name={icon} size={iconSize.base} color={color} />
    </View>
  );
}

function Chevron() {
  const theme = useTheme();
  return (
    <Ionicons
      name={directionalIcon('chevron-forward')}
      size={iconSize.sm}
      color={theme.color.textMuted}
    />
  );
}

/** One summary tile: icon, title, big value, caption. Text shrinks rather than truncating. */
function StatTile({
  icon,
  tint,
  color,
  title,
  value,
  caption,
  background,
  wide,
  onPress,
}: {
  icon: Icon;
  tint: string;
  color: string;
  title: string;
  value?: string;
  caption: string;
  background?: string;
  /** Full-width layout: icon left, text right. */
  wide?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[title, value, caption].filter(Boolean).join(', ')}
      onPress={onPress}
      style={{ flex: 1 }}
    >
      <StandardCard
        style={{
          flexDirection: wide ? 'row' : 'column',
          alignItems: wide ? 'center' : 'flex-start',
          gap: theme.spacing.sm,
          padding: theme.spacing.md,
          ...(background ? { backgroundColor: background } : null),
        }}
      >
        <IconDot icon={icon} tint={tint} color={color} />
        <View style={{ flex: wide ? 1 : undefined, alignSelf: 'stretch', gap: 1 }}>
          <Text
            variant="caption"
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
            style={{ fontWeight: '600' }}
          >
            {title}
          </Text>
          {value ? (
            <Text
              variant="heading"
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
              style={{ fontSize: 20, lineHeight: 26, fontWeight: '800' }}
            >
              {value}
            </Text>
          ) : null}
          <Text
            variant="micro"
            tone="muted"
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
            style={value ? undefined : { color: color, fontWeight: '600' }}
          >
            {caption}
          </Text>
        </View>
        {wide ? <Chevron /> : null}
      </StandardCard>
    </Pressable>
  );
}

/** A label, its value and (when it can be changed) a chevron. */
export function DetailRow({
  icon,
  label,
  value,
  onPress,
  divider = true,
}: {
  icon: Icon;
  label: string;
  value: string;
  onPress?: () => void;
  divider?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${label}, ${value}`}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        minHeight: 44,
        paddingVertical: theme.spacing.xs,
        borderBottomWidth: divider ? 1 : 0,
        borderBottomColor: theme.color.border,
      }}
    >
      <Ionicons name={icon} size={iconSize.md} color={theme.color.textMuted} />
      <Text variant="caption" tone="muted" style={{ flexBasis: 110, flexShrink: 1 }}>
        {label}
      </Text>
      <Text variant="body" style={{ flex: 1 }} numberOfLines={2}>
        {value}
      </Text>
      {onPress ? <Chevron /> : null}
    </Pressable>
  );
}

export function OverviewTab({
  groupId,
  memberId,
  currency,
  dueCount,
  dueTotal,
  month,
  onMonth,
  showAttendance,
  onTab,
  onAddExpense,
  datesSummary,
  onDates,
  typeText,
  departmentText,
  joinedText,
  onType,
  onDepartment,
}: {
  groupId: string;
  memberId: string;
  currency: string;
  dueCount: number;
  dueTotal: bigint;
  /** YYYY-MM shown in the cards and calendar. */
  month: string;
  onMonth: (month: string) => void;
  showAttendance: boolean;
  onTab: (tab: EmployeeTab) => void;
  /** Omitted when the viewer cannot add entries for this person. */
  onAddExpense?: () => void;
  /** null = nothing to show and nothing to edit: the card is hidden. */
  datesSummary: string | null;
  onDates?: () => void;
  typeText: string;
  departmentText: string;
  joinedText: string;
  onType?: () => void;
  onDepartment?: () => void;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const { width, fontScale } = useWindowDimensions();
  const marks = useAttendance(groupId);
  const counts = monthCounts(marks, memberId, month);
  const days = counts.present + counts.half / 2;
  const monthShort = new Date(`${month}-01T00:00:00Z`).toLocaleDateString(locale, {
    month: 'short',
    timeZone: 'UTC',
  });
  const amount = format(money(dueTotal, currency as CurrencyCode), { locale });
  const brand = theme.color.brand;
  const three = width >= 390 && fontScale <= 1.15;
  const dark = theme.scheme === 'dark';
  const attendanceTile = showAttendance ? (
    <StatTile
      icon="calendar"
      tint={theme.color.brandSoft}
      color={brand}
      title={fill(t.company.attendanceMonthTitle, { month: monthShort })}
      value={`${days} / ${counts.daysInMonth}`}
      caption={t.company.daysPresent}
      onPress={() => onTab('attendance')}
    />
  ) : null;
  const payTile = (
    <StatTile
      icon="wallet"
      tint={theme.color.negativeSoft}
      color={theme.color.negative}
      title={t.company.amountToPay}
      value={amount}
      caption={plural(locale, dueCount, t.company.expensesPending)}
      background={dark ? undefined : '#FFF1EF'}
      onPress={() => onTab('expenses')}
    />
  );
  const summaryTile = (wide: boolean) => (
    <StatTile
      icon="stats-chart"
      tint={theme.color.brandSoft}
      color={brand}
      title={t.company.tileSummary}
      caption={t.company.viewReport}
      wide={wide}
      onPress={() => onTab('expenses')}
    />
  );
  return (
    <>
      {three ? (
        <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
          {attendanceTile}
          {payTile}
          {summaryTile(false)}
        </View>
      ) : (
        <>
          <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
            {attendanceTile}
            {payTile}
          </View>
          {summaryTile(true)}
        </>
      )}
      {showAttendance ? (
        <AttendanceMonth
          groupId={groupId}
          memberId={memberId}
          month={month}
          onMonth={onMonth}
          onViewAll={() => onTab('attendance')}
        />
      ) : null}
      <StandardCard style={{ gap: theme.spacing.sm, padding: theme.spacing.md }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t.company.expenses}, ${amount}, ${plural(locale, dueCount, t.company.expensesPending)}`}
          onPress={() => onTab('expenses')}
          style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}
        >
          <IconDot icon="wallet" tint={theme.color.negativeSoft} color={theme.color.negative} />
          <Text variant="subheading" style={{ fontWeight: '700', flexShrink: 1 }} numberOfLines={1}>
            {t.company.expenses}
          </Text>
          <View style={{ flex: 1, alignItems: 'flex-end' }}>
            <Text
              variant="body"
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
              style={{ fontWeight: '800' }}
            >
              {amount}
            </Text>
            <Text variant="micro" tone="muted" numberOfLines={1}>
              {plural(locale, dueCount, t.company.expensesPending)}
            </Text>
          </View>
          <Chevron />
        </Pressable>
        <View style={{ flexDirection: 'row', gap: theme.spacing.xs }}>
          {onAddExpense ? (
            <ActionChip icon="add" title={t.company.addEntry} onPress={onAddExpense} />
          ) : null}
          <ActionChip
            icon="document-text-outline"
            title={t.company.tileHistory}
            onPress={() => onTab('expenses')}
          />
          <ActionChip
            icon="stats-chart"
            title={t.company.tileSummary}
            onPress={() => onTab('expenses')}
          />
        </View>
      </StandardCard>
      {datesSummary !== null ? (
        <StandardCard style={{ padding: theme.spacing.md }}>
          <Pressable
            disabled={!onDates}
            accessibilityRole={onDates ? 'button' : undefined}
            onPress={onDates}
            style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}
          >
            <IconDot icon="gift-outline" tint={theme.color.brandSoft} color={brand} />
            <View style={{ flex: 1 }}>
              <Text variant="body" style={{ fontWeight: '700' }} numberOfLines={1}>
                {t.company.birthdayJoining}
              </Text>
              <Text variant="caption" tone="muted" numberOfLines={2}>
                {datesSummary || t.company.addBirthdayJoining}
              </Text>
            </View>
            {onDates ? <Chevron /> : null}
          </Pressable>
        </StandardCard>
      ) : null}
      <StandardCard
        style={{ paddingVertical: theme.spacing.xs, paddingHorizontal: theme.spacing.md }}
      >
        <DetailRow
          icon="briefcase-outline"
          label={t.company.employmentType}
          value={typeText}
          onPress={onType}
        />
        <DetailRow
          icon="people-outline"
          label={t.company.department}
          value={departmentText}
          onPress={onDepartment}
        />
        <DetailRow
          icon="calendar-outline"
          label={t.company.joiningDate}
          value={joinedText}
          onPress={onDates}
          divider={false}
        />
      </StandardCard>
    </>
  );
}

function ActionChip({ icon, title, onPress }: { icon: Icon; title: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={{
        flex: 1,
        alignItems: 'center',
        gap: 4,
        paddingVertical: theme.spacing.sm,
        paddingHorizontal: 4,
        borderRadius: theme.radius.lg,
        backgroundColor: theme.color.surfaceMuted,
      }}
    >
      <Ionicons name={icon} size={iconSize.md} color={theme.color.brand} />
      <Text
        variant="micro"
        align="center"
        numberOfLines={2}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
        style={{ fontWeight: '600' }}
      >
        {title}
      </Text>
    </Pressable>
  );
}
