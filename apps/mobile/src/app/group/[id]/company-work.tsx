import { ReadOnlyWhenSuspended } from '@/components/company/SuspendedBanner';
import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { randomUUID } from 'expo-crypto';
import { useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import type { CompanyWorkSetPayload } from '@waves/core';
import { Button, Screen, Sheet, Text, useTheme } from '@waves/ui';
import { EditTextSheet } from '@/components/EditTextSheet';
import { OverflowMenu, type OverflowMenuItem } from '@/components/OverflowMenu';
import { PersonAvatar } from '@/components/PersonAvatar';
import {
  ListRow,
  ScenicBody,
  ScenicHeader,
  SectionHeader,
  SegmentedPills,
  StandardCard,
} from '@/components/standard';
import { useCompanyProjects } from '@/data/companyEntries';
import {
  useRemoveWorkTask,
  useSetWorkTask,
  useWorkdayAccess,
  useWorkTasks,
  type MirrorWorkTask,
} from '@/data/companyWorkday';
import { todayIso } from '@/data/personal';
import { displayName, isGhost } from '@/data/types';
import { useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';

type Payload = CompanyWorkSetPayload;
function shift(iso: string, n: number) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}
function payload(task: MirrorWorkTask): Payload {
  return {
    taskId: task.id,
    memberId: task.memberId,
    day: task.day,
    title: task.title,
    projectId: task.projectId,
    status: task.status,
    blockedReason: task.blockedReason,
    note: task.note,
  };
}

export default function CompanyWorkScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const access = useWorkdayAccess(id);
  const tasks = useWorkTasks(id);
  const projects = useCompanyProjects(id);
  const sites = projects.filter((p) => !p.archived_at);
  const save = useSetWorkTask(id);
  const remove = useRemoveWorkTask(id);
  const { t, locale } = useStrings();
  const theme = useTheme();
  const clearance = useBottomClearance();
  const today = todayIso();
  const maxDay = shift(today, 7);
  const [day, setDay] = useState(today);
  const [draft, setDraft] = useState<Payload | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [statusId, setStatusId] = useState<string | null>(null);
  const [reasonAfterClose, setReasonAfterClose] = useState<string | null>(null);
  const [field, setField] = useState<{ taskId: string; kind: 'note' | 'blockedReason' } | null>(
    null,
  );
  const [error, setError] = useState(false);
  const busy = save.isPending || remove.isPending;
  const allowedPerson = (memberId: string) =>
    access.canManage && access.people.some((p) => p.id === memberId);
  const canChange = (task: MirrorWorkTask) =>
    access.enabled &&
    task.day <= maxDay &&
    (allowedPerson(task.memberId) || (access.isEmployee && task.memberId === access.me?.id));
  const visibleTasks = tasks.filter(
    (task) =>
      task.day === day &&
      (allowedPerson(task.memberId) || (access.isEmployee && task.memberId === access.me?.id)),
  );
  const people = access.isEmployee && access.me ? [access.me] : access.people;
  const write = (next: Payload, onSuccess?: () => void) => {
    const current = tasks.find((task) => task.id === next.taskId);
    if (
      !access.enabled ||
      busy ||
      next.day > maxDay ||
      !next.title.trim() ||
      next.title.length > 200 ||
      (next.note?.length ?? 0) > 200 ||
      (next.blockedReason?.length ?? 0) > 120 ||
      (next.status === 'blocked' && !next.blockedReason?.trim())
    )
      return;
    if (!allowedPerson(next.memberId)) {
      if (
        !current ||
        !access.isEmployee ||
        current.memberId !== access.me?.id ||
        next.memberId !== current.memberId ||
        next.day !== current.day ||
        next.title !== current.title ||
        next.projectId !== current.projectId
      )
        return;
    }
    setError(false);
    save.mutate(next, { onSuccess, onError: () => setError(true) });
  };
  const statusOptions = [
    { value: 'todo' as const, label: t.company.workTodo },
    { value: 'doing' as const, label: t.company.workDoing },
    { value: 'done' as const, label: t.company.workDone },
    { value: 'blocked' as const, label: t.company.workBlocked },
  ];
  const changeStatus = (task: MirrorWorkTask, status: Payload['status']) => {
    if (!canChange(task) || busy) return;
    if (status === 'blocked') {
      setStatusId(null);
      if (statusId !== null) setReasonAfterClose(task.id);
      else setField({ taskId: task.id, kind: 'blockedReason' });
    } else write({ ...payload(task), status, blockedReason: null });
  };
  const menuTask = tasks.find((task) => task.id === menuId);
  const items: OverflowMenuItem[] =
    menuTask && allowedPerson(menuTask.memberId) && canChange(menuTask) && !busy
      ? [
          {
            icon: 'create-outline',
            label: t.company.workEdit,
            onPress: () => setDraft(payload(menuTask)),
          },
          ...(menuTask.status !== 'done' && shift(menuTask.day, 1) <= maxDay
            ? [
                {
                  icon: 'copy-outline' as const,
                  label: t.company.workRepeat,
                  onPress: () =>
                    write({
                      ...payload(menuTask),
                      taskId: randomUUID(),
                      day: shift(menuTask.day, 1),
                      status: 'todo',
                      blockedReason: null,
                    }),
                },
              ]
            : []),
          {
            icon: 'trash-outline',
            label: t.company.workRemove,
            tone: 'danger',
            onPress: () => {
              if (!allowedPerson(menuTask.memberId) || busy) return;
              setError(false);
              remove.mutate({ taskId: menuTask.id }, { onError: () => setError(true) });
            },
          },
        ]
      : [];
  const fieldTask = tasks.find((task) => task.id === field?.taskId);
  const statusTask = tasks.find((task) => task.id === statusId);
  return (
    <Screen edges={[]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: clearance + 80 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <ScenicHeader title={access.isEmployee ? t.company.workMine : t.company.workTitle} />
        <ScenicBody>
          <ReadOnlyWhenSuspended groupId={id}>
            {!access.enabled ? (
              <Text tone="muted">{t.company.attendanceEmpty}</Text>
            ) : (
              <>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <Button
                    label="‹"
                    accessibilityLabel={t.company.workPreviousDay}
                    variant="secondary"
                    repeatable
                    onPress={() => setDay(shift(day, -1))}
                  />
                  <Text>
                    {new Date(`${day}T00:00:00Z`).toLocaleDateString(locale, {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                      timeZone: 'UTC',
                    })}
                  </Text>
                  <Button
                    label="›"
                    accessibilityLabel={t.company.workNextDay}
                    variant="secondary"
                    repeatable
                    disabled={day >= maxDay}
                    onPress={() => setDay(shift(day, 1))}
                  />
                </View>
                {access.canManage ? (
                  <Button
                    label={`+ ${t.company.workAdd}`}
                    disabled={busy || access.people.length === 0 || day > maxDay}
                    onPress={() =>
                      setDraft({
                        taskId: randomUUID(),
                        memberId: access.people[0]?.id ?? '',
                        day,
                        title: '',
                        projectId: null,
                        status: 'todo',
                        blockedReason: null,
                        note: null,
                      })
                    }
                  />
                ) : null}
                {visibleTasks.length === 0 ? <Text tone="muted">{t.company.workEmpty}</Text> : null}
                {people.map((person) => {
                  const own = visibleTasks.filter((task) => task.memberId === person.id);
                  if (!own.length) return null;
                  return (
                    <StandardCard key={person.id} style={{ gap: theme.spacing.sm }}>
                      <ListRow
                        title={displayName(person)}
                        leading={
                          <PersonAvatar
                            member={person}
                            name={displayName(person)}
                            ghost={isGhost(person)}
                            size={36}
                          />
                        }
                      />
                      {own.map((task) => (
                        <View
                          key={task.id}
                          style={{ gap: theme.spacing.xs, paddingVertical: theme.spacing.sm }}
                        >
                          <ListRow
                            title={task.title}
                            subtitle={projects.find((p) => p.id === task.projectId)?.name}
                            trailing={
                              access.canManage && canChange(task) ? (
                                <Pressable
                                  disabled={busy}
                                  hitSlop={8}
                                  accessibilityRole="button"
                                  accessibilityLabel={t.company.workEdit}
                                  onPress={() => setMenuId(task.id)}
                                  style={{
                                    minWidth: 44,
                                    minHeight: 44,
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                  }}
                                >
                                  <Ionicons
                                    name="ellipsis-vertical"
                                    size={20}
                                    color={theme.color.textMuted}
                                  />
                                </Pressable>
                              ) : undefined
                            }
                          />
                          {task.blockedReason ? (
                            <Text variant="caption" tone="negative">
                              {task.blockedReason}
                            </Text>
                          ) : null}
                          {task.note ? (
                            <Text variant="caption" tone="muted">
                              {task.note}
                            </Text>
                          ) : null}
                          <View
                            style={{
                              flexDirection: 'row',
                              flexWrap: 'wrap',
                              alignItems: 'center',
                              gap: theme.spacing.xs,
                            }}
                          >
                            <View pointerEvents={!canChange(task) || busy ? 'none' : 'auto'}>
                              <SegmentedPills
                                options={statusOptions.filter(
                                  (option) => option.value === task.status,
                                )}
                                value={task.status}
                                onChange={() =>
                                  changeStatus(
                                    task,
                                    task.status === 'todo'
                                      ? 'doing'
                                      : task.status === 'doing'
                                        ? 'done'
                                        : 'todo',
                                  )
                                }
                              />
                            </View>
                            {canChange(task) ? (
                              <>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  label={t.company.workStatus}
                                  disabled={busy}
                                  onPress={() => setStatusId(task.id)}
                                />
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  label={t.company.workNote}
                                  disabled={busy}
                                  onPress={() => setField({ taskId: task.id, kind: 'note' })}
                                />
                              </>
                            ) : null}
                          </View>
                        </View>
                      ))}
                    </StandardCard>
                  );
                })}
              </>
            )}
            {error ? <Text tone="negative">{t.company.workSaveError}</Text> : null}
          </ReadOnlyWhenSuspended>
        </ScenicBody>
      </ScrollView>
      <OverflowMenu visible={menuId !== null} onClose={() => setMenuId(null)} items={items} />
      <Sheet
        visible={draft !== null}
        onClose={() => {
          if (!busy) setDraft(null);
        }}
        closeLabel={t.common.close}
      >
        {draft ? (
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ gap: theme.spacing.md }}
          >
            <SectionHeader
              title={
                tasks.some((task) => task.id === draft.taskId)
                  ? t.company.workEdit
                  : t.company.workAdd
              }
            />
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
                backgroundColor: theme.color.surface,
                borderWidth: 1,
                borderColor: theme.color.border,
                borderRadius: theme.radius.lg,
                padding: theme.spacing.md,
                fontSize: 16,
              }}
            />
            <Text variant="caption" tone="muted">
              {t.company.workPerson}
            </Text>
            <View
              pointerEvents={busy ? 'none' : 'auto'}
              style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }}
            >
              {access.people.map((person) => (
                <View
                  key={person.id}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs }}
                >
                  <PersonAvatar
                    name={displayName(person)}
                    member={person}
                    ghost={isGhost(person)}
                    size={28}
                  />
                  <SegmentedPills
                    options={[{ value: person.id, label: displayName(person) }]}
                    value={draft.memberId}
                    onChange={(memberId) => setDraft({ ...draft, memberId })}
                  />
                </View>
              ))}
            </View>
            <Text variant="caption" tone="muted">
              {t.company.workSite}
            </Text>
            <View
              pointerEvents={busy ? 'none' : 'auto'}
              style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }}
            >
              <SegmentedPills
                options={[
                  { value: '', label: t.company.workNoSite },
                  ...sites.map((site) => ({ value: site.id, label: site.name })),
                ]}
                value={draft.projectId ?? ''}
                onChange={(projectId) => setDraft({ ...draft, projectId: projectId || null })}
              />
            </View>
            {error ? <Text tone="negative">{t.company.workSaveError}</Text> : null}
            <Button
              label={t.common.save}
              disabled={
                busy ||
                !draft.title.trim() ||
                !allowedPerson(draft.memberId) ||
                (draft.projectId !== null && !sites.some((site) => site.id === draft.projectId))
              }
              onPress={() => write({ ...draft, title: draft.title.trim() }, () => setDraft(null))}
            />
          </ScrollView>
        ) : null}
      </Sheet>
      <Sheet
        visible={statusId !== null}
        onClosed={() => {
          if (reasonAfterClose) {
            setField({ taskId: reasonAfterClose, kind: 'blockedReason' });
            setReasonAfterClose(null);
          }
        }}
        onClose={() => setStatusId(null)}
        closeLabel={t.common.close}
      >
        <View style={{ gap: theme.spacing.md }}>
          <SectionHeader title={t.company.workStatus} />
          {statusTask ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }}>
              <SegmentedPills
                options={statusOptions}
                value={statusTask.status}
                onChange={(status) => {
                  changeStatus(statusTask, status);
                  setStatusId(null);
                }}
              />
            </View>
          ) : null}
        </View>
      </Sheet>
      <EditTextSheet
        required={field?.kind === 'blockedReason'}
        visible={field !== null}
        title={field?.kind === 'blockedReason' ? t.company.workReason : t.company.workNote}
        value={
          field?.kind === 'blockedReason'
            ? (fieldTask?.blockedReason ?? '')
            : (fieldTask?.note ?? '')
        }
        maxLength={field?.kind === 'blockedReason' ? 120 : 200}
        saving={busy}
        error={error ? t.company.workSaveError : undefined}
        onClose={() => setField(null)}
        onSave={(text) => {
          if (
            !fieldTask ||
            !field ||
            !canChange(fieldTask) ||
            (field.kind === 'blockedReason' && !text.trim())
          )
            return;
          write(
            {
              ...payload(fieldTask),
              ...(field.kind === 'blockedReason'
                ? { status: 'blocked' as const, blockedReason: text.trim() }
                : { note: text.trim() || null }),
            },
            () => setField(null),
          );
        }}
      />
    </Screen>
  );
}
