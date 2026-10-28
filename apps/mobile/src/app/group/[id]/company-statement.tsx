/** One employee's statement, opened by an admin from the company summary. */

import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView } from 'react-native';

import { Screen, Text, iconSize, useTheme } from '@waves/ui';

import { CompanyStatementView } from '@/components/company/CompanyStatementView';
import { CompanyTeamCard } from '@/components/company/CompanyTeamCard';
import { ScenicBody, ScenicHeader } from '@/components/standard';
import { useCompanyEntries } from '@/data/companyEntries';
import { displayName } from '@/data/types';
import { useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';
import { router } from '@/lib/navigation';

export default function CompanyStatementScreen() {
  const { id, member: memberParam } = useLocalSearchParams<{ id: string; member?: string }>();
  const groupId = id ?? '';
  const theme = useTheme();
  const clearance = useBottomClearance();
  const { t } = useStrings();
  const view = useCompanyEntries(groupId);
  // The member list only holds who this viewer may read, so a guessed id finds nothing.
  const member = view.members.find((m) => m.id === memberParam) ?? null;

  return (
    <Screen edges={[]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: clearance + 80 }}
        showsVerticalScrollIndicator={false}
      >
        <ScenicHeader
          title={member ? displayName(member, null, null, t.misc.someone) : t.company.myStatement}
        />
        <ScenicBody>
          {member ? <CompanyTeamCard groupId={groupId} view={view} member={member} /> : null}
          {member ? (
            <CompanyStatementView view={view} member={member} period="all" groupId={groupId} />
          ) : view.ready ? (
            <Text variant="caption" tone="muted">
              {t.company.none}
            </Text>
          ) : null}
        </ScenicBody>
      </ScrollView>
      {member && (view.manageableIds.has(member.id) || view.me?.id === member.id) ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.company.addEntry}
          onPress={() => router.push(`/group/${groupId}/company-entry?member=${member.id}`)}
          style={{
            position: 'absolute',
            right: theme.spacing.lg,
            bottom: clearance,
            width: 60,
            height: 60,
            borderRadius: 30,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.color.buttonPrimary,
          }}
        >
          <Ionicons name="add" size={iconSize.xl} color="#FFFFFF" />
        </Pressable>
      ) : null}
    </Screen>
  );
}
