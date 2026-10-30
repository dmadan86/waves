import { useState } from 'react';
import { randomUUID } from 'expo-crypto';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { Button, Callout, Chip, Row, Sheet, Text, useTheme } from '@waves/ui';
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
import { useCompanyEntries, useCompanyProjects, useCompanySuspended } from '@/data/companyEntries';
import { todayIso } from '@/data/personal';
import { displayName } from '@/data/types';
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

export function HolidayFormSheet({
  groupId,
  visible,
  onClose,
  day,
  holiday,
}: Props & { day?: string; holiday?: MirrorHoliday }) {
  const { t } = useStrings();
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
  return (
    <FormSheet visible={visible} onClose={onClose}>
      <Text variant="title">{holiday ? t.calendar.holidayName : t.calendar.addHoliday}</Text>
      <Field label={t.calendar.holidayName} value={name} onChange={setName} />
      <Field label={t.calendar.startDate} value={start} onChange={setStart} />
      <Field label={t.calendar.endDate} value={end} onChange={setEnd} />
      {error ? <Callout tone="negative">{error}</Callout> : null}
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

export function EventFormSheet({
  groupId,
  visible,
  onClose,
  day,
  event,
}: Props & { day?: string; event?: import('@waves/core').MirrorEvent }) {
  const { t } = useStrings();
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
  const eligible = view.members.filter(
    (p) => !p.left_at && p.role !== 'vendor' && (view.isOwner || view.manageableIds.has(p.id)),
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
  return (
    <FormSheet visible={visible} onClose={onClose}>
      <Text variant="title">{t.calendar.eventTitle}</Text>
      <Field label={t.calendar.eventTitle} value={title} onChange={setTitle} />
      <Field label={t.calendar.startDate} value={date} onChange={setDate} />
      <Field label={t.calendar.eventTime} value={time} onChange={setTime} placeholder="HH:MM" />
      <Field
        label={t.calendar.eventSite}
        value={site}
        onChange={setSite}
        placeholder={projects.map((p) => p.name).join(', ')}
      />
      <Text variant="caption" tone="muted">
        {t.calendar.eventPeople}
      </Text>
      {view.isOwner ? (
        <Pressable onPress={() => setPeople([])}>
          <Chip label={t.calendar.eventEveryone} selected={people.length === 0} />
        </Pressable>
      ) : null}
      {eligible.map((p) => (
        <Pressable
          key={p.id}
          onPress={() => toggle(p.id)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 5 }}
        >
          <PersonAvatar name={displayName(p)} />
          <Text>{displayName(p)}</Text>
          <Text>{people.includes(p.id) ? '✓' : ''}</Text>
        </Pressable>
      ))}
      {error ? <Callout tone="negative">{error}</Callout> : null}
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
        saveLabel={t.calendar.save}
        remove={event ? () => remove.mutate({ id: event.id }, { onSuccess: onClose }) : undefined}
      />
    </FormSheet>
  );
}

export function LeaveFormSheet({
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
  const [kind, setKind] = useState<'casual' | 'sick' | 'other'>('casual');
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
  const error =
    !iso(start) || !iso(end) || end < start || days(start, end) > 60
      ? t.calendar.errRange
      : half && start !== end
        ? t.calendar.errHalfDay
        : start < shift(today, -60) || end > shift(today, 365)
          ? t.calendar.errWindow
          : overlap
            ? t.calendar.errOverlap
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
      <Field label={t.calendar.startDate} value={start} onChange={setStart} />
      <Field label={t.calendar.endDate} value={end} onChange={setEnd} />
      {start === end ? (
        <Pressable onPress={() => setHalf(!half)}>
          <Text>
            {t.calendar.halfDay}
            {half ? ' ✓' : ''}
          </Text>
        </Pressable>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {(['casual', 'sick', 'other'] as const).map((k) => (
          <Pressable key={k} onPress={() => setKind(k)}>
            <Chip
              label={
                k === 'casual'
                  ? t.calendar.leaveCasual
                  : k === 'sick'
                    ? t.calendar.leaveSick
                    : t.calendar.leaveOther
              }
              selected={kind === k}
            />
          </Pressable>
        ))}
      </View>
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

export function LeaveDecisionSheet({
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
  if (!leave) return null;
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
        {leave.kind === 'casual'
          ? t.calendar.leaveCasual
          : leave.kind === 'sick'
            ? t.calendar.leaveSick
            : t.calendar.leaveOther}
        {leave.halfDay ? ` · ${t.calendar.halfDay}` : ''}
      </Text>
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
          <Button label={t.calendar.approve} fullWidth onPress={() => decision(true)} />
        </View>
      </Row>
    </FormSheet>
  );
}

export function MyDatesSheet({
  groupId,
  visible,
  onClose,
  memberId,
}: Props & { memberId?: string }) {
  const { t } = useStrings();
  const access = useCalendarAccess(groupId);
  const cal = useCalendar(groupId);
  const save = useSetDates(groupId);
  const suspended = useCompanySuspended(groupId);
  const id = memberId ?? access.meId ?? '';
  const own = !memberId || memberId === access.meId;
  const current = cal.dates.get(id);
  const [birth, setBirth] = useState(current?.birthDay ? String(current.birthDay) : '');
  const [month, setMonth] = useState(current?.birthMonth ? String(current.birthMonth) : '');
  const [joined, setJoined] = useState(current?.joinedOn ?? '');
  const [show, setShow] = useState(current?.showBirthday ?? false);
  const today = todayIso();
  const birthdayValid =
    (!birth && !month) ||
    (Number.isInteger(+birth) &&
      +birth >= 1 &&
      +birth <= 31 &&
      Number.isInteger(+month) &&
      +month >= 1 &&
      +month <= 12 &&
      (!(+birth === 29 && +month === 2) || true));
  const err = !birthdayValid
    ? t.calendar.errBirthday
    : joined && (!iso(joined) || joined > today || joined < '1980-01-01')
      ? t.calendar.errDate
      : null;
  const write = (clear = false) =>
    save.mutate(
      {
        memberId: id,
        birthDay: clear || !birth ? null : Number(birth),
        birthMonth: clear || !month ? null : Number(month),
        joinedOn: clear || !joined ? null : joined,
        showBirthday: own && !clear && show,
      },
      { onSuccess: onClose },
    );
  return (
    <FormSheet visible={visible} onClose={onClose}>
      <Text variant="title">{t.calendar.myDates}</Text>
      <Field label={t.calendar.birthDay} value={birth} onChange={setBirth} />
      <Field label={t.calendar.birthMonth} value={month} onChange={setMonth} />
      <Field label={t.calendar.joinedOn} value={joined} onChange={setJoined} />
      {own ? (
        <Pressable onPress={() => setShow(!show)}>
          <Text>
            {t.calendar.showBirthday}
            {show ? ' ✓' : ''}
          </Text>
        </Pressable>
      ) : null}
      {err ? <Callout tone="negative">{err}</Callout> : null}
      <Actions
        onClose={onClose}
        onSave={() => write()}
        disabled={!!err || suspended || !id || save.isPending}
        saveLabel={t.calendar.save}
      />
      <Button
        label={t.calendar.clear}
        variant="secondary"
        fullWidth
        disabled={suspended || save.isPending || !id}
        onPress={() => write(true)}
      />
    </FormSheet>
  );
}
