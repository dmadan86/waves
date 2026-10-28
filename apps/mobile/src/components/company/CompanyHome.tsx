/**
 * What opening a Company group shows. An employee lands on their own statement; an
 * admin lands on the company summary — what is owed each way, the totals for the
 * period, and each employee one tap from their statement.
 */

import { useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, View } from 'react-native';

import { companySummary, format, formatParts, money, type CurrencyCode } from '@waves/core';
import { Button, Screen, Text, Toggle, iconSize, useTheme } from '@waves/ui';

import {
  CompanyPeriodPills,
  CompanyStatementView,
  kindLabel,
} from '@/components/company/CompanyStatementView';
import { PersonAvatar } from '@/components/PersonAvatar';
import {
  ListRow,
  ScenicBody,
  ScenicHeader,
  SectionHeader,
  StandardCard,
  StatCard,
} from '@/components/standard';
import { useCompanyEntries, useSetCompanySettings } from '@/data/companyEntries';
import { todayIso } from '@/data/personal';
import { displayName, isGhost } from '@/data/types';
import { fill, useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';
import { periodRange, type CompanyPeriod } from '@/lib/companyPeriod';
import { router } from '@/lib/navigation';

export function CompanyHome({ groupId }: { groupId: string }) {
  const theme = useTheme();
  const clearance = useBottomClearance();
  const { t, locale } = useStrings();
  const view = useCompanyEntries(groupId);
  const settings = useSetCompanySettings(groupId);
  const [period, setPeriod] = useState<CompanyPeriod>('month');
  const currency = view.currency as CurrencyCode;
  const fmt = (minor: bigint): string => format(money(minor, currency), { locale });

  const live = view.members.filter((member) => !member.left_at);
  const awaiting = view.entries.filter((entry) => !entry.deleted && entry.status === 'submitted');
  const summary = useMemo(() => {
    const { from, to } = periodRange(period, todayIso());
    return companySummary(view.entries, { from, to });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.entries, view.members, period]);

  const addButton = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t.company.addEntry}
      onPress={() => router.push(`/group/${groupId}/company-entry`)}
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
  );

  const owesParts = formatParts({ minor: summary.companyOwes, currency }, { locale });
  const categories = Object.entries(summary.totals.byCategory).sort((a, b) =>
    a[1] === b[1] ? 0 : a[1] > b[1] ? -1 : 1,
  );
  const catLabel = (key: string): string =>
    t.company[
      (
        {
          fuel: 'catFuel',
          transport: 'catTransport',
          travel: 'catTravel',
          food: 'catFood',
          office: 'catOffice',
        } as const
      )[key as 'fuel'] ?? 'catOther'
    ];

  return (
    <Screen edges={[]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: clearance }}
        showsVerticalScrollIndicator={false}
      >
        <ScenicHeader
          title={view.name || t.extras.typeCompany}
          subtitle={view.isAdmin ? t.company.summary : t.company.myStatement}
          action={view.me ? addButton : undefined}
        >
          <CompanyPeriodPills value={period} onChange={setPeriod} />
        </ScenicHeader>
        <ScenicBody>
          {view.ready && view.me && view.entries.length === 0 ? (
            <StandardCard style={{ gap: theme.spacing.md }}>
              <Text variant="body">
                {view.isAdmin ? t.company.welcomeAdmin : t.company.welcomeEmployee}
              </Text>
              <Button
                label={view.isAdmin ? t.company.invite : t.company.addEntry}
                onPress={() =>
                  router.push(
                    view.isAdmin ? `/group/${groupId}/invite` : `/group/${groupId}/company-entry`,
                  )
                }
              />
            </StandardCard>
          ) : null}
          {!view.ready || !view.me ? null : view.isAdmin ? (
            <>
              <StatCard
                label={t.company.companyOwesAll}
                lead={owesParts.lead}
                fraction={`${owesParts.fraction}${owesParts.trail}`}
                accessibilityLabel={`${t.company.companyOwesAll}: ${fmt(summary.companyOwes)}`}
                caption={
                  summary.employeesOwe > 0n
                    ? fill(t.company.employeesOweAll, { amount: fmt(summary.employeesOwe) })
                    : undefined
                }
              />
              {awaiting.length > 0 ? (
                <View style={{ gap: theme.spacing.md }}>
                  <SectionHeader title={t.company.pendingApprovals} />
                  <StandardCard>
                    {awaiting.map((entry, index) => {
                      const owner = live.find((member) => member.id === entry.memberId);
                      return (
                        <ListRow
                          key={entry.id}
                          title={`${owner ? displayName(owner, null, null, t.misc.someone) : t.misc.someone} · ${kindLabel(t, entry)}`}
                          subtitle={t.company.awaiting}
                          amount={fmt(entry.amount)}
                          onPress={() =>
                            router.push(`/group/${groupId}/company-entry-view?entry=${entry.id}`)
                          }
                          divider={index < awaiting.length - 1}
                        />
                      );
                    })}
                  </StandardCard>
                </View>
              ) : null}
              <StandardCard>
                {[
                  [t.company.expenses, summary.totals.expenses],
                  [t.company.bata, summary.totals.allowance],
                  [t.company.advances, summary.totals.advances],
                  [t.company.wages, summary.totals.wages],
                  [t.company.paidOut, summary.totals.paidOut],
                ]
                  .filter(([, value]) => (value as bigint) !== 0n)
                  .map(([label, value], index, all) => (
                    <ListRow
                      key={String(label)}
                      title={String(label)}
                      amount={fmt(value as bigint)}
                      divider={index < all.length - 1}
                    />
                  ))}
              </StandardCard>
              {categories.length > 0 ? (
                <View style={{ gap: theme.spacing.md }}>
                  <SectionHeader title={t.company.byCategory} />
                  <StandardCard>
                    {categories.map(([key, value], index) => (
                      <ListRow
                        key={key}
                        title={catLabel(key)}
                        amount={fmt(value)}
                        divider={index < categories.length - 1}
                      />
                    ))}
                  </StandardCard>
                </View>
              ) : null}
              <View style={{ gap: theme.spacing.md }}>
                <SectionHeader title={t.company.employees} />
                <StandardCard>
                  {live.map((member) => {
                    const row = summary.rows.find((r) => r.memberId === member.id);
                    const net = row?.statement.closing ?? 0n;
                    return (
                      <ListRow
                        key={member.id}
                        leading={
                          <PersonAvatar
                            member={member}
                            name={displayName(member)}
                            ghost={isGhost(member)}
                            size={36}
                          />
                        }
                        title={displayName(member, null, null, t.misc.someone)}
                        subtitle={
                          net === 0n ? undefined : net > 0n ? t.company.owedTo : t.company.owedBy
                        }
                        amount={net === 0n ? t.company.settled : fmt(net < 0n ? -net : net)}
                        onPress={() =>
                          router.push(`/group/${groupId}/company-statement?member=${member.id}`)
                        }
                        divider
                      />
                    );
                  })}
                  <ListRow
                    title={t.company.approvalsTitle}
                    subtitle={t.company.approvalsHint}
                    subtitleLines={3}
                    trailing={
                      <Toggle
                        value={view.approvalsEnabled}
                        onValueChange={(next) => settings.mutate({ approvalsEnabled: next })}
                        accessibilityLabel={t.company.approvalsTitle}
                      />
                    }
                    divider
                  />
                  <ListRow
                    title={t.company.exportAction}
                    leading={
                      <Ionicons
                        name="download-outline"
                        size={iconSize.md}
                        color={theme.color.brand}
                      />
                    }
                    onPress={() => router.push(`/group/${groupId}/export`)}
                    divider
                  />
                  <ListRow
                    title={t.company.invite}
                    leading={
                      <Ionicons
                        name="person-add-outline"
                        size={iconSize.md}
                        color={theme.color.brand}
                      />
                    }
                    onPress={() => router.push(`/group/${groupId}/invite`)}
                  />
                </StandardCard>
                {live.length <= 1 ? (
                  <Text variant="caption" tone="muted">
                    {t.company.noEmployees}
                  </Text>
                ) : null}
              </View>
            </>
          ) : (
            <>
              <CompanyStatementView
                view={view}
                member={view.me}
                period={period}
                groupId={groupId}
              />
              <Button
                label={t.company.exportAction}
                variant="secondary"
                onPress={() => router.push(`/group/${groupId}/export`)}
              />
            </>
          )}
        </ScenicBody>
      </ScrollView>
    </Screen>
  );
}
