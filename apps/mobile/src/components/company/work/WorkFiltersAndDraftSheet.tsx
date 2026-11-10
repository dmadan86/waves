/** The Edit task sheet: title, person, site, due date and time, notes, then photos. Pickers open as panels in the same sheet. */
import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { Button, IconButton, iconSize, Sheet, Text, useTheme } from '@waves/ui';
import { CompanyEntryPhotos } from '@/components/company/CompanyEntryPhotos';
import { PersonAvatar } from '@/components/PersonAvatar';
import { displayName, isGhost, type MemberRow } from '@/data/types';
import { maxTaskDay } from '@/lib/companyWork';
import { HelpersPanel, helpersSummary } from './HelpersPanel';
import type { CompanyWorkSetPayload } from '@waves/core';
import { useStrings } from '@/i18n';

type Payload = CompanyWorkSetPayload;
type Site = { id: string; name: string };
type Panel = 'form' | 'person' | 'helpers' | 'site' | 'date' | 'time';

const pad = (n: number) => String(n).padStart(2, '0');

export function WorkFiltersAndDraftSheet({
  sites,
  groupId,
  canManage,
  meId,
  people,
  draft,
  setDraft,
  busy,
  error,
  allowedPerson,
  write,
  today,
}: {
  sites: readonly Site[];
  groupId: string;
  canManage: boolean;
  meId: string | null;
  people: readonly MemberRow[];
  draft: Payload | null;
  setDraft: (next: Payload | null) => void;
  busy: boolean;
  error: boolean;
  allowedPerson: (memberId: string) => boolean;
  write: (next: Payload, onSuccess?: () => void) => void;
  today: string;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const [panel, setPanel] = useState<Panel>('form');
  const close = () => {
    if (busy) return;
    setPanel('form');
    setDraft(null);
  };
  const card = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: theme.spacing.sm,
    padding: theme.spacing.sm,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.color.surfaceMuted,
  };
  const pill = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: theme.spacing.xs,
    minHeight: 40,
    paddingHorizontal: theme.spacing.sm,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.color.surface,
    borderWidth: 1,
    borderColor: theme.color.border,
  };
  const chevron = <Ionicons name="chevron-down" size={iconSize.sm} color={theme.color.textMuted} />;
  const rowIcon = (name: React.ComponentProps<typeof Ionicons>['name']) => (
    <Ionicons name={name} size={iconSize.md} color={theme.color.text} />
  );
  const done = <Button label={t.common.done} onPress={() => setPanel('form')} />;
  const person = draft ? people.find((p) => p.id === draft.memberId) : undefined;
  const site = draft ? sites.find((s) => s.id === draft.projectId) : undefined;
  const dayLabel = draft
    ? new Date(`${draft.day}T00:00:00Z`).toLocaleDateString(locale, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      })
    : '';
  const [hh, mm] = (draft?.dueTime ?? '10:00').split(':').map(Number);
  const timeValue = new Date(2000, 0, 1, hh, mm);
  const timeLabel = draft?.dueTime
    ? timeValue.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
    : t.company.workNoTime;
  return (
    <Sheet visible={draft !== null} onClose={close} closeLabel={t.common.close}>
      {draft && panel === 'person' ? (
        <View style={{ gap: theme.spacing.md }}>
          <Text variant="title">{t.company.taskResponsible}</Text>
          <ScrollView style={{ maxHeight: 360 }}>
            {people.map((p) => (
              <Pressable
                key={p.id}
                accessibilityRole="radio"
                accessibilityState={{ selected: p.id === draft.memberId }}
                onPress={() => {
                  setDraft({
                    ...draft,
                    memberId: p.id,
                    helperIds: (draft.helperIds ?? []).filter((id) => id !== p.id),
                  });
                  setPanel('form');
                }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.spacing.md,
                  minHeight: 52,
                }}
              >
                <PersonAvatar name={displayName(p)} member={p} ghost={isGhost(p)} size={36} />
                <Text style={{ flex: 1 }}>{displayName(p)}</Text>
                <Ionicons
                  name={p.id === draft.memberId ? 'checkmark-circle' : 'ellipse-outline'}
                  size={iconSize.lg}
                  color={p.id === draft.memberId ? theme.color.brand : theme.color.textFaint}
                />
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : draft && panel === 'helpers' ? (
        <HelpersPanel
          people={people}
          responsibleId={draft.memberId}
          value={draft.helperIds ?? []}
          onChange={(helperIds) => setDraft({ ...draft, helperIds })}
          onDone={() => setPanel('form')}
        />
      ) : draft && panel === 'site' ? (
        <View style={{ gap: theme.spacing.md }}>
          <Text variant="title">{t.company.workSite}</Text>
          <ScrollView style={{ maxHeight: 360 }}>
            {[{ id: '', name: t.company.workNoSite }, ...sites].map((s) => (
              <Pressable
                key={s.id}
                accessibilityRole="radio"
                accessibilityState={{ selected: s.id === (draft.projectId ?? '') }}
                onPress={() => {
                  setDraft({ ...draft, projectId: s.id || null });
                  setPanel('form');
                }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.spacing.md,
                  minHeight: 52,
                }}
              >
                <Text style={{ flex: 1 }}>{s.name}</Text>
                <Ionicons
                  name={s.id === (draft.projectId ?? '') ? 'checkmark-circle' : 'ellipse-outline'}
                  size={iconSize.lg}
                  color={
                    s.id === (draft.projectId ?? '') ? theme.color.brand : theme.color.textFaint
                  }
                />
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : draft && panel === 'date' ? (
        <View style={{ gap: theme.spacing.md }}>
          <Text variant="title">{t.company.workDue}</Text>
          <DateTimePicker
            value={new Date(`${draft.day}T12:00:00`)}
            mode="date"
            minimumDate={new Date(`${draft.day < today ? draft.day : today}T00:00:00`)}
            maximumDate={new Date(`${maxTaskDay(today)}T23:59:59`)}
            onChange={(event, chosen) => {
              if (Platform.OS !== 'ios') setPanel('form');
              if (event.type === 'set' && chosen)
                setDraft({
                  ...draft,
                  day: `${chosen.getFullYear()}-${pad(chosen.getMonth() + 1)}-${pad(chosen.getDate())}`,
                });
            }}
          />
          {Platform.OS === 'ios' ? done : null}
        </View>
      ) : draft && panel === 'time' ? (
        <View style={{ gap: theme.spacing.md }}>
          <Text variant="title">{t.company.workTime}</Text>
          <DateTimePicker
            value={timeValue}
            mode="time"
            onChange={(event, chosen) => {
              if (Platform.OS !== 'ios') setPanel('form');
              if (event.type === 'set' && chosen)
                setDraft({
                  ...draft,
                  dueTime: `${pad(chosen.getHours())}:${pad(chosen.getMinutes())}`,
                });
            }}
          />
          {Platform.OS === 'ios' ? done : null}
        </View>
      ) : draft ? (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ gap: theme.spacing.sm }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
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
              {t.company.workEdit}
            </Text>
            <IconButton label={t.common.close} onPress={close}>
              <Ionicons name="close" size={iconSize.lg} color={theme.color.text} />
            </IconButton>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
            <Ionicons name="checkbox-outline" size={iconSize.md} color={theme.color.brand} />
            <Text style={{ fontWeight: '600' }}>
              {t.company.workTitleField} <Text tone="negative">*</Text>
            </Text>
          </View>
          <TextInput
            accessibilityLabel={t.company.workTitleField}
            placeholder={t.company.workTitleField}
            placeholderTextColor={theme.color.textFaint}
            value={draft.title}
            maxLength={200}
            editable={!busy}
            onChangeText={(title) => setDraft({ ...draft, title })}
            style={{
              color: theme.color.text,
              backgroundColor: theme.color.surfaceMuted,
              borderWidth: 1,
              borderColor: theme.color.border,
              borderRadius: theme.radius.lg,
              paddingHorizontal: theme.spacing.md,
              paddingVertical: theme.spacing.sm,
              fontSize: 16,
            }}
          />
          <View style={card}>
            {rowIcon('people-outline')}
            <Text style={{ flex: 1 }}>{t.company.taskResponsible}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.company.taskResponsible}
              disabled={busy}
              onPress={() => setPanel('person')}
              style={pill}
            >
              {person ? (
                <PersonAvatar
                  name={displayName(person)}
                  member={person}
                  ghost={isGhost(person)}
                  size={24}
                />
              ) : null}
              <Text numberOfLines={1} style={{ maxWidth: 140 }}>
                {person ? displayName(person) : ''}
              </Text>
              {chevron}
            </Pressable>
          </View>
          <View style={card}>
            {rowIcon('people-circle-outline')}
            <Text style={{ flex: 1 }} numberOfLines={2}>
              {t.company.taskHelpers}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.company.taskHelpers}
              disabled={busy}
              onPress={() => setPanel('helpers')}
              style={pill}
            >
              <Text numberOfLines={1} style={{ maxWidth: 140 }}>
                {helpersSummary(people, draft.helperIds ?? [], t.company.taskHelpersNone)}
              </Text>
              {chevron}
            </Pressable>
          </View>
          {sites.length > 0 ? (
            <View style={card}>
              {rowIcon('location-outline')}
              <Text style={{ flex: 1 }}>{t.company.workSite}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t.company.workSite}
                disabled={busy}
                onPress={() => setPanel('site')}
                style={pill}
              >
                <Text numberOfLines={1} style={{ maxWidth: 140 }}>
                  {site?.name ?? t.company.workNoSite}
                </Text>
                {chevron}
              </Pressable>
            </View>
          ) : null}
          <View style={[card, { alignItems: 'flex-start' }]}>
            <View style={{ flex: 1, gap: theme.spacing.xs }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                {rowIcon('calendar-outline')}
                <Text style={{ fontWeight: '600' }}>
                  {t.company.workDueDate} <Text tone="negative">*</Text>
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t.company.workDueDate}
                disabled={busy}
                onPress={() => setPanel('date')}
                style={pill}
              >
                <Ionicons
                  name="calendar-outline"
                  size={iconSize.sm}
                  color={theme.color.textMuted}
                />
                <Text numberOfLines={1} style={{ flex: 1 }}>
                  {dayLabel}
                </Text>
                {chevron}
              </Pressable>
            </View>
            <View style={{ width: 1, alignSelf: 'stretch', backgroundColor: theme.color.border }} />
            <View style={{ flex: 1, gap: theme.spacing.xs }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                {rowIcon('time-outline')}
                <Text style={{ fontWeight: '600', flex: 1 }}>{t.company.workDueTime}</Text>
                {draft.dueTime ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t.company.workNoTime}
                    disabled={busy}
                    hitSlop={8}
                    onPress={() => setDraft({ ...draft, dueTime: null })}
                  >
                    <Ionicons
                      name="close-circle"
                      size={iconSize.md}
                      color={theme.color.textFaint}
                    />
                  </Pressable>
                ) : null}
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t.company.workDueTime}
                disabled={busy}
                onPress={() => setPanel('time')}
                style={pill}
              >
                <Text numberOfLines={1} style={{ flex: 1 }}>
                  {timeLabel}
                </Text>
                {chevron}
              </Pressable>
            </View>
          </View>
          <View style={[card, { flexDirection: 'column', alignItems: 'stretch' }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
              {rowIcon('flag-outline')}
              <Text style={{ fontWeight: '600' }}>{t.company.workPriority}</Text>
            </View>
            <View
              accessibilityLabel={t.company.workPriority}
              style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}
            >
              {(
                [
                  ['normal', t.company.workPrioNormal],
                  ['urgent', t.company.workPrioUrgent],
                  ['very_urgent', t.company.workPrioVeryUrgent],
                ] as const
              ).map(([value, text]) => {
                const on = (draft.priority ?? 'normal') === value;
                return (
                  <Pressable
                    key={value}
                    accessibilityRole="radio"
                    accessibilityLabel={text}
                    accessibilityState={{ selected: on }}
                    disabled={busy}
                    onPress={() => setDraft({ ...draft, priority: value })}
                    style={[
                      pill,
                      {
                        justifyContent: 'center',
                        paddingHorizontal: theme.spacing.md,
                        backgroundColor: on ? theme.color.brandSoft : theme.color.surface,
                      },
                    ]}
                  >
                    <Text
                      tone={on ? 'brand' : undefined}
                      style={on ? { fontWeight: '700' } : undefined}
                    >
                      {text}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <View style={[card, { flexDirection: 'column', alignItems: 'stretch' }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
              {rowIcon('document-text-outline')}
              <Text style={{ fontWeight: '600' }}>{t.company.workNotesOptional}</Text>
            </View>
            <View
              style={{
                borderWidth: 1,
                borderColor: theme.color.border,
                borderRadius: theme.radius.md,
                backgroundColor: theme.color.surface,
                paddingHorizontal: theme.spacing.sm,
                paddingVertical: theme.spacing.xs,
              }}
            >
              <TextInput
                accessibilityLabel={t.company.workNotesOptional}
                value={draft.note ?? ''}
                multiline
                maxLength={200}
                editable={!busy}
                onChangeText={(note) => setDraft({ ...draft, note: note || null })}
                style={{ color: theme.color.text, fontSize: 16, minHeight: 72, padding: 0 }}
                textAlignVertical="top"
              />
              <Text variant="caption" tone="muted" style={{ alignSelf: 'flex-end' }}>
                {(draft.note ?? '').length}/200
              </Text>
            </View>
          </View>
          {draft.blockedReason ? (
            <Text variant="caption" tone="muted">
              {draft.blockedReason}
            </Text>
          ) : null}
          <CompanyEntryPhotos
            kind="task"
            groupId={groupId}
            entryId={draft.taskId}
            canAdd={false}
            canRemove={(uploader) => canManage || uploader === meId}
          />
          {error ? <Text tone="negative">{t.company.workSaveError}</Text> : null}
          <Button
            label={t.company.taskSave}
            fullWidth
            size="lg"
            icon={<Ionicons name="checkmark" size={iconSize.md} color={theme.color.onBrand} />}
            disabled={
              busy ||
              !draft.title.trim() ||
              !allowedPerson(draft.memberId) ||
              (draft.projectId !== null && !sites.some((s) => s.id === draft.projectId))
            }
            onPress={() => write({ ...draft, title: draft.title.trim() }, close)}
          />
        </ScrollView>
      ) : null}
    </Sheet>
  );
}
