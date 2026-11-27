/** One rental property: the tenant, rent due and received, expenses, and the actions. */

import { useEffect, useMemo, useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
// The OS share sheet, opened only when the owner taps "Share receipt".
import { Pressable, ScrollView, Share, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import Animated, {
  FadeInDown,
  FadeOut,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { leaseEndsIn, linkedPersonalTxnIds, settleDeposit, type PersonalTxn } from '@waves/core';
import {
  AmountField,
  Button,
  directionalIcon,
  IconButton,
  iconSize,
  Row,
  Screen,
  Sheet,
  Text,
  useTheme,
} from '@waves/ui';

import { OverflowMenu, type OverflowMenuItem } from '@/components/OverflowMenu';
import { PersonalGuard } from '@/components/PersonalGuard';
import { BALANCE_MASK } from '@/components/home/HomeBalanceCard';
import { PlainHeader, SectionHeader, StandardCard } from '@/components/standard';
import { PropertyArt } from '@/components/wealth/PropertyArt';
import { DetailsCard, DocumentsCard } from '@/components/wealth/RentalExtras';
import { RaiseCard, useRaisePrompts } from '@/components/wealth/RaiseCard';
import { AmountSheet, RenameSheet, StatusPill, useWealthMoney } from '@/components/wealth/parts';
import {
  todayIso,
  useAllGroupRecords,
  usePersonalLedger,
  usePersonalRecords,
} from '@/data/personal';
import {
  usePersonalWealth,
  useRentalStore,
  useSpaceName,
  useWealthWrites,
} from '@/data/personalWealth';
import { useBlockedUsers } from '@/data/blocked';
import { memberLookup, useGroup } from '@/data/hooks';
import { memberNameById } from '@/lib/memberName';
import { fullPaymentOf, liveDocPropertyIds, outstandingRent, spaceParams } from '@/lib/rentalScope';
import { fill, useStrings } from '@/i18n';
import { DetailEnter, EASE_OUT, popEntering, PressableScale, settleEntering } from '@/lib/anim';
import { hapticSuccess } from '@/lib/assistantHaptics';
import { useReducedMotion } from '@/lib/reducedMotion';
import { shouldShowPreviousBalance } from '@/lib/rentalExtrasBehavior';
import { useAuth, useViewerId } from '@/lib/auth';
import { useBottomClearance } from '@/lib/clearance';
import { useDefaultCurrency } from '@/lib/currency';
import { useDialog } from '@/lib/dialog';
import { router } from '@/lib/navigation';
import { deleteAllDocs, sweepOrphanDocs } from '@/lib/propertyDocs';
import { useEntitlement } from '@/lib/useEntitlement';
import {
  depositTerm,
  heroCaptionKey,
  paymentsOfTenancy,
  propertyView,
  regionOf,
  rentStrip,
  stripMark,
} from '@/lib/wealthPlan';
import { PROPERTY_ICON, type IconName } from '@/lib/wizardIcons';

type Open = 'rent' | 'expense' | 'change' | 'left' | 'deposit' | null;

// The theme's positive is blue; a received rent reads green, as in the design.
const GREEN = '#16A34A';
const GREEN_TINT = '#16A34A22';

function TintButton({
  label,
  icon,
  bg,
  fg,
  disabled,
  onPress,
}: {
  label: string;
  icon: IconName;
  bg: string;
  fg: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        flex: 1,
        minHeight: 48,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.spacing.sm,
        borderRadius: theme.radius.lg,
        backgroundColor: bg,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Ionicons name={icon} size={iconSize.md} color={fg} />
      <Text variant="body" style={{ fontWeight: '700', color: fg }}>
        {label}
      </Text>
    </PressableScale>
  );
}

/** The hero figure: when it changes, the old one dissolves under the new one in place. */
function SwapText({ value }: { value: string }) {
  const reduce = useReducedMotion();
  const [prev, setPrev] = useState(value);
  const mix = useSharedValue(1);
  const shown = useRef(value);
  useEffect(() => {
    if (shown.current === value) return;
    const masked = value === BALANCE_MASK || shown.current === BALANCE_MASK;
    setPrev(shown.current);
    shown.current = value;
    // Hiding or revealing amounts is a hard cut: never show the old figure while masking.
    if (masked) {
      mix.set(1);
      return;
    }
    mix.set(reduce ? 1 : 0);
    if (!reduce) mix.set(withTiming(1, { duration: 180 }));
  }, [value, reduce, mix]);
  const next = useAnimatedStyle(() => ({ opacity: mix.get() }));
  const old = useAnimatedStyle(() => ({ opacity: 1 - mix.get(), position: 'absolute' }));
  const showPrevious = shouldShowPreviousBalance(value, prev, BALANCE_MASK);
  const style = { fontWeight: '800', fontSize: 34, lineHeight: 40 } as const;
  return (
    <View>
      {showPrevious ? (
        <Animated.View
          style={old}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Text variant="title" style={style}>
            {prev}
          </Text>
        </Animated.View>
      ) : null}
      <Animated.View style={next}>
        <Text variant="title" style={style}>
          {value}
        </Text>
      </Animated.View>
    </View>
  );
}

/** A strip cell's badge: the check pops only when the month turns paid while you watch. */
function StripBadge({ mark }: { mark: string }) {
  const theme = useTheme();
  const reduce = useReducedMotion();
  const [markAtMount] = useState(mark);
  const pop = !reduce && markAtMount !== 'check';
  return (
    <View
      style={{
        width: 18,
        height: 14,
        borderRadius: 5,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: mark === 'check' ? GREEN_TINT : theme.color.surfaceMuted,
      }}
    >
      {mark === 'check' ? (
        <Animated.View entering={pop ? popEntering(120) : undefined}>
          <Ionicons name="checkmark" size={11} color={GREEN} />
        </Animated.View>
      ) : null}
    </View>
  );
}

function DetailBody() {
  const theme = useTheme();
  const clearance = useBottomClearance();
  const { t, locale } = useStrings();
  const { confirm } = useDialog();
  const reduce = useReducedMotion();
  const glide = reduce ? undefined : LinearTransition.springify().damping(24).stiffness(220);
  const [renaming, setRenaming] = useState(false);
  const w = t.wealth;
  const fmt = useWealthMoney();
  const dc = useDefaultCurrency();
  const { profile } = useAuth();
  const region = regionOf(profile?.country_code);
  const { id, space } = useLocalSearchParams<{ id: string; space?: string }>();
  const spaceName = useSpaceName(space);
  const ledger = usePersonalLedger(space);
  const { properties, tenancies } = usePersonalWealth(space);
  const writes = useWealthWrites(space);
  const store = useRentalStore(space);
  const del = { mutateAsync: store.del };
  const personalRecords = usePersonalRecords();
  const groupRecords = useAllGroupRecords();
  const { everyone } = useGroup(space ?? '');
  const viewerId = useViewerId();
  const { blockedIds } = useBlockedUsers();
  const members = useMemo(() => memberLookup(everyone.data), [everyone.data]);
  const { isPro } = useEntitlement();
  const [open, setOpen] = useState<Open>(null);
  const [menu, setMenu] = useState(false);
  const [asked, setAsked] = useState(true);
  const [returned, setReturned] = useState<bigint | null>(null);
  const [today] = useState(() => todayIso());
  const raise = useRaisePrompts(today, space).find((p) => p.propertyId === id) ?? null;

  const prop = properties.find((p) => p.id === id);
  // Only once this property has loaded, so a still-empty list never looks like "all deleted".
  const loaded = prop !== undefined;
  // Keep every document whose property exists in Personal or in any group the person is in.
  useEffect(() => {
    if (loaded) void sweepOrphanDocs(liveDocPropertyIds(personalRecords, groupRecords));
  }, [loaded, personalRecords, groupRecords]);
  if (!prop) {
    return (
      <Screen edges={[]}>
        <PlainHeader title={w.rentals} />
      </Screen>
    );
  }
  const cur = prop.currency || dc;
  const v = propertyView(prop, tenancies, ledger.recurrings, ledger.txns, today);
  const tn = v.tenancy;
  const unit = tn?.unit ?? prop.name;
  const nounKey = depositTerm(region);
  const noun = w.depositNouns[nounKey];
  const day = (iso: string): string =>
    new Date(`${iso}T12:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  const month = (m: string): string =>
    new Date(`${m}-01T12:00:00`).toLocaleDateString(locale, { month: 'narrow' });

  const unpaid = v.balance.lines.find((l) => l.status !== 'paid' && l.date <= today);
  const outstanding = outstandingRent(unpaid);
  // The recording form still offers the regular instalment when nothing is overdue.
  const remaining = unpaid ? outstanding : (v.rule?.amount ?? 0n);
  const part = v.balance.lines.find((l) => l.status === 'part');
  const lease = tn ? leaseEndsIn(tn.endDate, today, 60) : null;
  const strip = rentStrip(v.balance, today);
  const statusText: Record<string, string> = {
    paid: w.statusPaid,
    part: w.statusPart,
    due: w.statusDue,
    overdue: w.statusOverdue,
    vacant: w.statusVacant,
  };
  const facts: [IconName, string, string, (() => void)?][] = tn
    ? [
        ['person-outline', w.tenantRow, tn.tenantName],
        ['calendar-outline', w.leaseRow, tn.endDate ? day(tn.endDate) : w.openEnded],
        [
          'cash-outline',
          w.refundableDepositHeld,
          fmt(tn.depositHeld, cur),
          () => setOpen('deposit'),
        ],
      ]
    : [];

  const payments: PersonalTxn[] = tn ? paymentsOfTenancy(ledger.txns, v.rules) : [];
  const lastPayment = [...payments].sort((a, b) => (a.date < b.date ? 1 : -1))[0] ?? null;

  const record = (amount: bigint, date: string): void => {
    // A full payment of an untouched due date keeps one fixed id (see recordRent).
    const full = fullPaymentOf(unpaid, amount);
    if (!v.rule) return;
    void writes.recordRent(v.rule, prop.id, amount, date, unit, full).then(hapticSuccess, () => {});
  };
  const lastBy = lastPayment
    ? store.records.find((r) => r.id === lastPayment.id)?.created_by
    : null;
  const recordedBy = lastBy
    ? memberNameById(members, lastBy, {
        viewerId,
        blocked: blockedIds,
        someone: t.misc.someone,
        leftLabel: t.misc.memberLeft,
      })
    : null;
  const share = async (): Promise<void> => {
    if (!isPro) {
      router.push('/paywall');
      return;
    }
    if (!lastPayment || !tn) return;
    try {
      await Share.share({
        title: w.receiptTitle,
        message: [
          w.receiptTitle,
          fill(w.receiptLine, {
            amount: fmt(lastPayment.amount, cur),
            name: tn.tenantName,
            date: day(lastPayment.date),
            unit,
          }),
          '',
          w.receiptFooter,
        ].join('\n'),
      });
    } catch {
      // A dismissed sheet is not an error.
    }
  };

  const editItem: OverflowMenuItem = {
    icon: 'create-outline',
    label: t.personal.editDetails,
    onPress: () => setRenaming(true),
  };
  const items: OverflowMenuItem[] = tn
    ? [
        editItem,
        {
          icon: 'document-text-outline',
          label: w.shareReceipt,
          disabled: !lastPayment,
          hint: isPro ? undefined : w.proOnly,
          onPress: () => void share(),
        },
        { icon: 'swap-vertical-outline', label: w.raiseRent, onPress: () => setOpen('change') },
        { icon: 'exit-outline', label: w.tenantLeft, onPress: () => setOpen('left') },
        {
          icon: 'trash-outline',
          label: t.common.delete,
          tone: 'danger',
          onPress: () => {
            void (async () => {
              if (
                !(await confirm({
                  title: t.common.delete,
                  body: t.personal.deleteRental,
                  confirmLabel: t.common.delete,
                  tone: 'danger',
                }))
              )
                return;
              await writes.deleteTenancy(tn);
              for (const r of v.rules) await del.mutateAsync(r.id);
              for (const txnId of linkedPersonalTxnIds(ledger.txns, { propertyId: prop.id }))
                await del.mutateAsync(txnId);
              await del.mutateAsync(prop.id);
              await deleteAllDocs(prop.id);
              router.back();
            })();
          },
        },
      ]
    : [
        editItem,
        {
          icon: 'trash-outline',
          label: t.common.delete,
          tone: 'danger',
          onPress: () =>
            void (async () => {
              if (
                !(await confirm({
                  title: t.common.delete,
                  body: t.personal.deleteRental,
                  confirmLabel: t.common.delete,
                  tone: 'danger',
                }))
              )
                return;
              for (const txnId of linkedPersonalTxnIds(ledger.txns, { propertyId: prop.id }))
                await del.mutateAsync(txnId);
              await del.mutateAsync(prop.id);
              await deleteAllDocs(prop.id);
              router.back();
            })(),
        },
      ];

  const settle = tn ? settleDeposit(tn.depositHeld, returned ?? tn.depositHeld) : null;
  const suggested =
    v.rule && tn?.escalationPct
      ? v.rule.amount + (v.rule.amount * BigInt(Math.round(tn.escalationPct * 100))) / 10_000n
      : (v.rule?.amount ?? 0n);

  return (
    <Screen edges={[]}>
      <PlainHeader
        title={prop.name}
        subtitle={
          spaceName ? `${w.propertyTypes[prop.type]} · ${spaceName}` : w.propertyTypes[prop.type]
        }
        subtitleIcon={
          <Ionicons name={PROPERTY_ICON[prop.type]} size={iconSize.sm} color={theme.color.brand} />
        }
        trailing={
          <IconButton label={t.personalHome.toolMore} onPress={() => setMenu(true)}>
            <Ionicons name="ellipsis-vertical" size={iconSize.md} color={theme.color.text} />
          </IconButton>
        }
      />
      <DetailEnter>
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: theme.spacing.lg,
            paddingBottom: theme.spacing.lg,
            gap: theme.spacing.md,
          }}
        >
          <Animated.View layout={glide}>
            <StandardCard
              style={{ backgroundColor: theme.color.brandSoft, borderColor: theme.color.brandSoft }}
            >
              <Row style={{ alignItems: 'center' }}>
                <View style={{ flex: 1, gap: theme.spacing.xs }}>
                  {tn ? (
                    <>
                      <Text variant="body" tone="muted">
                        {w.rentDueCap}
                      </Text>
                      <SwapText value={fmt(outstanding, cur)} />
                      <Row style={{ alignItems: 'center', gap: theme.spacing.xs }}>
                        <Ionicons
                          name="calendar-outline"
                          size={iconSize.sm}
                          color={theme.color.textMuted}
                        />
                        <Text variant="caption" tone="muted">
                          {w[heroCaptionKey(v.status)]}
                        </Text>
                      </Row>
                      {space && recordedBy ? (
                        <Text variant="caption" tone="muted">
                          {fill(w.recordedBy, { name: recordedBy })}
                        </Text>
                      ) : null}
                      {part ? (
                        <Text variant="caption">
                          {fill(w.partLine, {
                            paid: fmt(part.paid, cur),
                            due: fmt(part.amount, cur),
                            left: fmt(part.amount - part.paid, cur),
                          })}
                        </Text>
                      ) : null}
                      {v.next ? (
                        <Text variant="caption" tone="muted">
                          {fill(w.raiseFuture, {
                            amount: fmt(v.next.amount, cur),
                            date: day(v.next.anchorDate),
                          })}
                        </Text>
                      ) : null}
                      <View style={{ marginTop: theme.spacing.sm }}>
                        <Button
                          label={w.recordRent}
                          icon={
                            <Ionicons
                              name="wallet-outline"
                              size={iconSize.md}
                              color={theme.color.onButtonPrimary}
                            />
                          }
                          onPress={() => setOpen('rent')}
                        />
                      </View>
                    </>
                  ) : (
                    <>
                      <Text variant="caption" tone="muted">
                        {w.vacantNote}
                      </Text>
                      <View style={{ marginTop: theme.spacing.sm }}>
                        <Button
                          label={w.addTenant}
                          onPress={() =>
                            router.push({
                              pathname: '/rentals/tenant',
                              params: { id: prop.id, ...spaceParams(space) },
                            })
                          }
                        />
                      </View>
                    </>
                  )}
                </View>
                <Animated.View entering={reduce ? undefined : settleEntering(80)}>
                  <PropertyArt type={prop.type} />
                </Animated.View>
              </Row>
            </StandardCard>
          </Animated.View>

          {raise ? (
            <Animated.View layout={glide}>
              <RaiseCard prompt={raise} groupId={space} />
            </Animated.View>
          ) : null}

          {tn && unpaid && asked ? (
            <Animated.View exiting={FadeOut.duration(160)}>
              <StandardCard style={{ gap: theme.spacing.md }}>
                <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: theme.radius.md,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: GREEN_TINT,
                    }}
                  >
                    <Ionicons name="wallet-outline" size={iconSize.md} color={GREEN} />
                  </View>
                  <Text variant="body" style={{ fontWeight: '600', flex: 1 }}>
                    {fill(w.confirmQ, { name: tn.tenantName, amount: fmt(remaining, cur), unit })}
                  </Text>
                </Row>
                <Row style={{ gap: theme.spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <Button
                      label={w.yesReceived}
                      icon={
                        <Ionicons
                          name="checkmark"
                          size={iconSize.md}
                          color={theme.color.onButtonPrimary}
                        />
                      }
                      onPress={() => record(remaining, today)}
                    />
                  </View>
                  <TintButton
                    label={w.notYet}
                    icon="time-outline"
                    bg={theme.color.brandSoft}
                    fg={theme.color.brand}
                    onPress={() => setAsked(false)}
                  />
                </Row>
              </StandardCard>
            </Animated.View>
          ) : null}

          {tn ? (
            <Animated.View layout={glide}>
              <StandardCard style={{ gap: theme.spacing.md }}>
                {facts.map(([icon, label, value, onPress], i) => (
                  <Pressable
                    key={label}
                    disabled={!onPress}
                    accessibilityRole={onPress ? 'button' : undefined}
                    accessibilityLabel={`${label} ${value}`}
                    onPress={onPress}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: theme.spacing.md,
                      paddingBottom: i < facts.length - 1 ? theme.spacing.md : 0,
                      borderBottomWidth: i < facts.length - 1 ? 1 : 0,
                      borderBottomColor: theme.color.border,
                    }}
                  >
                    <Ionicons name={icon} size={iconSize.md} color={theme.color.textMuted} />
                    <Text variant="caption" tone="muted" style={{ flex: 1 }}>
                      {label}
                    </Text>
                    <Text variant="body" style={{ fontWeight: '700' }}>
                      {value}
                    </Text>
                    {onPress ? (
                      <Ionicons
                        name={directionalIcon('chevron-forward')}
                        size={iconSize.sm}
                        color={theme.color.textMuted}
                      />
                    ) : null}
                  </Pressable>
                ))}
                {lease !== null ? (
                  <StatusPill label={fill(w.leaseEndsIn, { n: lease })} tone="warning" />
                ) : null}
              </StandardCard>
            </Animated.View>
          ) : null}

          <Animated.View layout={glide}>
            <DocumentsCard propertyId={prop.id} region={region} groupId={space} />
          </Animated.View>
          <Animated.View layout={glide}>
            <DetailsCard prop={prop} tenancy={tn} groupId={space} />
          </Animated.View>

          {tn ? (
            <Animated.View layout={glide} style={{ gap: theme.spacing.sm }}>
              <SectionHeader title={w.last12} />
              <StandardCard>
                <Row style={{ alignItems: 'stretch' }}>
                  {strip.map((m, i) => {
                    const mark = stripMark(m.state);
                    const current = i === strip.length - 1;
                    const color =
                      mark === 'alert'
                        ? theme.color.negativeText
                        : mark === 'warn'
                          ? theme.color.warning
                          : mark === 'check'
                            ? GREEN
                            : theme.color.textMuted;
                    return (
                      <Animated.View
                        key={m.month}
                        entering={
                          reduce
                            ? undefined
                            : FadeInDown.duration(220)
                                .easing(EASE_OUT)
                                .delay(160 + i * 30)
                        }
                        accessible
                        accessibilityLabel={`${month(m.month)} ${statusText[m.state] ?? ''}`}
                        style={{
                          flex: 1,
                          alignItems: 'center',
                          gap: 6,
                          paddingVertical: 6,
                          borderRadius: theme.radius.md,
                          backgroundColor: current ? theme.color.negativeSoft : undefined,
                        }}
                      >
                        <Text variant="micro" tone="muted">
                          {month(m.month)}
                        </Text>
                        <StripBadge mark={mark} />
                        {mark === 'dash' && !current ? (
                          <Text variant="micro" style={{ color }}>
                            -
                          </Text>
                        ) : mark === 'alert' || mark === 'warn' || mark === 'check' || current ? (
                          <>
                            {mark === 'alert' || mark === 'warn' ? (
                              <Text variant="micro" style={{ color }}>
                                •
                              </Text>
                            ) : null}
                            {current ? (
                              <Text
                                variant="micro"
                                numberOfLines={1}
                                style={{ fontSize: 9, color }}
                              >
                                {statusText[m.state] ?? ''}
                              </Text>
                            ) : null}
                          </>
                        ) : null}
                      </Animated.View>
                    );
                  })}
                </Row>
              </StandardCard>
            </Animated.View>
          ) : null}
        </ScrollView>
        <Row
          style={{
            gap: theme.spacing.sm,
            paddingHorizontal: theme.spacing.lg,
            paddingTop: theme.spacing.sm,
            paddingBottom: clearance + theme.spacing.sm,
          }}
        >
          <TintButton
            label={w.addExpense}
            icon="document-text-outline"
            bg={theme.color.brandSoft}
            fg={theme.color.brand}
            onPress={() => setOpen('expense')}
          />
          {tn ? (
            <TintButton
              label={w.receiptsBtn}
              icon="receipt-outline"
              bg={theme.color.surfaceMuted}
              fg={theme.color.text}
              disabled={!lastPayment}
              onPress={() => void share()}
            />
          ) : null}
        </Row>
      </DetailEnter>

      <AmountSheet
        visible={open === 'rent'}
        title={`${w.recordRent} · ${w.partPayment}`}
        currency={cur}
        initial={remaining}
        withDate
        saveLabel={w.save}
        onClose={() => setOpen(null)}
        onSave={(amount, date) => {
          record(amount, date);
          setOpen(null);
        }}
      />
      <AmountSheet
        visible={open === 'expense'}
        title={w.expenseTitle}
        currency={cur}
        withDate
        notePlaceholder={w.expenseNote}
        saveLabel={w.save}
        onClose={() => setOpen(null)}
        onSave={(amount, date, note) => {
          void writes.addExpense(prop, amount, date, note, null);
          setOpen(null);
        }}
      />
      <AmountSheet
        visible={open === 'change'}
        title={w.newRentQ}
        currency={cur}
        initial={suggested}
        saveLabel={w.save}
        onClose={() => setOpen(null)}
        onSave={(amount) => {
          if (v.rule) void writes.changeRent(v.rule, amount, today);
          setOpen(null);
        }}
      />
      {tn && open === 'deposit' ? (
        <AmountSheet
          visible
          title={fill(w.depositQ, { term: noun })}
          currency={cur}
          initial={tn.depositHeld}
          saveLabel={w.save}
          onClose={() => setOpen(null)}
          onSave={(amount) => {
            void writes.saveTenancy({ ...tn, depositHeld: amount });
            setOpen(null);
          }}
        />
      ) : null}
      {tn && settle ? (
        <Sheet
          visible={open === 'left'}
          onClose={() => setOpen(null)}
          title={fill(w.settleQ, { term: noun })}
          closeLabel={t.common.close}
        >
          <View style={{ gap: theme.spacing.lg }}>
            <Text variant="caption" tone="muted">
              {fill(w.depositLine, { amount: fmt(tn.depositHeld, cur), term: noun })}
            </Text>
            <Text variant="caption">{w.returned}</Text>
            <AmountField currency={cur} value={settle.returned} onChange={setReturned} />
            <Row style={{ justifyContent: 'space-between' }}>
              <Text variant="body">{w.kept}</Text>
              <Text variant="body" style={{ fontWeight: '700' }}>
                {fmt(settle.kept, cur)}
              </Text>
            </Row>
            <Button
              fullWidth
              label={w.save}
              onPress={() => {
                void writes.tenantLeft(tn, prop, v.rules, settle.returned, settle.kept, today);
                setOpen(null);
              }}
            />
          </View>
        </Sheet>
      ) : null}
      <RenameSheet
        visible={renaming}
        title={t.personal.editDetails}
        placeholder={w.propNamePlaceholder}
        initial={prop.name}
        onClose={() => setRenaming(false)}
        onSave={(name) => {
          void writes.saveProperty({ ...prop, name });
          setRenaming(false);
        }}
      />
      <OverflowMenu visible={menu} onClose={() => setMenu(false)} items={items} />
    </Screen>
  );
}

export default function RentalDetailScreen() {
  return (
    <PersonalGuard>
      <DetailBody />
    </PersonalGuard>
  );
}
