import { ScrollView, TextInput, View } from 'react-native';
import { Button, Sheet, Text, useTheme } from '@waves/ui';
import { SectionHeader, SegmentedPills } from '@/components/standard';
import { CompanyEntryPhotos } from '@/components/company/CompanyEntryPhotos';
import { PersonAvatar } from '@/components/PersonAvatar';
import { displayName, isGhost, type MemberRow } from '@/data/types';
import type { CompanyDepartment } from '@/data/companyDepartments';
import type { CompanyWorkSetPayload } from '@waves/core';
import { useStrings } from '@/i18n';

type Payload = CompanyWorkSetPayload;
type Site = { id: string; name: string };

export function WorkFiltersAndDraftSheet({
  filterOpen,
  setFilterOpen,
  sites,
  departments,
  siteFilter,
  setSiteFilter,
  departmentFilter,
  setDepartmentFilter,
  groupId,
  canManage,
  scope,
  people,
  personFilter,
  setPersonFilter,
  draft,
  setDraft,
  busy,
  error,
  allowedPerson,
  write,
}: {
  filterOpen: boolean;
  setFilterOpen: (open: boolean) => void;
  sites: readonly Site[];
  departments: readonly CompanyDepartment[];
  siteFilter: string | null;
  setSiteFilter: (value: string | null) => void;
  departmentFilter: string | null;
  setDepartmentFilter: (value: string | null) => void;
  groupId: string;
  canManage: boolean;
  scope: 'mine' | 'team';
  people: readonly MemberRow[];
  personFilter: string | null;
  setPersonFilter: (value: string | null) => void;
  draft: Payload | null;
  setDraft: (next: Payload | null) => void;
  busy: boolean;
  error: boolean;
  allowedPerson: (memberId: string) => boolean;
  write: (next: Payload, onSuccess?: () => void) => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  return (
    <>
      <Sheet visible={filterOpen} onClose={() => setFilterOpen(false)} closeLabel={t.common.close}>
        <View style={{ gap: theme.spacing.md }}>
          <SectionHeader title={t.company.workFilter} />
          <SegmentedPills
            options={[
              { value: '', label: t.company.workAll },
              ...sites.map((site) => ({ value: site.id, label: site.name })),
            ]}
            value={siteFilter ?? ''}
            onChange={(value) => setSiteFilter(value || null)}
          />
          {departments.length ? (
            <SegmentedPills
              options={[
                { value: '', label: t.company.workAll },
                ...departments.map((d) => ({ value: d.id, label: d.name })),
              ]}
              value={departmentFilter ?? ''}
              onChange={(value) => setDepartmentFilter(value || null)}
            />
          ) : null}
          {canManage && scope === 'team' ? (
            <SegmentedPills
              options={[
                { value: '', label: t.company.workAll },
                ...people.map((person) => ({ value: person.id, label: displayName(person) })),
              ]}
              value={personFilter ?? ''}
              onChange={(value) => setPersonFilter(value || null)}
            />
          ) : null}
        </View>
      </Sheet>
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
            <SectionHeader title={t.company.workEdit} />
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
              {people.map((person) => (
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
            <TextInput
              accessibilityLabel={t.company.workTime}
              placeholder={t.company.workTime}
              placeholderTextColor={theme.color.textFaint}
              value={draft.dueTime ?? ''}
              keyboardType="numbers-and-punctuation"
              editable={!busy}
              onChangeText={(dueTime) => setDraft({ ...draft, dueTime: dueTime || null })}
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
            <SegmentedPills
              options={[{ value: '', label: t.company.workNoTime }]}
              value={draft.dueTime ? 'time' : ''}
              onChange={() => setDraft({ ...draft, dueTime: null })}
            />
            {draft.blockedReason || draft.note ? (
              <Text variant="caption" tone="muted">
                {[draft.blockedReason, draft.note].filter(Boolean).join(' · ')}
              </Text>
            ) : null}
            <CompanyEntryPhotos
              kind="task"
              groupId={groupId}
              entryId={draft.taskId}
              canAdd={false}
              canRemove={() => canManage}
            />
            {error ? <Text tone="negative">{t.company.workSaveError}</Text> : null}
            <Button
              label={t.common.save}
              disabled={
                busy ||
                !draft.title.trim() ||
                (!!draft.dueTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.dueTime)) ||
                !allowedPerson(draft.memberId) ||
                (draft.projectId !== null && !sites.some((site) => site.id === draft.projectId))
              }
              onPress={() => write({ ...draft, title: draft.title.trim() }, () => setDraft(null))}
            />
          </ScrollView>
        ) : null}
      </Sheet>
    </>
  );
}
