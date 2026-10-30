import { useCallback, useEffect, useRef, useState } from 'react';
import { TextInput, View } from 'react-native';
import { Button, Sheet, Text, useTheme } from '@waves/ui';

import { useSetCompanyEmployment } from '@/data/hooks';
import { employmentErrorKey, isEmploymentDate } from '@/data/companyEmployment';
import type { MemberRow } from '@/data/types';
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
  const currentlyEmployed = !member.left_at;
  const [open, setOpen] = useState(autoOpen && currentlyEmployed);
  const [endedOn, setEndedOn] = useState(todayIso());
  const [note, setNote] = useState('');
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
    if (!(await confirm({ title: t.company.markEmployed, confirmLabel: t.company.markEmployed })))
      return;
    try {
      await mutation.mutateAsync({ memberId: member.id, employed: true });
      onClose?.();
    } catch (error) {
      await notify({
        title: t.company.employmentFailed,
        body: t.company[employmentErrorKey(error)],
      });
    }
  }, [mutation, currentlyEmployed, endedOn, member.id, note, confirm, notify, onClose, t.company]);

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
        </View>
      </Sheet>
    </>
  );
}
