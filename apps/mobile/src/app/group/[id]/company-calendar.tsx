import { useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Screen, Text, useTheme } from '@waves/ui';
import { ScenicBody, ScenicHeader, SegmentedPills } from '@/components/standard';
import { SuspendedBanner } from '@/components/company/SuspendedBanner';
import { CompanyCalendarGrid } from '@/components/company/CompanyCalendarGrid';
import { CompanyCalendarAgenda } from '@/components/company/CompanyCalendarAgenda';
import {
  CalendarChooserSheet,
  EventFormSheet,
  HolidayFormSheet,
  LeaveDecisionSheet,
  LeaveFormSheet,
  MyDatesSheet,
} from '@/components/company/CompanyCalendarSheets';
import {
  useCalendar,
  useCalendarAccess,
  type MirrorEvent,
  type MirrorHoliday,
  type MirrorLeave,
} from '@/data/companyCalendar';
import { filterItems, useCalendarItems, type CalendarKind } from '@/data/companyCalendarItems';
import { useCompanySuspended } from '@/data/companyEntries';
import { todayIso } from '@/data/personal';
import { useStrings } from '@/i18n';
import { router } from '@/lib/navigation';
import { useBottomClearance } from '@/lib/clearance';

type Filter = 'all' | CalendarKind;
export default function CompanyCalendarScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const today = todayIso();
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const [month, setMonth] = useState(Number(today.slice(5, 7)));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [chooser, setChooser] = useState(false);
  const [holiday, setHoliday] = useState<MirrorHoliday | null | undefined>(undefined);
  const [event, setEvent] = useState<MirrorEvent | null | undefined>(undefined);
  const [leave, setLeave] = useState<MirrorLeave | null>(null);
  const [leaveForm, setLeaveForm] = useState<'request' | 'record' | null>(null);
  const [dates, setDates] = useState(false);
  const { t } = useStrings();
  const theme = useTheme();
  const clearance = useBottomClearance();
  const suspended = useCompanySuspended(id);
  const access = useCalendarAccess(id);
  const cal = useCalendar(id);
  const allItems = useCalendarItems(id, year, month);
  const items = filterItems(allItems, filter);
  const selectedLeave = leave && cal.leave.some((item) => item.id === leave.id) ? leave : null;
  const pick = (kind: 'holiday' | 'event' | 'leave-request' | 'leave-record' | 'dates') => {
    setChooser(false);
    if (kind === 'holiday') setHoliday(null);
    else if (kind === 'event') setEvent(null);
    else if (kind === 'leave-request') setLeaveForm('request');
    else if (kind === 'leave-record') setLeaveForm('record');
    else setDates(true);
  };
  return (
    <Screen edges={[]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: clearance + 90 }}
        showsVerticalScrollIndicator={false}
      >
        <ScenicHeader title={t.calendar.title} onBack={() => router.back()} />
        <ScenicBody>
          {suspended ? <SuspendedBanner /> : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }}>
            <SegmentedPills
              options={[
                { value: 'all', label: t.calendar.filterAll },
                { value: 'leave', label: t.calendar.filterLeave },
                { value: 'money', label: t.calendar.filterMoney },
                { value: 'work', label: t.calendar.filterWork },
                { value: 'birthday', label: t.calendar.filterBirthdays },
              ]}
              value={filter}
              onChange={setFilter}
            />
          </View>
          <CompanyCalendarGrid
            year={year}
            month={month}
            items={items}
            selectedDay={selectedDay}
            onSelect={(day) => setSelectedDay(selectedDay === day ? null : day)}
            onMonthChange={(y, m) => {
              setYear(y);
              setMonth(m);
              setSelectedDay(null);
            }}
          />
          <CompanyCalendarAgenda
            groupId={id}
            items={items}
            selectedDay={selectedDay}
            onOpenLeave={(item) => {
              setLeave(item);
            }}
            onOpenEvent={(item) => {
              if (access.isOwner) setEvent(item);
            }}
            onOpenHoliday={(item) => {
              if (access.isOwner) setHoliday(item);
            }}
          />
        </ScenicBody>
      </ScrollView>
      {!suspended ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.calendar.add}
          onPress={() => setChooser(true)}
          style={{
            position: 'absolute',
            right: theme.spacing.lg,
            bottom: clearance + theme.spacing.lg,
            width: 56,
            height: 56,
            borderRadius: 28,
            backgroundColor: theme.color.brand,
            alignItems: 'center',
            justifyContent: 'center',
            elevation: 5,
          }}
        >
          <Ionicons name="add" size={28} color={theme.color.onBrand} />
          <Text style={{ display: 'none' }}>{t.calendar.add}</Text>
        </Pressable>
      ) : null}
      <CalendarChooserSheet
        groupId={id}
        visible={chooser}
        onClose={() => setChooser(false)}
        onPick={pick}
      />
      <HolidayFormSheet
        groupId={id}
        visible={holiday !== undefined}
        onClose={() => setHoliday(undefined)}
        day={selectedDay ?? undefined}
        holiday={holiday ?? undefined}
      />
      <EventFormSheet
        groupId={id}
        visible={event !== undefined}
        onClose={() => setEvent(undefined)}
        day={selectedDay ?? undefined}
        event={event ?? undefined}
      />
      <LeaveFormSheet
        groupId={id}
        visible={leaveForm !== null}
        onClose={() => setLeaveForm(null)}
        day={selectedDay ?? undefined}
        mode={leaveForm ?? 'request'}
      />
      <LeaveDecisionSheet
        groupId={id}
        visible={
          !!selectedLeave && selectedLeave.status === 'pending' && access.canDecide(selectedLeave)
        }
        onClose={() => setLeave(null)}
        leave={selectedLeave}
      />
      <MyDatesSheet
        groupId={id}
        visible={dates}
        onClose={() => setDates(false)}
        memberId={access.meId ?? undefined}
      />
    </Screen>
  );
}
