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
import { Platform, Pressable, Share, View } from 'react-native';

import {
  buildReimbursementPreview,
  companyStatement,
  isReimbursable,
  reimbursementOutcome,
  format,
  formatCompanyStatement,
  formatParts,
  money,
  type CompanyEntry,
  type CurrencyCode,
} from '@waves/core';
import { Button, Text, iconSize, useTheme } from '@waves/ui';

import { TAG_ICON } from './EntryForm';
import { ActionTile, AmountCard, DueRow, ReadyNote } from './EmployeeDetail';
import { CompanyTeamCard } from './CompanyTeamCard';

import {
  ListRow,
  SectionHeader,
  PillButton,
  SegmentedPills,
  StandardCard,
  StatCard,
} from '@/components/standard';
import { useReimburseCompany, type CompanyView } from '@/data/companyEntries';
import { todayIso } from '@/data/personal';
import { displayName, type MemberRow } from '@/data/types';
import { fill, plural, useStrings, type UiStrings } from '@/i18n';
import { periodRange, type CompanyPeriod } from '@/lib/companyPeriod';
import { useCompanyTags } from '@/data/companyTags';
import { friendlyError } from '@/lib/errors';
import { dateFrom, isoDate, showDate } from '@/lib/expenseDay';
import { router } from '@/lib/navigation';

export function kindLabel(
  t: UiStrings,
  entry: CompanyEntry,
  tagLabel: (key: string) => string,
): string {
  const c = t.company;
  switch (entry.kind) {
    case 'expense':
      return entry.category ? tagLabel(entry.category) : c.catOther;
    case 'allowance':
      return c.bata;
    case 'advance':
      return c.kAdvance;
    case 'wages':
    case 'wage_payment':
      return c.kWages;
    case 'allocation':
      return c.kAllocation;
    case 'pool_return':
      return c.kPoolReturn;
    case 'pool_adjustment':
      return c.kPoolAdjustment;
    case 'pool_request':
      return c.askTitle;
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
  detail = false,
}: {
  view: CompanyView;
  member: MemberRow;
  period: CompanyPeriod;
  groupId: string;
  /** An admin opening an employee: the pay-first layout of the employee screen. */
  detail?: boolean;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const tagLabel = useCompanyTags(groupId, view).label;
  const reimburse = useReimburseCompany(groupId);
  const [selecting, setSelecting] = useState(false);
  const [panel, setPanel] = useState<'history' | 'summary' | null>(null);
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

  const statement = useMemo(() => {
    const { from, to } = periodRange(period, todayIso());
    return companyStatement(view.entries, { memberId: member.id, from, to });
  }, [view.entries, member.id, period]);

  const fmt = (minor: bigint): string => format(money(minor, currency), { locale });
  const abs = statement.closing < 0n ? -statement.closing : statement.closing;
  const parts = formatParts({ minor: abs, currency }, { locale });
  const who = displayName(member, null, null, t.misc.someone);
  const sideText =
    statement.side === 'settled'
      ? t.company.settled
      : statement.side === 'company_owes'
        ? mine
          ? t.company.companyOwesYou
          : fill(t.company.youOweName, { name: who, amount: fmt(abs) })
        : mine
          ? fill(t.company.youHaveOfCompany, { amount: fmt(abs) })
          : fill(t.company.hasOfYours, { name: who, amount: fmt(abs) });

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

  // A chat reads oldest first; unpaid / rejected claims sit in it with a "waiting" mark.
  const bubbles = [
    ...statement.rows.map(({ entry, delta }) => ({ entry, delta })),
    ...statement.pending.map((entry) => ({ entry, delta: 0n })),
  ].sort((a, b) =>
    a.entry.occurredOn === b.entry.occurredOn
      ? a.entry.createdAt.localeCompare(b.entry.createdAt)
      : a.entry.occurredOn.localeCompare(b.entry.occurredOn),
  );

  const history = (
    <View style={{ gap: theme.spacing.sm }}>
      {bubbles.length === 0 ? (
        <Text variant="caption" tone="muted" align="center">
          {t.company.threadEmpty}
        </Text>
      ) : (
        bubbles.map(({ entry }) => (
          <Bubble
            key={entry.id}
            entry={entry}
            label={kindLabel(t, entry, tagLabel)}
            fmt={fmt}
            locale={locale}
            hasPhoto={view.receiptEntryIds.has(entry.id)}
            onPress={() => open(entry)}
          />
        ))
      )}
    </View>
  );

  if (detail) {
    const dueTotal = due.reduce((sum, e) => sum + e.amount, 0n);
    const dueParts = formatParts({ minor: dueTotal, currency }, { locale });
    const allPicked = due.length > 0 && picked.size === due.length;
    return (
      <>
        <AmountCard
          label={t.company.amountToPay}
          lead={dueParts.lead}
          fraction={`${dueParts.fraction}${dueParts.trail}`}
          caption={plural(locale, due.length, t.company.expensesPending)}
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

        {due.length > 0 ? (
          <>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <Text variant="subheading">{t.company.pendingForPayment}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setThrough(null);
                  setPicked(allPicked ? new Set() : new Set(due.map((e) => e.id)));
                }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  height: 34,
                  paddingHorizontal: theme.spacing.md,
                  borderRadius: theme.radius.pill,
                  borderWidth: 1,
                  borderColor: theme.color.brand,
                }}
              >
                <Ionicons
                  name={allPicked ? 'checkbox' : 'checkbox-outline'}
                  size={iconSize.base}
                  color={theme.color.brand}
                />
                <Text variant="caption" style={{ color: theme.color.brand, fontWeight: '600' }}>
                  {t.company.selectAllBtn}
                </Text>
              </Pressable>
            </View>
            {due.map((e) => {
              const receipts = view.receiptEntryIds.has(e.id);
              return (
                <DueRow
                  key={e.id}
                  checked={picked.has(e.id)}
                  icon={
                    e.kind === 'expense'
                      ? (TAG_ICON[e.category ?? '']?.[0] ?? 'pricetag')
                      : 'cash-outline'
                  }
                  title={kindLabel(t, e, tagLabel)}
                  date={showDate(e.occurredOn, locale)}
                  receipt={receipts ? t.company.receiptOne : undefined}
                  amount={fmt(e.amount)}
                  onToggle={() => toggle(e.id)}
                  onOpen={() => open(e)}
                />
              );
            })}
            <ReadyNote title={t.company.readyToSettle} body={t.company.readyBody} />
            {picked.size > 0 ? (
              <Text variant="caption" tone="muted" align="center">
                {[
                  fill(t.company.payCount, { count: String(preview.claims.length) }),
                  preview.creditsMinor !== 0n
                    ? fill(t.company.payCredits, { amount: fmt(preview.creditsMinor) })
                    : null,
                  fmt(preview.payoutMinor < 0n ? 0n : preview.payoutMinor),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            ) : null}
            {picked.size > 0 && preview.payoutMinor < 0n ? (
              <Text variant="caption" tone="negative">
                {t.company.payNeedMore}
              </Text>
            ) : null}
          </>
        ) : null}

        {statement.rows.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            onPress={share}
            style={{
              height: 50,
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              gap: 8,
              borderRadius: theme.radius.pill,
              backgroundColor: theme.color.brand,
            }}
          >
            <Ionicons name="logo-whatsapp" size={iconSize.md} color={theme.color.onBrand} />
            <Text variant="subheading" style={{ color: theme.color.onBrand, fontWeight: '700' }}>
              {t.company.sendWhatsApp}
            </Text>
          </Pressable>
        ) : null}
        {due.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !canPay }}
            disabled={!canPay}
            onPress={() => void pay()}
            style={{
              height: 46,
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              gap: 8,
              borderRadius: theme.radius.pill,
              backgroundColor: theme.color.brandSoft,
              opacity: canPay ? 1 : 0.6,
            }}
          >
            <Ionicons name="checkmark-circle" size={iconSize.md} color={theme.color.brand} />
            <Text variant="subheading" style={{ color: theme.color.brand, fontWeight: '700' }}>
              {t.company.markPaid}
            </Text>
          </Pressable>
        ) : null}
        {due.length > 0 ? (
          <Text variant="micro" tone="muted" align="center">
            {t.company.payExternal}
          </Text>
        ) : null}

        <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
          {view.manageableIds.has(member.id) ? (
            <ActionTile
              icon="add"
              title={t.company.addEntry}
              sub={t.company.tileAddSub}
              onPress={() => router.push(`/group/${groupId}/company-entry?member=${member.id}`)}
            />
          ) : null}
          <ActionTile
            icon="document-text-outline"
            title={t.company.tileHistory}
            sub={t.company.tileHistorySub}
            onPress={() => setPanel((p) => (p === 'history' ? null : 'history'))}
          />
          <ActionTile
            icon="stats-chart"
            title={t.company.tileSummary}
            sub={t.company.tileSummarySub}
            onPress={() => setPanel((p) => (p === 'summary' ? null : 'summary'))}
          />
        </View>
        {panel === 'history' ? history : null}
        {panel === 'summary' ? (
          <>
            <StatCard
              label={who}
              lead={parts.lead}
              fraction={`${parts.fraction}${parts.trail}`}
              accessibilityLabel={`${t.company.balance}: ${fmt(abs)}`}
              caption={sideText}
            />
            <CompanyTeamCard groupId={groupId} view={view} member={member} />
          </>
        ) : null}
        <View
          style={{
            padding: 10,
            borderRadius: theme.radius.lg,
            backgroundColor: theme.color.brandSoft,
          }}
        >
          <Text variant="caption" style={{ fontWeight: '700' }}>
            {t.company.detailPrivacyTitle}
          </Text>
          <Text variant="caption" tone="muted">
            {t.company.detailPrivacyBody}
          </Text>
        </View>
      </>
    );
  }

  return (
    <>
      <StatCard
        label={mine ? t.company.balance : who}
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
                    title={kindLabel(t, e, tagLabel)}
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

      {bubbles.length === 0 ? (
        <Text variant="caption" tone="muted" align="center">
          {t.company.threadEmpty}
        </Text>
      ) : (
        <View style={{ gap: theme.spacing.sm }}>
          {bubbles.map(({ entry }) => (
            <Bubble
              key={entry.id}
              entry={entry}
              label={kindLabel(t, entry, tagLabel)}
              fmt={fmt}
              locale={locale}
              hasPhoto={view.receiptEntryIds.has(entry.id)}
              onPress={() => open(entry)}
            />
          ))}
        </View>
      )}

      {statement.rows.length > 0 ? (
        <Button label={t.company.shareWhatsApp} variant="secondary" onPress={share} />
      ) : null}
      <Text variant="micro" tone="muted" align="center">
        {view.isAdmin ? t.company.privacyAdmin : t.company.privacyEmployee}
      </Text>
    </>
  );
}

const GIVEN_KINDS = new Set(['advance', 'wages', 'wage_payment', 'allocation']);

/** One money event as a chat bubble: money handed over leans right, what they spent leans left. */
function Bubble({
  entry,
  label,
  fmt,
  locale,
  hasPhoto,
  onPress,
}: {
  entry: CompanyEntry;
  label: string;
  fmt: (minor: bigint) => string;
  locale: string;
  hasPhoto: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const gave =
    GIVEN_KINDS.has(entry.kind) ||
    (entry.kind === 'reimbursement' && entry.direction !== 'employee_to_company');
  const wage = entry.kind === 'wages' || entry.kind === 'wage_payment';
  const waiting = entry.status === 'submitted' || entry.status === 'rejected';
  const icon = wage ? 'cash' : gave ? 'arrow-up-circle' : 'arrow-down-circle';
  const verb = wage ? t.company.paidWagesVerb : gave ? t.company.gaveMoney : label;
  const formula =
    entry.kind === 'wage_payment' && (entry.recoveryMinor ?? 0n) > 0n
      ? fill(t.company.wageFormula, {
          gross: fmt(entry.grossMinor ?? entry.amount),
          cut: fmt(entry.recoveryMinor ?? 0n),
          net: fmt(entry.amount),
        })
      : entry.calcMode === 'days_rate' && entry.days && entry.rateMinor !== null
        ? fill(t.company.daysAt, { days: entry.days, rate: fmt(entry.rateMinor) })
        : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${verb} ${fmt(entry.amount)}`}
      onPress={onPress}
      style={{
        alignSelf: gave ? 'flex-end' : 'flex-start',
        maxWidth: '82%',
        gap: 2,
        padding: theme.spacing.md,
        borderRadius: theme.radius.lg,
        backgroundColor: gave ? theme.color.brandSoft : theme.color.surfaceMuted,
        opacity: waiting ? 0.7 : 1,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs }}>
        <Ionicons
          name={icon}
          size={iconSize.md}
          color={gave || wage ? theme.color.brand : theme.color.negative}
        />
        <Text variant="body">{fmt(entry.amount)}</Text>
        {hasPhoto ? (
          <Ionicons name="camera" size={iconSize.sm} color={theme.color.textMuted} />
        ) : null}
      </View>
      <Text variant="caption" tone="muted">
        {[verb, formula, entry.note].filter(Boolean).join(' · ')}
      </Text>
      <Text variant="micro" tone="muted">
        {[
          showDate(entry.occurredOn, locale),
          waiting ? (entry.status === 'rejected' ? t.company.rejected : t.company.awaiting) : null,
          entry.pending ? '\u23F2' : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </Text>
    </Pressable>
  );
}
