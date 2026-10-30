/** Owners, their managers and each manager's team in one tree. Tap a person to manage them. */

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

function CompanyHierarchyScreenInner() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const groupId = id ?? '';
  const { t, locale } = useStrings();
  const clearance = useBottomClearance();
  const view = useCompanyEntries(groupId);
  const live = view.members.filter((m) => !m.left_at);
  const row = (m: MemberRow, pill?: string, sub?: string) => (
    <ListRow
      key={m.id}
      leading={<PersonAvatar member={m} name={displayName(m)} ghost={isGhost(m)} size={40} />}
      title={displayName(m, null, null, t.misc.someone)}
      titleAccessory={pill ? <RolePill label={pill} /> : undefined}
      subtitle={sub}
      onPress={() => router.push(`/group/${groupId}/company-statement?member=${m.id}`)}
      divider
    />
  );
  const direct = live.filter((m) => m.role === 'member' && !m.manager_id);
  return (
    <Screen edges={[]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: clearance }}
        showsVerticalScrollIndicator={false}
      >
        <ScenicHeader title={t.company.hierarchyTitle} />
        <ScenicBody>
          {view.isOwner ? (
            <>
              <SectionHeader title={t.company.owners} />
              <StandardCard>
                {live.filter((m) => m.role === 'admin').map((m) => row(m, t.company.pillOwner))}
              </StandardCard>
              {live
                .filter((m) => m.role === 'manager')
                .map((mgr) => {
                  const team = live.filter((m) => m.manager_id === mgr.id);
                  return (
                    <StandardCard key={mgr.id}>
                      {row(
                        mgr,
                        t.company.manager,
                        plural(locale, team.length, t.company.employeeCount),
                      )}
                      {team.map((m) => row(m))}
                    </StandardCard>
                  );
                })}
              {direct.length > 0 ? (
                <>
                  <SectionHeader title={t.company.reportsToOwners} />
                  <StandardCard>{direct.map((m) => row(m))}</StandardCard>
                </>
              ) : null}
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
