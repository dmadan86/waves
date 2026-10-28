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
import { Image } from 'expo-image';
import { Platform, Pressable, ScrollView, TextInput, View } from 'react-native';

import {
  allowanceAmount,
  COMPANY_EXPENSE_CATEGORIES,
  evaluateCompanyPolicies,
  findDuplicateEntry,
  format,
  gstFromInclusive,
  mileageAmount,
  money,
  normaliseDecimalInput,
  normaliseGstin,
  resolveMileageRate,
  validateGstin,
  type CompanyCalcMode,
  type CompanyEntryData,
  type CompanyEntryKind,
  type CurrencyCode,
  type PolicyFlag,
} from '@waves/core';
import { AmountField, Button, ChipRow, Text, useTheme } from '@waves/ui';

import {
  ScenicBody,
  ScenicHeader,
  SectionHeader,
  StandardCard,
  PillButton,
} from '@/components/standard';
import { attachCompanyPhoto, useAddCompanyEntry, useCompanyEntries } from '@/data/companyEntries';
import { captureReceipt, pickAlbumPhoto, type PickedImage } from '@/lib/image';
import { MAX_COMPANY_PHOTOS } from '@/components/company/CompanyEntryPhotos';
import { useSync } from '@/sync';
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
  const {
    id,
    member: memberParam,
    intro,
  } = useLocalSearchParams<{ id: string; member?: string; intro?: string }>();
  const groupId = id ?? '';
  const theme = useTheme();
  const clearance = useBottomClearance();
  const { t, locale } = useStrings();
  const { choose, notify } = useDialog();
  const { flush } = useSync();
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
  const [photos, setPhotos] = useState<PickedImage[]>([]);
  const [mileage, setMileage] = useState(false);
  const [distance, setDistance] = useState('');
  const [kmRate, setKmRate] = useState<bigint | null>(null);
  const [fromText, setFromText] = useState('');
  const [toText, setToText] = useState('');
  const [gstOpen, setGstOpen] = useState(false);
  const [vendor, setVendor] = useState('');
  const [gstin, setGstin] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [gstRateBps, setGstRateBps] = useState<number | null>(null);
  const [gstTouched, setGstTouched] = useState<bigint | null>(null);

  // The employee's own rate, else the company-wide default, else none.
  const defaultRate = employee?.daily_rate_minor
    ? BigInt(employee.daily_rate_minor)
    : (view.defaultRateMinor ?? 0n);
  const rate = rateTouched ?? defaultRate;
  const byDays = kind === 'allowance' || (kind === 'wages' && wagesMode === 'days_rate');
  const byKm = kind === 'expense' && mileage && (category === 'fuel' || category === 'transport');
  const perKm = resolveMileageRate(
    kmRate,
    employee?.mileage_rate_minor,
    view.defaultMileageRateMinor?.toString(),
  );
  const computed = byDays
    ? allowanceAmount(days, rate)
    : byKm && perKm !== null
      ? mileageAmount(distance, perKm)
      : null;
  const total = byDays || byKm ? (computed ?? 0n) : amount;
  const showGst = view.gstEnabled && kind === 'expense' && !byKm;
  const gstAmount =
    gstTouched ?? (gstRateBps !== null && total > 0n ? gstFromInclusive(total, gstRateBps) : null);
  const gstinText = gstin.trim();
  const gstinBad = showGst && gstinText !== '' && !validateGstin(gstinText);
  const gstTooBig = showGst && gstAmount !== null && gstAmount > total;
  const flags: PolicyFlag[] =
    employee && (kind === 'expense' || kind === 'allowance') && total > 0n
      ? evaluateCompanyPolicies(
          {
            memberId: employee.id,
            kind,
            category: kind === 'expense' ? category : null,
            amount: total,
            occurredOn: date,
          },
          view.entries,
          view.policies,
          { hasReceipt: photos.length > 0 },
        )
      : [];
  const blocked = flags.find((f) => f.effect === 'block');
  const duplicate =
    employee && kind === 'expense' && total > 0n
      ? findDuplicateEntry(
          {
            memberId: employee.id,
            kind,
            category,
            amount: total,
            occurredOn: date,
            vendor: vendor.trim() || null,
            invoiceNo: invoiceNo.trim() || null,
          },
          view.entries,
        )
      : null;
  const periodLabel = (period: 'day' | 'month' | undefined): string =>
    period === 'day' ? t.company.perDay : t.company.perMonth;
  const flagText = (flag: PolicyFlag): string =>
    flag.code === 'RECEIPT'
      ? fill(t.company.policyHintReceipt, { limit: fmt(flag.limitMinor) })
      : flag.effect === 'block'
        ? fill(t.company.policyBlocked, { limit: fmt(flag.limitMinor) })
        : fill(t.company.policyHintLimit, {
            actual: fmt(flag.actualMinor),
            period: periodLabel(flag.period),
            limit: fmt(flag.limitMinor),
          });
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

  const addPhoto = async (source: 'camera' | 'library'): Promise<void> => {
    const picked = source === 'camera' ? await captureReceipt() : await pickAlbumPhoto();
    if (picked) setPhotos((current) => [...current, picked].slice(0, MAX_COMPANY_PHOTOS));
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

  // A days x rate entry may be zero (a zero rate is valid); a typed amount may not.
  const valid =
    !!employee &&
    (byDays || byKm ? computed !== null : total > 0n) &&
    !gstinBad &&
    !gstTooBig &&
    !blocked;

  const save = async (): Promise<void> => {
    if (!employee || !valid) {
      setError(
        byKm
          ? perKm === null
            ? t.company.needMileageRate
            : t.company.needDistance
          : gstinBad
            ? t.company.gstinBad
            : blocked
              ? flagText(blocked)
              : byDays
                ? t.company.needRate
                : t.company.needAmount,
      );
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
      ...(byKm && perKm !== null
        ? {
            calcMode: 'distance_rate' as const,
            distanceKm: distance.trim(),
            rateMinor: perKm.toString(),
            fromText: fromText.trim() || null,
            toText: toText.trim() || null,
          }
        : {}),
      ...(showGst
        ? {
            vendor: vendor.trim() || null,
            gstin: gstinText ? normaliseGstin(gstinText) : null,
            invoiceNo: invoiceNo.trim() || null,
            gstRateBps,
            gstAmountMinor: gstAmount !== null ? gstAmount.toString() : null,
          }
        : {}),
      ...(kind === 'reimbursement' ? { direction } : {}),
    };
    try {
      const entryId = randomUUID();
      await add.mutateAsync({ entryId, memberId: employee.id, entryKind: kind, data });
      if (photos.length > 0) {
        // The attach checks a real server row, so the queued entry goes first.
        try {
          await flush([groupId]);
          for (const photo of photos) await attachCompanyPhoto(groupId, entryId, photo);
        } catch (caught) {
          await notify({
            title: friendlyError(caught, t.company.photoFailed, 'company.photo.add'),
            tone: 'danger',
          });
        }
      }
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
          {intro === '1' ? (
            <Text variant="caption" tone="muted">
              {t.company.introPrivacy}
            </Text>
          ) : null}
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
                    ? fill(t.company.forPerson, {
                        name: displayName(employee, null, null, t.misc.someone),
                      })
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
                {category === 'fuel' || category === 'transport' ? (
                  <ChipRow
                    wrap
                    onCard
                    options={[
                      { value: 'typed', label: t.company.wagesTyped },
                      { value: 'km', label: t.company.kMileage },
                    ]}
                    value={mileage ? 'km' : 'typed'}
                    onChange={(value) => setMileage(value === 'km')}
                  />
                ) : null}
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

            {byKm ? (
              <>
                <Text variant="caption" tone="muted">
                  {t.company.formDistance}
                </Text>
                <TextInput
                  value={distance}
                  onChangeText={(text) => setDistance(normaliseDecimalInput(text))}
                  keyboardType="decimal-pad"
                  accessibilityLabel={t.company.formDistance}
                  style={{
                    color: theme.color.text,
                    fontSize: 20,
                    paddingVertical: theme.spacing.sm,
                    borderBottomWidth: 1,
                    borderBottomColor: theme.color.border,
                  }}
                />
                <Text variant="caption" tone="muted">
                  {t.company.formRatePerKm}
                </Text>
                <AmountField
                  currency={currency}
                  value={perKm ?? 0n}
                  onChange={setKmRate}
                  size="compact"
                  framed
                />
                {(['from', 'to'] as const).map((which) => (
                  <TextInput
                    key={which}
                    value={which === 'from' ? fromText : toText}
                    onChangeText={which === 'from' ? setFromText : setToText}
                    placeholder={which === 'from' ? t.company.formFrom : t.company.formTo}
                    placeholderTextColor={theme.color.textMuted}
                    maxLength={120}
                    accessibilityLabel={which === 'from' ? t.company.formFrom : t.company.formTo}
                    style={{
                      color: theme.color.text,
                      fontSize: 16,
                      paddingVertical: theme.spacing.sm,
                      borderBottomWidth: 1,
                      borderBottomColor: theme.color.border,
                    }}
                  />
                ))}
                <Text variant="body" style={{ fontWeight: '700' }}>
                  {`${t.company.formTotal}: ${fmt(total)}`}
                </Text>
              </>
            ) : byDays ? (
              <>
                <Text variant="caption" tone="muted">
                  {t.company.formDays}
                </Text>
                <TextInput
                  value={days}
                  onChangeText={(text) => setDays(normaliseDecimalInput(text))}
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
                <AmountField
                  currency={currency}
                  value={amount}
                  onChange={setAmount}
                  size="compact"
                  framed
                />
              </>
            )}

            {flags.map((flag) => (
              <Text
                key={flag.ruleId}
                variant="caption"
                tone={flag.effect === 'block' ? 'negative' : 'muted'}
              >
                {`! ${flagText(flag)}`}
              </Text>
            ))}
            {duplicate ? (
              <Text variant="caption" tone="muted">
                {`! ${t.company.dupHint}`}
              </Text>
            ) : null}
            {showGst ? (
              <>
                <PillButton
                  label={t.company.gstSection}
                  icon={gstOpen ? 'chevron-down-outline' : 'receipt-outline'}
                  chevron={false}
                  onPress={() => setGstOpen((open) => !open)}
                />
                {gstOpen ? (
                  <>
                    {(
                      [
                        [t.company.vendor, vendor, setVendor, 120],
                        [t.company.gstin, gstin, (v: string) => setGstin(v.toUpperCase()), 15],
                        [t.company.invoiceNo, invoiceNo, setInvoiceNo, 80],
                      ] as const
                    ).map(([label, value, setter, max]) => (
                      <TextInput
                        key={label}
                        value={value}
                        onChangeText={setter}
                        placeholder={label}
                        placeholderTextColor={theme.color.textMuted}
                        maxLength={max}
                        autoCapitalize={label === t.company.gstin ? 'characters' : 'sentences'}
                        accessibilityLabel={label}
                        style={{
                          color: theme.color.text,
                          fontSize: 16,
                          paddingVertical: theme.spacing.sm,
                          borderBottomWidth: 1,
                          borderBottomColor: theme.color.border,
                        }}
                      />
                    ))}
                    {gstinBad ? (
                      <Text variant="caption" tone="negative">
                        {t.company.gstinBad}
                      </Text>
                    ) : null}
                    <Text variant="caption" tone="muted">
                      {t.company.gstRate}
                    </Text>
                    <ChipRow
                      wrap
                      onCard
                      options={[0, 500, 1200, 1800, 2800].map((bps) => ({
                        value: String(bps),
                        label: `${bps / 100}%`,
                      }))}
                      value={gstRateBps === null ? '' : String(gstRateBps)}
                      onChange={(value) => {
                        setGstRateBps(Number(value));
                        setGstTouched(null);
                      }}
                    />
                    <Text variant="caption" tone="muted">
                      {t.company.gstAmount}
                    </Text>
                    <AmountField
                      currency={currency}
                      value={gstAmount ?? 0n}
                      onChange={setGstTouched}
                      size="compact"
                      framed
                    />
                    {gstAmount !== null && gstAmount <= total ? (
                      <Text variant="micro" tone="muted">
                        {`${t.company.gstBefore}: ${fmt(total - gstAmount)}  ·  ${t.company.gstAmount}: ${fmt(gstAmount)}`}
                      </Text>
                    ) : null}
                  </>
                ) : null}
              </>
            ) : null}
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
            <Text variant="caption" tone="muted">
              {t.company.photos}
            </Text>
            {photos.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {photos.map((photo, index) => (
                  <Pressable
                    key={photo.uri}
                    accessibilityRole="button"
                    accessibilityLabel={t.company.removePhoto}
                    onPress={() => setPhotos((current) => current.filter((_, i) => i !== index))}
                    style={{ marginRight: theme.spacing.sm }}
                  >
                    <Image
                      source={{ uri: photo.uri }}
                      style={{ width: 64, height: 64, borderRadius: theme.radius.md }}
                      contentFit="cover"
                    />
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}
            {photos.length < MAX_COMPANY_PHOTOS ? (
              <View style={{ flexDirection: 'row', gap: theme.spacing.sm, flexWrap: 'wrap' }}>
                <PillButton
                  label={t.company.takePhoto}
                  icon="camera-outline"
                  chevron={false}
                  onPress={() => void addPhoto('camera')}
                />
                <PillButton
                  label={t.company.choosePhoto}
                  icon="image-outline"
                  chevron={false}
                  onPress={() => void addPhoto('library')}
                />
              </View>
            ) : null}
            {photos.length > 0 ? (
              <Text variant="micro" tone="muted">
                {t.company.photoPrivacy}
              </Text>
            ) : null}
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
