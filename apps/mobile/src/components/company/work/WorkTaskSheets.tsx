import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable } from 'react-native';
import { iconSize, Sheet, useTheme } from '@waves/ui';
import { EditTextSheet } from '@/components/EditTextSheet';
import { CompanyEntryPhotos } from '@/components/company/CompanyEntryPhotos';
import { StatusSheetBody } from './StatusSheetBody';
import type { CompanyWorkSetPayload } from '@waves/core';
import type { MirrorWorkTask } from '@/data/companyWorkday';
import { useStrings } from '@/i18n';

type Field = { taskId: string; kind: 'note' | 'blockedReason' } | null;
type Payload = CompanyWorkSetPayload;

export function WorkTaskSheets({
  groupId,
  statusId,
  setStatusId,
  statusTask,
  reasonAfterClose,
  setReasonAfterClose,
  setField,
  field,
  fieldTask,
  busy,
  canManage,
  meId,
  error,
  canChange,
  write,
}: {
  groupId: string;
  statusId: string | null;
  setStatusId: (id: string | null) => void;
  statusTask: MirrorWorkTask | undefined;
  reasonAfterClose: string | null;
  setReasonAfterClose: (id: string | null) => void;
  setField: (field: Field) => void;
  field: Field;
  fieldTask: MirrorWorkTask | undefined;
  busy: boolean;
  canManage: boolean;
  meId: string | null;
  error: boolean;
  canChange: (task: MirrorWorkTask) => boolean;
  write: (next: Payload, onSuccess?: () => void) => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const makePayload = (task: MirrorWorkTask): Payload => ({
    taskId: task.id,
    memberId: task.memberId,
    day: task.day,
    title: task.title,
    projectId: task.projectId,
    status: task.status,
    blockedReason: task.blockedReason,
    note: task.note,
    dueTime: task.dueTime ?? null,
  });
  return (
    <>
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
        title={t.company.workUpdateStatus}
        titleAction={
          <Pressable
            onPress={() => setStatusId(null)}
            accessibilityRole="button"
            accessibilityLabel={t.common.close}
            hitSlop={8}
          >
            <Ionicons name="close" size={iconSize.lg} color={theme.color.text} />
          </Pressable>
        }
      >
        {statusTask ? (
          <StatusSheetBody
            key={statusTask.id}
            task={statusTask}
            enabled={canChange(statusTask) && !busy}
            error={error}
            onPick={(status, text) => {
              const base = makePayload(statusTask);
              const next: Payload =
                status === 'blocked'
                  ? { ...base, status, blockedReason: text || statusTask.blockedReason }
                  : {
                      ...base,
                      status,
                      blockedReason: null,
                      // Add to the task's note, never replace it.
                      note: text
                        ? statusTask.note
                          ? `${statusTask.note}\n${text}`
                          : text
                        : statusTask.note,
                    };
              write(next, () => setStatusId(null));
            }}
          />
        ) : null}
        {statusTask ? (
          <CompanyEntryPhotos
            kind="task"
            groupId={groupId}
            entryId={statusTask.id}
            canAdd
            canRemove={(uploader) => canManage || uploader === meId}
          />
        ) : null}
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
              ...makePayload(fieldTask),
              ...(field.kind === 'blockedReason'
                ? { status: 'blocked', blockedReason: text.trim() }
                : { note: text.trim() || null }),
            },
            () => setField(null),
          );
        }}
      />
    </>
  );
}
