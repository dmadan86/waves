import { useMemo, useState } from 'react';
import { randomUUID } from 'expo-crypto';
import Ionicons from '@expo/vector-icons/Ionicons';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { leaveDays } from '@waves/core';
import { Button, Callout, Chip, iconSize, Row, Sheet, Text, Toggle, useTheme } from '@waves/ui';
import { FieldLabel, SelectField } from '@/components/company/EntryForm';
import { birthdayToDate, dateToBirthday, formatBirthday, type Birthday } from '@/lib/birthday';
import { dateFrom, isoDate, showDate } from '@/lib/expenseDay';
import { PersonAvatar } from '@/components/PersonAvatar';
import {
  useCalendar,
  useCalendarAccess,
  useDecideLeave,
  useRemoveEvent,
  useRemoveHoliday,
  useSetDates,
  useSetEvent,
  useSetHoliday,
  useSetLeave,
  type MirrorHoliday,
  type MirrorLeave,
} from '@/data/companyCalendar';
import { CompanyCalendarGrid } from '@/components/company/CompanyCalendarGrid';
import { isDayDisabled, markDays, pickDay, shiftDay, type Picking } from '@/lib/leaveRange';
import { daysText, useLeaveBalances, useLeaveCheck, useLeaveTypes } from '@/data/companyLeave';
import { useCompanyEntries, useCompanyProjects, useCompanySuspended } from '@/data/companyEntries';
import { todayIso } from '@/data/personal';
import { displayName, isGhost } from '@/data/types';
import { useStrings } from '@/i18n';

type Kind = 'holiday' | 'event' | 'leave-request' | 'leave-record' | 'dates';
type Props = { groupId: string; visible: boolean; onClose: () => void };
export type CalendarChooserSheetProps = Props & { onPick: (kind: Kind) => void };
const iso = (s: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const days = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000) + 1;
function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  placeholder?: string;
}) {
  const theme = useTheme();
  return (
    <View style={{ gap: 4 }}>
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.color.textFaint}
        style={{
          borderWidth: 1,
          borderColor: theme.color.border,
          borderRadius: theme.radius.lg,
          padding: theme.spacing.md,
          color: theme.color.text,
          backgroundColor: theme.color.surface,
        }}
      />
    </View>
  );
}
function Actions({
  onClose,
  onSave,
  disabled,
  remove,
  saveLabel,
}: {
  onClose: () => void;
  onSave: () => void;
  disabled: boolean;
  remove?: () => void;
  saveLabel: string;
}) {
  const { t } = useStrings();
  return (
    <Row style={{ gap: 8 }}>
      {remove ? (
        <View style={{ flex: 1 }}>
          <Button label={t.calendar.remove} variant="secondary" fullWidth onPress={remove} />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <Button label={t.calendar.cancel} variant="secondary" fullWidth onPress={onClose} />
      </View>
      <View style={{ flex: 1 }}>
        <Button label={saveLabel} fullWidth disabled={disabled} onPress={onSave} />
      </View>
    </Row>
  );
}
function FormSheet({
  visible,
  onClose,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const { t } = useStrings();
  const theme = useTheme();
  return (
    <Sheet visible={visible} onClose={onClose} closeLabel={t.common.close}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: theme.spacing.md }}
      >
        {children}
      </ScrollView>
    </Sheet>
  );
}

export function CalendarChooserSheet({
  groupId,
  visible,
  onClose,
  onPick,
}: CalendarChooserSheetProps) {
  const { t } = useStrings();
  const access = useCalendarAccess(groupId);
  const choices: [Kind, string][] = access.isOwner
    ? [
        ['holiday', t.calendar.addHoliday],
        ['event', t.calendar.addEvent],
        ['leave-record', t.calendar.recordLeave],
        ['dates', t.calendar.myDates],
      ]
    : access.canManage
      ? [
          ['event', t.calendar.addEvent],
          ['leave-record', t.calendar.recordLeave],
          ['dates', t.calendar.myDates],
        ]
      : [
          ['leave-request', t.calendar.requestLeave],
          ['dates', t.calendar.myDates],
        ];
  return (
    <FormSheet visible={visible} onClose={onClose}>
      {choices.map(([key, label]) => (
        <Pressable
          key={key}
          onPress={() => {
            onClose();
            onPick(key);
          }}
          style={{ padding: 14 }}
        >
          <Text>{label}</Text>
        </Pressable>
      ))}
    </FormSheet>
  );
}

function HolidayFormSheetInner({
  groupId,
  visible,
  onClose,
  day,
  holiday,
}: Props & { day?: string; holiday?: MirrorHoliday }) {
  const { t, locale } = useStrings();
  const theme = useTheme();
  const save = useSetHoliday(groupId);
  const remove = useRemoveHoliday(groupId);
  const suspended = useCompanySuspended(groupId);
  const today = todayIso();
  const [name, setName] = useState(holiday?.name ?? '');
  const [start, setStart] = useState(holiday?.startDay ?? day ?? today);
  const [end, setEnd] = useState(holiday?.endDay ?? day ?? today);
  const error = !name.trim()
    ? t.calendar.errName
    : !iso(start) || !iso(end) || end < start || days(start, end) > 31
      ? t.calendar.errRange
      : start < shift(today, -400) || end > shift(today, 730)
        ? t.calendar.errWindow
        : null;
  const submit = () =>
    save.mutate(
      { id: holiday?.id ?? randomUUID(), name: name.trim(), startDay: start, endDay: end },
      { onSuccess: onClose },
    );
  const [picking, setPicking] = useState<'start' | 'end' | null>(null);
  const bounds = {
    minimumDate: dateFrom(shift(today, -400)),
    maximumDate: dateFrom(shift(today, 730)),
  };
  const apply = (which: 'start' | 'end', d: Date) => {
    const v = isoDate(d);
    if (which === 'start') {
      setStart(v);
      if (end < v) setEnd(v);
    } else setEnd(v);
  };
  const open = (which: 'start' | 'end') => {
    const value = dateFrom(which === 'start' ? start : end);
    if (Platform.OS === 'android')
      DateTimePickerAndroid.open({
        value,
        mode: 'date',
        ...bounds,
        onChange: (e, d) => e.type === 'set' && d && apply(which, d),
      });
    else setPicking((p) => (p === which ? null : which));
  };
  const required = (label: string) => (
    <Text variant="caption" style={{ fontWeight: '600' }}>
      {label}
      <Text variant="caption" tone="negative">
        {' *'}
      </Text>
    </Text>
  );
  const dateField = (which: 'start' | 'end', label: string) => (
    <View style={{ flex: 1, gap: 4 }}>
      {required(label)}
      <SelectField
        icon="calendar-outline"
        label={label}
        text={showDate(which === 'start' ? start : end, locale)}
        chevron={false}
        onPress={() => open(which)}
      />
    </View>
  );
  return (
    <FormSheet visible={visible} onClose={onClose}>
      <Row style={{ gap: theme.spacing.md }}>
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: theme.radius.md,
            backgroundColor: theme.color.brandSoft,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="calendar-outline" size={iconSize.lg} color={theme.color.brand} />
        </View>
        <Text variant="title" style={{ flex: 1 }}>
          {holiday ? t.calendar.addHoliday : t.calendar.holidayTitle}
        </Text>
      </Row>
      <View style={{ gap: 4 }}>
        {required(t.calendar.holidayName)}
        <TextInput
          value={name}
          onChangeText={setName}
          accessibilityLabel={t.calendar.holidayName}
          placeholder={t.calendar.holidayPlaceholder}
          placeholderTextColor={theme.color.textFaint}
          style={{
            borderWidth: 1,
            borderColor: theme.color.border,
            borderRadius: theme.radius.lg,
            padding: theme.spacing.md,
            color: theme.color.text,
            backgroundColor: theme.color.surface,
          }}
        />
      </View>
      <Row style={{ gap: theme.spacing.md, alignItems: 'flex-start' }}>
        {dateField('start', t.calendar.startDate)}
        {dateField('end', t.calendar.endDate)}
      </Row>
      {Platform.OS === 'ios' && picking ? (
        <DateTimePicker
          value={dateFrom(picking === 'start' ? start : end)}
          mode="date"
          display="inline"
          {...bounds}
          onChange={(e, d) => {
            if (e.type !== 'dismissed' && d) apply(picking, d);
          }}
        />
      ) : null}
      {name.trim() && error ? <Callout tone="negative">{error}</Callout> : null}
      <Actions
        onClose={onClose}
        onSave={submit}
        disabled={!!error || suspended || save.isPending}
        saveLabel={t.calendar.save}
        remove={
          holiday ? () => remove.mutate({ id: holiday.id }, { onSuccess: onClose }) : undefined
        }
      />
    </FormSheet>
  );
}
function shift(day: string, n: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function EventFormSheetInner({
  groupId,
  visible,
  onClose,
  day,
  event,
}: Props & { day?: string; event?: import('@waves/core').MirrorEvent }) {
  const { t, locale } = useStrings();
  const theme = useTheme();
  const view = useCompanyEntries(groupId);
  const projects = useCompanyProjects(groupId);
  const save = useSetEvent(groupId);
  const remove = useRemoveEvent(groupId);
  const suspended = useCompanySuspended(groupId);
  const today = todayIso();
  const [title, setTitle] = useState(event?.title ?? '');
  const [date, setDate] = useState(event?.day ?? day ?? today);
  const [time, setTime] = useState(event?.time ?? '');
  const [site, setSite] = useState(event?.projectId ?? '');
  const [people, setPeople] = useState<string[]>(event?.people ? [...event.people] : []);
  const [query, setQuery] = useState('');
  const [picking, setPicking] = useState<'date' | 'time' | null>(null);
  const eligible = view.members.filter(
    (p) => !p.left_at && p.role !== 'vendor' && (view.isOwner || view.manageableIds.has(p.id)),
  );
  const shown = eligible.filter((p) =>
    displayName(p).toLowerCase().includes(query.trim().toLowerCase()),
  );
  const error = !title.trim()
    ? t.calendar.errTitle
    : !iso(date) || date < shift(today, -400) || date > shift(today, 730)
      ? t.calendar.errWindow
      : time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)
        ? t.calendar.errTime
        : !view.isOwner && people.length === 0
          ? t.calendar.errPeople
          : null;
  const toggle = (id: string) =>
    setPeople((x) => (x.includes(id) ? x.filter((v) => v !== id) : [...x, id]));
  const bounds = {
    minimumDate: dateFrom(shift(today, -400)),
    maximumDate: dateFrom(shift(today, 730)),
  };
  const timeValue = () => {
    const d = new Date();
    const [h, m] = (time || '09:00').split(':').map(Number);
    d.setHours(h ?? 9, m ?? 0, 0, 0);
    return d;
  };
  const pad = (n: number) => String(n).padStart(2, '0');
  const applyTime = (d: Date) => setTime(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
  const open = (which: 'date' | 'time') => {
    if (Platform.OS !== 'android') return setPicking((p) => (p === which ? null : which));
    if (which === 'date')
      DateTimePickerAndroid.open({
        value: dateFrom(date),
        mode: 'date',
        ...bounds,
        onChange: (e, d) => e.type === 'set' && d && setDate(isoDate(d)),
      });
    else
      DateTimePickerAndroid.open({
        value: timeValue(),
        mode: 'time',
        is24Hour: true,
        onChange: (e, d) => e.type === 'set' && d && applyTime(d),
      });
  };
  const label = (
    icon: React.ComponentProps<typeof Ionicons>['name'],
    text: string,
    mark?: 'required' | 'optional',
  ) => (
    <Row style={{ gap: theme.spacing.sm }}>
      <Ionicons name={icon} size={iconSize.base} color={theme.color.brand} />
      <Text variant="caption" style={{ fontWeight: '600' }}>
        {text}
        {mark === 'required' ? (
          <Text variant="caption" tone="negative">
            {' *'}
          </Text>
        ) : mark === 'optional' ? (
          <Text variant="caption" tone="muted">
            {` ${t.calendar.eventOptional}`}
          </Text>
        ) : null}
      </Text>
    </Row>
  );
  const input = {
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
    color: theme.color.text,
    backgroundColor: theme.color.surface,
  } as const;
  const card = {
    gap: theme.spacing.md,
    padding: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.lg,
  } as const;
  return (
    <FormSheet visible={visible} onClose={onClose}>
      <Text variant="title">{event ? t.calendar.eventTitle : t.calendar.eventCreate}</Text>
      <View style={card}>
        <View style={{ gap: 4 }}>
          {label('calendar-outline', t.calendar.eventTitle, 'required')}
          <TextInput
            value={title}
            onChangeText={setTitle}
            accessibilityLabel={t.calendar.eventTitle}
            placeholder={t.calendar.eventTitlePlaceholder}
            placeholderTextColor={theme.color.textFaint}
            style={input}
          />
        </View>
        <Row style={{ gap: theme.spacing.md, alignItems: 'flex-start' }}>
          <View style={{ flex: 1, gap: 4 }}>
            {label('calendar-outline', t.calendar.eventDate, 'required')}
            <SelectField
              icon="calendar-outline"
              label={t.calendar.eventDate}
              text={showDate(date, locale)}
              chevron={false}
              onPress={() => open('date')}
            />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            {label('time-outline', t.calendar.eventTimeLabel, 'optional')}
            <SelectField
              icon="time-outline"
              label={t.calendar.eventTimeLabel}
              text={time || 'HH:MM'}
              placeholder={!time}
              onPress={() => open('time')}
              trailing={
                time ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t.calendar.clear}
                    hitSlop={8}
                    onPress={() => setTime('')}
                  >
                    <Ionicons
                      name="close-circle"
                      size={iconSize.base}
                      color={theme.color.textMuted}
                    />
                  </Pressable>
                ) : undefined
              }
            />
          </View>
        </Row>
        {Platform.OS === 'ios' && picking ? (
          <DateTimePicker
            value={picking === 'date' ? dateFrom(date) : timeValue()}
            mode={picking}
            display={picking === 'date' ? 'inline' : 'spinner'}
            is24Hour
            {...(picking === 'date' ? bounds : {})}
            onChange={(e, d) => {
              if (e.type === 'dismissed' || !d) return;
              if (picking === 'date') setDate(isoDate(d));
              else applyTime(d);
            }}
          />
        ) : null}
        <View style={{ gap: 4 }}>
          {label('location-outline', t.calendar.eventSiteLabel, 'optional')}
          <TextInput
            value={site}
            onChangeText={setSite}
            accessibilityLabel={t.calendar.eventSite}
            placeholder={projects.map((p) => p.name).join(', ')}
            placeholderTextColor={theme.color.textFaint}
            style={input}
          />
        </View>
      </View>
      <View style={card}>
        <Row style={{ justifyContent: 'space-between' }}>
          {label('people-outline', t.calendar.eventPeople)}
          <Text variant="caption" tone="muted">
            {t.calendar.eventSelected.replace('{n}', String(people.length))}
          </Text>
        </Row>
        <TextInput
          value={query}
          onChangeText={setQuery}
          accessibilityLabel={t.calendar.eventSearch}
          placeholder={t.calendar.eventSearch}
          placeholderTextColor={theme.color.textFaint}
          style={input}
        />
        {view.isOwner ? (
          <Pressable onPress={() => setPeople([])}>
            <Chip label={t.calendar.eventEveryone} selected={people.length === 0} />
          </Pressable>
        ) : null}
        {shown.map((p, i) => (
          <Pressable
            key={p.id}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: people.includes(p.id) }}
            accessibilityLabel={displayName(p)}
            onPress={() => toggle(p.id)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing.md,
              paddingVertical: theme.spacing.sm,
              borderTopWidth: i ? 1 : 0,
              borderTopColor: theme.color.border,
            }}
          >
            <Ionicons
              name={people.includes(p.id) ? 'checkbox' : 'square-outline'}
              size={iconSize.lg}
              color={people.includes(p.id) ? theme.color.brand : theme.color.textMuted}
            />
            <PersonAvatar name={displayName(p)} size={36} member={p} ghost={isGhost(p)} />
            <Text style={{ flex: 1 }}>{displayName(p)}</Text>
          </Pressable>
        ))}
      </View>
      {title.trim() && error ? <Callout tone="negative">{error}</Callout> : null}
      <Actions
        onClose={onClose}
        onSave={() =>
          save.mutate(
            {
              id: event?.id ?? randomUUID(),
              title: title.trim(),
              day: date,
              time: time || null,
              projectId: site || null,
              people,
            },
            { onSuccess: onClose },
          )
        }
        disabled={!!error || suspended || save.isPending}
        saveLabel={t.calendar.eventSave}
        remove={event ? () => remove.mutate({ id: event.id }, { onSuccess: onClose }) : undefined}
      />
    </FormSheet>
  );
}

function LeaveFormSheetInner({
  groupId,
  visible,
  onClose,
  day,
  mode,
}: Props & { day?: string; mode: 'request' | 'record' }) {
  const { t } = useStrings();
  const access = useCalendarAccess(groupId);
  const view = useCompanyEntries(groupId);
  const cal = useCalendar(groupId);
  const save = useSetLeave(groupId);
  const suspended = useCompanySuspended(groupId);
  const today = todayIso();
  const [memberId, setMember] = useState(access.meId ?? '');
  const [start, setStart] = useState(day ?? today);
  const [end, setEnd] = useState(day ?? today);
  const [half, setHalf] = useState(false);
  const theme = useTheme();
  const [picking, setPicking] = useState<Picking>('start');
  const [shown, setShown] = useState(() => {
    const d = day ?? today;
    return { year: Number(d.slice(0, 4)), month: Number(d.slice(5, 7)) };
  });
  const types = useLeaveTypes(groupId, true);
  const [pickedType, setType] = useState<string | null | undefined>(undefined);
  // First type by default; null = "Unspecified" (counted nowhere), kept for leave that fits no policy.
  const typeId = pickedType === undefined ? (types[0]?.id ?? null) : pickedType;
  const balances = useLeaveBalances(groupId, memberId || null);
  const type = types.find((x) => x.id === typeId);
  const kind = type?.kind ?? 'other';
  const [reason, setReason] = useState('');
  const persons = view.members.filter(
    (p) =>
      !p.left_at &&
      p.role !== 'admin' &&
      (view.isOwner ? p.id !== access.meId : view.manageableIds.has(p.id)),
  );
  const overlap = cal.leave.some(
    (l) =>
      l.memberId === memberId && l.status !== 'rejected' && l.startDay <= end && l.endDay >= start,
  );
  // A dot on the member's own leave (amber) and on company holidays (brand), inside the allowed window.
  const dots = useMemo(
    () =>
      markDays(
        [
          ...cal.leave
            .filter((l) => l.memberId === memberId && l.status !== 'rejected')
            .map((l) => ({ ...l, value: theme.color.warning })),
          ...cal.holidays.map((h) => ({ ...h, value: theme.color.brand })),
        ],
        shiftDay(today, -60),
        shiftDay(today, 365),
      ),
    [cal.leave, cal.holidays, memberId, today, theme],
  );
  const chip = (which: Picking, label: string, value: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: picking === which }}
      onPress={() => setPicking(which)}
      style={{
        flex: 1,
        borderWidth: picking === which ? 2 : 1,
        borderColor: picking === which ? theme.color.brand : theme.color.border,
        borderRadius: theme.radius.lg,
        padding: theme.spacing.md,
        gap: 2,
      }}
    >
      <Text variant="micro" tone="muted">
        {label}
      </Text>
      <Text>{value}</Text>
    </Pressable>
  );
  const rangeOk = iso(start) && iso(end) && end >= start;
  const count = rangeOk ? leaveDays({ startDay: start, endDay: end, halfDay: half }) : 0;
  const check = useLeaveCheck(groupId, {
    memberId,
    typeId,
    startDay: start,
    endDay: end,
    halfDay: half && start === end,
  });
  const error =
    !iso(start) || !iso(end) || end < start || days(start, end) > 60
      ? t.calendar.errRange
      : half && start !== end
        ? t.calendar.errHalfDay
        : start < shift(today, -60) || end > shift(today, 365)
          ? t.calendar.errWindow
          : overlap
            ? t.calendar.errOverlap
            : check && !check.ok
              ? t.calendar.leaveOverBalance
                  .replace('{n}', daysText(Math.max(0, check.available)))
                  .replace('{type}', check.type.name)
              : null;
  return (
    <FormSheet visible={visible} onClose={onClose}>
      <Text variant="title">
        {mode === 'request' ? t.calendar.requestLeave : t.calendar.recordLeave}
      </Text>
      {mode === 'record' ? (
        <>
          <Text variant="caption" tone="muted">
            {t.calendar.person}
          </Text>
          {persons.map((p) => (
            <Pressable key={p.id} onPress={() => setMember(p.id)} style={{ padding: 8 }}>
              <Text>
                {displayName(p)}
                {memberId === p.id ? ' ✓' : ''}
              </Text>
            </Pressable>
          ))}
        </>
      ) : null}
      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
        {chip('start', t.calendar.startDate, start)}
        {chip('end', t.calendar.endDate, end)}
      </View>
      <CompanyCalendarGrid
        year={shown.year}
        month={shown.month}
        items={[]}
        selectedDay={null}
        range={{ start, end }}
        dots={dots}
        isDisabled={(d) => isDayDisabled(d, today)}
        onMonthChange={(year, month) => setShown({ year, month })}
        onSelect={(d) => {
          const next = pickDay({ start, end, picking }, d);
          setStart(next.start);
          setEnd(next.end);
          if (next.start !== next.end) setHalf(false); // half day only exists for a single day
          setPicking(next.picking);
        }}
      />
      {start === end ? (
        <Pressable onPress={() => setHalf(!half)}>
          <Text>
            {t.calendar.halfDay}
            {half ? ' ✓' : ''}
          </Text>
        </Pressable>
      ) : null}
      <Text variant="caption" tone="muted">
        {t.calendar.leaveType}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {types.map((x) => {
          const left = balances.find((b) => b.type.id === x.id)?.balance.balance;
          return (
            <Pressable key={x.id} onPress={() => setType(x.id)}>
              <Chip
                label={
                  left === undefined
                    ? x.name
                    : `${x.name} · ${t.calendar.leaveLeft.replace('{n}', daysText(left))}`
                }
                selected={typeId === x.id}
              />
            </Pressable>
          );
        })}
        <Pressable onPress={() => setType(null)}>
          <Chip label={t.calendar.leaveTypeNone} selected={typeId === null} />
        </Pressable>
      </View>
      {count > 0 ? (
        <Text variant="caption" tone="muted">
          {t.calendar.leaveDaysSelected.replace('{n}', daysText(count))}
          {check && check.ok
            ? ` · ${t.calendar.leaveAfter.replace('{n}', daysText(check.available - check.days))}`
            : ''}
        </Text>
      ) : null}
      <Field label={t.calendar.reason} value={reason} onChange={setReason} />
      {error ? <Callout tone="negative">{error}</Callout> : null}
      <Actions
        onClose={onClose}
        onSave={() =>
          save.mutate(
            {
              id: randomUUID(),
              memberId,
              startDay: start,
              endDay: end,
              halfDay: half,
              kind,
              reason: reason.trim() || null,
              leaveTypeId: typeId,
            },
            { onSuccess: onClose },
          )
        }
        disabled={!!error || !memberId || suspended || save.isPending}
        saveLabel={t.calendar.save}
      />
    </FormSheet>
  );
}

function LeaveDecisionSheetInner({
  groupId,
  visible,
  onClose,
  leave,
}: Props & { leave: MirrorLeave | null }) {
  const { t } = useStrings();
  const view = useCompanyEntries(groupId);
  const decide = useDecideLeave(groupId);
  const [note, setNote] = useState('');
  const person = view.members.find((p) => p.id === leave?.memberId);
  const types = useLeaveTypes(groupId);
  // The server refuses an approval that would take the balance below zero; say so here instead.
  const check = useLeaveCheck(groupId, {
    memberId: leave?.memberId ?? '',
    typeId: leave?.leaveTypeId ?? null,
    startDay: leave?.startDay ?? '',
    endDay: leave?.endDay ?? '',
    halfDay: leave?.halfDay ?? false,
    ignoreId: leave?.id,
  });
  if (!leave) return null;
  const typeName = types.find((x) => x.id === leave.leaveTypeId)?.name;
  const blocked = !!check && !check.ok;
  const decision = (approve: boolean) =>
    decide.mutate({ id: leave.id, approve, note: note.trim() || null }, { onSuccess: onClose });
  return (
    <FormSheet visible={visible} onClose={onClose}>
      <Text variant="title">{t.calendar.decisionTitle}</Text>
      {person ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <PersonAvatar name={displayName(person)} />
          <Text>{displayName(person)}</Text>
        </View>
      ) : null}
      <Text>
        {leave.startDay} – {leave.endDay}
      </Text>
      <Text>
        {typeName ??
          (leave.kind === 'casual'
            ? t.calendar.leaveCasual
            : leave.kind === 'sick'
              ? t.calendar.leaveSick
              : t.calendar.leaveOther)}
        {leave.halfDay ? ` · ${t.calendar.halfDay}` : ''}
        {` · ${t.calendar.leaveDaysSelected.replace('{n}', daysText(leaveDays(leave)))}`}
      </Text>
      {blocked && check ? (
        <Callout tone="negative">
          {t.calendar.leaveCannotApprove
            .replace('{n}', daysText(Math.max(0, check.available)))
            .replace('{type}', check.type.name)}
        </Callout>
      ) : null}
      {leave.reason ? <Text>{leave.reason}</Text> : null}
      <Field label={t.calendar.decisionNote} value={note} onChange={setNote} />
      <Row style={{ gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Button
            label={t.calendar.reject}
            variant="secondary"
            fullWidth
            onPress={() => decision(false)}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            label={t.calendar.approve}
            fullWidth
            disabled={blocked || decide.isPending}
            onPress={() => decision(true)}
          />
        </View>
      </Row>
    </FormSheet>
  );
}

function MyDatesSheetInner({ groupId, visible, onClose, memberId }: Props & { memberId?: string }) {
  const { t, locale } = useStrings();
  const theme = useTheme();
  const access = useCalendarAccess(groupId);
  const cal = useCalendar(groupId);
  const save = useSetDates(groupId);
  const suspended = useCompanySuspended(groupId);
  const id = memberId ?? access.meId ?? '';
  const own = !memberId || memberId === access.meId;
  const current = cal.dates.get(id);
  const [birth, setBirth] = useState<Birthday | null>(
    current?.birthDay && current?.birthMonth
      ? { day: current.birthDay, month: current.birthMonth }
      : null,
  );
  const [joined, setJoined] = useState(current?.joinedOn ?? '');
  const [show, setShow] = useState(current?.showBirthday ?? false);
  const [picking, setPicking] = useState<'birth' | 'join' | null>(null);
  const today = todayIso();
  const write = (clear = false) =>
    save.mutate(
      {
        memberId: id,
        birthDay: clear || !birth ? null : birth.day,
        birthMonth: clear || !birth ? null : birth.month,
        joinedOn: clear || !joined ? null : joined,
        showBirthday: own && !clear && show,
      },
      { onSuccess: onClose },
    );
  const open = (which: 'birth' | 'join') => {
    const value =
      which === 'birth' ? birthdayToDate(birth ?? { day: 1, month: 1 }) : dateFrom(joined || today);
    const apply = (d: Date) =>
      which === 'birth' ? setBirth(dateToBirthday(d)) : setJoined(isoDate(d));
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value,
        mode: 'date',
        ...(which === 'join'
          ? { minimumDate: dateFrom('1980-01-01'), maximumDate: dateFrom(today) }
          : {}),
        onChange: (e, d) => e.type === 'set' && d && apply(d),
      });
    } else setPicking((p) => (p === which ? null : which));
  };
  const picker = (which: 'birth' | 'join') =>
    Platform.OS === 'ios' && picking === which ? (
      <DateTimePicker
        value={
          which === 'birth'
            ? birthdayToDate(birth ?? { day: 1, month: 1 })
            : dateFrom(joined || today)
        }
        mode="date"
        display="inline"
        {...(which === 'join'
          ? { minimumDate: dateFrom('1980-01-01'), maximumDate: dateFrom(today) }
          : {})}
        onChange={(e, d) => {
          if (e.type === 'dismissed' || !d) return;
          if (which === 'birth') setBirth(dateToBirthday(d));
          else setJoined(isoDate(d));
        }}
      />
    ) : null;
  return (
    <FormSheet visible={visible} onClose={onClose}>
      <Row style={{ gap: theme.spacing.md }}>
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: theme.radius.md,
            backgroundColor: theme.color.brandSoft,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="calendar-outline" size={iconSize.lg} color={theme.color.brand} />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="title">{t.calendar.datesTitle}</Text>
          <Text variant="caption" tone="muted">
            {t.calendar.datesSubtitle}
          </Text>
        </View>
      </Row>
      <FieldLabel>{t.calendar.birthday}</FieldLabel>
      <SelectField
        icon="gift-outline"
        label={t.calendar.birthday}
        text={birth ? formatBirthday(birth, locale) : t.calendar.selectDate}
        placeholder={!birth}
        chevron={false}
        onPress={() => open('birth')}
      />
      {picker('birth')}
      <FieldLabel>{t.calendar.joinedLabel}</FieldLabel>
      <SelectField
        icon="briefcase-outline"
        label={t.calendar.joinedLabel}
        text={joined ? showDate(joined, locale) : t.calendar.selectDate}
        placeholder={!joined}
        chevron={false}
        onPress={() => open('join')}
      />
      {picker('join')}
      {own ? (
        <Row style={{ gap: theme.spacing.md }}>
          <View style={{ flex: 1 }}>
            <Text>{t.calendar.showBirthday}</Text>
            <Text variant="caption" tone="muted">
              {t.calendar.showBirthdayHint}
            </Text>
          </View>
          <Toggle
            value={show}
            onValueChange={setShow}
            accessibilityLabel={t.calendar.showBirthday}
          />
        </Row>
      ) : null}
      <Row style={{ gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Button label={t.calendar.cancel} variant="secondary" fullWidth onPress={onClose} />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            label={t.calendar.save}
            fullWidth
            icon={<Ionicons name="checkmark" size={iconSize.base} color={theme.color.onBrand} />}
            disabled={suspended || !id || save.isPending}
            onPress={() => write()}
          />
        </View>
      </Row>
      <Button
        label={t.calendar.clear}
        variant="ghost"
        fullWidth
        disabled={suspended || save.isPending || !id}
        onPress={() => write(true)}
      />
    </FormSheet>
  );
}

// Remount on every open (and per record) so the form state starts from the record being edited.
export function HolidayFormSheet(p: Parameters<typeof HolidayFormSheetInner>[0]) {
  return <HolidayFormSheetInner key={`${p.visible}-${p.holiday?.id ?? ''}`} {...p} />;
}
export function EventFormSheet(p: Parameters<typeof EventFormSheetInner>[0]) {
  return <EventFormSheetInner key={`${p.visible}-${p.event?.id ?? ''}`} {...p} />;
}
export function LeaveFormSheet(p: Parameters<typeof LeaveFormSheetInner>[0]) {
  return <LeaveFormSheetInner key={`${p.visible}-${p.day ?? ''}`} {...p} />;
}
export function LeaveDecisionSheet(p: Parameters<typeof LeaveDecisionSheetInner>[0]) {
  return <LeaveDecisionSheetInner key={`${p.visible}-${p.leave?.id ?? ''}`} {...p} />;
}
export function MyDatesSheet(p: Parameters<typeof MyDatesSheetInner>[0]) {
  return <MyDatesSheetInner key={`${p.visible}-${p.memberId ?? ''}`} {...p} />;
}
