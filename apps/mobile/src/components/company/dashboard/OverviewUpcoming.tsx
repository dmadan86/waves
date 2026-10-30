/**
 * "Upcoming" on the Overview: one tinted card per meeting, payroll day, holiday or birthday, with who
 * is in it. Read from the company calendar; nothing to show (or no calendar) hides the whole row.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, useWindowDimensions, View } from 'react-native';

import type { MirrorEvent, MirrorHoliday } from '@waves/core';
import { directionalIcon, iconSize, Text, useTheme } from '@waves/ui';

import { TintCard, withAlpha } from '@/components/company/dashboard/overviewKit';
import { GREEN } from '@/components/company/dashboard/parts';
import { PersonAvatar } from '@/components/PersonAvatar';
import { useUpcomingItems } from '@/data/companyCalendarItems';
import { useCompanyEntries } from '@/data/companyEntries';
import { todayIso } from '@/data/personal';
import { displayName, isGhost } from '@/data/types';
import { useStrings } from '@/i18n';
import { router } from '@/lib/navigation';
import { buildUpcomingCards, clockText, type UpcomingKind } from '@/lib/overviewMath';

const KIND: Record<UpcomingKind, { icon: keyof typeof Ionicons.glyphMap; ink: string }> = {
  event: { icon: 'calendar-outline', ink: '#6C4FD8' },
  payroll: { icon: 'cash-outline', ink: GREEN },
  holiday: { icon: 'airplane-outline', ink: '#D97706' },
  birthday: { icon: 'gift-outline', ink: '#DB2777' },
};
const TINTS = ['lilac', 'peach', 'sky', 'pink', 'mint', 'coral'] as const;

export function OverviewUpcoming({ groupId }: { groupId: string }) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const { width } = useWindowDimensions();
  const view = useCompanyEntries(groupId);
  const today = todayIso();
  // A holiday or offsite is for the whole company.
  const everyone = view.members.filter((m) => !m.left_at && m.role === 'member').map((m) => m.id);
  const items = useUpcomingItems(groupId, 400);
  const cards = buildUpcomingCards(
    items
      // Payroll is the owner's; a manager never sees what the company owes.
      .filter((it) => it.subKind !== 'wage' || view.isOwner)
      .map((it) => ({
        id: it.id,
        day: it.day,
        subKind: it.subKind,
        title: it.title,
        time: it.time,
        memberId: it.memberId,
        people:
          it.subKind === 'event'
            ? (it.ref as MirrorEvent).people
            : it.subKind === 'holiday'
              ? everyone
              : undefined,
        rangeStart: it.subKind === 'holiday' ? (it.ref as MirrorHoliday).startDay : undefined,
        rangeEnd: it.subKind === 'holiday' ? (it.ref as MirrorHoliday).endDay : undefined,
      })),
    today,
  );
  if (cards.length === 0) return null;
  const members = new Map(view.members.map((m) => [m.id, m]));
  // Four across on a phone like the mockup; more scroll sideways.
  const cardWidth = Math.max(96, (width - 32 - 24) / 4);
  const date = (iso: string, year: boolean) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale, {
      month: 'short',
      day: 'numeric',
      ...(year ? { year: 'numeric' } : {}),
      timeZone: 'UTC',
    });
  const open = () => router.push(`/group/${groupId}/company-calendar`);
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text
          variant="title"
          numberOfLines={1}
          style={{ flexShrink: 1, fontSize: 18, fontWeight: '700' }}
        >
          {t.calendar.upcoming}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={open}
          hitSlop={8}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}
        >
          <Text variant="caption" style={{ color: theme.color.brand, fontWeight: '600' }}>
            {t.calendar.seeAll}
          </Text>
          <Ionicons
            name={directionalIcon('chevron-forward')}
            size={iconSize.sm}
            color={theme.color.brand}
          />
        </Pressable>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        // Bleed to the screen edge so a scrolling row reads as scrolling.
        style={{ marginHorizontal: -theme.spacing.lg }}
        contentContainerStyle={{ paddingHorizontal: theme.spacing.lg, gap: 8 }}
      >
        {cards.map((c) => {
          const { icon, ink } = KIND[c.kind];
          const when =
            c.kind === 'holiday' && c.endDay !== c.day
              ? `${date(c.day, false)} – ${c.endDay.slice(0, 7) === c.day.slice(0, 7) ? new Date(`${c.endDay}T00:00:00Z`).getUTCDate() : date(c.endDay, false)}`
              : c.day === today
                ? [t.calendar.today, c.time ? clockText(c.time, locale) : null]
                    .filter(Boolean)
                    .join(', ')
                : c.time
                  ? `${date(c.day, false)}, ${clockText(c.time, locale)}`
                  : date(c.day, true);
          const title = c.kind === 'payroll' ? t.company.ovPayrollRun : c.title;
          const who = c.people.map((id) => members.get(id)).filter((m) => !!m);
          return (
            <Pressable
              key={c.key}
              accessibilityRole="button"
              accessibilityLabel={`${title}, ${when}`}
              onPress={open}
              style={{ width: cardWidth }}
            >
              <TintCard ink={ink} style={{ flex: 1, padding: 10, gap: 6 }}>
                <View
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 16,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: withAlpha(ink, 0.16),
                  }}
                >
                  <Ionicons name={icon} size={iconSize.base} color={ink} />
                </View>
                <Text
                  variant="caption"
                  numberOfLines={2}
                  style={{ fontWeight: '700', fontSize: 13 }}
                >
                  {title}
                </Text>
                <Text variant="micro" tone="muted" numberOfLines={2}>
                  {when}
                </Text>
                {who.length > 0 ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                    {who.slice(0, 3).map((m, i) => (
                      <View
                        key={m.id}
                        style={{
                          marginStart: i === 0 ? 0 : -8,
                          borderRadius: 12,
                          borderWidth: 1.5,
                          borderColor: theme.color.bg,
                        }}
                      >
                        <PersonAvatar
                          member={m}
                          name={displayName(m)}
                          ghost={isGhost(m)}
                          size={22}
                          tint={TINTS[i % TINTS.length]}
                        />
                      </View>
                    ))}
                    {who.length > 3 ? (
                      <Text variant="micro" tone="muted" style={{ marginStart: 4 }}>
                        {`+${who.length - 3}`}
                      </Text>
                    ) : null}
                  </View>
                ) : null}
              </TintCard>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
