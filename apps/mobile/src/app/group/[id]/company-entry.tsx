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
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';

import {
  allowanceAmount,
  evaluateCompanyPolicies,
  findDuplicateEntry,
  format,
  gstFromInclusive,
  mileageAmount,
  money,
  normaliseDecimalInput,
  normaliseGstin,
  packTags,
  resolveMileageRate,
  validateGstin,
  type CompanyCalcMode,
  type CompanyEntryData,
  type CompanyEntryKind,
  type CompanyIndustry,
  type CurrencyCode,
  type PolicyFlag,
} from '@waves/core';
import { AmountField, Button, ChipRow, iconSize, Text, useTheme } from '@waves/ui';

import { ScenicBody, ScenicHeader, StandardCard, PillButton } from '@/components/standard';
import {
  DashedRow,
  FieldLabel,
  KindTile,
  SaveButton,
  SelectField,
  TagGrid,
} from '@/components/company/EntryForm';
import { CompanyTagsSheet } from '@/components/company/CompanyTagsSheet';
import { COMPANY_PAID_TAGS, useCompanyTags } from '@/data/companyTags';
import {
  attachCompanyPhoto,
  useAddCompanyEntry,
  useCompanyEntries,
  useCompanyProjects,
} from '@/data/companyEntries';
import { captureReceipt, pickAlbumPhoto, type PickedImage } from '@/lib/image';
import { MAX_COMPANY_PHOTOS } from '@/components/company/CompanyEntryPhotos';
import { useSync } from '@/sync';
import { todayIso } from '@/data/personal';
import { displayName } from '@/data/types';
import { fill, useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';
import { useDialog } from '@/lib/dialog';
import { friendlyError } from '@/lib/errors';
import { dateFrom, isoDate } from '@/lib/expenseDay';
import { router } from '@/lib/navigation';

type Direction = 'company_to_employee' | 'employee_to_company';

const INDUSTRY_OPTIONS: readonly CompanyIndustry[] = ['construction', 'transport', 'field_sales'];

export default function CompanyEntryScreen() {
  const {
    id,
    member: memberParam,
    intro,
    kind: kindParam,
  } = useLocalSearchParams<{ id: string; member?: string; intro?: string; kind?: string }>();
  const groupId = id ?? '';
  const theme = useTheme();
  const clearance = useBottomClearance();
  const { t, locale } = useStrings();
  const { choose, notify } = useDialog();
  const { flush } = useSync();
  const view = useCompanyEntries(groupId);
  const add = useAddCompanyEntry(groupId);
  const currency = view.currency as CurrencyCode;

  const projects = useCompanyProjects(groupId).filter((p) => !p.archived_at);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [pickedKind, setKind] = useState<CompanyEntryKind | null>(null);
  const [memberId, setMemberId] = useState<string | null>(memberParam ?? null);
  const [payer, setPayer] = useState<'employee' | 'company'>('employee');
  const paidByCompany = payer === 'company' && (view.isOwner || view.isManager);
  const employee = paidByCompany
    ? undefined
    : memberId === null
      ? view.me
      : view.members.find((m) => m.id === memberId);
  // A manager's own entries are expense / bata only; money to the team comes from their pool.
  const moneyKinds = view.isAdmin && (view.isOwner || employee?.id !== view.me?.id);
  const kinds: CompanyEntryKind[] = moneyKinds
    ? view.isOwner
      ? ['expense', 'allowance', 'advance', 'wages', 'reimbursement']
      : ['expense', 'allowance', 'advance', 'reimbursement']
    : ['expense', 'allowance'];
  // Inside a person's thread the first verb is giving money; anywhere else it is spending.
  const kind: CompanyEntryKind =
    (paidByCompany ? 'expense' : null) ??
    pickedKind ??
    (moneyKinds && kindParam === 'advance' ? 'advance' : null) ??
    (moneyKinds && memberParam && memberParam !== view.me?.id ? 'advance' : 'expense');
  const tags = useCompanyTags(groupId, view);
  // Nothing tapped yet: the tag this person uses most is already chosen.
  const [pickedTag, setPickedTag] = useState<string | null>(null);
  const category = pickedTag ?? (paidByCompany ? 'materials' : tags.ranked[0]?.key) ?? 'other';
  const unit = tags.all.find((tag) => tag.key === category)?.unit ?? null;
  const [qty, setQty] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [saved, setSaved] = useState<{ summary: string } | null>(null);
  const [formKey, setFormKey] = useState(0);
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
  const [gstOpen, setGstOpen] = useState(true);
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
  const byKm =
    !paidByCompany &&
    kind === 'expense' &&
    mileage &&
    (category === 'fuel' || category === 'transport');
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

  const industryLabel = (industry: CompanyIndustry): string =>
    industry === 'construction'
      ? t.company.industryConstruction
      : industry === 'transport'
        ? t.company.industryTransport
        : t.company.industryFieldSales;
  const kindLabel: Record<CompanyEntryKind, string> = {
    expense: t.company.kExpense,
    allowance: t.company.kAllowance,
    advance: t.company.kAdvance,
    wages: t.company.kWages,
    reimbursement: t.company.kReimbursement,
    allocation: t.company.kAllocation,
    pool_return: t.company.kPoolReturn,
    pool_adjustment: t.company.kPoolAdjustment,
    pool_request: t.company.askTitle,
    wage_payment: t.company.kWages,
  };

  const pickEmployee = async (): Promise<void> => {
    const picked = await choose({
      title: t.company.formEmployee,
      options: [
        ...((view.isOwner || view.isManager) && kind === 'expense'
          ? [{ id: 'company', label: t.company.companyPaidDirect }]
          : []),
        ...view.members
          .filter((m) => !m.left_at)
          .map((m) => ({ id: m.id, label: displayName(m, null, null, t.misc.someone) })),
      ],
    });
    if (picked) {
      setPayer(picked === 'company' ? 'company' : 'employee');
      if (picked !== 'company') setMemberId(picked);
      if (picked === 'company' || paidByCompany) setKind('expense');
      setPickedTag(null);
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
    (paidByCompany || !!employee) &&
    (byDays || byKm ? computed !== null : total > 0n) &&
    !gstinBad &&
    !gstTooBig &&
    !blocked;

  const addAnother = (): void => {
    setAmount(0n);
    setPickedTag(null);
    setQty('');
    setNote('');
    setPhotos([]);
    setMoreOpen(false);
    setDate(todayIso());
    setPickingDate(false);
    setMileage(false);
    setDistance('');
    setKmRate(null);
    setFromText('');
    setToText('');
    setGstOpen(true);
    setVendor('');
    setGstin('');
    setInvoiceNo('');
    setGstRateBps(null);
    setGstTouched(null);
    setDays('1');
    setRateTouched(null);
    setError(null);
    setSaved(null);
    setFormKey((k) => k + 1);
  };

  const save = async (): Promise<void> => {
    if (!valid || (!paidByCompany && !employee)) {
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
    // No column for quantity yet: it rides in the note ("20 bag · site 2").
    const qtyText =
      !paidByCompany && kind === 'expense' && unit && qty.trim() && !byKm
        ? `${qty.trim()} ${unit}`
        : '';
    // The server caps a note at 500 characters; the quantity rides inside that.
    const noteText = [qtyText, note.trim()].filter(Boolean).join(' · ').slice(0, 500);
    const data: CompanyEntryData = {
      ...(paidByCompany ? { paidByCompany: true } : {}),
      amount: total.toString(),
      occurredOn: date,
      note: noteText || null,
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
      ...(projectId ? { projectId } : {}),
      // A manager pays from their own pool; an owner's entry is paid by the owners.
      ...(view.isManager && (kind === 'advance' || kind === 'wages' || kind === 'reimbursement')
        ? { fundingManagerId: view.me?.id ?? null }
        : {}),
    };
    try {
      const entryId = randomUUID();
      await add.mutateAsync({
        entryId,
        memberId: paidByCompany ? null : employee!.id,
        entryKind: kind as 'expense' | 'advance' | 'allowance' | 'wages' | 'reimbursement',
        data,
      });
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
      setSaved({
        summary: [fmt(total), kind === 'expense' ? tags.label(category) : kindLabel[kind]].join(
          ' · ',
        ),
      });
      Keyboard.dismiss();
    } catch (caught) {
      setError(friendlyError(caught, t.company.couldNotSave, 'company.add'));
    }
  };

  const giveSel = kind === 'advance' || kind === 'reimbursement';
  const tiles = moneyKinds
    ? [
        {
          id: 'give',
          icon: 'swap-horizontal' as const,
          title: t.company.kindGive,
          sub: t.company.kindSubGive,
          selected: giveSel,
        },
        {
          id: 'expense',
          icon: 'document-text-outline' as const,
          title: t.company.theySpent,
          sub: t.company.kindSubSpent,
          selected: kind === 'expense',
        },
        {
          id: 'wages',
          icon: 'people' as const,
          title: t.company.paidWagesVerb,
          sub: t.company.kindSubWages,
          selected: kind === 'wages',
        },
      ]
    : [
        {
          id: 'expense',
          icon: 'document-text-outline' as const,
          title: t.company.iSpent,
          sub: t.company.kindSubSpent,
          selected: kind === 'expense',
        },
        {
          id: 'allowance',
          icon: 'calendar-outline' as const,
          title: kindLabel.allowance,
          sub: t.company.kindSubAllowance,
          selected: kind === 'allowance',
        },
      ];
  const otherKinds =
    !paidByCompany && moneyKinds ? kinds.filter((k) => k === 'allowance' || k === 'wages') : [];
  const hasMore = otherKinds.length > 0 || projects.length > 0 || showGst;
  const canPickPerson = view.isOwner || view.isManager;
  const dateText = dateFrom(date).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const photoRoom = photos.length < MAX_COMPANY_PHOTOS;
  const pickPhoto = async (): Promise<void> => {
    const source = await choose({
      title: t.company.photos,
      options: [
        { id: 'camera', label: t.company.takePhoto },
        { id: 'library', label: t.company.choosePhoto },
      ],
    });
    if (source) void addPhoto(source as 'camera' | 'library');
  };
  const lineInput = {
    color: theme.color.text,
    fontSize: 16,
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.color.border,
  } as const;

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.bg }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          pointerEvents={saved ? 'none' : 'auto'}
          style={{ flex: 1, opacity: saved ? 0.6 : 1 }}
          contentContainerStyle={{ paddingBottom: theme.spacing.xl }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <ScenicHeader title={t.company.addEntry} subtitle={view.name} circleBack />
          <ScenicBody>
            {intro === '1' ? (
              <Text variant="caption" tone="muted">
                {t.company.introPrivacy}
              </Text>
            ) : null}
            <StandardCard style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
              {tiles
                .filter((tile) => !paidByCompany || tile.id === 'expense')
                .map((tile) => (
                  <KindTile
                    key={tile.id}
                    icon={tile.icon}
                    title={tile.title}
                    sub={tile.sub}
                    selected={tile.selected}
                    onPress={() => {
                      if (tile.id === 'wages') router.push(`/group/${groupId}/company-wages`);
                      else if (tile.id === 'give') setKind(giveSel ? kind : 'advance');
                      else setKind(tile.id as CompanyEntryKind);
                    }}
                  />
                ))}
            </StandardCard>

            <StandardCard style={{ gap: theme.spacing.md }}>
              {giveSel ? (
                <ChipRow
                  wrap
                  onCard
                  options={[
                    { value: 'advance' as CompanyEntryKind, label: kindLabel.advance },
                    { value: 'reimbursement' as CompanyEntryKind, label: kindLabel.reimbursement },
                  ]}
                  value={kind}
                  onChange={setKind}
                />
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
                  <FieldLabel>{t.company.formDistance}</FieldLabel>
                  <TextInput
                    value={distance}
                    onChangeText={(text) => setDistance(normaliseDecimalInput(text))}
                    keyboardType="decimal-pad"
                    accessibilityLabel={t.company.formDistance}
                    style={{ ...lineInput, fontSize: 20 }}
                  />
                  <FieldLabel>{t.company.formRatePerKm}</FieldLabel>
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
                      style={lineInput}
                    />
                  ))}
                  <Text variant="body" style={{ fontWeight: '700' }}>
                    {`${t.company.formTotal}: ${fmt(total)}`}
                  </Text>
                </>
              ) : byDays ? (
                <>
                  <FieldLabel>{t.company.formDays}</FieldLabel>
                  <TextInput
                    value={days}
                    onChangeText={(text) => setDays(normaliseDecimalInput(text))}
                    keyboardType="decimal-pad"
                    accessibilityLabel={t.company.formDays}
                    style={{ ...lineInput, fontSize: 20 }}
                  />
                  <FieldLabel>{t.company.formRate}</FieldLabel>
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
                  <FieldLabel>{t.company.formAmount}</FieldLabel>
                  <View
                    style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}
                  >
                    <View style={{ flex: 1 }}>
                      <AmountField
                        key={formKey}
                        autoFocus
                        currency={currency}
                        value={amount}
                        onChange={setAmount}
                        size="hero"
                        framed
                      />
                    </View>
                    <View
                      style={{
                        height: 44,
                        justifyContent: 'center',
                        paddingHorizontal: theme.spacing.md,
                        borderRadius: theme.radius.lg,
                        backgroundColor: theme.color.surfaceMuted,
                      }}
                    >
                      <Text variant="caption" style={{ fontWeight: '700' }}>
                        {currency}
                      </Text>
                    </View>
                  </View>
                </>
              )}

              {kind === 'expense' ? (
                <>
                  <FieldLabel>{t.company.formCategory}</FieldLabel>
                  <TagGrid
                    tags={
                      paidByCompany
                        ? COMPANY_PAID_TAGS.map((key) => ({ key, label: tags.label(key) }))
                        : tags.ranked.map((tag) => ({ key: tag.key, label: tag.label }))
                    }
                    limit={paidByCompany ? 8 : 7}
                    value={category}
                    onChange={setPickedTag}
                    onMore={() => setTagsOpen(true)}
                    moreLabel={t.company.tagAll}
                  />
                  {!paidByCompany && unit && !byKm ? (
                    <View
                      style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}
                    >
                      <TextInput
                        value={qty}
                        onChangeText={(text) => setQty(normaliseDecimalInput(text))}
                        keyboardType="decimal-pad"
                        placeholder={t.company.qtyPh}
                        placeholderTextColor={theme.color.textMuted}
                        accessibilityLabel={t.company.qtyPh}
                        style={{ ...lineInput, flex: 1 }}
                      />
                      <Text variant="body">{unit}</Text>
                    </View>
                  ) : null}
                  {!paidByCompany && (category === 'fuel' || category === 'transport') ? (
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

              <FieldLabel>{t.company.formDate}</FieldLabel>
              <SelectField
                icon="calendar-outline"
                label={t.company.formDate}
                text={
                  date === todayIso() ? fill(t.company.todayDate, { date: dateText }) : dateText
                }
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

              <FieldLabel>
                {kind === 'expense' || kind === 'allowance'
                  ? t.company.paidBy
                  : t.company.formEmployee}
              </FieldLabel>
              <SelectField
                icon="person-outline"
                label={t.company.paidBy}
                text={
                  paidByCompany
                    ? t.company.companyPaidDirect
                    : employee
                      ? displayName(employee, null, null, t.misc.someone)
                      : t.company.selectPerson
                }
                placeholder={!paidByCompany && !employee}
                onPress={canPickPerson ? () => void pickEmployee() : undefined}
              />

              {paidByCompany && view.isManager ? (
                <Text variant="caption" tone="muted">
                  {t.company.companyPaidPoolHint}
                </Text>
              ) : null}

              <FieldLabel>{t.company.notesLabel}</FieldLabel>
              <SelectField
                icon="document-text-outline"
                label={t.company.formNote}
                trailing={
                  photoRoom ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t.company.takePhoto}
                      onPress={() => void addPhoto('camera')}
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: 17,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: theme.color.brandSoft,
                      }}
                    >
                      <Ionicons name="camera" size={iconSize.base} color={theme.color.brand} />
                    </Pressable>
                  ) : null
                }
                input={
                  <TextInput
                    value={note}
                    onChangeText={setNote}
                    placeholder={t.company.notePh}
                    placeholderTextColor={theme.color.textMuted}
                    maxLength={500}
                    accessibilityLabel={t.company.formNote}
                    style={{
                      flex: 1,
                      color: theme.color.text,
                      fontSize: 16,
                      paddingVertical: theme.spacing.sm,
                    }}
                  />
                }
              />
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
              {photoRoom ? (
                <DashedRow
                  icon="attach"
                  label={t.company.addReceipt}
                  onPress={() => void pickPhoto()}
                />
              ) : null}
              {photos.length > 0 ? (
                <Text variant="micro" tone="muted">
                  {t.company.photoPrivacy}
                </Text>
              ) : null}

              {hasMore ? (
                <PillButton
                  label={t.company.moreOpen}
                  icon={moreOpen ? 'chevron-up-outline' : 'chevron-down-outline'}
                  chevron={false}
                  onPress={() => setMoreOpen((open) => !open)}
                />
              ) : null}
              {moreOpen ? (
                <>
                  {otherKinds.length > 0 ? (
                    <ChipRow
                      wrap
                      onCard
                      options={otherKinds.map((value) => ({ value, label: kindLabel[value] }))}
                      value={kind}
                      onChange={setKind}
                    />
                  ) : null}
                  {projects.length > 0 ? (
                    <ChipRow
                      wrap
                      onCard
                      options={[
                        { value: '', label: t.company.noSite },
                        ...projects.map((p) => ({ value: p.id, label: p.name })),
                      ]}
                      value={projectId ?? ''}
                      onChange={(next) => setProjectId(next || null)}
                    />
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
                              [
                                t.company.gstin,
                                gstin,
                                (v: string) => setGstin(v.toUpperCase()),
                                15,
                              ],
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
                              autoCapitalize={
                                label === t.company.gstin ? 'characters' : 'sentences'
                              }
                              accessibilityLabel={label}
                              style={lineInput}
                            />
                          ))}
                          {gstinBad ? (
                            <Text variant="caption" tone="negative">
                              {t.company.gstinBad}
                            </Text>
                          ) : null}
                          <FieldLabel>{t.company.gstRate}</FieldLabel>
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
                          <FieldLabel>{t.company.gstAmount}</FieldLabel>
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
                </>
              ) : null}
            </StandardCard>
          </ScenicBody>
        </ScrollView>
        <View
          style={{
            paddingHorizontal: theme.spacing.lg,
            paddingTop: theme.spacing.sm,
            paddingBottom: clearance,
            gap: theme.spacing.xs,
            backgroundColor: theme.color.bg,
          }}
        >
          {error ? (
            <Text variant="caption" tone="negative">
              {error}
            </Text>
          ) : null}
          {saved ? (
            <>
              <Text variant="caption" tone="muted">
                {`${t.company.savedAnother} ✓ ${saved.summary}`}
              </Text>
              <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
                <View style={{ flex: 2 }}>
                  <Button label={t.company.addAnother} onPress={addAnother} fullWidth />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    label={t.company.doneBtn}
                    variant="secondary"
                    onPress={() => router.back()}
                    fullWidth
                  />
                </View>
              </View>
            </>
          ) : (
            <SaveButton
              label={t.company.save}
              onPress={() => void save()}
              disabled={add.isPending || !view.ready}
            />
          )}
        </View>
      </KeyboardAvoidingView>
      <CompanyTagsSheet
        visible={tagsOpen}
        onClose={() => setTagsOpen(false)}
        rows={tags.all.map((tag) => ({
          key: tag.key,
          label: tag.label,
          unit: tag.unit,
          hidden: tag.hidden === true,
          addedBy: (() => {
            const adder = view.members.find((m) => m.id === tag.addedBy);
            return adder ? displayName(adder, null, null, t.misc.someone) : null;
          })(),
        }))}
        isAdmin={view.isOwner}
        industries={INDUSTRY_OPTIONS.map((industry) => ({
          id: industry,
          label: industryLabel(industry),
          missing: packTags(industry).filter((p) => !tags.all.some((a) => a.key === p.key)).length,
        }))}
        onAdd={(name) => {
          const key = tags.add(name);
          if (key) setPickedTag(key);
        }}
        onRename={(key, label) =>
          tags.setTags(
            tags.all.map((tag) => (tag.key === key ? { ...tag, label } : tag)),
            tags.industry,
          )
        }
        onToggleHidden={(key) =>
          tags.setTags(
            tags.all.map((tag) => (tag.key === key ? { ...tag, hidden: !tag.hidden } : tag)),
            tags.industry,
          )
        }
        onAddPack={(id) => tags.addPack(id as CompanyIndustry)}
        onPick={(key) => {
          setPickedTag(key);
          setTagsOpen(false);
        }}
      />
    </View>
  );
}
