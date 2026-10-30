import { useCallback, useEffect, useRef, useState } from 'react';
import { TextInput, View } from 'react-native';
import { Button, Sheet, Text, useTheme } from '@waves/ui';

import { useGroup, useSetCompanyEmployment } from '@/data/hooks';
import { employeeIdHolder, employmentErrorKey, isEmploymentDate } from '@/data/companyEmployment';
import { displayName, type MemberRow } from '@/data/types';
import { useEmployeeIdTaken } from '@/data/companyEntries';
import { useStrings } from '@/i18n';
import { useDialog } from '@/lib/dialog';
import { todayIso } from '@/data/personal';

export function CompanyEmploymentControl({
  groupId,
  member,
  autoOpen = false,
  onClose,
}: {
  groupId: string;
  member: MemberRow;
  autoOpen?: boolean;
  onClose?: () => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const { confirm, notify } = useDialog();
  const mutation = useSetCompanyEmployment(groupId);
  const { members } = useGroup(groupId);
  const people = members.data ?? [];
  const isTaken = useEmployeeIdTaken(groupId, people);
  const currentlyEmployed = !member.left_at;
  const [open, setOpen] = useState(autoOpen && currentlyEmployed);
  const [endedOn, setEndedOn] = useState(todayIso());
  const [note, setNote] = useState('');
  const [idConflict, setIdConflict] = useState(false);
  const [newEmployeeId, setNewEmployeeId] = useState('');
  const [newIdError, setNewIdError] = useState<string | null>(null);
  const [checkingId, setCheckingId] = useState(false);
  const autoStarted = useRef(false);

  const submit = useCallback(async () => {
    if (mutation.isPending) return;
    if (currentlyEmployed) {
      const date = endedOn.trim();
      if (date && !isEmploymentDate(date)) {
        await notify({ title: t.company.employmentFailed, body: t.company.employmentInvalidDate });
        return;
      }
      if (
        !(await confirm({
          title: t.company.markNotEmployed,
          body: t.company.employmentHint,
          confirmLabel: t.company.markNotEmployed,
          tone: 'danger',
        }))
      )
        return;
      setOpen(false);
      try {
        await mutation.mutateAsync({
          memberId: member.id,
          employed: false,
          endedOn: date || null,
          note,
        });
        onClose?.();
      } catch (error) {
        await notify({
          title: t.company.employmentFailed,
          body: t.company[employmentErrorKey(error)],
        });
      }
      return;
    }
    if (member.employee_id && (await isTaken(member.employee_id, member.id))) {
      setIdConflict(true);
      setOpen(true);
      return;
    }
    if (!(await confirm({ title: t.company.markEmployed, confirmLabel: t.company.markEmployed })))
      return;
    try {
      await mutation.mutateAsync({ memberId: member.id, employed: true });
      onClose?.();
    } catch (error) {
      if (employmentErrorKey(error) === 'employmentIdTaken') {
        setIdConflict(true);
        setOpen(true);
        return;
      }
      await notify({
        title: t.company.employmentFailed,
        body: t.company[employmentErrorKey(error)],
      });
    }
  }, [
    mutation,
    currentlyEmployed,
    endedOn,
    member.id,
    member.employee_id,
    note,
    confirm,
    notify,
    onClose,
    t.company,
    isTaken,
  ]);

  const restore = async (idChoice?: 'clear' | 'new') => {
    if (mutation.isPending || checkingId) return;
    let input: { clearEmployeeId?: boolean; newEmployeeId?: string } = {};
    if (idChoice === 'clear') input.clearEmployeeId = true;
    if (idChoice === 'new') {
      const id = newEmployeeId.trim();
      if (!id) return;
      setCheckingId(true);
      const taken = await isTaken(id, member.id);
      setCheckingId(false);
      if (taken) {
        setNewIdError(t.company.employeeIdTaken);
        return;
      }
      input.newEmployeeId = id;
    }
    try {
      await mutation.mutateAsync({ memberId: member.id, employed: true, ...input });
      setOpen(false);
      setIdConflict(false);
      onClose?.();
    } catch (error) {
      if (employmentErrorKey(error) === 'employmentIdTaken') {
        setIdConflict(true);
        setNewIdError(t.company.employeeIdTaken);
        return;
      }
      await notify({
        title: t.company.employmentFailed,
        body: t.company[employmentErrorKey(error)],
      });
    }
  };

  useEffect(() => {
    if (!autoOpen || autoStarted.current || currentlyEmployed) return;
    const timer = setTimeout(() => {
      if (autoStarted.current) return;
      autoStarted.current = true;
      void submit();
    }, 0);
    return () => clearTimeout(timer);
  }, [autoOpen, currentlyEmployed, submit]);

  return (
    <>
      {autoOpen ? null : (
        <Button
          label={currentlyEmployed ? t.company.markNotEmployed : t.company.markEmployed}
          onPress={() => (currentlyEmployed ? setOpen(true) : void submit())}
          disabled={mutation.isPending}
        />
      )}
      <Sheet
        visible={open}
        onClose={() => {
          setOpen(false);
          onClose?.();
        }}
        closeLabel={t.common.close}
      >
        <View style={{ gap: theme.spacing.md }}>
          {!currentlyEmployed ? (
            idConflict ? (
              <>
                <Text variant="heading">{t.company.markEmployed}</Text>
                <Text variant="body">
                  {t.company.employeeIdInUseBy.replace('{id}', member.employee_id ?? '').replace(
                    '{name}',
                    (() => {
                      const holder = employeeIdHolder(people, member.employee_id ?? '', member.id);
                      return holder
                        ? displayName(holder, null, null, t.misc.someone)
                        : t.misc.someone;
                    })(),
                  )}
                </Text>
                <Button
                  label={t.company.restoreWithoutId}
                  onPress={() => void restore('clear')}
                  disabled={mutation.isPending || checkingId}
                />
                <TextInput
                  value={newEmployeeId}
                  onChangeText={(value) => {
                    setNewEmployeeId(value);
                    setNewIdError(null);
                  }}
                  placeholder={t.company.newEmployeeId}
                  accessibilityLabel={t.company.newEmployeeId}
                  style={{
                    color: theme.color.text,
                    borderColor: theme.color.border,
                    borderWidth: 1,
                    borderRadius: theme.radius.md,
                    padding: 12,
                  }}
                />
                {newIdError ? <Text variant="body">{newIdError}</Text> : null}
                <Button
                  label={t.company.pickNewId}
                  onPress={() => void restore('new')}
                  disabled={mutation.isPending || checkingId || !newEmployeeId.trim()}
                />
              </>
            ) : (
              <>
                <Text variant="heading">{t.company.markEmployed}</Text>
                <Button
                  label={t.company.markEmployed}
                  onPress={() => void submit()}
                  disabled={mutation.isPending}
                />
              </>
            )
          ) : (
            <>
              <Text variant="heading">{t.company.markNotEmployed}</Text>
              <Text variant="body">{t.company.employmentHint}</Text>
              <TextInput
                value={endedOn}
                onChangeText={setEndedOn}
                placeholder={t.company.employmentDate}
                accessibilityLabel={t.company.employmentDate}
                style={{
                  color: theme.color.text,
                  borderColor: theme.color.border,
                  borderWidth: 1,
                  borderRadius: theme.radius.md,
                  padding: 12,
                }}
              />
              <TextInput
                value={note}
                onChangeText={(value) => setNote(value.slice(0, 200))}
                maxLength={200}
                placeholder={t.company.employmentNote}
                accessibilityLabel={t.company.employmentNote}
                style={{
                  color: theme.color.text,
                  borderColor: theme.color.border,
                  borderWidth: 1,
                  borderRadius: theme.radius.md,
                  padding: 12,
                }}
              />
              <Button
                label={t.company.markNotEmployed}
                onPress={() => void submit()}
                disabled={mutation.isPending}
              />
            </>
          )}
        </View>
      </Sheet>
    </>
  );
}
