/** One employee's statement, opened by an admin from the company summary. */

import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView } from 'react-native';

import { Screen, Text, iconSize, useTheme } from '@waves/ui';

import {
  CompanyPeriodPills,
  CompanyStatementView,
} from '@/components/company/CompanyStatementView';
import { ScenicBody, ScenicHeader } from '@/components/standard';
import { useCompanyEntries } from '@/data/companyEntries';
import { displayName } from '@/data/types';
import { useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';
import type { CompanyPeriod } from '@/lib/companyPeriod';
import { router } from '@/lib/navigation';

export default function CompanyStatementScreen() {
  const { id, member: memberParam } = useLocalSearchParams<{ id: string; member?: string }>();
  const groupId = id ?? '';
  const theme = useTheme();
  const clearance = useBottomClearance();
  const { t } = useStrings();
  const view = useCompanyEntries(groupId);
  const [period, setPeriod] = useState<CompanyPeriod>('month');
  // The member list only holds who this viewer may read, so a guessed id finds nothing.
  const member = view.members.find((m) => m.id === memberParam) ?? null;

  return (
    <Screen edges={[]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: clearance }}
        showsVerticalScrollIndicator={false}
      >
        <ScenicHeader
          title={member ? displayName(member, null, null, t.misc.someone) : t.company.myStatement}
          action={
            member && view.isAdmin ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t.company.addEntry}
                onPress={() => router.push(`/group/${groupId}/company-entry?member=${member.id}`)}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: theme.color.buttonPrimary,
                }}
              >
                <Ionicons name="add" size={iconSize.lg} color="#FFFFFF" />
              </Pressable>
            ) : undefined
          }
        >
          <CompanyPeriodPills value={period} onChange={setPeriod} />
        </ScenicHeader>
        <ScenicBody>
          {member ? (
            <CompanyStatementView view={view} member={member} period={period} groupId={groupId} />
          ) : view.ready ? (
            <Text variant="caption" tone="muted">
              {t.company.none}
            </Text>
          ) : null}
        </ScenicBody>
      </ScrollView>
    </Screen>
  );
}
