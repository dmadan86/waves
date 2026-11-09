/** Owners, managers and employees of a company, one section each. Tap a person to manage them. */

import { SuspendedGate } from '@/components/company/SuspendedBanner';
import { ScrollView } from 'react-native';

import { Screen, Text } from '@waves/ui';

import { RolePill } from '@/components/company/dashboard/parts';
import { PersonAvatar } from '@/components/PersonAvatar';
import {
  ListRow,
  ScenicBody,
  ScenicHeader,
  SectionHeader,
  StandardCard,
} from '@/components/standard';
import { useCompanyEntries } from '@/data/companyEntries';
import { displayName, isGhost, type MemberRow } from '@/data/types';
import { plural, useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';
import { router } from '@/lib/navigation';
import { useLocalSearchParams } from 'expo-router';

/** Room under the list so the company bar's round + never sits on the last person. */
const FAB_ROOM = 88;

function CompanyHierarchyScreenInner() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const groupId = id ?? '';
  const { t, locale } = useStrings();
  const clearance = useBottomClearance();
  const view = useCompanyEntries(groupId);
  const live = view.members.filter((m) => !m.left_at);
  const owners = live.filter((m) => m.role === 'admin');
  const managers = live.filter((m) => m.role === 'manager');
  const employees = live.filter((m) => m.role === 'member');

  const rows = (
    list: readonly MemberRow[],
    pill?: string,
    sub?: (m: MemberRow) => string | undefined,
  ) =>
    list.map((m, i) => (
      <ListRow
        key={m.id}
        leading={<PersonAvatar member={m} name={displayName(m)} ghost={isGhost(m)} size={44} />}
        title={displayName(m, null, null, t.misc.someone)}
        titleAccessory={pill ? <RolePill label={pill} /> : undefined}
        subtitle={sub ? sub(m) : (m.employee_id ?? undefined)}
        onPress={() => router.push(`/group/${groupId}/company-statement?member=${m.id}`)}
        divider={i < list.length - 1}
      />
    ));

  const section = (title: string, list: readonly MemberRow[], body: React.ReactNode) =>
    list.length > 0 ? (
      <>
        <SectionHeader title={`${title} (${list.length})`} />
        <StandardCard>{body}</StandardCard>
      </>
    ) : null;

  return (
    <Screen edges={[]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: clearance + FAB_ROOM }}
        showsVerticalScrollIndicator={false}
      >
        <ScenicHeader title={t.company.hierarchyTitle} subtitle={t.company.hierarchySub} />
        <ScenicBody>
          {view.isOwner ? (
            <>
              {section(t.company.owners, owners, rows(owners, t.company.pillOwner))}
              {section(
                t.company.tabManagers,
                managers,
                rows(managers, t.company.manager, (mgr) =>
                  plural(
                    locale,
                    live.filter((m) => m.manager_id === mgr.id).length,
                    t.company.employeeCount,
                  ),
                ),
              )}
              {section(t.company.employees, employees, rows(employees))}
            </>
          ) : (
            <Text variant="caption" tone="muted">
              {t.company.none}
            </Text>
          )}
        </ScenicBody>
      </ScrollView>
    </Screen>
  );
}

export default function CompanyHierarchyScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <SuspendedGate groupId={id ?? ''}>
      <CompanyHierarchyScreenInner />
    </SuspendedGate>
  );
}
