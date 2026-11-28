/**
 * Budgets (A48): a monthly cap on spending, overall or per category, with this
 * month's spend measured against it. Loan repayments do not count — a budget is
 * about everyday spending (see personalBudgetProgress). The editor is an inline
 * sheet.
 *
 * The sheet's job is not to collect a number, it is to help somebody choose
 * one, so it carries three things beyond the field itself:
 *
 * - **A − / + stepper either side of the amount**, sized off the amount by
 *   `budgetStep`. Typing stays the fast path for a figure already in mind; the
 *   stepper is for the other half of the time, when the cap is being felt
 *   towards rather than known. The row is a plain `flexDirection: 'row'`, which
 *   React Native reverses in an RTL layout by itself — and − and + are
 *   symmetrical glyphs, so unlike a chevron they need no mirroring.
 * - **What the last six months actually cost**, from `budgetSpendWindow`, under
 *   the amount. Same filter as the bar above it, deliberately, so the two
 *   numbers can never contradict each other. When the window is genuinely empty
 *   it says so in words: ₹0 where a total should be reads as a broken screen.
 * - **The category's own colour and icon**, from the shared catalog — the badge
 *   in the header and the tint behind the amount. Nothing new is invented here;
 *   it is the same pastel the chip, the list row and the chart already use.
 */

import { useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, ScrollView, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import {
  budgetSpendWindow,
  budgetStep,
  encodeBudget,
  format,
  money,
  personalBudgetProgress,
  resolveCategory,
  type PersonalBudget,
  type PersonalTxn,
  currencySymbol,
  fallbackCurrency,
} from '@waves/core';
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

import { CategoryBadge, CategoryPicker } from '@/components/Category';
import {
  todayIso,
  usePersonalLedger,
  useDeletePersonalRecord,
  useUpsertPersonalRecord,
} from '@/data/personal';
import { useDefaultCurrency } from '@/lib/currency';
import { useStrings } from '@/i18n';
import { PersonalGuard } from '@/components/PersonalGuard';
import { useBottomClearance } from '@/lib/clearance';
import { monthLabel, shiftMonth } from '@/lib/monthNav';
import { PlanningHeader, PlanningTabs } from '@/components/PlanningTabs';
import { budgetsOverview } from '@/lib/budgetsOverview';
import { router } from '@/lib/navigation';
import { useDialog } from '@/lib/dialog';
import { SPEC_ACCENT, SPEC_INK, SPEC_MUTED } from '@/lib/specPalette';

function BudgetsScreenBody() {
  const theme = useTheme();
  const clearance = useBottomClearance();
  const { t, locale } = useStrings();
  const dc = useDefaultCurrency();
  const { budgets, txns } = usePersonalLedger();

  const [currentMonth] = useState(() => todayIso().slice(0, 7));
  const [month, setMonth] = useState(currentMonth);
  const earliest = shiftMonth(currentMonth, -12);
  // A link from a save tip names a category (and a suggested cap): open that
  // category's budget, or a new one pre-filled with it.
  const link = useLocalSearchParams<{ category?: string; limit?: string }>();
  const linked = link.category ? budgets.find((b) => b.category === link.category) : undefined;
  const [editing, setEditing] = useState<PersonalBudget | null>(linked ?? null);
  const [creating, setCreating] = useState(!!link.category && !linked);

  const { ink, muted } = useBudgetInks();

  const labelFor = (id: string | null): string =>
    id ? (t.categories[id as keyof typeof t.categories] ?? id) : t.personal.overall;

  const summaryCurrency = budgets.some((x) => x.currency === dc)
    ? dc
    : (budgets[0]?.currency ?? dc);
  const overview = budgetsOverview(budgets, txns, month, summaryCurrency);
  const fmt = (amount: bigint, currency: string): string =>
    format(money(amount, currency), { locale, trimZeros: true });
  const categoryBudgets = budgets.filter((x) => x.category !== null);
  const card = {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.color.border,
  } as const;

  return (
    <Screen>
      <PlanningHeader
        title={t.personal.budgets}
        subtitle={t.personal.budgetsPlanSub}
        addLabel={t.personal.addBudget}
        onAdd={() => setCreating(true)}
      />

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: clearance,
          gap: theme.spacing.md,
        }}
        showsVerticalScrollIndicator={false}
      >
        <PlanningTabs value="budgets" />
        <Row style={{ alignItems: 'center', justifyContent: 'center', gap: theme.spacing.sm }}>
          <Ionicons name="disc-outline" size={iconSize.md} color={theme.color.brand} />
          <Text variant="body" tone="muted" numberOfLines={2}>
            {t.personal.budgetsSub.replace(/\.$/, '')}
          </Text>
        </Row>

        {budgets.length > 0 ? (
          <Row
            style={{
              ...card,
              alignSelf: 'center',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderRadius: theme.radius.pill,
              paddingHorizontal: theme.spacing.xs,
              width: '88%',
              maxWidth: 360,
            }}
          >
            <IconButton
              label={t.personal.prevMonth}
              onPress={month > earliest ? () => setMonth(shiftMonth(month, -1)) : undefined}
            >
              <Ionicons
                name={directionalIcon('chevron-back')}
                size={iconSize.lg}
                color={month > earliest ? theme.color.text : theme.color.textFaint}
              />
            </IconButton>
            <Row style={{ alignItems: 'center', gap: theme.spacing.sm, flexShrink: 1 }}>
              <Ionicons name="calendar-outline" size={iconSize.md} color={theme.color.textMuted} />
              <Text variant="body" numberOfLines={1} style={{ fontWeight: '800', flexShrink: 1 }}>
                {monthLabel(month, locale)}
              </Text>
            </Row>
            <IconButton label={t.personal.nextMonth} onPress={() => setMonth(shiftMonth(month, 1))}>
              <Ionicons
                name={directionalIcon('chevron-forward')}
                size={iconSize.lg}
                color={theme.color.text}
              />
            </IconButton>
          </Row>
        ) : null}

        {overview ? (
          <View style={{ ...card, overflow: 'hidden' }}>
            <LinearGradient
              colors={[theme.color.surface, theme.color.brandSoft]}
              start={{ x: 0.3, y: 0 }}
              end={{ x: 1, y: 0.6 }}
              style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }}
            />
            <Pressable
              accessibilityRole={overview.overall ? 'button' : undefined}
              disabled={!overview.overall}
              onPress={() => overview.overall && setEditing(overview.overall)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.spacing.md,
                padding: theme.spacing.lg,
              }}
            >
              <BudgetRing
                percent={overview.percent}
                over={overview.over}
                label={t.personal.ofBudget}
              />
              <View
                style={{
                  width: 1,
                  alignSelf: 'stretch',
                  backgroundColor: theme.color.border,
                }}
              />
              <View style={{ flex: 1, minWidth: 0, gap: theme.spacing.sm }}>
                <Text variant="subheading" style={{ fontWeight: '800' }} numberOfLines={1}>
                  {t.personal.overall}
                </Text>
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  style={{
                    fontSize: 22,
                    lineHeight: 28,
                    fontWeight: '800',
                    color: overview.over ? theme.color.negativeText : theme.color.text,
                  }}
                >
                  {fmt(overview.spent, summaryCurrency)}
                  <Text style={{ fontSize: 15, fontWeight: '500', color: theme.color.textMuted }}>
                    {' / '}
                    {fmt(overview.limit, summaryCurrency)}
                  </Text>
                </Text>
                <BudgetBar ratio={overview.percent / 100} over={overview.over} height={10} />
                <View
                  style={{
                    alignSelf: 'flex-start',
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.spacing.xs,
                    borderRadius: theme.radius.pill,
                    paddingHorizontal: theme.spacing.sm,
                    paddingVertical: 4,
                    backgroundColor: overview.over
                      ? theme.color.negativeSoft
                      : theme.color.brandSoft,
                  }}
                >
                  {overview.over ? (
                    <Ionicons
                      name="trending-up"
                      size={iconSize.sm}
                      color={theme.color.negativeText}
                    />
                  ) : null}
                  <Text
                    variant="caption"
                    style={{
                      flexShrink: 1,
                      fontWeight: '600',
                      color: overview.over ? theme.color.negativeText : theme.color.brand,
                    }}
                  >
                    {(overview.over ? t.personal.overBudgetAmount : t.personal.leftAmount).replace(
                      '{amount}',
                      fmt(
                        overview.over ? -overview.remaining : overview.remaining,
                        summaryCurrency,
                      ),
                    )}
                  </Text>
                </View>
              </View>
            </Pressable>
            <Pressable
              accessibilityRole="link"
              onPress={() => router.push('/personal/spending')}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.spacing.md,
                marginHorizontal: theme.spacing.md,
                marginBottom: theme.spacing.md,
                paddingHorizontal: theme.spacing.md,
                minHeight: 48,
                borderRadius: theme.radius.sm,
                backgroundColor: theme.color.brandSoft,
              }}
            >
              <Ionicons name="stats-chart" size={iconSize.md} color={theme.color.brand} />
              <Text
                variant="body"
                numberOfLines={1}
                style={{ flex: 1, fontWeight: '700', color: theme.color.brand }}
              >
                {t.personal.viewMonthSpending}
              </Text>
              <Ionicons
                name={directionalIcon('chevron-forward')}
                size={iconSize.md}
                color={theme.color.brand}
              />
            </Pressable>
          </View>
        ) : null}

        {budgets.length === 0 ? (
          <View style={{ paddingTop: theme.spacing.lg, alignItems: 'center', gap: 8 }}>
            <ClipboardArt />
            <Text style={{ fontSize: 20, fontWeight: '800', color: ink, textAlign: 'center' }}>
              {t.personal.noBudgets}
            </Text>
            <Text
              style={{
                fontSize: 14,
                lineHeight: 20,
                color: muted,
                textAlign: 'center',
                paddingHorizontal: theme.spacing.lg,
              }}
            >
              {t.personal.noBudgetsBody}
            </Text>
            <Button label={t.personal.addBudget} onPress={() => setCreating(true)} />
          </View>
        ) : (
          <>
            <Row style={{ alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <Text
                variant="heading"
                numberOfLines={1}
                style={{ fontWeight: '800', flexShrink: 1 }}
              >
                {t.personal.categoryBudgets}
              </Text>
              <Pressable
                accessibilityRole="link"
                hitSlop={8}
                onPress={() => router.push('/settings/categories')}
                style={{ flexShrink: 1 }}
              >
                <Text
                  variant="caption"
                  numberOfLines={2}
                  align="right"
                  style={{ color: theme.color.brand, fontWeight: '600' }}
                >
                  {t.personal.manageCategories}
                </Text>
              </Pressable>
            </Row>
            {categoryBudgets.map((budget) => {
              const progress = personalBudgetProgress(budget, txns, month);
              const over = progress.remaining < 0n;
              const tone = over ? theme.color.negativeText : theme.color.brand;
              return (
                <Pressable
                  key={budget.id}
                  accessibilityRole="button"
                  onPress={() => setEditing(budget)}
                  style={{
                    ...card,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.spacing.md,
                    padding: theme.spacing.md,
                  }}
                >
                  <CategoryBadge
                    category={budget.category ?? 'other'}
                    meta={null}
                    size={44}
                    shape="square"
                  />
                  <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                    <Text variant="body" style={{ fontWeight: '700' }} numberOfLines={1}>
                      {labelFor(budget.category)}
                    </Text>
                    <Text numberOfLines={1} adjustsFontSizeToFit style={{ fontSize: 14 }}>
                      <Text
                        style={{
                          fontSize: 14,
                          fontWeight: '700',
                          color: over ? theme.color.negativeText : theme.color.text,
                        }}
                      >
                        {fmt(progress.spent, budget.currency)}
                      </Text>
                      <Text style={{ fontSize: 14, color: theme.color.textMuted }}>
                        {' / '}
                        {fmt(budget.limit, budget.currency)}
                      </Text>
                    </Text>
                    <BudgetBar ratio={progress.ratio} over={over} height={6} />
                  </View>
                  <View
                    style={{
                      borderRadius: theme.radius.pill,
                      paddingHorizontal: theme.spacing.sm,
                      paddingVertical: 4,
                      backgroundColor: over ? theme.color.negativeSoft : theme.color.brandSoft,
                    }}
                  >
                    <Text variant="caption" style={{ fontWeight: '700', color: tone }}>
                      {Math.round(progress.ratio * 100)}%
                    </Text>
                  </View>
                  <Ionicons
                    name={directionalIcon('chevron-forward')}
                    size={iconSize.md}
                    color={theme.color.textMuted}
                  />
                </Pressable>
              );
            })}
          </>
        )}
      </ScrollView>

      {/* The browsed month and the ledger come from here rather than being read
          again inside the sheet: the context line has to measure the same window
          the bars behind it do, and a second `todayIso()` in the editor would be
          a second clock reading for one screen. */}
      {creating ? (
        <BudgetEditor
          currency={dc}
          month={month}
          txns={txns}
          start={link.category ? { category: link.category, limit: link.limit } : undefined}
          onClose={() => setCreating(false)}
        />
      ) : null}
      {editing ? (
        <BudgetEditor
          budget={editing}
          currency={dc}
          month={month}
          txns={txns}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </Screen>
  );
}

function BudgetEditor({
  budget,
  currency,
  month,
  txns,
  start,
  onClose,
}: {
  budget?: PersonalBudget;
  /** A category (and cap, in minor units) to open a new budget with. */
  start?: { category: string; limit?: string };
  currency: string;
  /** The month the list behind this sheet is measuring, as YYYY-MM. */
  month: string;
  txns: readonly PersonalTxn[];
  onClose: () => void;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const { confirm } = useDialog();
  const { ink, muted, accent, lavender } = useBudgetInks();
  const upsert = useUpsertPersonalRecord();
  const remove = useDeletePersonalRecord();

  const [scope, setScope] = useState<'overall' | 'category'>(
    budget?.category || start ? 'category' : 'overall',
  );
  const [category, setCategory] = useState<string | null>(
    budget?.category ?? start?.category ?? null,
  );
  const [limit, setLimit] = useState<bigint>(
    budget?.limit ?? (start?.limit && /^\d+$/.test(start.limit) ? BigInt(start.limit) : 0n),
  );

  const chosenCategory = scope === 'category' ? category : null;
  const canSave = limit > 0n && (scope === 'overall' || category !== null) && !upsert.isPending;

  // A budget keeps the currency it was written in; a new one takes the default.
  const budgetCurrency = budget?.currency ?? currency;
  const asMoney = (amount: bigint): string => format(money(amount, budgetCurrency), { locale });

  // The category's own pastel and glyph, from the catalog every other surface
  // draws from. A budget stores the category key alone, with no `meta` snapshot,
  // so a custom tag resolves to Other's tint here — the same limitation the rows
  // behind this sheet already have, and not one worth fixing in two places at
  // once.
  const resolved = resolveCategory(chosenCategory);
  const tint = theme.tint[resolved.tint];
  const tinted = chosenCategory !== null;
  const contextInk = tinted ? tint.inkMuted : theme.color.textMuted;

  const recent = useMemo(
    () => budgetSpendWindow(txns, { category: chosenCategory, currency: budgetCurrency }, month),
    [txns, chosenCategory, budgetCurrency, month],
  );

  // Three ways to say what six months cost, and they are not interchangeable.
  // Nothing at all is said in words, because a formatted zero where a total
  // belongs reads as a screen that failed to load. A single month of spend is a
  // real total but not an average — "about X a month" drawn from one month is a
  // claim the ledger cannot support.
  //
  // And nothing at all is said while the category scope is chosen but no
  // category is: the window would then be measuring *everything*, and a whole
  // ledger's spend shown under a heading that says Category is not a hint, it is
  // a wrong anchor to set a cap from.
  const measuring = scope === 'overall' || category !== null;
  const context = !measuring
    ? null
    : recent.monthsWithSpend === 0
      ? chosenCategory === null
        ? t.personal.budgetContextNoneOverall
        : t.personal.budgetContextNone
      : recent.monthsWithSpend === 1
        ? t.personal.budgetContextTotal.replace('{total}', asMoney(recent.total))
        : t.personal.budgetContextAverage
            .replace('{total}', asMoney(recent.total))
            .replace('{average}', asMoney(recent.average));

  // One tap of − or +. The step is read off the amount, so it stays useful at
  // ₹50 and at ₹50,000; the floor at zero lives here rather than in the helper
  // because a negative cap is a screen's concern, not an arithmetic one.
  const step = budgetStep(limit, budgetCurrency);
  const stepped = (by: bigint): void => {
    const next = limit + by;
    setLimit(next > 0n ? next : 0n);
  };

  const openTransactions = (): void => {
    // Leave before navigating: a sheet left standing over the push is a sheet
    // the person comes back to and has to dismiss twice.
    onClose();
    router.push(
      chosenCategory
        ? {
            pathname: '/personal/transactions',
            params: {
              category: chosenCategory,
              kind: 'expense',
              month,
              returnTo: '/personal/budgets',
            },
          }
        : {
            pathname: '/personal/transactions',
            params: { kind: 'expense', month, loans: 'none', returnTo: '/personal/budgets' },
          },
    );
  };

  const onSave = (): void => {
    if (!canSave) return;
    upsert.mutate(
      {
        recordId: budget?.id,
        recordKind: 'budget',
        data: encodeBudget({
          carried: budget?.carried,
          category: chosenCategory,
          limit,
          currency: budgetCurrency,
        }),
      },
      { onSuccess: onClose },
    );
  };

  // The six-month figure, split so the total can be set in bold the way the
  // mockup leads with it; the average goes on its own quieter line.
  const [contextLead, contextTail] = (() => {
    if (!measuring || recent.monthsWithSpend === 0) return [null, null];
    const parts = t.personal.budgetContextTotal.split('{total}');
    return [parts[0] ?? '', parts.slice(1).join('')];
  })();

  return (
    <Sheet visible onClose={onClose} padded={false} style={{ maxHeight: '90%' }}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.xl,
          paddingTop: theme.spacing.md,
          paddingBottom: theme.spacing.xl,
          gap: 14,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Row style={{ alignItems: 'flex-start', gap: theme.spacing.md }}>
          {/* The badge says which budget this is before the heading does, and
              carries the one colour the sheet is allowed to use. */}
          {tinted ? <CategoryBadge category={chosenCategory} meta={null} size={36} /> : null}
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text style={{ fontSize: 24, fontWeight: '800', color: ink }} numberOfLines={1}>
              {budget ? t.personal.editBudget : t.personal.addBudget}
            </Text>
            <Text style={{ fontSize: 14, color: muted }}>{t.personal.addBudgetSub}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.common.close}
            onPress={onClose}
            hitSlop={6}
            style={({ pressed }) => ({
              width: 36,
              height: 36,
              borderRadius: 18,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.color.surfaceMuted,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Ionicons name="close" size={20} color={ink} />
          </Pressable>
        </Row>

        <ScopeTabs
          value={scope}
          onChange={setScope}
          tabs={[
            { value: 'overall', label: t.personal.overall, icon: 'bar-chart-outline' },
            { value: 'category', label: t.personal.category, icon: 'grid-outline' },
          ]}
        />

        {scope === 'category' ? (
          <CategoryPicker value={category} onChange={(picked) => setCategory(picked)} />
        ) : null}

        <Row style={{ alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ fontSize: 16, fontWeight: '600', color: ink, flexShrink: 1 }}>
            {t.personal.monthlyLimit}
          </Text>
          {/* Every budget is monthly, so this is a label and not a menu: a
              chevron here would open a list of one. */}
          <Row
            style={{
              alignItems: 'center',
              gap: 6,
              paddingHorizontal: 12,
              paddingVertical: 6,
              borderRadius: 14,
              backgroundColor: lavender,
            }}
          >
            <Ionicons name="calendar-outline" size={15} color={accent} />
            <Text style={{ fontSize: 13, fontWeight: '600', color: ink }}>
              {t.personal.monthly}
            </Text>
          </Row>
        </Row>

        <Row
          style={{
            alignItems: 'center',
            justifyContent: 'space-between',
            borderRadius: 18,
            backgroundColor: tinted ? tint.bg : lavender,
            paddingVertical: 12,
            paddingHorizontal: 20,
          }}
        >
          {/* `repeatable`, because a stepper is the one control somebody is
              meant to press again immediately — the default single-action
              guard would swallow the second tap and read as a dead button. */}
          <StepDisc
            icon="remove"
            label={t.personal.lowerLimit.replace('{amount}', asMoney(step))}
            onPress={limit > 0n ? () => stepped(-step) : undefined}
          />
          <View style={{ flex: 1, alignItems: 'center' }}>
            <AmountField currency={budgetCurrency} value={limit} onChange={setLimit} />
          </View>
          <StepDisc
            icon="add"
            label={t.personal.raiseLimit.replace('{amount}', asMoney(step))}
            onPress={() => stepped(step)}
          />
        </Row>

        {context ? (
          <Row
            style={{
              alignItems: 'center',
              gap: 12,
              borderRadius: 18,
              padding: 14,
              backgroundColor: tinted ? tint.bg : lavender,
            }}
          >
            <View
              style={{
                width: 38,
                height: 38,
                borderRadius: 19,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: theme.color.surface,
              }}
            >
              <Ionicons name="bar-chart-outline" size={18} color={accent} />
            </View>
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              {contextLead !== null ? (
                <>
                  <Text style={{ fontSize: 14, color: tinted ? contextInk : ink }}>
                    {contextLead}
                    <Text style={{ fontWeight: '800' }}>{asMoney(recent.total)}</Text>
                    {contextTail}
                  </Text>
                  {recent.monthsWithSpend > 1 ? (
                    <Text style={{ fontSize: 13, color: tinted ? contextInk : muted }}>
                      {t.personal.budgetAboutMonth.replace('{average}', asMoney(recent.average))}
                    </Text>
                  ) : null}
                </>
              ) : (
                <Text style={{ fontSize: 14, color: tinted ? contextInk : muted }}>{context}</Text>
              )}
            </View>
          </Row>
        ) : null}

        {measuring ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={t.personal.viewTransactions}
            onPress={openTransactions}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              alignSelf: 'center',
              gap: theme.spacing.xs,
              minHeight: 40,
              paddingHorizontal: theme.spacing.sm,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ fontSize: 15, fontWeight: '600', color: accent }}>
              {t.personal.viewTransactions}
            </Text>
            {/* A chevron *is* directional, unlike the stepper's glyphs, so this
                one goes through the mirror. */}
            <Ionicons name={directionalIcon('chevron-forward')} size={18} color={accent} />
          </Pressable>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.personal.save}
          accessibilityState={{ disabled: !canSave }}
          disabled={!canSave}
          onPress={onSave}
          style={({ pressed }) => ({
            height: 54,
            borderRadius: 27,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: canSave ? accent : theme.color.surfaceMuted,
            opacity: pressed ? 0.88 : 1,
          })}
        >
          <Text
            style={{
              fontSize: 17,
              fontWeight: '700',
              color: canSave ? '#FFFFFF' : theme.color.textFaint,
            }}
          >
            {t.personal.save}
          </Text>
        </Pressable>

        {budget ? (
          <Button
            label={t.common.delete}
            variant="danger"
            fullWidth
            onPress={() =>
              void confirm({
                title: t.common.delete,
                body: t.personal.deleteConfirm.replace('this entry', 'this budget'),
                confirmLabel: t.common.delete,
                tone: 'danger',
              }).then((ok) => {
                if (ok) remove.mutate(budget.id, { onSuccess: onClose });
              })
            }
          />
        ) : null}
      </ScrollView>
    </Sheet>
  );
}

/** The mockup's inks in the light theme; the theme's own in the dark. */
function useBudgetInks() {
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

type IconName = keyof typeof Ionicons.glyphMap;

/** Overall or Category, as a lavender track with the chosen half lit. */
function ScopeTabs<T extends string>({
  value,
  onChange,
  tabs,
}: {
  value: T;
  onChange: (next: T) => void;
  tabs: readonly { value: T; label: string; icon: IconName }[];
}) {
  const { dark, ink, accent, lavender } = useBudgetInks();
  return (
    <Row
      accessibilityRole="tablist"
      style={{ padding: 4, borderRadius: 24, backgroundColor: lavender, gap: 4 }}
    >
      {tabs.map((tab) => {
        const on = tab.value === value;
        return (
          <Pressable
            key={tab.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(tab.value)}
            style={{
              flex: 1,
              height: 40,
              borderRadius: 20,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              backgroundColor: on ? (dark ? '#3A3470' : '#E2DAFD') : 'transparent',
            }}
          >
            <Ionicons name={tab.icon} size={17} color={on ? accent : ink} />
            <Text
              style={{ fontSize: 15, fontWeight: on ? '700' : '500', color: on ? accent : ink }}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </Row>
  );
}

/** A round − or + beside the amount; faded when it would do nothing. */
function StepDisc({
  icon,
  label,
  onPress,
}: {
  icon: 'add' | 'remove';
  label: string;
  onPress?: () => void;
}) {
  const theme = useTheme();
  const { dark, accent } = useBudgetInks();
  return (
    <IconButton label={label} repeatable onPress={onPress}>
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: dark ? theme.color.surface : '#E2DAFD',
          opacity: onPress ? 1 : 0.5,
        }}
      >
        <Ionicons name={icon} size={20} color={accent} />
      </View>
    </IconButton>
  );
}

/** The empty list's picture: a clipboard with a small bar chart, a rupee coin
 *  and a leaf. Drawn from views and glyphs, so it themes and costs no asset. */
function ClipboardArt() {
  const theme = useTheme();
  const dark = theme.scheme === 'dark';
  const accent = dark ? theme.color.brand : SPEC_ACCENT;
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: 150, height: 130 }}
    >
      <View
        style={{
          position: 'absolute',
          left: 15,
          top: 12,
          width: 120,
          height: 110,
          borderRadius: 60,
          backgroundColor: dark ? theme.color.surfaceMuted : '#EFEBFD',
        }}
      />
      <Ionicons
        name="leaf"
        size={40}
        color={dark ? '#3F8C7A' : '#5FAE9C'}
        style={{ position: 'absolute', right: 10, bottom: 18, transform: [{ rotate: '30deg' }] }}
      />
      <View
        style={{
          position: 'absolute',
          left: 42,
          top: 10,
          width: 66,
          height: 96,
          borderRadius: 10,
          borderWidth: 4,
          borderColor: accent,
          backgroundColor: dark ? theme.color.surface : '#FFFFFF',
          transform: [{ rotate: '6deg' }],
          alignItems: 'center',
          justifyContent: 'flex-end',
          paddingBottom: 14,
        }}
      >
        <View
          style={{
            position: 'absolute',
            top: -8,
            width: 24,
            height: 10,
            borderRadius: 4,
            backgroundColor: accent,
          }}
        />
        <Row style={{ alignItems: 'flex-end', gap: 5 }}>
          {[14, 22, 34].map((h) => (
            <View
              key={h}
              style={{ width: 8, height: h, borderRadius: 2, backgroundColor: accent }}
            />
          ))}
        </Row>
      </View>
      <View
        style={{
          position: 'absolute',
          left: 22,
          bottom: 16,
          width: 40,
          height: 40,
          borderRadius: 20,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#F2B233',
          borderWidth: 3,
          borderColor: '#E39C18',
        }}
      >
        <Text style={{ fontSize: 18, fontWeight: '800', color: '#FFF6DC' }}>
          {currencySymbol(fallbackCurrency())}
        </Text>
      </View>
    </View>
  );
}

/**
 * Behind the section shield: one unlock covers the Me tab and every room
 * under `personal/`, so arriving here from the ledger never asks again.
 */
export default function BudgetsScreen() {
  return (
    <PersonalGuard>
      <BudgetsScreenBody />
    </PersonalGuard>
  );
}

/** A thin rounded bar: red once over the cap, brand blue under it. */
function BudgetBar({ ratio, over, height }: { ratio: number; over: boolean; height: number }) {
  const theme = useTheme();
  const pct = Math.min(1, Math.max(0, ratio));
  return (
    <View
      style={{
        height,
        borderRadius: height / 2,
        overflow: 'hidden',
        backgroundColor: theme.color.surfaceMuted,
      }}
    >
      <View
        style={{
          width: `${pct * 100}%`,
          height,
          backgroundColor: over ? theme.color.negative : theme.color.brand,
        }}
      />
    </View>
  );
}

/** The overall ring: arc of the cap used, the whole-number percent inside. */
function BudgetRing({ percent, over, label }: { percent: number; over: boolean; label: string }) {
  const theme = useTheme();
  const size = 96;
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const color = over ? theme.color.negative : theme.color.brand;
  const arc = Math.min(1, Math.max(0, percent / 100));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={over ? theme.color.negativeSoft : theme.color.brandSoft}
          strokeWidth={stroke}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${c * arc} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={{ width: size - 2 * stroke - 6, alignItems: 'center' }}>
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          style={{ fontSize: 22, lineHeight: 26, fontWeight: '800', color }}
        >
          {percent}%
        </Text>
        <Text variant="micro" tone="muted" numberOfLines={1} adjustsFontSizeToFit>
          {label}
        </Text>
      </View>
    </View>
  );
}
