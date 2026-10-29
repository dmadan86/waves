/**
 * An employee's company home: one balance in words, three small numbers, their own
 * entries and one big +. No tabs, no other people, no budgets.
 */

import { useMemo } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router } from '@/lib/navigation';
import Ionicons from '@expo/vector-icons/Ionicons';

import { companyStatement } from '@waves/core';
import { Screen, Text, iconSize, useTheme } from '@waves/ui';

import { DashBody, DashHeader, useMoney } from '@/components/company/dashboard/parts';
import { CompanyStatementView } from '@/components/company/CompanyStatementView';
import { StandardCard } from '@/components/standard';
import { useCompanyEntries, useCompanyPeople } from '@/data/companyEntries';
import { todayIso } from '@/data/personal';
import { fill, useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';

export function EmployeeHome({ groupId }: { groupId: string }) {
  const theme = useTheme();
  const clearance = useBottomClearance();
  const { t } = useStrings();
  const view = useCompanyEntries(groupId);
  const people = useCompanyPeople(groupId).data ?? [];
  const fmt = useMoney(view.currency);
  const me = view.me;
  const boss =
    people.find((p) => p.member_id === me?.manager_id) ?? people.find((p) => p.role === 'admin');
  const month = todayIso().slice(0, 7);
  const sums = useMemo(() => {
    const mine = view.entries.filter(
      (e) => !e.paidByCompany && e.memberId === me?.id && !e.deleted,
    );
    const st = me
      ? companyStatement(view.entries, { memberId: me.id, from: '0000-01-01', to: '9999-12-31' })
      : null;
    return {
      advances: st?.totals.advances ?? 0n,
      spent: (st?.totals.expenses ?? 0n) + (st?.totals.allowance ?? 0n),
      wages: mine
        .filter(
          (e) =>
            (e.kind === 'wage_payment' || e.kind === 'wages') && e.occurredOn.startsWith(month),
        )
        .reduce((sum, e) => sum + e.amount, 0n),
    };
  }, [view.entries, me, month]);

  return (
    <Screen edges={[]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: clearance + 24 }}
        showsVerticalScrollIndicator={false}
      >
        <DashHeader
          groupId={groupId}
          view={view}
          showGear={false}
          voice
          subtitle={
            boss ? fill(t.company.yourManager, { name: boss.display_name }) : t.company.yourOwners
          }
        />
        <DashBody>
          {view.entries.length === 0 ? (
            <Text variant="body" tone="muted">
              {t.company.welcomeEmployee}
            </Text>
          ) : null}
          <StandardCard style={{ flexDirection: 'row', gap: theme.spacing.md }}>
            {(
              [
                [t.company.advancesLabel, sums.advances],
                [t.company.spentLabel, sums.spent],
                [t.company.wagesThisMonth, sums.wages],
              ] as const
            ).map(([label, value]) => (
              <View key={label} style={{ flex: 1 }}>
                <Text variant="micro" tone="muted" numberOfLines={2}>
                  {label}
                </Text>
                <Text
                  variant="body"
                  style={{ fontWeight: '700' }}
                  adjustsFontSizeToFit
                  numberOfLines={1}
                >
                  {fmt(value)}
                </Text>
              </View>
            ))}
          </StandardCard>
          {me ? (
            <CompanyStatementView view={view} member={me} period="all" groupId={groupId} />
          ) : null}
        </DashBody>
      </ScrollView>
      {/* The hero button scrolls away; statements are long, so keep an add action in reach. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t.company.addEntry}
        onPress={() => router.push(`/group/${groupId}/company-entry`)}
        style={{
          position: 'absolute',
          right: theme.spacing.lg,
          bottom: clearance + 8,
          width: 54,
          height: 54,
          borderRadius: 27,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.color.buttonPrimary,
          elevation: 4,
        }}
      >
        <Ionicons name="add" size={iconSize.xl} color="#FFFFFF" />
      </Pressable>
    </Screen>
  );
}
