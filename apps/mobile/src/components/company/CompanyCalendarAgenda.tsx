import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { View } from 'react-native';
import { Button, Text, useTheme } from '@waves/ui';
import { format } from '@waves/core';
import { ListRow, SectionHeader, StandardCard } from '@/components/standard';
import { OverflowMenu, type OverflowMenuItem } from '@/components/OverflowMenu';
import {
  useCalendarAccess,
  useRemoveEvent,
  useRemoveHoliday,
  useRemoveLeave,
  type MirrorEvent,
  type MirrorHoliday,
  type MirrorLeave,
} from '@/data/companyCalendar';
import type { CalendarItem } from '@/data/companyCalendarItems';
import { useCompanyEntries } from '@/data/companyEntries';
import { displayName } from '@/data/types';
import { useStrings } from '@/i18n';
import { router } from '@/lib/navigation';

export function CompanyCalendarAgenda({
  groupId,
  items,
  selectedDay,
  onOpenLeave,
  onOpenEvent,
  onOpenHoliday,
}: {
  groupId: string;
  items: readonly CalendarItem[];
  selectedDay: string | null;
  onOpenLeave: (leave: MirrorLeave) => void;
  onOpenEvent: (event: MirrorEvent) => void;
  onOpenHoliday: (holiday: MirrorHoliday) => void;
}) {
  const { t, locale } = useStrings();
  const theme = useTheme();
  const access = useCalendarAccess(groupId);
  const company = useCompanyEntries(groupId);
  const removeLeave = useRemoveLeave(groupId);
  const removeEvent = useRemoveEvent(groupId);
  const removeHoliday = useRemoveHoliday(groupId);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [menuItems, setMenuItems] = useState<OverflowMenuItem[]>([]);
  const visible = items.filter((item) =>
    selectedDay ? item.day === selectedDay : item.day >= new Date().toISOString().slice(0, 10),
  );
  const title = selectedDay
    ? t.calendar.agendaFor.replace(
        '{date}',
        new Date(`${selectedDay}T00:00:00Z`).toLocaleDateString(locale, {
          month: 'short',
          day: 'numeric',
          timeZone: 'UTC',
        }),
      )
    : t.calendar.upcoming;
  const icons: Record<CalendarItem['subKind'], keyof typeof Ionicons.glyphMap> = {
    holiday: 'sunny-outline',
    leave: 'airplane-outline',
    wage: 'cash-outline',
    vendor_bill: 'receipt-outline',
    customer_bill: 'document-text-outline',
    advance: 'wallet-outline',
    recurring: 'repeat-outline',
    task: 'briefcase-outline',
    event: 'calendar-outline',
    birthday: 'gift-outline',
    anniversary: 'ribbon-outline',
  };
  const icon = (kind: CalendarItem['subKind']): keyof typeof Ionicons.glyphMap => icons[kind];
  const open = (item: CalendarItem) => {
    if (item.route) router.push(`/group/${groupId}/${item.route}` as never);
    else if (item.subKind === 'leave' && item.ref && 'startDay' in item.ref)
      onOpenLeave(item.ref as MirrorLeave);
    else if (item.subKind === 'holiday' && item.ref && 'startDay' in item.ref)
      onOpenHoliday(item.ref as MirrorHoliday);
    else if (item.subKind === 'event' && item.ref && 'day' in item.ref && 'people' in item.ref)
      onOpenEvent(item.ref);
  };
  const more = (item: CalendarItem) => {
    const options: OverflowMenuItem[] = [];
    if (item.subKind === 'leave' && item.ref && 'status' in item.ref) {
      const leave = item.ref;
      if (leave.status === 'pending' && leave.memberId === access.meId)
        options.push({
          icon: 'close-circle-outline',
          label: t.calendar.withdraw,
          tone: 'danger',
          onPress: () => removeLeave.mutate({ id: leave.id }),
        });
      else if (access.canDecide(leave))
        options.push({
          icon: 'trash-outline',
          label: t.calendar.remove,
          tone: 'danger',
          onPress: () => removeLeave.mutate({ id: leave.id }),
        });
    }
    if (item.subKind === 'holiday' && access.isOwner && item.ref && 'startDay' in item.ref)
      options.push({
        icon: 'trash-outline',
        label: t.calendar.remove,
        tone: 'danger',
        onPress: () => removeHoliday.mutate({ id: item.ref!.id }),
      });
    if (item.subKind === 'event' && access.isOwner && item.ref && 'people' in item.ref)
      options.push({
        icon: 'trash-outline',
        label: t.calendar.remove,
        tone: 'danger',
        onPress: () => removeEvent.mutate({ id: item.ref!.id }),
      });
    setMenuItems(options);
    setMenuId(options.length ? item.id : null);
  };
  const labels: Record<string, string> = {
    holiday: t.calendar.kindHoliday,
    leave: t.calendar.kindLeave,
    wage: t.calendar.kindWage,
    vendor_bill: t.calendar.kindVendorBill,
    customer_bill: t.calendar.kindCustomerBill,
    advance: t.calendar.kindAdvance,
    recurring: t.calendar.kindWage,
    task: t.calendar.kindTask,
    event: t.calendar.kindEvent,
    birthday: t.calendar.kindBirthday,
    anniversary: t.calendar.kindAnniversary,
  };
  return (
    <StandardCard style={{ gap: theme.spacing.sm }}>
      <SectionHeader title={title} />
      {visible.length === 0 ? (
        <Text tone="muted">
          {selectedDay ? t.calendar.nothingPlanned : t.calendar.nothingPlanned}
        </Text>
      ) : (
        visible.map((item, index) => {
          const person = item.memberId
            ? company.members.find((member) => member.id === item.memberId)
            : undefined;
          const subtitle = [
            labels[item.subKind],
            item.time,
            person ? displayName(person) : null,
            item.status === 'pending'
              ? t.calendar.statusPending
              : item.status === 'approved'
                ? t.calendar.statusApproved
                : null,
          ]
            .filter(Boolean)
            .join(' · ');
          const amount =
            item.amountMinor != null && item.currency
              ? format({ minor: item.amountMinor, currency: item.currency }, { locale })
              : undefined;
          return (
            <View key={item.id}>
              <ListRow
                title={item.title}
                subtitle={subtitle}
                leading={
                  <View
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 18,
                      backgroundColor: theme.color.brandSoft,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Ionicons name={icon(item.subKind)} size={18} color={theme.color.brand} />
                  </View>
                }
                amount={amount}
                onPress={() => open(item)}
                divider={index < visible.length - 1}
                trailing={
                  item.overdue ? (
                    <Text variant="micro" tone="negative">
                      {t.calendar.overdue}
                    </Text>
                  ) : undefined
                }
              />
              <Button size="sm" variant="ghost" label={t.calendar.add} onPress={() => more(item)} />
            </View>
          );
        })
      )}
      <OverflowMenu visible={menuId !== null} onClose={() => setMenuId(null)} items={menuItems} />
    </StandardCard>
  );
}
