/**
 * Owner's company rules in one card: approvals on/off, the default daily rate, the per-km
 * rate and the policy limits. The rate is also asked in context at the first wage run;
 * these rows are where it is changed later.
 */

import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';

import { formatMinorInput, parseMinorInput, type CurrencyCode } from '@waves/core';
import { View } from 'react-native';

import { Text, Toggle, directionalIcon, iconSize, useTheme } from '@waves/ui';

import { CompanyPolicyEditor } from '@/components/company/CompanyPolicyEditor';
import { useMoney } from '@/components/company/dashboard/parts';
import { EditTextSheet } from '@/components/EditTextSheet';
import { ListRow, StandardCard } from '@/components/standard';
import {
  useSetCompanySettings,
  useSetMileageRate,
  useSetSecondApproval,
  type CompanyView,
} from '@/data/companyEntries';
import { useCalendarSettings, useSetCalendarSettings } from '@/data/companyCalendar';
import { useStrings } from '@/i18n';

export function CompanyRules({ groupId, view }: { groupId: string; view: CompanyView }) {
  const theme = useTheme();
  const { t } = useStrings();
  const fmt = useMoney(view.currency);
  const settings = useSetCompanySettings(groupId);
  const setKm = useSetMileageRate(groupId);
  const setSecond = useSetSecondApproval(groupId);
  const calendarSettings = useCalendarSettings(groupId);
  const setCalendarSettings = useSetCalendarSettings(groupId);
  const [limit, setLimitOpen] = useState(false);
  const [policies, setPolicies] = useState(false);
  const [km, setKmOpen] = useState(false);
  const [rate, setRateOpen] = useState(false);
  const currency = view.currency as CurrencyCode;
  if (!view.isOwner) return null;
  // Only offered when it can apply: approvals are on and there is a second owner to ask.
  const ownerCount = view.members.filter((m) => m.role === 'admin' && !m.left_at).length;
  const secondOn = view.secondApproval;
  const thresholdMinor = view.secondApprovalThresholdMinor;
  const lead = (name: keyof typeof Ionicons.glyphMap) => (
    <Ionicons name={name} size={iconSize.lg} color={theme.color.textMuted} />
  );
  return (
    <>
      <StandardCard style={{ paddingHorizontal: 14, paddingVertical: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <Ionicons name="settings-outline" size={iconSize.lg} color={theme.color.text} />
          <Text variant="title" style={{ fontSize: 16 }}>
            {t.company.paymentSettings}
          </Text>
        </View>
        <ListRow
          leading={lead('shield-checkmark-outline')}
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
        {view.approvalsEnabled && ownerCount > 1 ? (
          <>
            <ListRow
              leading={lead('people-outline')}
              title={t.company.secondOwnerTitle}
              subtitle={t.company.secondOwnerHint}
              subtitleLines={3}
              trailing={
                <Toggle
                  value={secondOn}
                  onValueChange={(next) =>
                    setSecond.mutate({
                      enabled: next,
                      thresholdMinor: thresholdMinor?.toString() ?? null,
                    })
                  }
                  accessibilityLabel={t.company.secondOwnerTitle}
                />
              }
              divider
            />
            {secondOn ? (
              <ListRow
                leading={lead('trending-up-outline')}
                title={t.company.secondOwnerFrom}
                subtitle={t.company.secondOwnerFromHint}
                subtitleLines={2}
                amount={thresholdMinor !== null ? fmt(thresholdMinor) : t.company.rateNotSet}
                onPress={() => setLimitOpen(true)}
                divider
              />
            ) : null}
          </>
        ) : null}
        <ListRow
          leading={lead('sunny-outline')}
          title={t.calendar.paidHolidays}
          subtitle={t.calendar.paidHolidaysHint}
          subtitleLines={2}
          trailing={
            <Toggle
              value={calendarSettings.paidHolidays}
              onValueChange={(paidHolidays) =>
                setCalendarSettings.mutate({ paidHolidays, paidLeave: calendarSettings.paidLeave })
              }
              accessibilityLabel={t.calendar.paidHolidays}
            />
          }
          divider
        />
        <ListRow
          leading={lead('medical-outline')}
          title={t.calendar.paidLeave}
          subtitle={t.calendar.paidLeaveHint}
          subtitleLines={2}
          trailing={
            <Toggle
              value={calendarSettings.paidLeave}
              onValueChange={(paidLeave) =>
                setCalendarSettings.mutate({
                  paidHolidays: calendarSettings.paidHolidays,
                  paidLeave,
                })
              }
              accessibilityLabel={t.calendar.paidLeave}
            />
          }
          divider
        />
        <ListRow
          leading={lead('calendar-outline')}
          title={t.company.dailyRate}
          subtitle={t.company.dailyRateHint}
          subtitleLines={2}
          amount={
            view.defaultRateMinor !== null ? fmt(view.defaultRateMinor) : t.company.rateNotSet
          }
          onPress={() => setRateOpen(true)}
          divider
        />
        <ListRow
          leading={lead('car-outline')}
          title={t.company.mileageRate}
          subtitle={t.company.mileageRateHint}
          subtitleLines={2}
          amount={
            view.defaultMileageRateMinor !== null
              ? fmt(view.defaultMileageRateMinor)
              : t.company.rateNotSet
          }
          onPress={() => setKmOpen(true)}
          divider
        />
        <ListRow
          leading={lead('document-text-outline')}
          title={t.company.policiesTitle}
          subtitle={t.company.policiesHint}
          amount={`${view.policies.rules.length}`}
          trailing={
            <Ionicons
              name={policies ? 'chevron-up' : directionalIcon('chevron-forward')}
              size={iconSize.sm}
              color={theme.color.textFaint}
            />
          }
          onPress={() => setPolicies((open) => !open)}
        />
        {policies ? <CompanyPolicyEditor groupId={groupId} view={view} /> : null}
      </StandardCard>
      <EditTextSheet
        visible={rate}
        title={t.company.dailyRate}
        value={
          view.defaultRateMinor !== null ? formatMinorInput(view.defaultRateMinor, currency) : ''
        }
        autoCapitalize="none"
        saving={settings.isPending}
        onClose={() => setRateOpen(false)}
        onSave={(text) => {
          setRateOpen(false);
          settings.mutate({
            defaultDailyRateMinor:
              text.trim() === '' ? null : parseMinorInput(text, currency).toString(),
          });
        }}
      />
      <EditTextSheet
        visible={limit}
        title={t.company.secondOwnerFrom}
        value={thresholdMinor !== null ? formatMinorInput(thresholdMinor, currency) : ''}
        autoCapitalize="none"
        saving={setSecond.isPending}
        onClose={() => setLimitOpen(false)}
        onSave={(text) => {
          setLimitOpen(false);
          // Empty = only claims an owner raised themselves need the second owner.
          setSecond.mutate({
            enabled: true,
            thresholdMinor: text.trim() === '' ? null : parseMinorInput(text, currency).toString(),
          });
        }}
      />
      <EditTextSheet
        visible={km}
        title={t.company.mileageRate}
        value={
          view.defaultMileageRateMinor !== null
            ? formatMinorInput(view.defaultMileageRateMinor, currency)
            : ''
        }
        autoCapitalize="none"
        saving={setKm.isPending}
        onClose={() => setKmOpen(false)}
        onSave={(text) => {
          setKmOpen(false);
          // Empty clears the rate; an explicit 0 is a real rate.
          setKm.mutate({
            memberId: null,
            rateMinor: text.trim() === '' ? null : parseMinorInput(text, currency).toString(),
          });
        }}
      />
    </>
  );
}
