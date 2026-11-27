/**
 * Loans (A48): money you owe or are owed, tracked with a running balance. A loan
 * carries its principal; each repayment is a normal ledger entry linked to it
 * ("Record payment" opens the entry form pre-linked), and what is left is the
 * principal less those payments. The editor is an inline sheet.
 */

import { useEffect, useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import DateTimePicker from '@react-native-community/datetimepicker';
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type EntryExitAnimationFunction,
} from 'react-native-reanimated';
import { useLocalSearchParams } from 'expo-router';
import {
  Image,
  Platform,
  Pressable,
  ScrollView,
  Share,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';

import {
  canUnlink,
  cleanCounterpart,
  encodeLoan,
  format,
  loanOutstanding,
  shareBlocker,
  syncedOutstanding,
  currencySymbol,
  minorUnitScale,
  money,
  type LoanDirection,
  type PersonalLoan,
  linkedPersonalTxnIds,
} from '@waves/core';
import {
  AmountField,
  Button,
  directionalIcon,
  Divider,
  ChipRow,
  IconButton,
  iconSize,
  Row,
  Screen,
  Sheet,
  Text,
  useTheme,
} from '@waves/ui';

import type { PickedContact } from '@/components/ContactPicker';
import { DetailRow } from '@/components/DetailRows';
import { LoanPersonPicker } from '@/components/LoanPersonPicker';
import { useSyncedLoanNets } from '@/data/hooks';
import { useShareLoan, useUnshareLoan } from '@/data/syncedLoans';
import { friendlyError } from '@/lib/errors';
import { useViewerId } from '@/lib/auth';
import { PersonalNoteField } from '@/components/PersonalNoteField';
import {
  localIsoDate,
  todayIso,
  usePersonalLedger,
  useDeletePersonalRecord,
  useUpsertPersonalRecord,
} from '@/data/personal';
import { useDefaultCurrency } from '@/lib/currency';
import { fill, useStrings } from '@/i18n';
import { PersonalGuard } from '@/components/PersonalGuard';
import { EASE_OUT } from '@/lib/anim';
import { useBottomClearance } from '@/lib/clearance';
import { useReducedMotion } from '@/lib/reducedMotion';
import { router } from '@/lib/navigation';
import { useDialog } from '@/lib/dialog';
import { SPEC_ACCENT, SPEC_INK, SPEC_MUTED } from '@/lib/specPalette';
import { settleHref } from '@/lib/groupTab';
import { BALANCE_MASK } from '@/components/home/HomeBalanceCard';
import { AddReminderSheet } from '@/components/personal/AddReminderSheet';
import { PlainHeader, StandardCard } from '@/components/standard';
import { usePersonalAmountsHidden } from '@/lib/amountsHidden';
import { loanTotals, matchesLoanFilter, repaid, type LoanFilter } from '@/lib/loansSummary';
import { formatLoanPaymentDate, loanPaymentDefaults } from '@/lib/loanPayment';
import { EmptyStateCta } from '@/components/EmptyStateCta';
import { OverflowMenu, type OverflowMenuItem } from '@/components/OverflowMenu';
import { loanHeaderAddVisible, loanNextStatus } from '@/lib/personalLayoutRules';

function LoansScreenBody() {
  const theme = useTheme();
  const clearance = useBottomClearance();
  const { t, locale } = useStrings();
  const dc = useDefaultCurrency();
  const { loans, txns } = usePersonalLedger();
  // Everyone a loan has been with before, for the sheet's "With" suggestions.
  const names = [...new Set(loans.map((loan) => loan.counterpart.trim()).filter(Boolean))];

  const [today] = useState(() => todayIso());
  const [editing, setEditing] = useState<PersonalLoan | null>(null);
  const [creating, setCreating] = useState(false);
  const { share } = useLocalSearchParams<{ share?: string }>();
  const [sharing, setSharing] = useState<PersonalLoan | null>(null);
  const [reminding, setReminding] = useState<PersonalLoan | null>(null);
  const [filter, setFilter] = useState<LoanFilter>('all');
  const { hidden } = usePersonalAmountsHidden();
  const [shareDismissed, setShareDismissed] = useState(false);
  const [menuLoan, setMenuLoan] = useState<PersonalLoan | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const loanButtonRefs = useRef(new Map<string, View>());
  const loanUpsert = useUpsertPersonalRecord();
  const loanRemove = useDeletePersonalRecord();
  const loanUnshare = useUnshareLoan();
  const { confirm: confirmLoanAction } = useDialog();

  // A shared loan's outstanding amount is the balance in its 1:1 group (repaid
  // through the ordinary settle-up flow), not the personal ledger's own sum.
  const viewerId = useViewerId();
  const nets = useSyncedLoanNets(
    viewerId,
    loans.flatMap((loan) => (loan.synced ? [loan.synced] : [])),
  );
  const syncedLeft = syncedOutstanding(loans, nets.nets);
  const leftOf = (loan: PersonalLoan): bigint => {
    if (!loan.synced) return loanOutstanding(loan, txns);
    // Until the group is on this device the principal is the honest figure.
    if (!nets.groups.has(loan.synced.groupId)) return loan.principal;
    return syncedLeft.get(loan.id) ?? 0n;
  };

  // The assistant hands a fresh loan over with `?share=<id>`: open its share
  // sheet once the record has landed in the ledger.
  const wanted = share ? (loans.find((loan) => loan.id === share) ?? null) : null;
  const shareLoanTarget = sharing ?? (wanted && !wanted.synced && !shareDismissed ? wanted : null);

  const show = (n: bigint, cur: string = dc): string =>
    hidden ? BALANCE_MASK : format(money(n, cur), { locale });
  const totals = loanTotals(
    loans.map((l) => ({ direction: l.direction, left: leftOf(l), status: l.status })),
  );
  const sorted = [...loans].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
    return a.startDate < b.startDate ? 1 : -1;
  });

  return (
    <Screen>
      <PlainHeader
        title={t.personal.loans}
        subtitle={t.personal.loansSub}
        trailing={
          loanHeaderAddVisible(sorted.length) ? (
            <IconButton label={t.personal.addLoan} onPress={() => setCreating(true)}>
              <Ionicons name="add" size={iconSize.xl} color={theme.color.brand} />
            </IconButton>
          ) : null
        }
      />

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: clearance,
          gap: theme.spacing.md,
        }}
        showsVerticalScrollIndicator={false}
      >
        <ChipRow<'recurring' | 'budgets' | 'loans'>
          value="loans"
          onChange={(v) => {
            if (v !== 'loans')
              router.push(v === 'budgets' ? '/personal/budgets' : '/personal/recurring');
          }}
          variant="brand"
          onCard
          options={[
            { value: 'recurring', label: t.personal.recurring },
            { value: 'budgets', label: t.personal.budgets },
            { value: 'loans', label: t.personal.loans },
          ]}
        />
        {sorted.length === 0 ? (
          <EmptyStateCta
            compact
            title={t.personal.noLoans}
            body={t.personal.noLoansBody}
            action={t.personal.addLoan}
            onAdd={() => setCreating(true)}
          />
        ) : (
          <>
            <StandardCard>
              <Row style={{ alignItems: 'center' }}>
                <View style={{ flex: 1 }}>
                  <Text variant="caption" tone="muted">
                    {t.personal.loansTotal}
                  </Text>
                  <Text
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    style={{ fontSize: 26, lineHeight: 32, fontWeight: '800' }}
                  >
                    {show(totals.total)}
                  </Text>
                </View>
                <Image
                  source={require('../../../assets/images/personal-loans.webp')}
                  resizeMode="contain"
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  style={{ width: 72, height: 56 }}
                />
              </Row>
              <Divider />
              <Row style={{ marginTop: theme.spacing.sm }}>
                <TotalHalf icon="arrow-down" label={t.personal.youOwe} value={show(totals.owe)} />
                <TotalHalf
                  icon="arrow-up"
                  label={t.personal.youAreOwed}
                  value={show(totals.owed)}
                />
              </Row>
            </StandardCard>

            <Row
              accessibilityLabel={t.personalHome.filterLabel}
              style={{
                backgroundColor: theme.color.surface,
                borderRadius: theme.radius.pill,
                padding: 4,
                gap: 2,
              }}
            >
              {(
                [
                  ['all', t.personalHome.filterAll, null],
                  ['owe', t.personal.youOwe, 'arrow-down'],
                  ['owed', t.personal.youAreOwed, 'arrow-up'],
                ] as const
              ).map(([value, label, icon]) => {
                const on = filter === value;
                const text = `${label}${hidden ? '' : ` (${totals.counts[value]})`}`;
                return (
                  <Pressable
                    key={value}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={text}
                    onPress={() => setFilter(value)}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 4,
                      minHeight: 40,
                      borderRadius: theme.radius.pill,
                      backgroundColor: on ? theme.color.brand : 'transparent',
                    }}
                  >
                    {icon ? (
                      <Ionicons
                        name={icon}
                        size={iconSize.sm}
                        color={on ? theme.color.onBrand : theme.color.text}
                      />
                    ) : null}
                    <Text
                      variant="caption"
                      numberOfLines={2}
                      style={{
                        fontWeight: '600',
                        flexShrink: 1,
                        color: on ? theme.color.onBrand : theme.color.text,
                      }}
                    >
                      {text}
                    </Text>
                  </Pressable>
                );
              })}
            </Row>

            {sorted
              .filter((loan) => matchesLoanFilter(loan.direction, filter))
              .map((loan) => {
                const left = leftOf(loan);
                const borrowed = loan.direction === 'borrowed';
                const settled = loan.status === 'closed' || left === 0n;
                const name = loan.counterpart || (borrowed ? t.personal.borrowed : t.personal.lent);
                const done = repaid(loan.principal, left);
                const fmt = (n: bigint) => show(n, loan.currency);
                const actions: {
                  key: string;
                  icon: keyof typeof Ionicons.glyphMap;
                  label: string;
                  onPress: () => void;
                  primary?: boolean;
                }[] = [
                  {
                    key: 'pay',
                    icon: 'card-outline',
                    label: t.personal.recordPayment,
                    primary: true,
                    onPress: () => {
                      if (loan.synced) {
                        router.push(settleHref(loan.synced.groupId));
                        return;
                      }
                      router.push({
                        pathname: '/personal/entry',
                        params: {
                          loanId: loan.id,
                          kind: borrowed ? 'expense' : 'income',
                          recordPayment: '1',
                          ...loanPaymentDefaults(loan),
                        },
                      });
                    },
                  },
                  {
                    key: 'remind',
                    icon: 'calendar-outline',
                    label: t.personal.addReminderShort,
                    onPress: () => setReminding(loan),
                  },
                  {
                    key: 'edit',
                    icon: 'create-outline',
                    label: t.personal.editDetails,
                    onPress: () => setEditing(loan),
                  },
                  {
                    key: 'share',
                    icon: 'share-social-outline',
                    label: t.personal.shareAction,
                    onPress: () =>
                      void Share.share({
                        message: fill(
                          borrowed ? t.personal.loanShareOwe : t.personal.loanShareLent,
                          {
                            name,
                            amount: format(money(left, loan.currency), { locale }),
                            repaid: format(money(done.amount, loan.currency), { locale }),
                          },
                        ),
                      }),
                  },
                ];
                return (
                  <StandardCard key={loan.id} style={{ gap: theme.spacing.sm }}>
                    <Row style={{ alignItems: 'center' }}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`${name}, ${settled ? t.personal.paidOff : t.personal.outstanding} ${fmt(left)}`}
                        onPress={() => setEditing(loan)}
                      >
                        <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
                          <View
                            style={{
                              width: 40,
                              height: 40,
                              borderRadius: theme.radius.md,
                              alignItems: 'center',
                              justifyContent: 'center',
                              backgroundColor: theme.color.brandSoft,
                            }}
                          >
                            <Ionicons
                              name={borrowed ? 'arrow-down' : 'arrow-up'}
                              size={iconSize.md}
                              color={theme.color.brand}
                            />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text variant="body" numberOfLines={1} style={{ fontWeight: '800' }}>
                              {name}
                            </Text>
                            <Text variant="micro" tone="muted" numberOfLines={1}>
                              {borrowed ? t.personal.borrowed : t.personal.lent} ·{' '}
                              {fmt(loan.principal)}
                            </Text>
                            {loan.synced ? (
                              <Row style={{ alignItems: 'center', gap: 4, marginTop: 2 }}>
                                <Ionicons
                                  name="people-outline"
                                  size={12}
                                  color={theme.color.brand}
                                />
                                <Text
                                  variant="micro"
                                  style={{ color: theme.color.brand }}
                                  numberOfLines={1}
                                >
                                  {fill(t.personal.visibleTo, { name: loan.counterpart })}
                                </Text>
                              </Row>
                            ) : null}
                          </View>
                          <View style={{ alignItems: 'flex-end' }}>
                            <Text variant="micro" tone="muted">
                              {settled ? t.personal.paidOff : t.personal.outstanding}
                            </Text>
                            <Text variant="body" style={{ fontWeight: '800' }}>
                              {fmt(left)}
                            </Text>
                          </View>
                          <Ionicons
                            name={directionalIcon('chevron-forward')}
                            size={iconSize.sm}
                            color={theme.color.textMuted}
                          />
                        </Row>
                      </Pressable>
                      <IconButton
                        label={t.personalHome.toolMore}
                        onPress={() => {
                          setMenuLoan(loan);
                          const node = loanButtonRefs.current.get(loan.id);
                          node?.measureInWindow((x, y, width, height) =>
                            setMenuAnchor({ x, y, width, height }),
                          );
                        }}
                      >
                        <View
                          ref={(node) => {
                            if (node) loanButtonRefs.current.set(loan.id, node);
                          }}
                        >
                          <Ionicons
                            name="ellipsis-vertical"
                            size={iconSize.md}
                            color={theme.color.textMuted}
                          />
                        </View>
                      </IconButton>
                    </Row>
                    <Divider />
                    <Row style={{ justifyContent: 'space-between' }}>
                      <Text variant="caption" numberOfLines={1} style={{ flex: 1 }}>
                        {fill(t.personal.repaidOf, {
                          paid: fmt(done.amount),
                          total: fmt(loan.principal),
                        })}
                      </Text>
                      <Text variant="caption" tone="muted">
                        {hidden ? '' : `${done.percent}%`}
                      </Text>
                    </Row>
                    {done.amount > 0n ? (
                      <Pressable
                        accessibilityRole="link"
                        accessibilityLabel={t.personal.seePayments}
                        hitSlop={8}
                        onPress={() =>
                          router.push({
                            pathname: '/personal/transactions',
                            params: { loan: loan.id, returnTo: '/personal/loans' },
                          })
                        }
                      >
                        <Text
                          variant="caption"
                          style={{ color: theme.color.brand, fontWeight: '600' }}
                        >
                          {t.personal.seePayments}
                        </Text>
                      </Pressable>
                    ) : null}
                    <View
                      accessible
                      accessibilityRole="progressbar"
                      accessibilityValue={
                        hidden ? undefined : { min: 0, max: 100, now: done.percent }
                      }
                      style={{
                        height: 8,
                        borderRadius: 4,
                        overflow: 'hidden',
                        backgroundColor: theme.color.brandSoft,
                      }}
                    >
                      <View
                        style={{
                          width: `${hidden ? 0 : done.percent}%`,
                          height: 8,
                          backgroundColor: theme.color.brand,
                        }}
                      />
                    </View>
                    <Divider />
                    <Row>
                      {actions.map((a) => (
                        <Pressable
                          key={a.key}
                          accessibilityRole="button"
                          accessibilityLabel={a.label}
                          onPress={a.onPress}
                          style={{
                            flex: 1,
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 4,
                            paddingVertical: theme.spacing.sm,
                            borderRadius: theme.radius.md,
                            backgroundColor: a.primary ? theme.color.brandSoft : 'transparent',
                          }}
                        >
                          <Ionicons
                            name={a.icon}
                            size={iconSize.md}
                            color={a.primary ? theme.color.brand : theme.color.text}
                          />
                          <Text
                            variant="micro"
                            align="center"
                            style={{
                              fontWeight: '600',
                              color: a.primary ? theme.color.brand : theme.color.text,
                            }}
                          >
                            {a.label}
                          </Text>
                        </Pressable>
                      ))}
                    </Row>
                    {/* The 1:1 link: shared loans repay through the group; others can be offered to the person. */}
                    {!settled && !loan.synced && shareBlocker(loan) === null ? (
                      <Button
                        label={fill(t.personal.shareWith, {
                          name: cleanCounterpart(loan.counterpart),
                        })}
                        size="sm"
                        variant="ghost"
                        onPress={() => setSharing(loan)}
                      />
                    ) : null}
                  </StandardCard>
                );
              })}
          </>
        )}
      </ScrollView>

      <OverflowMenu
        visible={!!menuLoan}
        onClose={() => setMenuLoan(null)}
        anchor={menuAnchor}
        items={
          menuLoan
            ? loanMenuItems(
                menuLoan,
                leftOf(menuLoan),
                txns,
                t,
                confirmLoanAction,
                loanUpsert,
                loanRemove,
                loanUnshare,
                () => setMenuLoan(null),
                locale,
              )
            : []
        }
      />
      {reminding ? (
        <AddReminderSheet
          visible
          currency={reminding.currency}
          today={today}
          initialTitle={fill(
            reminding.direction === 'borrowed'
              ? t.personal.loanReminderOwe
              : t.personal.loanReminderLent,
            { name: cleanCounterpart(reminding.counterpart) },
          )}
          // A lent loan is money coming in, so only a borrowed one carries an expense amount.
          initialAmount={
            reminding.direction === 'borrowed'
              ? String(Number(leftOf(reminding)) / Number(minorUnitScale(reminding.currency)))
              : ''
          }
          onClose={() => setReminding(null)}
        />
      ) : null}

      {creating ? (
        <LoanEditor
          loans={loans}
          currency={dc}
          today={today}
          names={names}
          onClose={() => setCreating(false)}
        />
      ) : null}
      {editing ? (
        <LoanEditor
          loans={loans}
          loan={editing}
          left={leftOf(editing)}
          currency={dc}
          today={today}
          names={names}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {shareLoanTarget ? (
        <ShareLoanSheet
          loans={loans}
          loan={shareLoanTarget}
          onClose={() => {
            setSharing(null);
            setShareDismissed(true);
          }}
        />
      ) : null}
    </Screen>
  );
}

/** The names dropdown grows from just under its field: 3% scale and a fade, from the top edge. */
const dropdownIn: EntryExitAnimationFunction = () => {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ scale: 0.97 }] },
    animations: {
      opacity: withTiming(1, { duration: 160, easing: EASE_OUT }),
      transform: [{ scale: withTiming(1, { duration: 160, easing: EASE_OUT }) }],
    },
  };
};

/** One chevron that turns over when the dropdown opens, rather than swapping glyphs. */
function DropChevron({ open, color }: { open: boolean; color: string }) {
  const reduce = useReducedMotion();
  const turn = useSharedValue(open ? 1 : 0);
  useEffect(() => {
    turn.set(
      reduce ? (open ? 1 : 0) : withTiming(open ? 1 : 0, { duration: 180, easing: EASE_OUT }),
    );
  }, [open, reduce, turn]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.get() * 180}deg` }] }));
  return (
    <Animated.View style={style}>
      <Ionicons name="chevron-down" size={20} color={color} />
    </Animated.View>
  );
}

function loanMenuItems(
  loan: PersonalLoan,
  left: bigint,
  txns: readonly import('@waves/core').PersonalTxn[],
  t: ReturnType<typeof useStrings>['t'],
  confirm: ReturnType<typeof useDialog>['confirm'],
  upsert: ReturnType<typeof useUpsertPersonalRecord>,
  remove: ReturnType<typeof useDeletePersonalRecord>,
  unshare: ReturnType<typeof useUnshareLoan>,
  close: () => void,
  _locale: string,
): OverflowMenuItem[] {
  const unlinkable = loan.synced ? canUnlink(loan, new Map([[loan.id, left]])) : false;
  const flip = (): void => {
    void upsert
      .mutateAsync({
        recordId: loan.id,
        recordKind: 'loan',
        data: encodeLoan({ ...loan, status: loanNextStatus(loan.status) }),
      })
      .then(close);
  };
  const items: OverflowMenuItem[] = [
    {
      icon: loan.status === 'closed' ? 'refresh-outline' : 'checkmark-done-outline',
      label: loan.status === 'closed' ? t.personal.reopenLoan : t.personal.markLoanClosed,
      section: 'state',
      onPress: flip,
    },
  ];
  if (loan.synced)
    items.push({
      icon: 'people-outline',
      label: t.personal.stopSharing,
      section: 'share',
      disabled: !unlinkable,
      hint: unlinkable ? undefined : t.personal.cannotStopSharing,
      onPress: () => {
        if (unlinkable) void unshare.mutateAsync(loan).then(close);
      },
    });
  items.push({
    icon: 'trash-outline',
    label: t.common.delete,
    tone: 'danger',
    section: 'danger',
    onPress: () => {
      void confirm({
        title: t.common.delete,
        body: loan.synced
          ? `Delete this loan and its payments? ${unlinkable ? t.personal.deleteSharedBody : fill(t.personal.deleteSharedKept, { name: loan.counterpart })}`
          : 'Delete this loan and its payments?',
        confirmLabel: t.common.delete,
        tone: 'danger',
      }).then(async (ok) => {
        if (!ok) return;
        if (loan.synced && unlinkable) await unshare.mutateAsync(loan);
        for (const id of linkedPersonalTxnIds(txns, { loanId: loan.id }))
          await remove.mutateAsync(id);
        await remove.mutateAsync(loan.id);
        close();
      });
    },
  });
  return items;
}

function LoanEditor({
  loans,
  loan,
  left,
  currency,
  today,
  names,
  onClose,
}: {
  loans: readonly PersonalLoan[];
  loan?: PersonalLoan;
  /** What is still outstanding (shared loans: the group balance). */
  left?: bigint;
  currency: string;
  today: string;
  /** People earlier loans were with, offered under the "With" field. */
  names: readonly string[];
  onClose: () => void;
}) {
  const theme = useTheme();
  const { height: windowHeight } = useWindowDimensions();
  const { t, locale } = useStrings();
  const { dark, ink, muted, accent, lavender } = useLoanInks();
  const [namesOpen, setNamesOpen] = useState(false);
  const reduce = useReducedMotion();
  const upsert = useUpsertPersonalRecord();
  const { txns } = usePersonalLedger();
  const payments = loan ? txns.filter((x) => x.loanId === loan.id).slice(0, 5) : [];
  const shareLoan = useShareLoan(loans);
  const [alsoShare, setAlsoShare] = useState(false);
  const [contact, setContact] = useState<PickedContact | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A shared loan's amount, side and person are the debt in the group: editing
  // them here would quietly disagree with what the other person sees.
  const locked = Boolean(loan?.synced);
  const [direction, setDirection] = useState<LoanDirection>(loan?.direction ?? 'borrowed');
  const [counterpart, setCounterpart] = useState(loan?.counterpart ?? '');
  const [principal, setPrincipal] = useState<bigint>(loan?.principal ?? 0n);
  const [emiAmount, setEmiAmount] = useState<bigint>(() => {
    const amount = loanPaymentDefaults({ carried: loan?.carried }).amount;
    try {
      return amount ? BigInt(amount) : 0n;
    } catch {
      return 0n;
    }
  });
  const [note, setNote] = useState(loan?.note ?? '');
  const [startDate, setStartDate] = useState(loan?.startDate ?? today);
  const [showDate, setShowDate] = useState(false);

  const busy = upsert.isPending || shareLoan.isPending;
  const canSave = principal > 0n && counterpart.trim().length > 0 && !busy;

  const onSave = async (): Promise<void> => {
    if (!canSave) return;
    setError(null);
    const carried = { ...loan?.carried };
    if (emiAmount > 0n) carried.emiAmount = emiAmount.toString();
    else delete carried.emiAmount;
    const next = {
      carried: Object.keys(carried).length ? carried : undefined,
      direction,
      counterpart: locked ? (loan?.counterpart ?? '') : cleanCounterpart(counterpart),
      principal,
      currency: loan?.currency ?? currency,
      note: note.trim() || null,
      startDate,
      status: loan?.status ?? 'active',
      synced: loan?.synced ?? null,
    };
    try {
      const recordId = await upsert.mutateAsync({
        recordId: loan?.id,
        recordKind: 'loan',
        data: encodeLoan(next),
      });
      if (!loan && alsoShare) {
        await shareLoan.mutateAsync({
          loan: { ...next, id: recordId },
          person: { name: next.counterpart, email: contact?.email, phone: contact?.phone },
        });
      }
      onClose();
    } catch (caught) {
      setError(friendlyError(caught, t.personal.shareFailed, 'loans.save'));
    }
  };

  const loanCurrency = loan?.currency ?? currency;
  const others = names.filter((name) => name !== counterpart.trim());
  const fieldBox = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    minHeight: 52,
    paddingHorizontal: 16,
    borderRadius: 16,
    backgroundColor: lavender,
  };

  return (
    <Sheet visible onClose={onClose} padded={false} style={{ maxHeight: '92%', flexShrink: 1 }}>
      <View
        style={{
          paddingHorizontal: theme.spacing.xl,
          paddingTop: theme.spacing.md,
          paddingBottom: theme.spacing.sm,
        }}
      >
        <Row style={{ alignItems: 'flex-start', gap: theme.spacing.md }}>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text style={{ fontSize: 24, fontWeight: '800', color: ink }} numberOfLines={1}>
              {loan ? t.personal.editLoan : t.personal.addLoan}
            </Text>
            {!loan ? (
              <Text style={{ fontSize: 14, color: muted }}>{t.personal.addLoanSub}</Text>
            ) : null}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.common.close}
            onPress={onClose}
            hitSlop={6}
          >
            <Ionicons name="close" size={24} color={ink} />
          </Pressable>
        </Row>
      </View>
      <ScrollView
        style={{ flexGrow: 0, flexShrink: 1, maxHeight: Math.round(windowHeight * 0.92) - 200 }}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.xl,
          paddingBottom: theme.spacing.lg,
          gap: theme.spacing.md,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Row
          accessibilityRole="tablist"
          style={{ padding: 4, borderRadius: 26, backgroundColor: lavender, gap: 4 }}
        >
          {(
            [
              { value: 'borrowed', label: t.personal.borrowed, icon: 'arrow-down-circle-outline' },
              { value: 'lent', label: t.personal.lent, icon: 'arrow-up-circle-outline' },
            ] as const
          ).map((tab) => {
            const on = tab.value === direction;
            return (
              <Pressable
                key={tab.value}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                disabled={locked}
                onPress={() => setDirection(tab.value)}
                style={{
                  opacity: locked && !on ? 0.4 : 1,
                  flex: 1,
                  height: 42,
                  borderRadius: 21,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  backgroundColor: on ? accent : 'transparent',
                }}
              >
                <Ionicons name={tab.icon} size={20} color={on ? '#FFFFFF' : ink} />
                <Text
                  style={{
                    fontSize: 15,
                    fontWeight: on ? '700' : '500',
                    color: on ? '#FFFFFF' : ink,
                  }}
                >
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </Row>

        <FieldLabel>{t.personal.loanAmount}</FieldLabel>
        <View style={fieldBox} pointerEvents={locked ? 'none' : 'auto'}>
          <Text style={{ fontSize: 22, fontWeight: '600', color: ink }}>
            {currencySymbol(loanCurrency, locale)}
          </Text>
          <View
            style={{ width: 1, height: 26, backgroundColor: dark ? theme.color.border : '#E0DCF3' }}
          />
          <View style={{ flex: 1, minWidth: 0 }}>
            <AmountField
              currency={loanCurrency}
              value={principal}
              onChange={setPrincipal}
              size="compact"
              showSymbol={false}
              align="start"
            />
          </View>
        </View>

        <FieldLabel>{t.personalSetup.emiLabel}</FieldLabel>
        <View style={fieldBox} pointerEvents={locked ? 'none' : 'auto'}>
          <Text style={{ fontSize: 22, fontWeight: '600', color: ink }}>
            {currencySymbol(loanCurrency, locale)}
          </Text>
          <View
            style={{ width: 1, height: 26, backgroundColor: dark ? theme.color.border : '#E0DCF3' }}
          />
          <View style={{ flex: 1, minWidth: 0 }}>
            <AmountField
              currency={loanCurrency}
              value={emiAmount}
              onChange={setEmiAmount}
              size="compact"
              showSymbol={false}
              align="start"
            />
          </View>
        </View>

        <FieldLabel>{t.personal.counterpart}</FieldLabel>
        <View style={{ gap: 6 }}>
          <View style={fieldBox}>
            <Ionicons name="person-outline" size={20} color={muted} />
            <TextInput
              value={counterpart}
              editable={!locked}
              onChangeText={setCounterpart}
              placeholder={t.personal.counterpartPlaceholder}
              placeholderTextColor={theme.color.textFaint}
              accessibilityLabel={t.personal.counterpart}
              style={{ flex: 1, fontSize: 16, color: ink, paddingVertical: 12 }}
            />
            {/* Only a dropdown when there is somebody to offer: a chevron over
                an empty list would be a control that does nothing. */}
            {!locked ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t.personal.pickContact}
                onPress={() => setPickerOpen(true)}
                hitSlop={10}
              >
                <Ionicons name="person-add-outline" size={20} color={ink} />
              </Pressable>
            ) : null}
            {others.length > 0 && !locked ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t.personal.pickName}
                accessibilityState={{ expanded: namesOpen }}
                onPress={() => setNamesOpen((open) => !open)}
                hitSlop={10}
              >
                <DropChevron open={namesOpen} color={ink} />
              </Pressable>
            ) : null}
          </View>
          {namesOpen && others.length > 0 ? (
            <Animated.View
              entering={reduce ? FadeIn.duration(160) : dropdownIn}
              exiting={FadeOut.duration(120)}
              style={{
                transformOrigin: 'top',
                borderRadius: 14,
                backgroundColor: theme.color.surface,
                borderWidth: 1,
                borderColor: dark ? theme.color.border : '#E7E3F7',
              }}
            >
              {others.map((name, index) => (
                <Pressable
                  key={name}
                  accessibilityRole="button"
                  onPress={() => {
                    setCounterpart(name);
                    setNamesOpen(false);
                  }}
                  style={({ pressed }) => ({
                    paddingVertical: 12,
                    paddingHorizontal: 16,
                    borderTopWidth: index > 0 ? 1 : 0,
                    borderTopColor: dark ? theme.color.border : '#F0EEF7',
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <Text style={{ fontSize: 15, color: ink }}>{name}</Text>
                </Pressable>
              ))}
            </Animated.View>
          ) : null}
        </View>

        {loan?.synced ? (
          <Row style={{ alignItems: 'center', gap: 6 }}>
            <Ionicons name="people-outline" size={16} color={accent} />
            <Text style={{ flex: 1, fontSize: 14, fontWeight: '600', color: accent }}>
              {fill(t.personal.visibleTo, { name: loan.counterpart })}
            </Text>
          </Row>
        ) : !loan && counterpart.trim().length > 0 ? (
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: alsoShare }}
            onPress={() => setAlsoShare((on) => !on)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }}
          >
            <Ionicons
              name={alsoShare ? 'checkbox' : 'square-outline'}
              size={22}
              color={alsoShare ? accent : muted}
            />
            <Text style={{ flex: 1, fontSize: 15, color: ink }}>
              {fill(t.personal.shareToggle, { name: cleanCounterpart(counterpart) })}
            </Text>
          </Pressable>
        ) : null}

        <FieldLabel>{t.personal.notePlaceholder}</FieldLabel>
        {/* The shared note field, so the mic comes with it. The person the
            loan is with is handed to the recogniser: "lent to Ravi for the
            deposit" is exactly the sentence a general model turns into a name
            that was never said. */}
        <PersonalNoteField
          value={note}
          onChange={setNote}
          placeholder={t.personal.loanForPlaceholder}
          accessibilityLabel={t.personal.note}
          hints={counterpart.trim() ? [counterpart.trim()] : undefined}
        />

        {/* The same `DetailRow` the expense and personal-entry forms state
            their date in, so a screen reader hears what the date is for. */}
        <View style={{ borderRadius: 16, backgroundColor: lavender, paddingHorizontal: 16 }}>
          <DetailRow
            icon="calendar-outline"
            label={t.personal.startsOn}
            value={formatLoanPaymentDate(startDate, locale)}
            onPress={() => setShowDate(true)}
          />
        </View>
        {showDate ? (
          <DateTimePicker
            value={new Date(`${startDate}T00:00:00`)}
            mode="date"
            onChange={(event, picked) => {
              if (Platform.OS !== 'ios') setShowDate(false);
              if (event.type === 'set' && picked) setStartDate(localIsoDate(picked));
            }}
          />
        ) : null}

        {payments.length > 0 ? (
          <View style={{ gap: 2 }}>
            <Text variant="caption" tone="muted">
              {t.personal.payments}
            </Text>
            {payments.map((p) => (
              <Pressable
                key={p.id}
                accessibilityRole="button"
                accessibilityLabel={`${formatLoanPaymentDate(p.date, locale)} ${format(money(p.amount, p.currency), { locale })}`}
                onPress={() => {
                  // Leave first: a sheet left over the pushed screen has to be dismissed twice.
                  onClose();
                  router.push({ pathname: '/personal/entry', params: { id: p.id } });
                }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  minHeight: 44,
                }}
              >
                <Text variant="body">{formatLoanPaymentDate(p.date, locale)}</Text>
                <Text variant="body" style={{ fontWeight: '700' }}>
                  {format(money(p.amount, p.currency), { locale, trimZeros: true })}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <LoanPersonPicker
          visible={pickerOpen}
          onClose={() => setPickerOpen(false)}
          onPick={(picked) => {
            setCounterpart(picked.name);
            setContact(picked);
          }}
        />
      </ScrollView>
      <View
        style={{
          paddingHorizontal: theme.spacing.xl,
          paddingTop: theme.spacing.sm,
          paddingBottom: theme.spacing.md,
          borderTopWidth: 1,
          borderTopColor: theme.color.border,
          gap: theme.spacing.sm,
        }}
      >
        {error ? (
          <Text variant="caption" style={{ color: theme.color.negative }}>
            {error}
          </Text>
        ) : null}
        <Button
          label={t.personal.save}
          fullWidth
          variant="brand"
          disabled={!canSave}
          onPress={() => void onSave()}
        />
      </View>
    </Sheet>
  );
}

/**
 * Share an existing private loan with the person it is with: one tap, or pick
 * them from contacts first so a Waves account (matched on email or number) sees
 * it straight away.
 */
function ShareLoanSheet({
  loans,
  loan,
  onClose,
}: {
  loans: readonly PersonalLoan[];
  loan: PersonalLoan;
  onClose: () => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const { ink, muted } = useLoanInks();
  const shareLoan = useShareLoan(loans);
  const [contact, setContact] = useState<PickedContact | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = cleanCounterpart(contact?.name ?? loan.counterpart);

  const onShare = async (): Promise<void> => {
    setError(null);
    try {
      await shareLoan.mutateAsync({
        loan,
        person: { name, email: contact?.email, phone: contact?.phone },
      });
      onClose();
    } catch (caught) {
      setError(friendlyError(caught, t.personal.shareFailed, 'loans.share'));
    }
  };

  return (
    <Sheet visible onClose={onClose}>
      <View style={{ gap: theme.spacing.md }}>
        <Text style={{ fontSize: 20, fontWeight: '800', color: ink }}>{t.personal.shareTitle}</Text>
        <Text style={{ fontSize: 14, lineHeight: 20, color: muted }}>
          {fill(t.personal.shareBody, { name })}
        </Text>
        <Row style={{ alignItems: 'center', gap: 10 }}>
          <Ionicons name="person-outline" size={20} color={ink} />
          <View style={{ flex: 1 }}>
            <Text variant="micro" tone="muted">
              {t.personal.shareWho}
            </Text>
            <Text style={{ fontSize: 16, fontWeight: '600', color: ink }} numberOfLines={1}>
              {name}
            </Text>
          </View>
          <Button
            label={t.personal.pickContact}
            size="sm"
            variant="secondary"
            onPress={() => setPickerOpen(true)}
          />
        </Row>
        {error ? (
          <Text variant="caption" style={{ color: theme.color.negative }}>
            {error}
          </Text>
        ) : null}
        <Button
          label={t.personal.shareAction}
          fullWidth
          onPress={() => void onShare()}
          disabled={shareLoan.isPending}
        />
      </View>
      <LoanPersonPicker
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={setContact}
      />
    </Sheet>
  );
}

/** The mockup's inks in the light theme; the theme's own in the dark. */
function useLoanInks() {
  const theme = useTheme();
  const dark = theme.scheme === 'dark';
  return {
    dark,
    ink: dark ? theme.color.text : SPEC_INK,
    muted: dark ? theme.color.textMuted : SPEC_MUTED,
    accent: dark ? theme.color.brand : SPEC_ACCENT,
    lavender: dark ? theme.color.surfaceMuted : '#F3F0FE',
  };
}

function FieldLabel({ children }: { children: string }) {
  const { ink } = useLoanInks();
  return (
    <Text style={{ fontSize: 15, fontWeight: '600', color: ink, marginTop: 4 }}>{children}</Text>
  );
}

/**
 * Behind the section shield: one unlock covers the Me tab and every room
 * under `personal/`, so arriving here from the ledger never asks again.
 */
export default function LoansScreen() {
  return (
    <PersonalGuard>
      <LoansScreenBody />
    </PersonalGuard>
  );
}

function TotalHalf({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  const theme = useTheme();
  return (
    <Row style={{ flex: 1, alignItems: 'center', gap: theme.spacing.sm }}>
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: theme.radius.sm,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.color.brandSoft,
        }}
      >
        <Ionicons name={icon} size={iconSize.md} color={theme.color.brand} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="micro" tone="muted" numberOfLines={1}>
          {label}
        </Text>
        <Text numberOfLines={1} adjustsFontSizeToFit style={{ fontWeight: '800' }}>
          {value}
        </Text>
      </View>
    </Row>
  );
}
