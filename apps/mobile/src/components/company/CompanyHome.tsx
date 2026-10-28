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
  money,
  parseMinorInput,
  type CurrencyCode,
} from '@waves/core';
import { Screen, Text, Toggle, iconSize, useTheme } from '@waves/ui';

import { CompanyStatementView, kindLabel } from '@/components/company/CompanyStatementView';
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
} from '@/components/standard';
import { useCompanyTags } from '@/data/companyTags';
import {
  useCompanyEntries,
  useCompanyProjects,
  useSetCompanySettings,
  useSetMileageRate,
} from '@/data/companyEntries';
import { displayName, isGhost } from '@/data/types';
import { fill, useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';
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
  const [moreOpen, setMoreOpen] = useState(false);
  const [policiesOpen, setPoliciesOpen] = useState(false);
  const [kmOpen, setKmOpen] = useState(false);
  const [rateOpen, setRateOpen] = useState(false);
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
  const summary = useMemo(
    () => companySummary(view.entries, { from: '0000-01-01', to: '9999-12-31' }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view.entries, view.members],
  );

  const plus = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t.company.addEntry}
      onPress={() => router.push(`/group/${groupId}/company-entry`)}
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
  );

  // "Kumar has Rs 2,000 of yours" / "You owe Kumar Rs 500": a person's balance in words.
  const words = (memberId: string, name: string): string | undefined => {
    const net = summary.rows.find((r) => r.memberId === memberId)?.statement.closing ?? 0n;
    if (net === 0n) return undefined;
    return net > 0n
      ? fill(t.company.youOweName, { name, amount: fmt(net) })
      : fill(t.company.hasOfYours, { name, amount: fmt(-net) });
  };

  return (
    <Screen edges={[]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: clearance + 80 }}
        showsVerticalScrollIndicator={false}
      >
        <ScenicHeader
          title={view.name || t.extras.typeCompany}
          subtitle={view.isAdmin ? undefined : t.company.myStatement}
          action={
            view.isOwner ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t.group.settings}
                onPress={() => router.push(`/group/${groupId}/settings`)}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="settings-outline" size={iconSize.lg} color="#FFFFFF" />
              </Pressable>
            ) : undefined
          }
        />
        <ScenicBody>
          {!view.ready || !view.me ? null : view.isAdmin ? (
            <>
              {view.isManager ? <ManagerCashCard groupId={groupId} view={view} /> : null}
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
              <CompanySites groupId={groupId} view={view} />
              <StandardCard>
                {live.map((member, index) => {
                  const name = displayName(member, null, null, t.misc.someone);
                  return (
                    <ListRow
                      key={member.id}
                      leading={
                        <PersonAvatar
                          member={member}
                          name={displayName(member)}
                          ghost={isGhost(member)}
                          size={44}
                        />
                      }
                      title={name}
                      subtitle={words(member.id, name) ?? t.company.settled}
                      subtitleLines={2}
                      onPress={() =>
                        router.push(`/group/${groupId}/company-statement?member=${member.id}`)
                      }
                      divider={index < live.length - 1}
                    />
                  );
                })}
                <ListRow
                  title={t.company.addPerson}
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
                <Text variant="body" tone="muted">
                  {view.entries.length === 0 ? t.company.welcomeAdmin : t.company.noEmployees}
                </Text>
              ) : null}
              <ListRow
                title={t.company.moreOptions}
                trailing={
                  <Ionicons
                    name={moreOpen ? 'chevron-up' : 'chevron-down'}
                    size={iconSize.md}
                    color={theme.color.textMuted}
                  />
                }
                onPress={() => setMoreOpen((open) => !open)}
              />
              {moreOpen ? (
                <StandardCard>
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
                        title={t.company.dailyRate}
                        amount={
                          view.defaultRateMinor !== null
                            ? fmt(view.defaultRateMinor)
                            : t.company.rateNotSet
                        }
                        onPress={() => setRateOpen(true)}
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
                  />
                </StandardCard>
              ) : null}
            </>
          ) : (
            <>
              {view.entries.length === 0 ? (
                <Text variant="body" tone="muted">
                  {t.company.welcomeEmployee}
                </Text>
              ) : null}
              <CompanyStatementView view={view} member={view.me} period="all" groupId={groupId} />
            </>
          )}
        </ScenicBody>
      </ScrollView>
      {view.me ? plus : null}
      {addSite.sheet}
      <EditTextSheet
        visible={rateOpen}
        title={t.company.dailyRate}
        value={
          view.defaultRateMinor !== null ? formatMinorInput(view.defaultRateMinor, currency) : ''
        }
        autoCapitalize="none"
        saving={settings.isPending}
        onClose={() => setRateOpen(false)}
        onSave={(text) => {
          const minor = parseMinorInput(text, currency);
          setRateOpen(false);
          settings.mutate({ defaultDailyRateMinor: text.trim() === '' ? null : minor.toString() });
        }}
      />
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
