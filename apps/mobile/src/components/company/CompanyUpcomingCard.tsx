import Ionicons from '@expo/vector-icons/Ionicons';
import { View } from 'react-native';
import { iconSize, useTheme } from '@waves/ui';
import { ListRow, SectionHeader, StandardCard } from '@/components/standard';
import { useUpcomingItems, type CalendarItem } from '@/data/companyCalendarItems';
import { useCompanyEntries } from '@/data/companyEntries';
import { displayName } from '@/data/types';
import { useStrings } from '@/i18n';
import { router } from '@/lib/navigation';

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

export function CompanyUpcomingCard({ groupId }: { groupId: string }) {
  const { t, locale } = useStrings();
  const theme = useTheme();
  const items = useUpcomingItems(groupId, 5);
  const company = useCompanyEntries(groupId);
  if (!items.length) return null;
  return (
    <View>
      <SectionHeader
        title={t.calendar.comingUp}
        action={{
          label: t.calendar.seeAll,
          onPress: () => router.push(`/group/${groupId}/company-calendar`),
        }}
      />
      <StandardCard>
        {items.map((item, index) => {
          const person = item.memberId
            ? company.members.find((member) => member.id === item.memberId)
            : undefined;
          const date = new Date(`${item.day}T00:00:00Z`).toLocaleDateString(locale, {
            month: 'short',
            day: 'numeric',
            timeZone: 'UTC',
          });
          return (
            <ListRow
              key={item.id}
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
                  <Ionicons
                    name={icons[item.subKind]}
                    size={iconSize.md}
                    color={theme.color.brand}
                  />
                </View>
              }
              title={item.title}
              subtitle={[date, person ? displayName(person) : null].filter(Boolean).join(' · ')}
              onPress={() => router.push(`/group/${groupId}/company-calendar`)}
              divider={index < items.length - 1}
            />
          );
        })}
      </StandardCard>
    </View>
  );
}
