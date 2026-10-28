/**
 * Add a company entry: Expense, Bata, and (for an admin) Advance, Wages paid and
 * Reimbursement. One screen, one form; the fields follow the type. Bata is days x
 * a daily rate that starts at the employee's default and can be changed here.
 * The server recomputes bata and checks who may write what.
 */

import { useState } from 'react';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { randomUUID } from 'expo-crypto';
import { useLocalSearchParams } from 'expo-router';
import { Platform, ScrollView, TextInput, View } from 'react-native';

import {
  allowanceAmount,
  COMPANY_EXPENSE_CATEGORIES,
  format,
  money,
  type CompanyCalcMode,
  type CompanyEntryData,
  type CompanyEntryKind,
  type CurrencyCode,
} from '@waves/core';
import { AmountField, Button, ChipRow, Text, useTheme } from '@waves/ui';

import { ScenicBody, ScenicHeader, SectionHeader, StandardCard, PillButton } from '@/components/standard';
import { useAddCompanyEntry, useCompanyEntries } from '@/data/companyEntries';
import { todayIso } from '@/data/personal';
import { displayName } from '@/data/types';
import { fill, useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';
import { useDialog } from '@/lib/dialog';
import { friendlyError } from '@/lib/errors';
import { dateFrom, isoDate, showDate } from '@/lib/expenseDay';
import { router } from '@/lib/navigation';

type Direction = 'company_to_employee' | 'employee_to_company';

export default function CompanyEntryScreen() {
  const { id, member: memberParam } = useLocalSearchParams<{ id: string; member?: string }>();
  const groupId = id ?? '';
  const theme = useTheme();
  const clearance = useBottomClearance();
  const { t, locale } = useStrings();
  const { choose } = useDialog();
  const view = useCompanyEntries(groupId);
  const add = useAddCompanyEntry(groupId);
  const currency = view.currency as CurrencyCode;

  const kinds: CompanyEntryKind[] = view.isAdmin
    ? ['expense', 'allowance', 'advance', 'wages', 'reimbursement']
    : ['expense', 'allowance'];
  const [kind, setKind] = useState<CompanyEntryKind>('expense');
  const [memberId, setMemberId] = useState<string | null>(memberParam ?? null);
  const employee = view.members.find((m) => m.id === (memberId ?? view.me?.id)) ?? view.me;
  const [category, setCategory] = useState<string>('fuel');
  const [amount, setAmount] = useState(0n);
  const [days, setDays] = useState('1');
  const [rateTouched, setRateTouched] = useState<bigint | null>(null);
  const [wagesMode, setWagesMode] = useState<CompanyCalcMode>('typed');
  const [direction, setDirection] = useState<Direction>('company_to_employee');
  const [date, setDate] = useState(todayIso());
  const [pickingDate, setPickingDate] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const defaultRate = employee?.daily_rate_minor ? BigInt(employee.daily_rate_minor) : 0n;
  const rate = rateTouched ?? defaultRate;
  const byDays = kind === 'allowance' || (kind === 'wages' && wagesMode === 'days_rate');
  const computed = byDays ? allowanceAmount(days, rate) : null;
  const total = byDays ? (computed ?? 0n) : amount;
  const fmt = (minor: bigint): string => format(money(minor, currency), { locale });

  const kindLabel: Record<CompanyEntryKind, string> = {
    expense: t.company.kExpense,
    allowance: t.company.kAllowance,
    advance: t.company.kAdvance,
    wages: t.company.kWages,
    reimbursement: t.company.kReimbursement,
  };
  const catLabel: Record<string, string> = {
    fuel: t.company.catFuel,
    transport: t.company.catTransport,
    travel: t.company.catTravel,
    food: t.company.catFood,
    office: t.company.catOffice,
    other: t.company.catOther,
  };

  const pickEmployee = async (): Promise<void> => {
    const picked = await choose({
      title: t.company.formEmployee,
      options: view.members
        .filter((m) => !m.left_at)
        .map((m) => ({ id: m.id, label: displayName(m, null, null, t.misc.someone) })),
    });
    if (picked) {
      setMemberId(picked);
      setRateTouched(null);
    }
  };

  const openDate = (): void => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: dateFrom(date),
        mode: 'date',
        onChange: (event, picked) => {
          if (event.type === 'set' && picked) setDate(isoDate(picked));
        },
      });
    } else setPickingDate((open) => !open);
  };

  const valid = !!employee && total > 0n && (!byDays || computed !== null);

  const save = async (): Promise<void> => {
    if (!employee || !valid) {
      setError(byDays ? t.company.needRate : t.company.needAmount);
      return;
    }
    setError(null);
    const data: CompanyEntryData = {
      amount: total.toString(),
      occurredOn: date,
      note: note.trim() || null,
      ...(kind === 'expense' ? { category } : {}),
      ...(byDays
        ? { calcMode: 'days_rate' as const, days: days.trim(), rateMinor: rate.toString() }
        : kind === 'wages'
          ? { calcMode: wagesMode }
          : {}),
      ...(kind === 'reimbursement' ? { direction } : {}),
    };
    try {
      await add.mutateAsync({ entryId: randomUUID(), memberId: employee.id, entryKind: kind, data });
      router.back();
    } catch (caught) {
      setError(friendlyError(caught, t.company.couldNotSave, 'company.add'));
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.bg }}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: clearance }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <ScenicHeader title={t.company.addEntry} />
        <ScenicBody>
          <StandardCard style={{ gap: theme.spacing.md }}>
            <SectionHeader title={t.company.formKind} />
            <ChipRow
              wrap
              onCard
              options={kinds.map((value) => ({ value, label: kindLabel[value] }))}
              value={kind}
              onChange={setKind}
            />
            {view.isAdmin && view.members.filter((m) => !m.left_at).length > 1 ? (
              <PillButton
                label={
                  employee
                    ? fill(t.company.forPerson, { name: displayName(employee, null, null, t.misc.someone) })
                    : t.company.formEmployee
                }
                icon="person-outline"
                onPress={() => void pickEmployee()}
              />
            ) : null}
          </StandardCard>

          <StandardCard style={{ gap: theme.spacing.md }}>
            {kind === 'expense' ? (
              <>
                <Text variant="caption" tone="muted">
                  {t.company.formCategory}
                </Text>
                <ChipRow
                  wrap
                  onCard
                  options={COMPANY_EXPENSE_CATEGORIES.map((value) => ({
                    value,
                    label: catLabel[value] ?? value,
                  }))}
                  value={category as (typeof COMPANY_EXPENSE_CATEGORIES)[number]}
                  onChange={setCategory}
                />
              </>
            ) : null}
            {kind === 'wages' ? (
              <ChipRow
                wrap
                onCard
                options={[
                  { value: 'typed' as CompanyCalcMode, label: t.company.wagesTyped },
                  { value: 'fixed_weekly' as CompanyCalcMode, label: t.company.wagesWeekly },
                  { value: 'days_rate' as CompanyCalcMode, label: t.company.wagesDaysRate },
                ]}
                value={wagesMode}
                onChange={setWagesMode}
              />
            ) : null}
            {kind === 'reimbursement' ? (
              <ChipRow
                wrap
                onCard
                options={[
                  { value: 'company_to_employee' as Direction, label: t.company.payTo },
                  { value: 'employee_to_company' as Direction, label: t.company.returnFrom },
                ]}
                value={direction}
                onChange={setDirection}
              />
            ) : null}

            {byDays ? (
              <>
                <Text variant="caption" tone="muted">
                  {t.company.formDays}
                </Text>
                <TextInput
                  value={days}
                  onChangeText={(text) => setDays(text.replace(/[^0-9.]/g, ''))}
                  keyboardType="decimal-pad"
                  accessibilityLabel={t.company.formDays}
                  style={{
                    color: theme.color.text,
                    fontSize: 20,
                    paddingVertical: theme.spacing.sm,
                    borderBottomWidth: 1,
                    borderBottomColor: theme.color.border,
                  }}
                />
                <Text variant="caption" tone="muted">
                  {t.company.formRate}
                </Text>
                <AmountField
                  currency={currency}
                  value={rate}
                  onChange={setRateTouched}
                  size="compact"
                  framed
                />
                <Text variant="body" style={{ fontWeight: '700' }}>
                  {`${t.company.formTotal}: ${fmt(total)}`}
                </Text>
              </>
            ) : (
              <>
                <Text variant="caption" tone="muted">
                  {t.company.formAmount}
                </Text>
                <AmountField currency={currency} value={amount} onChange={setAmount} size="compact" framed />
              </>
            )}

            <PillButton
              label={date === todayIso() ? t.company.today : showDate(date, locale)}
              icon="calendar-outline"
              onPress={openDate}
            />
            {Platform.OS === 'ios' && pickingDate ? (
              <DateTimePicker
                value={dateFrom(date)}
                mode="date"
                display="inline"
                onChange={(event, picked) => {
                  if (event.type !== 'dismissed' && picked) setDate(isoDate(picked));
                }}
              />
            ) : null}

            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder={t.company.formNote}
              placeholderTextColor={theme.color.textMuted}
              maxLength={500}
              accessibilityLabel={t.company.formNote}
              style={{
                color: theme.color.text,
                fontSize: 16,
                paddingVertical: theme.spacing.sm,
                borderBottomWidth: 1,
                borderBottomColor: theme.color.border,
              }}
            />
          </StandardCard>

          {error ? (
            <Text variant="caption" tone="negative">
              {error}
            </Text>
          ) : null}
          <Button
            label={t.company.save}
            onPress={() => void save()}
            disabled={add.isPending || !view.ready}
            fullWidth
          />
        </ScenicBody>
      </ScrollView>
    </View>
  );
}
