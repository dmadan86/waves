/**
 * What opening a Company group shows. An employee lands on their own statement; an
 * admin lands on the company summary — what is owed each way, the totals for the
 * period, and each employee one tap from their statement.
 */

import { useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, View } from 'react-native';

import {
  companySummary,
  flagsForEntry,
  format,
  formatMinorInput,
  formatParts,
  money,
  parseMinorInput,
  type CurrencyCode,
} from '@waves/core';
import { Button, Screen, Text, Toggle, iconSize, useTheme } from '@waves/ui';

import {
  CompanyPeriodPills,
  CompanyStatementView,
  kindLabel,
} from '@/components/company/CompanyStatementView';
import { ManagerCashCard, OwnerCashList } from '@/components/company/CompanyCash';
import { CompanyPolicyEditor } from '@/components/company/CompanyPolicyEditor';
import { CompanySites, useAddSiteSheet } from '@/components/company/CompanySites';
import { EditTextSheet } from '@/components/EditTextSheet';
import { PersonAvatar } from '@/components/PersonAvatar';
import {
  ListRow,
  ScenicBody,
  ScenicHeader,
  SectionHeader,
  StandardCard,
  StatCard,
} from '@/components/standard';
import { useCompanyTags } from '@/data/companyTags';
import {
  useCompanyEntries,
  useCompanyProjects,
  useSetCompanySettings,
  useSetMileageRate,
} from '@/data/companyEntries';
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
  const tagLabel = useCompanyTags(groupId, view).label;
  const settings = useSetCompanySettings(groupId);
  const setKmRate = useSetMileageRate(groupId);
  const addSite = useAddSiteSheet(groupId);
  const hasSites = useCompanyProjects(groupId).length > 0;
  const [policiesOpen, setPoliciesOpen] = useState(false);
  const [kmOpen, setKmOpen] = useState(false);
  const [period, setPeriod] = useState<CompanyPeriod>('month');
  const currency = view.currency as CurrencyCode;
  const fmt = (minor: bigint): string => format(money(minor, currency), { locale });

  const live = view.members.filter((member) => !member.left_at);
  // A manager reviews their team, never their own claim (an owner does that).
  const awaiting = view.entries.filter(
    (entry) =>
      !entry.deleted &&
      entry.status === 'submitted' &&
      (view.isOwner || entry.memberId !== view.me?.id),
  );
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
  const catLabel = tagLabel;

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
              {view.isManager ? <ManagerCashCard groupId={groupId} view={view} /> : null}
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
              <OwnerCashList groupId={groupId} view={view} />
              {awaiting.length > 0 ? (
                <View style={{ gap: theme.spacing.md }}>
                  <SectionHeader title={t.company.pendingApprovals} />
                  <StandardCard>
                    {awaiting.map((entry, index) => {
                      const owner = live.find((member) => member.id === entry.memberId);
                      return (
                        <ListRow
                          key={entry.id}
                          title={`${owner ? displayName(owner, null, null, t.misc.someone) : t.misc.someone} · ${kindLabel(t, entry, tagLabel)}`}
                          subtitle={
                            flagsForEntry(entry, view.entries, view.policies, view.receiptEntryIds)
                              .length > 0
                              ? `${t.company.awaiting} · ! ${t.company.policyFlagged}`
                              : t.company.awaiting
                          }
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
                  [t.company.gstTotal, view.gstEnabled ? summary.totals.gst : 0n],
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
              <CompanySites groupId={groupId} view={view} />
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
                  {view.isOwner ? (
                    <>
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
                    title={t.company.mileageRate}
                    amount={
                      view.defaultMileageRateMinor !== null
                        ? fmt(view.defaultMileageRateMinor)
                        : t.company.rateNotSet
                    }
                    onPress={() => setKmOpen(true)}
                    divider
                  />
                  <ListRow
                    title={t.company.policiesTitle}
                    subtitle={`${view.policies.rules.length}`}
                    trailing={
                      <Ionicons
                        name={policiesOpen ? 'chevron-up' : 'chevron-down'}
                        size={iconSize.md}
                        color={theme.color.textMuted}
                      />
                    }
                    onPress={() => setPoliciesOpen((open) => !open)}
                    divider
                  />
                  {policiesOpen ? <CompanyPolicyEditor groupId={groupId} view={view} /> : null}
                    </>
                  ) : null}
                  {live.some((m) => view.manageableIds.has(m.id)) ? (
                    <ListRow
                      title={t.company.payWages}
                      leading={
                        <Ionicons name="cash-outline" size={iconSize.md} color={theme.color.brand} />
                      }
                      onPress={() => router.push(`/group/${groupId}/company-wages`)}
                      divider
                    />
                  ) : null}
                  {view.isOwner && !hasSites ? (
                    <ListRow
                      title={t.company.addSite}
                      leading={
                        <Ionicons
                          name="location-outline"
                          size={iconSize.md}
                          color={theme.color.brand}
                        />
                      }
                      onPress={addSite.open}
                      divider
                    />
                  ) : null}
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
      {addSite.sheet}
      <EditTextSheet
        visible={kmOpen}
        title={t.company.mileageRate}
        value={
          view.defaultMileageRateMinor !== null
            ? formatMinorInput(view.defaultMileageRateMinor, currency)
            : ''
        }
        autoCapitalize="none"
        saving={setKmRate.isPending}
        onClose={() => setKmOpen(false)}
        onSave={(text) => {
          const minor = parseMinorInput(text, currency);
          setKmOpen(false);
          // Empty clears the rate; an explicit 0 is a real rate.
          setKmRate.mutate({
            memberId: null,
            rateMinor: text.trim() === '' ? null : minor.toString(),
          });
        }}
      />
    </Screen>
  );
}
