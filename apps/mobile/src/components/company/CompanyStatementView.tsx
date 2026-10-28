/**
 * One employee's statement: the headline balance, the totals and the entries for
 * a period. Used by the employee's own home and by an admin opening an employee.
 * All of it is computed from the rows this viewer can read (see `data/companyEntries`),
 * so it can never show more than the server allowed.
 */

import { useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { randomUUID } from 'expo-crypto';
import { Platform, Share, View } from 'react-native';

import {
  buildReimbursementPreview,
  companyStatement,
  flagsForEntry,
  isReimbursable,
  reimbursedOn,
  reimbursementOutcome,
  format,
  formatCompanyStatement,
  formatMinorInput,
  formatParts,
  money,
  parseMinorInput,
  type CompanyEntry,
  type CurrencyCode,
} from '@waves/core';
import { Button, Text, iconSize, useTheme } from '@waves/ui';

import { EditTextSheet } from '@/components/EditTextSheet';
import {
  ListRow,
  SectionHeader,
  PillButton,
  SegmentedPills,
  StandardCard,
  StatCard,
} from '@/components/standard';
import {
  useReimburseCompany,
  useSetCompanyRate,
  useSetMileageRate,
  type CompanyView,
} from '@/data/companyEntries';
import { todayIso } from '@/data/personal';
import { displayName, type MemberRow } from '@/data/types';
import { fill, useStrings, type UiStrings } from '@/i18n';
import { periodRange, type CompanyPeriod } from '@/lib/companyPeriod';
import { friendlyError } from '@/lib/errors';
import { dateFrom, isoDate, showDate } from '@/lib/expenseDay';
import { router } from '@/lib/navigation';

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
  const setRate = useSetCompanyRate(groupId);
  const setKmRate = useSetMileageRate(groupId);
  const reimburse = useReimburseCompany(groupId);
  const [rateOpen, setRateOpen] = useState(false);
  const [kmOpen, setKmOpen] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  // Set when picked by date: every claim and credit through it is frozen into the payment.
  const [through, setThrough] = useState<string | null>(null);
  const [pickingDate, setPickingDate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastPay, setLastPay] = useState<{ reimbursementId: string; claimIds: string[] } | null>(
    null,
  );
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

  const open = (entry: CompanyEntry): void =>
    router.push(`/group/${groupId}/company-entry-view?entry=${entry.id}`);

  const share = (): void => {
    void Share.share({
      message: formatCompanyStatement(statement, {
        company: view.name,
        employee: displayName(member, null, null, t.misc.someone),
        money: fmt,
      }),
    });
  };

  // Claims an admin can pay now: approved, unpaid, and already on the server (a version to name).
  const due = view.isAdmin
    ? view.entries
        .filter((e) => e.memberId === member.id && isReimbursable(e) && !e.pending)
        .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn))
    : [];
  const preview = buildReimbursementPreview(view.entries, {
    memberId: member.id,
    ids: [...picked],
    ...(through ? { through } : {}),
  });
  const toggle = (id: string): void => {
    setThrough(null);
    setPicked((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  };
  const pickThrough = (date: string): void => {
    setThrough(date);
    setPicked(new Set(due.filter((e) => e.occurredOn <= date).map((e) => e.id)));
  };
  const openThrough = (): void => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: new Date(),
        mode: 'date',
        onChange: (event, date) => {
          if (event.type === 'set' && date) pickThrough(isoDate(date));
        },
      });
    } else setPickingDate((open) => !open);
  };
  // Unsynced credits have no server version to name yet: wait for them.
  const canPay =
    preview.claims.length > 0 &&
    preview.payoutMinor >= 0n &&
    !reimburse.isPending &&
    !preview.adjustments.some((e) => e.pending);
  const pay = async (): Promise<void> => {
    setError(null);
    const versioned = (rows: readonly CompanyEntry[]) =>
      rows.map((e) => ({ entryId: e.id, expectedVersion: e.version }));
    try {
      const reimbursementId = randomUUID();
      await reimburse.mutateAsync({
        reimbursementId,
        memberId: member.id,
        claims: versioned(preview.claims),
        adjustments: versioned(preview.adjustments),
        cutoff: preview.cutoff,
        paidOn: todayIso(),
        expectedAmountMinor: preview.payoutMinor.toString(),
        note: null,
      });
      setLastPay({ reimbursementId, claimIds: preview.claims.map((e) => e.id) });
      setSelecting(false);
      setPicked(new Set());
      setThrough(null);
    } catch (caught) {
      setError(friendlyError(caught, t.company.couldNotSave, 'company.reimburse'));
    }
  };

  // The server pays what is still due; claims another admin paid first read as a calm note.
  const alreadyPaid = useMemo(() => {
    const outcome = lastPay ? reimbursementOutcome(view.entries, lastPay) : null;
    return (outcome?.alreadyPaid ?? [])
      .filter((a) => a.by)
      .map((a) => {
        const payer = view.members.find((m) => m.id === a.by);
        const who = payer ? displayName(payer, null, null, t.misc.someone) : t.misc.someone;
        return a.count === 1
          ? fill(t.company.payAlreadyOne, { name: who })
          : fill(t.company.payAlreadyMany, { count: a.count, name: who });
      });
  }, [lastPay, view.entries, view.members, t]);

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

      {alreadyPaid.map((line) => (
        <Text key={line} variant="caption" tone="muted">
          {line}
        </Text>
      ))}

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
            divider
          />
          <ListRow
            title={t.company.mileageRate}
            amount={
              member.mileage_rate_minor
                ? fmt(BigInt(member.mileage_rate_minor))
                : view.defaultMileageRateMinor !== null
                  ? fmt(view.defaultMileageRateMinor)
                  : t.company.rateNotSet
            }
            onPress={() => setKmOpen(true)}
          />
        </StandardCard>
      ) : null}

      {view.isAdmin && due.length > 0 ? (
        <View style={{ gap: theme.spacing.md }}>
          <SectionHeader title={t.company.payTitle} />
          <StandardCard style={{ gap: theme.spacing.sm }}>
            <View style={{ flexDirection: 'row', gap: theme.spacing.sm, flexWrap: 'wrap' }}>
              <PillButton
                label={selecting ? t.cancel : t.company.select}
                icon={selecting ? 'close-outline' : 'checkbox-outline'}
                chevron={false}
                onPress={() => {
                  setSelecting((on) => !on);
                  setPicked(new Set());
                  setThrough(null);
                }}
              />
              {selecting ? (
                <PillButton
                  label={t.company.selectAllDue}
                  icon="calendar-outline"
                  chevron={false}
                  onPress={openThrough}
                />
              ) : null}
            </View>
            {selecting && Platform.OS === 'ios' && pickingDate ? (
              <DateTimePicker
                value={dateFrom(todayIso())}
                mode="date"
                display="inline"
                onChange={(event, date) => {
                  if (event.type !== 'dismissed' && date) pickThrough(isoDate(date));
                }}
              />
            ) : null}
            {selecting
              ? due.map((e) => (
                  <ListRow
                    key={e.id}
                    leading={
                      <Ionicons
                        name={picked.has(e.id) ? 'checkbox' : 'square-outline'}
                        size={iconSize.md}
                        color={theme.color.brand}
                      />
                    }
                    title={kindLabel(t, e)}
                    subtitle={showDate(e.occurredOn, locale)}
                    amount={fmt(e.amount)}
                    onPress={() => toggle(e.id)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: picked.has(e.id) }}
                    divider
                  />
                ))
              : null}
            {selecting && picked.size > 0 ? (
              <>
                <Text variant="caption" tone="muted">
                  {[
                    fill(t.company.payCount, { count: String(preview.claims.length) }),
                    preview.creditsMinor !== 0n
                      ? fill(t.company.payCredits, { amount: fmt(preview.creditsMinor) })
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
                {preview.payoutMinor < 0n ? (
                  <Text variant="caption" tone="negative">
                    {t.company.payNeedMore}
                  </Text>
                ) : null}
                <Button
                  label={fill(t.company.payTotal, {
                    amount: fmt(preview.payoutMinor < 0n ? 0n : preview.payoutMinor),
                  })}
                  fullWidth
                  disabled={!canPay}
                  onPress={() => void pay()}
                />
                <Text variant="micro" tone="muted" align="center">
                  {t.company.payExternal}
                </Text>
              </>
            ) : null}
          </StandardCard>
        </View>
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
                  entry.calcMode === 'distance_rate' && entry.distanceKm && entry.rateMinor !== null
                    ? fill(t.company.mileageAt, {
                        km: entry.distanceKm,
                        rate: fmt(entry.rateMinor),
                      })
                    : null,
                  entry.vendor,
                  reimbursedOn(entry, view.entries)
                    ? fill(t.company.reimbursedOn, {
                        date: showDate(reimbursedOn(entry, view.entries) ?? '', locale),
                      })
                    : null,
                  view.isAdmin &&
                  flagsForEntry(entry, view.entries, view.policies, view.receiptEntryIds).length > 0
                    ? `! ${t.company.policyFlagged}`
                    : null,
                  entry.note,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                subtitleLines={2}
                amount={`${entry.kind === 'wages' ? '' : delta < 0n ? '-' : '+'}${fmt(entry.amount)}`}
                onPress={() => open(entry)}
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
                subtitle={[
                  entry.status === 'rejected' ? t.company.rejected : t.company.awaiting,
                  showDate(entry.occurredOn, locale),
                  entry.status === 'rejected' ? entry.reviewNote : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                subtitleLines={2}
                amount={fmt(entry.amount)}
                onPress={() => open(entry)}
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
        visible={kmOpen}
        title={t.company.mileageRate}
        hint={fill(t.company.rateHint, { name: displayName(member, null, null, t.misc.someone) })}
        value={
          member.mileage_rate_minor
            ? formatMinorInput(BigInt(member.mileage_rate_minor), currency)
            : ''
        }
        autoCapitalize="none"
        saving={setKmRate.isPending}
        onClose={() => setKmOpen(false)}
        onSave={(text) => {
          const minor = parseMinorInput(text, currency);
          setKmOpen(false);
          setKmRate
            .mutateAsync({
              memberId: member.id,
              rateMinor: text.trim() === '' ? null : minor.toString(),
            })
            .catch((caught) =>
              setError(friendlyError(caught, t.company.couldNotSave, 'company.mileage')),
            );
        }}
      />
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
