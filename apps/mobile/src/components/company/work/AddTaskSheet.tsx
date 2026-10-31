/**
 * The Add task sheet (Team › Daily work): what to do, who gets it, by when, an optional photo, and the
 * mic. One task is saved per person picked, all with the same description, deadline and photos.
 * The deadline is the task's day, so it appears on that day's Daily work. Everything is checked here
 * first; the parent remounts it (a new `key`) on every open so nothing is left over. The server's own limits (scope, a week ahead) are the same ones, so it never has to refuse.
 */
import { useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Image } from 'expo-image';
import { randomUUID } from 'expo-crypto';
import { Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { Button, IconButton, iconSize, Sheet, Text, useTheme } from '@waves/ui';

import { DictateButton, dictationAvailable } from '@/components/DictateButton';
import { PersonAvatar } from '@/components/PersonAvatar';
import { attachCompanyPhoto } from '@/data/companyEntries';
import { useSetWorkTask } from '@/data/companyWorkday';
import { displayName, isGhost, type MemberRow } from '@/data/types';
import { plural, useStrings } from '@/i18n';
import { useDialog } from '@/lib/dialog';
import { captureReceipt, pickAlbumPhoto, type PickedImage } from '@/lib/image';
import {
  addTaskError,
  addTaskPayloads,
  MAX_TASK_PHOTOS,
  type AddTaskError,
} from '@/lib/companyWork';
import { useSync } from '@/sync';

const TILE = 96;
type Panel = 'form' | 'people' | 'date';
type Problem = AddTaskError | 'save' | 'photos' | null;

function localIso(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function AddTaskSheet({
  groupId,
  visible,
  onClose,
  people,
  defaultMemberIds,
  defaultDay,
  today,
  maxDay,
  onSaved,
}: {
  groupId: string;
  visible: boolean;
  onClose: () => void;
  /** Whom the viewer may assign to: the owner anyone, a manager their own team. */
  people: readonly MemberRow[];
  defaultMemberIds: readonly string[];
  /** The day Daily work is showing; the deadline starts here (never before today). */
  defaultDay: string;
  today: string;
  maxDay: string;
  /** Called with the deadline day once saved, so Daily work can show the new tasks. */
  onSaved: (day: string) => void;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const { choose } = useDialog();
  const { flush } = useSync();
  const save = useSetWorkTask(groupId);
  const [panel, setPanel] = useState<Panel>('form');
  const [title, setTitle] = useState('');
  const [ids, setIds] = useState<string[]>(() => [...defaultMemberIds]);
  const [day, setDay] = useState(() =>
    defaultDay < today ? today : defaultDay > maxDay ? maxDay : defaultDay,
  );
  const [photos, setPhotos] = useState<{ key: string; picked: PickedImage }[]>([]);
  const [problem, setProblem] = useState<Problem>(null);
  const [busy, setBusy] = useState(false);
  // A retry after a failed photo must not make a second task or a second copy of a photo that went up.
  const taskIds = useRef(new Map<string, string>());
  const uploaded = useRef(new Set<string>());

  const allowed = people.map((p) => p.id);
  const picked = people.filter((p) => ids.includes(p.id));
  const dayLabel = new Date(`${day}T00:00:00Z`).toLocaleDateString(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });

  const addPhoto = async () => {
    if (busy || photos.length >= MAX_TASK_PHOTOS) return;
    const way = await choose({
      title: t.company.taskAddPhoto,
      options: [
        { id: 'camera', label: t.company.takePhoto, icon: 'camera-outline' },
        { id: 'library', label: t.company.choosePhoto, icon: 'images-outline' },
      ],
    });
    if (!way) return;
    const next = way === 'camera' ? await captureReceipt() : await pickAlbumPhoto();
    if (next)
      setPhotos((prev) => [...prev, { key: randomUUID(), picked: next }].slice(0, MAX_TASK_PHOTOS));
  };

  const submit = async () => {
    if (busy) return;
    const found = addTaskError({ title, memberIds: ids, allowed, day, today, maxDay });
    if (found) {
      setProblem(found);
      return;
    }
    setBusy(true);
    setProblem(null);
    const payloads = addTaskPayloads({
      title,
      memberIds: ids,
      day,
      idFor: (memberId) => {
        const known = taskIds.current.get(memberId);
        if (known) return known;
        const fresh = randomUUID();
        taskIds.current.set(memberId, fresh);
        return fresh;
      },
    });
    try {
      for (const payload of payloads) await save.mutateAsync(payload);
    } catch {
      setProblem('save');
      setBusy(false);
      return;
    }
    if (photos.length > 0) {
      let failed = false;
      try {
        // The photos attach to real server rows, so the queued tasks go up first.
        await flush([groupId]);
        for (const payload of payloads)
          for (const photo of photos) {
            const mark = `${payload.taskId}:${photo.key}`;
            if (uploaded.current.has(mark)) continue;
            try {
              await attachCompanyPhoto(groupId, payload.taskId, photo.picked, 'task');
              uploaded.current.add(mark);
            } catch {
              failed = true;
            }
          }
      } catch {
        failed = true;
      }
      if (failed) {
        onSaved(day);
        setProblem('photos');
        setBusy(false);
        return;
      }
    }
    onSaved(day);
    setBusy(false);
    onClose();
  };

  const message =
    problem === 'title'
      ? t.company.taskNeedTitle
      : problem === 'people'
        ? t.company.taskNeedPeople
        : problem === 'day'
          ? t.company.taskBadDay
          : problem === 'photos'
            ? t.company.taskPhotoFailed
            : problem === 'save'
              ? t.company.workSaveError
              : null;

  const pill = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: theme.spacing.sm,
    minHeight: 48,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.surfaceMuted,
    borderWidth: 1,
    borderColor: theme.color.border,
  };
  const label = (icon: React.ComponentProps<typeof Ionicons>['name'], text: string) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
      <Ionicons name={icon} size={iconSize.md} color={theme.color.brand} />
      <Text style={{ fontWeight: '700' }}>{text}</Text>
    </View>
  );

  return (
    <Sheet
      visible={visible}
      onClose={() => {
        if (!busy) onClose();
      }}
      closeLabel={t.common.close}
      style={{ maxHeight: '92%' }}
    >
      {panel === 'people' ? (
        <View style={{ gap: theme.spacing.md }}>
          <Text variant="title">{t.company.taskAssignTo}</Text>
          <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ gap: theme.spacing.xs }}>
            {people.map((person) => {
              const on = ids.includes(person.id);
              return (
                <Pressable
                  key={person.id}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  onPress={() =>
                    setIds((prev) =>
                      on ? prev.filter((id) => id !== person.id) : [...prev, person.id],
                    )
                  }
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.spacing.md,
                    minHeight: 52,
                  }}
                >
                  <PersonAvatar
                    name={displayName(person)}
                    member={person}
                    ghost={isGhost(person)}
                    size={36}
                  />
                  <Text style={{ flex: 1 }}>{displayName(person)}</Text>
                  <Ionicons
                    name={on ? 'checkmark-circle' : 'ellipse-outline'}
                    size={iconSize.lg}
                    color={on ? theme.color.brand : theme.color.textFaint}
                  />
                </Pressable>
              );
            })}
          </ScrollView>
          <Button label={t.common.done} onPress={() => setPanel('form')} />
        </View>
      ) : panel === 'date' ? (
        <View style={{ gap: theme.spacing.md }}>
          <Text variant="title">{t.company.taskDeadline}</Text>
          <DateTimePicker
            value={new Date(`${day}T12:00:00`)}
            mode="date"
            minimumDate={new Date(`${today}T00:00:00`)}
            maximumDate={new Date(`${maxDay}T23:59:59`)}
            onChange={(event, chosen) => {
              if (Platform.OS !== 'ios') setPanel('form');
              if (event.type === 'set' && chosen) setDay(localIso(chosen));
            }}
          />
          {Platform.OS === 'ios' ? (
            <Button label={t.common.done} onPress={() => setPanel('form')} />
          ) : null}
        </View>
      ) : (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ gap: theme.spacing.lg }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: theme.radius.md,
                backgroundColor: theme.color.brand,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="clipboard-outline" size={iconSize.lg} color={theme.color.onBrand} />
            </View>
            <Text variant="title" style={{ flex: 1 }}>
              {t.company.workAdd}
            </Text>
            <IconButton label={t.common.close} onPress={onClose}>
              <Ionicons name="close" size={iconSize.lg} color={theme.color.text} />
            </IconButton>
          </View>

          <View style={{ gap: theme.spacing.sm }}>
            <Text style={{ fontWeight: '700' }}>
              {t.company.taskDescription} <Text tone="negative">*</Text>
            </Text>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'flex-start',
                gap: theme.spacing.sm,
                paddingStart: theme.spacing.md,
                paddingEnd: theme.spacing.sm,
                paddingVertical: theme.spacing.xs,
                minHeight: 88,
                borderRadius: theme.radius.lg,
                borderWidth: 1,
                borderColor: theme.color.border,
                backgroundColor: theme.color.surfaceMuted,
              }}
            >
              <TextInput
                accessibilityLabel={t.company.taskDescription}
                placeholder={t.company.taskDescriptionHint}
                placeholderTextColor={theme.color.textFaint}
                value={title}
                multiline
                maxLength={200}
                editable={!busy}
                textAlignVertical="top"
                onChangeText={setTitle}
                style={{
                  flex: 1,
                  minHeight: 72,
                  fontSize: 17,
                  color: theme.color.text,
                  paddingVertical: theme.spacing.sm,
                }}
              />
              <View style={{ paddingTop: theme.spacing.xs }}>
                <DictateButton
                  compact
                  value={title}
                  onChange={(next) => setTitle(next.slice(0, 200))}
                  hints={people.map((p) => displayName(p))}
                />
              </View>
            </View>
          </View>

          <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
            <View style={{ flex: 1, gap: theme.spacing.sm }}>
              {label('people-outline', t.company.taskAssignTo)}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t.company.taskAssignTo}
                disabled={busy}
                onPress={() => setPanel('people')}
                style={pill}
              >
                <View style={{ flexDirection: 'row' }}>
                  {picked.slice(0, 3).map((person, index) => (
                    <View key={person.id} style={{ marginStart: index === 0 ? 0 : -10 }}>
                      <PersonAvatar
                        name={displayName(person)}
                        member={person}
                        ghost={isGhost(person)}
                        size={28}
                      />
                    </View>
                  ))}
                </View>
                <Text numberOfLines={1} style={{ flex: 1 }}>
                  {picked.length === 1 && picked[0]
                    ? displayName(picked[0])
                    : plural(locale, picked.length, t.company.taskPeople)}
                </Text>
                <Ionicons name="chevron-forward" size={iconSize.sm} color={theme.color.textMuted} />
              </Pressable>
            </View>
            <View style={{ flex: 1, gap: theme.spacing.sm }}>
              {label('calendar-outline', t.company.taskDeadline)}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t.company.taskDeadline}
                disabled={busy}
                onPress={() => setPanel('date')}
                style={pill}
              >
                <Text numberOfLines={1} style={{ flex: 1 }}>
                  {dayLabel}
                </Text>
                <Ionicons name="chevron-forward" size={iconSize.sm} color={theme.color.textMuted} />
              </Pressable>
            </View>
          </View>

          <View style={{ gap: theme.spacing.sm }}>
            {label('attach-outline', t.company.taskPhotoLabel)}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
              {photos.length < MAX_TASK_PHOTOS ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t.company.taskAddPhoto}
                  disabled={busy}
                  onPress={() => void addPhoto()}
                  style={{
                    width: TILE,
                    height: TILE,
                    borderRadius: theme.radius.lg,
                    borderWidth: 1.5,
                    borderStyle: 'dashed',
                    borderColor: theme.color.brand,
                    backgroundColor: theme.color.brandSoft,
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: theme.spacing.xs,
                  }}
                >
                  <Ionicons name="camera-outline" size={iconSize.lg} color={theme.color.brand} />
                  <Text variant="caption" tone="muted">
                    {t.company.taskAddPhoto}
                  </Text>
                </Pressable>
              ) : null}
              {photos.map((photo) => (
                <View
                  key={photo.key}
                  style={{
                    width: TILE,
                    height: TILE,
                    borderRadius: theme.radius.lg,
                    overflow: 'hidden',
                    backgroundColor: theme.color.surfaceMuted,
                  }}
                >
                  <Image
                    source={{ uri: photo.picked.uri }}
                    style={{ width: '100%', height: '100%' }}
                    contentFit="cover"
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t.company.removePhoto}
                    disabled={busy}
                    hitSlop={8}
                    onPress={() => setPhotos((prev) => prev.filter((p) => p.key !== photo.key))}
                    style={{
                      position: 'absolute',
                      top: 4,
                      right: 4,
                      width: 24,
                      height: 24,
                      borderRadius: 12,
                      backgroundColor: theme.color.surface,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Ionicons name="close" size={16} color={theme.color.text} />
                  </Pressable>
                </View>
              ))}
            </View>
          </View>

          {dictationAvailable ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.spacing.md,
                padding: theme.spacing.md,
                borderRadius: theme.radius.lg,
                backgroundColor: theme.color.brandSoft,
              }}
            >
              <Ionicons name="sparkles-outline" size={iconSize.lg} color={theme.color.brand} />
              <View style={{ flex: 1 }}>
                <Text tone="brand" style={{ fontWeight: '700' }}>
                  {t.company.taskVoiceTitle}
                </Text>
                <Text variant="caption" tone="muted">
                  {t.company.taskVoiceBody}
                </Text>
              </View>
              <DictateButton
                value={title}
                onChange={(next) => setTitle(next.slice(0, 200))}
                hints={people.map((p) => displayName(p))}
              />
            </View>
          ) : null}

          {message ? <Text tone="negative">{message}</Text> : null}
          <Button
            label={t.company.taskSave}
            fullWidth
            size="lg"
            disabled={busy}
            onPress={() => void submit()}
          />
        </ScrollView>
      )}
    </Sheet>
  );
}
