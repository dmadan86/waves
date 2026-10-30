import { Platform, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Sheet, useTheme } from '@waves/ui';
import { EditTextSheet } from '@/components/EditTextSheet';
import { SectionHeader, SegmentedPills } from '@/components/standard';
import type { CompanyWorkSetPayload } from '@waves/core';
import type { MirrorWorkTask } from '@/data/companyWorkday';
import { useStrings } from '@/i18n';

type Field = { taskId: string; kind: 'note' | 'blockedReason' } | null;
type Payload = CompanyWorkSetPayload;

export function WorkTaskSheets({
  dateOpen,
  setDateOpen,
  day,
  setDay,
  today,
  maxDay,
  statusId,
  setStatusId,
  statusTask,
  statusOptions,
  changeStatus,
  reasonAfterClose,
  setReasonAfterClose,
  setField,
  field,
  fieldTask,
  busy,
  error,
  canChange,
  write,
}: {
  dateOpen: boolean;
  setDateOpen: (open: boolean) => void;
  day: string;
  setDay: (day: string) => void;
  today: string;
  maxDay: string;
  statusId: string | null;
  setStatusId: (id: string | null) => void;
  statusTask: MirrorWorkTask | undefined;
  statusOptions: readonly { value: Payload['status']; label: string }[];
  changeStatus: (task: MirrorWorkTask, status: Payload['status']) => void;
  reasonAfterClose: string | null;
  setReasonAfterClose: (id: string | null) => void;
  setField: (field: Field) => void;
  field: Field;
  fieldTask: MirrorWorkTask | undefined;
  busy: boolean;
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
      <Sheet visible={dateOpen} onClose={() => setDateOpen(false)} closeLabel={t.common.close}>
        <DateTimePicker
          value={new Date(`${day}T12:00:00`)}
          mode="date"
          minimumDate={new Date(`${shift(today, -400)}T00:00:00`)}
          maximumDate={new Date(`${maxDay}T23:59:59`)}
          onChange={(event, picked) => {
            if (Platform.OS !== 'ios') setDateOpen(false);
            if (event.type === 'set' && picked)
              setDay(
                `${picked.getFullYear()}-${String(picked.getMonth() + 1).padStart(2, '0')}-${String(picked.getDate()).padStart(2, '0')}`,
              );
          }}
        />
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

function shift(iso: string, n: number) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}
