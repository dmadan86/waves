/**
 * Owner's company rules in one card: approvals on/off, the default daily rate, the per-km
 * rate and the policy limits. The rate is also asked in context at the first wage run;
 * these rows are where it is changed later.
 */

import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';

import { formatMinorInput, parseMinorInput, type CurrencyCode } from '@waves/core';
import { Toggle, iconSize, useTheme } from '@waves/ui';

import { CompanyPolicyEditor } from '@/components/company/CompanyPolicyEditor';
import { useMoney } from '@/components/company/dashboard/parts';
import { EditTextSheet } from '@/components/EditTextSheet';
import { ListRow, StandardCard } from '@/components/standard';
import { useSetCompanySettings, useSetMileageRate, type CompanyView } from '@/data/companyEntries';
import { useStrings } from '@/i18n';

export function CompanyRules({ groupId, view }: { groupId: string; view: CompanyView }) {
  const theme = useTheme();
  const { t } = useStrings();
  const fmt = useMoney(view.currency);
  const settings = useSetCompanySettings(groupId);
  const setKm = useSetMileageRate(groupId);
  const [policies, setPolicies] = useState(false);
  const [km, setKmOpen] = useState(false);
  const [rate, setRateOpen] = useState(false);
  const currency = view.currency as CurrencyCode;
  if (!view.isOwner) return null;
  return (
    <>
      <StandardCard>
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
            view.defaultRateMinor !== null ? fmt(view.defaultRateMinor) : t.company.rateNotSet
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
              name={policies ? 'chevron-up' : 'chevron-down'}
              size={iconSize.md}
              color={theme.color.textMuted}
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
