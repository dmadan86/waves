/** One employee's statement, opened by an admin from the company summary. */

import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams } from 'expo-router';
import { Linking, Pressable, ScrollView, View } from 'react-native';

import { Screen, Text, iconSize, useTheme } from '@waves/ui';

import { CompanyStatementView } from '@/components/company/CompanyStatementView';
import { CompanyTeamCard } from '@/components/company/CompanyTeamCard';
import { ScenicBody, ScenicHeader } from '@/components/standard';
import {
  useCompanyEntries,
  useCompanyProjectMembers,
  useCompanyProjects,
} from '@/data/companyEntries';
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
  const detail = !!member && view.isAdmin && member.id !== view.me?.id;
  const projects = useCompanyProjects(groupId);
  const siteIds = useCompanyProjectMembers(groupId).get(member?.id ?? '') ?? [];
  const site = projects.find((p) => !p.archived_at && siteIds.includes(p.id));
  const phone = member?.invite_phone?.trim() || null;

  return (
    <Screen edges={[]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: clearance + 80 }}
        showsVerticalScrollIndicator={false}
      >
        <ScenicHeader
          title={member ? displayName(member, null, null, t.misc.someone) : t.company.myStatement}
          circleBack={detail}
          action={
            detail && phone ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t.company.callEmployee}
                onPress={() => void Linking.openURL(`tel:${phone}`)}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: theme.color.surface,
                }}
              >
                <Ionicons name="call" size={iconSize.md} color={theme.color.brand} />
              </Pressable>
            ) : undefined
          }
        >
          {detail && site ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                height: 28,
                paddingHorizontal: 12,
                borderRadius: theme.radius.pill,
                backgroundColor: theme.color.brandSoft,
              }}
            >
              <Ionicons name="briefcase" size={iconSize.sm} color={theme.color.brand} />
              <Text variant="caption" style={{ color: theme.color.brand, fontWeight: '600' }}>
                {site.name}
              </Text>
            </View>
          ) : null}
        </ScenicHeader>
        <ScenicBody>
          {member && !detail ? (
            <CompanyTeamCard groupId={groupId} view={view} member={member} />
          ) : null}
          {member ? (
            <CompanyStatementView
              view={view}
              member={member}
              period="all"
              groupId={groupId}
              detail={detail}
            />
          ) : view.ready ? (
            <Text variant="caption" tone="muted">
              {t.company.none}
            </Text>
          ) : null}
        </ScenicBody>
      </ScrollView>
      {member && !detail && (view.manageableIds.has(member.id) || view.me?.id === member.id) ? (
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
