/**
 * The top of the company Overview, as drawn in the owner's mockup: the Today card (day picker +
 * Mark attendance), four headcount tiles, today's tasks beside the Urgent card, and the attendance
 * summary bar. Owners see everyone, a manager only their team. Waves records; it never moves money.
 */

import { useState, type ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Platform, Pressable, useWindowDimensions, View } from 'react-native';

import { directionalIcon, iconSize, Sheet, Text, useTheme } from '@waves/ui';

import {
  AMBER,
  IconDisc,
  RED,
  Skeleton,
  TintCard,
  withAlpha,
} from '@/components/company/dashboard/overviewKit';
import { GREEN, BLUE } from '@/components/company/dashboard/parts';
import { StandardCard } from '@/components/standard';
import { useOverview } from '@/data/companyOverview';
import { todayIso } from '@/data/personal';
import { fill, plural, useStrings } from '@/i18n';
import { dateFrom, isoDate } from '@/lib/expenseDay';
import { router } from '@/lib/navigation';
import {
  attendanceSegments,
  dayKind,
  pct,
  urgentItems,
  urgentRoute,
  type UrgentKey,
} from '@/lib/overviewMath';

export function OverviewTop({
  groupId,
  afterTiles,
  afterAttendance,
}: {
  groupId: string;
  /** Owner's money cards: they sit right under the headcount tiles. */
  afterTiles?: ReactNode;
  /** Owner's upcoming payments: they follow the attendance strip. */
  afterAttendance?: ReactNode;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const { width } = useWindowDimensions();
  const narrow = width < 380;
  const today = todayIso();
  const [picked, setPicked] = useState(today);
  const [picking, setPicking] = useState(false);
  // A day can never be after today (the clock may have crossed midnight since it was picked).
  const day = picked > today ? today : picked;
  const o = useOverview(groupId, day);
  const kind = dayKind(day, today);
  const isToday = kind === 'today';
  const title =
    kind === 'today'
      ? t.company.overviewToday
      : kind === 'yesterday'
        ? t.company.ovYesterday
        : dateFrom(day).toLocaleDateString(locale, { weekday: 'long' });
  const dateText = dateFrom(day).toLocaleDateString(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const attColor = { present: GREEN, unmarked: theme.color.textMuted, absent: RED };
  const attLabel = {
    present: t.company.overviewPresent,
    unmarked: t.company.overviewUnmarked,
    absent: t.company.overviewAbsent,
  };
  // Present always shows; the other two only when someone is in them.
  const segments = attendanceSegments(o.counts);
  const legend = (['present', 'unmarked', 'absent'] as const)
    .filter((k) => k === 'present' || o.counts[k] > 0)
    .map((k) => ({ key: k, label: attLabel[k], color: attColor[k], n: o.counts[k] }));
  const attTitle = isToday
    ? t.company.ovAttendanceToday
    : fill(t.company.ovAttendanceDay, {
        date: dateFrom(day).toLocaleDateString(locale, { day: 'numeric', month: 'short' }),
      });
  const attendanceRoute = `/group/${groupId}/company-attendance?date=${day}`;

  if (!o.ready)
    return (
      <View style={{ gap: theme.spacing.md }} accessibilityLabel={t.common.loading}>
        <Skeleton height={72} style={{ marginTop: -28 }} />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={104} flex={1} />
          ))}
        </View>
      </View>
    );

  const employees = o.people.length;
  const empty = employees === 0;

  const todayCard = (
    <StandardCard
      style={{
        marginTop: -28,
        paddingVertical: 12,
        paddingHorizontal: 12,
        borderRadius: 22,
        gap: 10,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View
          style={{
            width: 46,
            height: 46,
            borderRadius: 15,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.color.brandSoft,
          }}
        >
          <Ionicons name="calendar-outline" size={iconSize.lg} color={theme.color.brand} />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${title}, ${dateText}, ${t.company.ovPickDate}`}
          onPress={() => setPicking(true)}
          style={{ flex: 1, minWidth: 0 }}
        >
          <Text variant="title" numberOfLines={1} style={{ fontSize: 18, fontWeight: '700' }}>
            {title}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text variant="caption" numberOfLines={1} style={{ fontSize: 14, flexShrink: 1 }}>
              {dateText}
            </Text>
            <Ionicons name="chevron-down" size={iconSize.sm} color={theme.color.text} />
          </View>
        </Pressable>
        {!narrow && !empty && !o.suspended ? (
          <MarkButton
            label={t.company.ovMarkAttendance}
            onPress={() => router.push(attendanceRoute)}
          />
        ) : null}
      </View>
      {narrow && !empty && !o.suspended ? (
        <MarkButton
          label={t.company.ovMarkAttendance}
          onPress={() => router.push(attendanceRoute)}
          full
        />
      ) : null}
    </StandardCard>
  );

  const picker = (
    <Sheet
      visible={picking}
      onClose={() => setPicking(false)}
      closeLabel={t.common.close}
      title={t.company.ovPickDate}
    >
      <DateTimePicker
        value={dateFrom(day)}
        maximumDate={dateFrom(today)}
        mode="date"
        display={Platform.OS === 'ios' ? 'inline' : 'default'}
        onChange={(_, d) => {
          setPicking(false);
          if (d) setPicked(isoDate(d) > today ? today : isoDate(d));
        }}
      />
    </Sheet>
  );

  if (empty)
    return (
      <>
        {todayCard}
        <TintCard ink={theme.color.brand} style={{ alignItems: 'center', gap: 8, padding: 20 }}>
          <IconDisc ink={theme.color.brand} size={48}>
            <Ionicons name="person-add-outline" size={iconSize.lg} color={theme.color.brand} />
          </IconDisc>
          <Text variant="title" align="center">
            {t.company.ovEmptyTitle}
          </Text>
          <Text variant="caption" tone="muted" align="center">
            {t.company.ovEmptyBody}
          </Text>
          {o.isOwner && !o.suspended ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push(`/group/${groupId}/invite`)}
              style={{
                marginTop: 4,
                paddingHorizontal: 18,
                height: 42,
                borderRadius: 14,
                justifyContent: 'center',
                backgroundColor: theme.color.brand,
              }}
            >
              <Text style={{ color: theme.color.onBrand, fontWeight: '700' }}>
                {t.company.qaInvite}
              </Text>
            </Pressable>
          ) : null}
        </TintCard>
        {picker}
      </>
    );

  const c = o.counts;
  const pctText = (n: number): string => {
    const p = pct(n, employees);
    return p === null ? '—' : `${p}%`;
  };
  const urgent = urgentItems(o.urgent);
  const urgentTotal = urgent.reduce((sum, u) => sum + u.n, 0);
  const urgentLine = (key: UrgentKey, n: number): string =>
    plural(
      locale,
      n,
      key === 'absent'
        ? t.company.ovAbsentN
        : key === 'paymentsPending'
          ? t.company.ovPaymentsPendingN
          : key === 'blockedTasks'
            ? t.company.ovTasksBlockedN
            : key === 'approvals'
              ? t.company.ovApprovalsN
              : t.company.ovBillsN,
    );
  const tasks = o.tasks;
  const progress = tasks.total > 0 ? tasks.done / tasks.total : 0;

  return (
    <>
      {todayCard}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Tile
          icon="people-outline"
          ink={GREEN}
          value={String(employees)}
          label={t.company.ovEmployees}
          chevron={!narrow}
          onPress={() => router.push(`/group/${groupId}/company-people`)}
        />
        <Tile
          icon="checkmark-circle"
          ink={BLUE}
          value={String(c.present)}
          label={t.company.overviewPresent}
          sub={pctText(c.present)}
          chevron={!narrow}
          onPress={() => router.push(attendanceRoute)}
        />
        {/* Leave is not tracked on this base yet, so this tile says who is not marked instead. */}
        <Tile
          icon="help-circle"
          ink={AMBER}
          value={String(c.unmarked)}
          label={t.company.overviewUnmarked}
          sub={pctText(c.unmarked)}
          chevron={!narrow}
          onPress={() => router.push(attendanceRoute)}
        />
        <Tile
          icon="person-remove"
          ink={RED}
          value={String(c.absent)}
          label={t.company.overviewAbsent}
          sub={pctText(c.absent)}
          chevron={!narrow}
          onPress={() => router.push(attendanceRoute)}
        />
      </View>

      {afterTiles}

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push(`/group/${groupId}/company-work`)}
          style={{ flex: 1 }}
        >
          <TintCard ink={BLUE} style={{ flex: 1, minHeight: 138, gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <IconDisc ink={BLUE}>
                <Ionicons name="clipboard-outline" size={iconSize.base} color={BLUE} />
              </IconDisc>
              <Text
                variant="caption"
                numberOfLines={2}
                style={{ flex: 1, fontSize: 14, color: theme.color.text }}
              >
                {isToday ? t.company.ovTasksTitle : t.company.ovTasksDay}
              </Text>
              <Chevron />
            </View>
            <Text
              variant="title"
              numberOfLines={1}
              adjustsFontSizeToFit
              style={{ fontSize: 20, fontWeight: '800' }}
            >
              {tasks.total === 0
                ? t.company.ovTasksNone
                : fill(t.company.ovTasksPending, { n: tasks.pending })}
            </Text>
            {tasks.total > 0 ? (
              <>
                <View
                  style={{
                    height: 7,
                    borderRadius: 4,
                    overflow: 'hidden',
                    backgroundColor: withAlpha(theme.color.brand, 0.16),
                  }}
                >
                  <View
                    style={{
                      height: 7,
                      width: `${Math.round(progress * 100)}%`,
                      backgroundColor: theme.color.brand,
                    }}
                  />
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 6 }}>
                  <Text variant="micro" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
                    {fill(t.company.ovTasksDone, { n: tasks.done })}
                  </Text>
                  <Text variant="micro" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
                    {fill(t.company.ovTasksTotal, { n: tasks.total })}
                  </Text>
                </View>
              </>
            ) : null}
          </TintCard>
        </Pressable>

        {urgent.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              router.push(
                `/group/${groupId}/${urgentRoute(urgent)}${urgent[0]?.key === 'absent' ? `?date=${day}` : ''}`,
              )
            }
            style={{ flex: 1 }}
          >
            <TintCard ink={RED} style={{ flex: 1, minHeight: 138, gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <IconDisc ink={RED}>
                  <Ionicons name="warning-outline" size={iconSize.base} color={RED} />
                </IconDisc>
                <Text
                  variant="caption"
                  numberOfLines={1}
                  style={{ fontSize: 14, color: theme.color.text, flexShrink: 1 }}
                >
                  {t.company.ovUrgent}
                </Text>
                <View
                  style={{
                    minWidth: 20,
                    height: 20,
                    borderRadius: 10,
                    paddingHorizontal: 5,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: RED,
                  }}
                >
                  <Text variant="micro" style={{ color: '#FFFFFF', fontWeight: '700' }}>
                    {urgentTotal > 99 ? '99+' : urgentTotal}
                  </Text>
                </View>
                <View style={{ flex: 1 }} />
                <Chevron />
              </View>
              {urgent.slice(0, 3).map((u) => (
                <View key={u.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: RED }} />
                  <Text
                    variant="caption"
                    numberOfLines={2}
                    style={{ flex: 1, fontSize: 13, color: theme.color.text }}
                  >
                    {urgentLine(u.key, u.n)}
                  </Text>
                </View>
              ))}
            </TintCard>
          </Pressable>
        ) : (
          <TintCard
            ink={GREEN}
            style={{
              flex: 1,
              minHeight: 138,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            <IconDisc ink={GREEN} size={40}>
              <Ionicons name="checkmark-circle-outline" size={iconSize.lg} color={GREEN} />
            </IconDisc>
            <Text
              variant="caption"
              align="center"
              style={{ fontSize: 14, fontWeight: '700', color: theme.color.text }}
            >
              {t.company.ovAllClear}
            </Text>
          </TintCard>
        )}
      </View>

      {o.people.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${attTitle}: ${legend.map((l) => `${l.label} ${l.n}`).join(', ')}`}
          onPress={() => router.push(attendanceRoute)}
        >
          <StandardCard
            style={{ paddingHorizontal: 12, paddingVertical: 12, borderRadius: 22, gap: 10 }}
          >
            <Text variant="title" numberOfLines={1} style={{ fontSize: 17, fontWeight: '700' }}>
              {attTitle}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 4 }}>
              {legend.map((l) => (
                <View key={l.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View
                    style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: l.color }}
                  />
                  <Text variant="caption" style={{ color: theme.color.text }}>
                    {l.label}
                  </Text>
                  <Text variant="caption" style={{ fontWeight: '700', color: theme.color.text }}>
                    {l.n}
                  </Text>
                </View>
              ))}
            </View>
            <View style={{ flexDirection: 'row', height: 14, borderRadius: 7, overflow: 'hidden' }}>
              {segments.map((s, i) => (
                <View
                  key={s.key}
                  style={{
                    flex: s.n,
                    backgroundColor: attColor[s.key],
                    marginStart: i > 0 ? 2 : 0,
                  }}
                />
              ))}
            </View>
          </StandardCard>
        </Pressable>
      ) : null}
      {afterAttendance}
      {picker}
    </>
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

function MarkButton({
  label,
  onPress,
  full,
}: {
  label: string;
  onPress: () => void;
  full?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={{
        height: 46,
        borderRadius: 16,
        paddingHorizontal: 14,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: theme.color.brand,
        flexShrink: 0,
        alignSelf: full ? 'stretch' : undefined,
      }}
    >
      <Ionicons name="people-outline" size={iconSize.base} color={theme.color.onBrand} />
      <Text
        numberOfLines={1}
        style={{ color: theme.color.onBrand, fontWeight: '600', fontSize: 15 }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function Tile({
  icon,
  ink,
  value,
  label,
  sub,
  chevron,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  ink: string;
  value: string;
  label: string;
  sub?: string;
  chevron: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}${sub ? `, ${sub}` : ''}`}
      onPress={onPress}
      style={{ flex: 1, minWidth: 0 }}
    >
      <StandardCard style={{ padding: 10, gap: 3, minHeight: 108, borderRadius: 18 }}>
        <IconDisc ink={ink}>
          <Ionicons name={icon} size={iconSize.base} color={ink} />
        </IconDisc>
        <Text
          variant="title"
          numberOfLines={1}
          adjustsFontSizeToFit
          style={{ fontSize: 22, fontWeight: '800' }}
        >
          {value}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
          <Text
            variant="caption"
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.75}
            style={{ fontSize: 13, flexShrink: 1, color: theme.color.text }}
          >
            {label}
          </Text>
          {chevron ? <Chevron /> : null}
        </View>
        {sub ? (
          <Text variant="micro" tone="muted" numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </StandardCard>
    </Pressable>
  );
}
