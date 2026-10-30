import { ReadOnlyWhenSuspended } from '@/components/company/SuspendedBanner';
import { useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { Button, Screen, Text, useTheme } from '@waves/ui';
import { PersonAvatar } from '@/components/PersonAvatar';
import { EditTextSheet } from '@/components/EditTextSheet';
import { AttendanceMonth } from '@/components/company/AttendanceMonth';
import {
  ListRow,
  ScenicBody,
  ScenicHeader,
  SegmentedPills,
  StandardCard,
} from '@/components/standard';
import {
  useAttendance,
  useSetAttendance,
  useWorkdayAccess,
  type AttendanceStatus,
} from '@/data/companyWorkday';
import { todayIso } from '@/data/personal';
import { displayName, isGhost } from '@/data/types';
import { useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';

export default function CompanyAttendanceScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const access = useWorkdayAccess(id);
  const marks = useAttendance(id);
  const save = useSetAttendance(id);
  const { t, locale } = useStrings();
  const theme = useTheme();
  const clearance = useBottomClearance();
  const today = todayIso();
  const [day, setDay] = useState(today);
  const [noteFor, setNoteFor] = useState<{ memberId: string; day: string } | null>(null);
  const [error, setError] = useState(false);
  const days = Array.from({ length: 31 }, (_, i) => {
    const date = new Date(`${today}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - i);
    return date.toISOString().slice(0, 10);
  });
  const write = (
    memberId: string,
    targetDay: string,
    status: AttendanceStatus | null,
    note: string | null,
    onSuccess?: () => void,
  ) => {
    if (
      !access.enabled ||
      !access.canManage ||
      !access.people.some((p) => p.id === memberId) ||
      targetDay > today ||
      (note?.length ?? 0) > 200
    )
      return;
    setError(false);
    save.mutate(
      { memberId, day: targetDay, status, note },
      { onSuccess, onError: () => setError(true) },
    );
  };
  return (
    <Screen edges={[]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: clearance + 80 }}
        showsVerticalScrollIndicator={false}
      >
        <ScenicHeader
          title={access.isEmployee ? t.company.attendanceMine : t.company.attendanceTitle}
        />
        <ScenicBody>
          <ReadOnlyWhenSuspended groupId={id}>
            {!access.enabled ? (
              <Text tone="muted">{t.company.attendanceEmpty}</Text>
            ) : access.isEmployee && access.me ? (
              <AttendanceMonth groupId={id} memberId={access.me.id} />
            ) : access.canManage ? (
              <>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: theme.spacing.sm }}
                >
                  <SegmentedPills
                    options={days.map((value) => ({
                      value,
                      label: new Date(`${value}T00:00:00Z`).toLocaleDateString(locale, {
                        day: 'numeric',
                        month: 'short',
                        timeZone: 'UTC',
                      }),
                    }))}
                    value={day}
                    onChange={setDay}
                  />
                </ScrollView>
                <Button
                  label={t.company.attendanceMarkAll}
                  disabled={
                    save.isPending || access.people.every((p) => marks.has(`${p.id}|${day}`))
                  }
                  onPress={() =>
                    access.people.forEach((p) => {
                      if (!marks.has(`${p.id}|${day}`)) write(p.id, day, 'present', null);
                    })
                  }
                />
                <StandardCard style={{ gap: theme.spacing.md }}>
                  {access.people.map((person) => {
                    const mark = marks.get(`${person.id}|${day}`);
                    return (
                      <View key={person.id} style={{ gap: theme.spacing.sm }}>
                        <ListRow
                          title={displayName(person)}
                          leading={
                            <PersonAvatar
                              name={displayName(person)}
                              member={person}
                              ghost={isGhost(person)}
                              size={36}
                            />
                          }
                        />
                        <View
                          pointerEvents={save.isPending ? 'none' : 'auto'}
                          style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }}
                        >
                          <SegmentedPills
                            options={[
                              { value: 'present', label: t.company.attendancePresent },
                              { value: 'half', label: t.company.attendanceHalf },
                              { value: 'absent', label: t.company.attendanceAbsent },
                            ]}
                            value={mark?.status ?? ''}
                            onChange={(status) =>
                              write(
                                person.id,
                                day,
                                status === mark?.status ? null : (status as AttendanceStatus),
                                mark?.note ?? null,
                              )
                            }
                          />
                        </View>
                        <Button
                          size="sm"
                          variant="ghost"
                          label={mark?.note || t.company.attendanceNote}
                          disabled={!mark || save.isPending}
                          onPress={() => setNoteFor({ memberId: person.id, day })}
                        />
                      </View>
                    );
                  })}
                </StandardCard>
              </>
            ) : null}
            {error ? <Text tone="negative">{t.company.workSaveError}</Text> : null}
          </ReadOnlyWhenSuspended>
        </ScenicBody>
      </ScrollView>
      <EditTextSheet
        visible={noteFor !== null}
        title={t.company.attendanceNote}
        maxLength={200}
        saving={save.isPending}
        error={error ? t.company.workSaveError : undefined}
        value={noteFor ? (marks.get(`${noteFor.memberId}|${noteFor.day}`)?.note ?? '') : ''}
        onClose={() => setNoteFor(null)}
        onSave={(note) => {
          if (!noteFor) return;
          const mark = marks.get(`${noteFor.memberId}|${noteFor.day}`);
          if (mark)
            write(noteFor.memberId, noteFor.day, mark.status, note || null, () => setNoteFor(null));
        }}
      />
    </Screen>
  );
}
