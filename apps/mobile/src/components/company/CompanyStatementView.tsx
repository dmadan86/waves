/**
 * One employee's statement: the headline balance, the totals and the entries for
 * a period. Used by the employee's own home and by an admin opening an employee.
 * All of it is computed from the rows this viewer can read (see `data/companyEntries`),
 * so it can never show more than the server allowed.
 */

import { useMemo, useState } from 'react';
import { Share, View } from 'react-native';

import {
  companyStatement,
  format,
  formatCompanyStatement,
  formatMinorInput,
  formatParts,
  money,
  parseMinorInput,
  type CompanyEntry,
  type CurrencyCode,
} from '@waves/core';
import { Button, Text, useTheme } from '@waves/ui';

import { EditTextSheet } from '@/components/EditTextSheet';
import {
  ListRow,
  SectionHeader,
  SegmentedPills,
  StandardCard,
  StatCard,
} from '@/components/standard';
import { useSetCompanyRate, useVoidCompanyEntry, type CompanyView } from '@/data/companyEntries';
import { todayIso } from '@/data/personal';
import { displayName, type MemberRow } from '@/data/types';
import { fill, useStrings, type UiStrings } from '@/i18n';
import { periodRange, type CompanyPeriod } from '@/lib/companyPeriod';
import { useDialog } from '@/lib/dialog';
import { friendlyError } from '@/lib/errors';
import { showDate } from '@/lib/expenseDay';

export function kindLabel(t: UiStrings, entry: CompanyEntry): string {
  const c = t.company;
  switch (entry.kind) {
    case 'expense':
      return c[
        (
          {
            fuel: 'catFuel',
            transport: 'catTransport',
            travel: 'catTravel',
            food: 'catFood',
            office: 'catOffice',
          } as const
        )[entry.category as 'fuel'] ?? 'catOther'
      ];
    case 'allowance':
      return c.bata;
    case 'advance':
      return c.kAdvance;
    case 'wages':
      return c.kWages;
    case 'reimbursement':
      return entry.direction === 'employee_to_company' ? c.kCashReturned : c.kReimbursement;
  }
}

export function CompanyPeriodPills({
  value,
  onChange,
}: {
  value: CompanyPeriod;
  onChange: (next: CompanyPeriod) => void;
}) {
  const { t } = useStrings();
  return (
    <SegmentedPills
      options={[
        { value: 'month', label: t.company.periodMonth },
        { value: 'last', label: t.company.periodLast },
        { value: 'all', label: t.company.periodAll },
      ]}
      value={value}
      onChange={onChange}
    />
  );
}

export function CompanyStatementView({
  view,
  member,
  period,
  groupId,
}: {
  view: CompanyView;
  member: MemberRow;
  period: CompanyPeriod;
  groupId: string;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const { confirm } = useDialog();
  const voidEntry = useVoidCompanyEntry(groupId);
  const setRate = useSetCompanyRate(groupId);
  const [rateOpen, setRateOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currency = view.currency as CurrencyCode;
  const mine = view.me?.id === member.id;
  const name = mine ? '' : displayName(member, null, null, t.misc.someone);

  const statement = useMemo(() => {
    const { from, to } = periodRange(period, todayIso());
    return companyStatement(view.entries, { memberId: member.id, from, to });
  }, [view.entries, member.id, period]);

  const fmt = (minor: bigint): string => format(money(minor, currency), { locale });
  const abs = statement.closing < 0n ? -statement.closing : statement.closing;
  const parts = formatParts({ minor: abs, currency }, { locale });
  const sideText =
    statement.side === 'settled'
      ? t.company.settled
      : statement.side === 'company_owes'
        ? mine
          ? t.company.companyOwesYou
          : fill(t.company.companyOwesName, { name })
        : mine
          ? t.company.youOweCompany
          : fill(t.company.nameOwesCompany, { name });

  const totals = statement.totals;
  const totalRows: [string, bigint][] = [
    [t.company.expenses, totals.expenses],
    [t.company.bata, totals.allowance],
    [t.company.advances, totals.advances],
    [t.company.wages, totals.wages],
    [t.company.paidOut, totals.paidOut],
    [t.company.returned, totals.returned],
  ];

  const remove = async (entry: CompanyEntry): Promise<void> => {
    // An employee may only withdraw their own expense or bata; an admin anything.
    const allowed =
      view.isAdmin ||
      (mine &&
        entry.createdBy === view.me?.id &&
        (entry.kind === 'expense' || entry.kind === 'allowance'));
    if (!allowed) return;
    const ok = await confirm({
      title: t.company.removeTitle,
      body: t.company.removeBody,
      confirmLabel: t.company.removeEntry,
      tone: 'danger',
    });
    if (!ok) return;
    setError(null);
    try {
      await voidEntry.mutateAsync({ entryId: entry.id });
    } catch (caught) {
      setError(friendlyError(caught, t.company.couldNotSave, 'company.void'));
    }
  };

  const share = (): void => {
    void Share.share({
      message: formatCompanyStatement(statement, {
        company: view.name,
        employee: displayName(member, null, null, t.misc.someone),
        money: fmt,
      }),
    });
  };

  const rate = member.daily_rate_minor ? BigInt(member.daily_rate_minor) : null;
  const entryRows = [...statement.rows].reverse();

  return (
    <>
      <StatCard
        label={t.company.balance}
        lead={parts.lead}
        fraction={`${parts.fraction}${parts.trail}`}
        accessibilityLabel={`${t.company.balance}: ${fmt(abs)}`}
        caption={sideText}
      />
      {error ? (
        <Text variant="caption" tone="negative">
          {error}
        </Text>
      ) : null}

      <StandardCard>
        {statement.opening !== 0n ? (
          <ListRow
            title={t.company.brought}
            amount={`${statement.opening < 0n ? '-' : ''}${fmt(statement.opening < 0n ? -statement.opening : statement.opening)}`}
            divider
          />
        ) : null}
        {totalRows
          .filter(([, value]) => value !== 0n)
          .map(([label, value], index, all) => (
            <ListRow
              key={label}
              title={label}
              amount={fmt(value)}
              divider={index < all.length - 1}
            />
          ))}
        {totalRows.every(([, value]) => value === 0n) && statement.opening === 0n ? (
          <Text variant="caption" tone="muted">
            {t.company.none}
          </Text>
        ) : null}
      </StandardCard>

      {view.isAdmin ? (
        <StandardCard>
          <ListRow
            title={t.company.dailyRate}
            amount={rate !== null ? fmt(rate) : t.company.rateNotSet}
            onPress={() => setRateOpen(true)}
          />
        </StandardCard>
      ) : null}

      {entryRows.length > 0 ? (
        <View style={{ gap: theme.spacing.md }}>
          <SectionHeader title={t.company.entries} />
          <StandardCard>
            {entryRows.map(({ entry, delta }, index) => (
              <ListRow
                key={entry.id}
                title={kindLabel(t, entry)}
                subtitle={[
                  showDate(entry.occurredOn, locale),
                  entry.calcMode === 'days_rate' && entry.days && entry.rateMinor !== null
                    ? fill(t.company.daysAt, { days: entry.days, rate: fmt(entry.rateMinor) })
                    : null,
                  entry.note,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                subtitleLines={2}
                amount={`${entry.kind === 'wages' ? '' : delta < 0n ? '-' : '+'}${fmt(entry.amount)}`}
                onPress={() => void remove(entry)}
                divider={index < entryRows.length - 1}
              />
            ))}
          </StandardCard>
        </View>
      ) : null}

      {statement.pending.length > 0 ? (
        <View style={{ gap: theme.spacing.md }}>
          <SectionHeader title={t.company.pending} />
          <StandardCard>
            {statement.pending.map((entry, index) => (
              <ListRow
                key={entry.id}
                title={kindLabel(t, entry)}
                subtitle={
                  entry.status === 'rejected'
                    ? t.company.rejected
                    : showDate(entry.occurredOn, locale)
                }
                amount={fmt(entry.amount)}
                divider={index < statement.pending.length - 1}
              />
            ))}
          </StandardCard>
        </View>
      ) : null}

      {statement.rows.length > 0 ? (
        <Button label={t.company.share} variant="secondary" onPress={share} />
      ) : null}
      <Text variant="micro" tone="muted" align="center">
        {view.isAdmin ? t.company.privacyAdmin : t.company.privacyEmployee}
      </Text>

      <EditTextSheet
        visible={rateOpen}
        title={t.company.rateTitle}
        hint={fill(t.company.rateHint, { name: displayName(member, null, null, t.misc.someone) })}
        value={rate !== null ? formatMinorInput(rate, currency) : ''}
        autoCapitalize="none"
        saving={setRate.isPending}
        onClose={() => setRateOpen(false)}
        onSave={(text) => {
          const minor = parseMinorInput(text, currency);
          setRateOpen(false);
          setRate
            .mutateAsync({
              memberId: member.id,
              dailyRateMinor: minor > 0n ? minor.toString() : null,
            })
            .catch((caught) =>
              setError(friendlyError(caught, t.company.couldNotSave, 'company.rate')),
            );
        }}
      />
    </>
  );
}
