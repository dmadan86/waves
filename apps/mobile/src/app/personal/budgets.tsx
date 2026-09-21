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
import { Pressable, ScrollView, View } from 'react-native';

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
} from '@waves/core';
import {
  AmountField,
  Button,
  Card,
  directionalIcon,
  EmptyState,
  IconButton,
  iconSize,
  Row,
  Screen,
  Sheet,
  SegmentedTabs,
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
import { router } from '@/lib/navigation';
import { useDialog } from '@/lib/dialog';

function BudgetsScreenBody() {
  const theme = useTheme();
  const clearance = useBottomClearance();
  const { t, locale } = useStrings();
  const dc = useDefaultCurrency();
  const { budgets, txns } = usePersonalLedger();

  const [month] = useState(() => todayIso().slice(0, 7));
  const [editing, setEditing] = useState<PersonalBudget | null>(null);
  const [creating, setCreating] = useState(false);

  const labelFor = (id: string | null): string =>
    id ? (t.categories[id as keyof typeof t.categories] ?? id) : t.personal.overall;

  return (
    <Screen>
      <Row
        style={{
          paddingHorizontal: theme.spacing.xl,
          paddingTop: theme.spacing.md,
          alignItems: 'center',
        }}
      >
        <IconButton label={t.common.back} onPress={() => router.back()}>
          <Ionicons
            name={directionalIcon('chevron-back')}
            size={iconSize.lg}
            color={theme.color.text}
          />
        </IconButton>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text variant="heading">{t.personal.budgets}</Text>
        </View>
        <IconButton label={t.personal.addBudget} onPress={() => setCreating(true)}>
          <Ionicons name="add" size={iconSize.xxl} color={theme.color.brand} />
        </IconButton>
      </Row>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.xl,
          paddingBottom: clearance,
          gap: theme.spacing.md,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Text
          variant="caption"
          tone="muted"
          align="center"
          style={{ marginBottom: theme.spacing.sm }}
        >
          {t.personal.budgetsSub}
        </Text>

        {budgets.length === 0 ? (
          <View style={{ paddingTop: theme.spacing.xxxl }}>
            <EmptyState title={t.personal.noBudgets} />
          </View>
        ) : (
          budgets.map((budget) => {
            const progress = personalBudgetProgress(budget, txns, month);
            const over = progress.remaining < 0n;
            const pct = Math.min(1, Math.max(0, progress.ratio));
            const barColor = over
              ? theme.color.negative
              : pct > 0.85
                ? theme.color.warning
                : theme.color.brand;
            return (
              <Pressable
                key={budget.id}
                accessibilityRole="button"
                onPress={() => setEditing(budget)}
              >
                <Card style={{ gap: theme.spacing.sm }}>
                  <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
                    <CategoryBadge category={budget.category ?? 'other'} meta={null} size={28} />
                    <Text variant="body" style={{ flex: 1, fontWeight: '600' }} numberOfLines={1}>
                      {labelFor(budget.category)}
                    </Text>
                    <Text variant="caption" tone={over ? 'negative' : 'muted'}>
                      {format(money(progress.spent, budget.currency), {
                        locale,
                      })}
                      {' / '}
                      {format(money(budget.limit, budget.currency), {
                        locale,
                      })}
                    </Text>
                  </Row>
                  <View
                    style={{
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: theme.color.surfaceMuted,
                      overflow: 'hidden',
                    }}
                  >
                    <View
                      style={{ width: `${pct * 100}%`, height: 8, backgroundColor: barColor }}
                    />
                  </View>
                  <Text variant="micro" tone={over ? 'negative' : 'muted'}>
                    {over
                      ? `${format(money(-progress.remaining, budget.currency), { locale })} ${t.personal.over}`
                      : `${format(money(progress.remaining, budget.currency), { locale })} ${t.personal.left}`}
                  </Text>
                </Card>
              </Pressable>
            );
          })
        )}
      </ScrollView>

      {/* The browsed month and the ledger come from here rather than being read
          again inside the sheet: the context line has to measure the same window
          the bars behind it do, and a second `todayIso()` in the editor would be
          a second clock reading for one screen. */}
      {creating ? (
        <BudgetEditor currency={dc} month={month} txns={txns} onClose={() => setCreating(false)} />
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
  onClose,
}: {
  budget?: PersonalBudget;
  currency: string;
  /** The month the list behind this sheet is measuring, as YYYY-MM. */
  month: string;
  txns: readonly PersonalTxn[];
  onClose: () => void;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const { confirm } = useDialog();
  const upsert = useUpsertPersonalRecord();
  const remove = useDeletePersonalRecord();

  const [scope, setScope] = useState<'overall' | 'category'>(
    budget?.category ? 'category' : 'overall',
  );
  const [category, setCategory] = useState<string | null>(budget?.category ?? null);
  const [limit, setLimit] = useState<bigint>(budget?.limit ?? 0n);

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
        ? { pathname: '/personal/transactions', params: { category: chosenCategory } }
        : { pathname: '/personal/transactions' },
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

  return (
    <Sheet visible onClose={onClose} padded={false} style={{ maxHeight: '90%' }}>
      <ScrollView
        contentContainerStyle={{ padding: theme.spacing.xl, gap: theme.spacing.lg }}
        keyboardShouldPersistTaps="handled"
      >
        <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
          {/* The badge says which budget this is before the heading does, and
              carries the one colour the sheet is allowed to use. */}
          {tinted ? <CategoryBadge category={chosenCategory} meta={null} size={36} /> : null}
          <Text variant="heading" style={{ flex: 1 }} numberOfLines={1}>
            {budget ? t.personal.editBudget : t.personal.addBudget}
          </Text>
          <IconButton label={t.common.close} onPress={onClose}>
            <Ionicons name="close" size={iconSize.lg} color={theme.color.text} />
          </IconButton>
        </Row>

        <SegmentedTabs
          value={scope}
          onChange={setScope}
          tabs={[
            { value: 'overall', label: t.personal.overall },
            { value: 'category', label: t.personal.category },
          ]}
        />

        {scope === 'category' ? (
          <CategoryPicker value={category} onChange={(picked) => setCategory(picked)} />
        ) : null}

        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="caption" tone="muted">
            {t.personal.monthlyLimit}
          </Text>
          <View
            style={{
              borderRadius: theme.radius.lg,
              backgroundColor: tinted ? tint.bg : theme.color.surfaceMuted,
              paddingVertical: theme.spacing.lg,
              paddingHorizontal: theme.spacing.sm,
              gap: theme.spacing.sm,
            }}
          >
            <Row style={{ alignItems: 'center', justifyContent: 'center', gap: theme.spacing.sm }}>
              {/* `repeatable`, because a stepper is the one control somebody is
                  meant to press again immediately — the default single-action
                  guard would swallow the second tap and read as a dead button. */}
              <IconButton
                label={t.personal.lowerLimit.replace('{amount}', asMoney(step))}
                repeatable
                onPress={limit > 0n ? () => stepped(-step) : undefined}
              >
                <Ionicons
                  name="remove"
                  size={iconSize.lg}
                  color={limit > 0n ? contextInk : theme.color.textFaint}
                />
              </IconButton>

              <AmountField currency={budgetCurrency} value={limit} onChange={setLimit} />

              <IconButton
                label={t.personal.raiseLimit.replace('{amount}', asMoney(step))}
                repeatable
                onPress={() => stepped(step)}
              >
                <Ionicons name="add" size={iconSize.lg} color={contextInk} />
              </IconButton>
            </Row>

            {context ? (
              <Text variant="micro" align="center" style={{ color: contextInk }}>
                {context}
              </Text>
            ) : null}
          </View>

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
                minHeight: 44,
                paddingHorizontal: theme.spacing.sm,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text variant="caption" style={{ color: theme.color.brand }}>
                {t.personal.viewTransactions}
              </Text>
              {/* A chevron *is* directional, unlike the stepper's glyphs, so this
                  one goes through the mirror. */}
              <Ionicons
                name={directionalIcon('chevron-forward')}
                size={iconSize.md}
                color={theme.color.brand}
              />
            </Pressable>
          ) : null}
        </View>

        <Button label={t.personal.save} size="lg" fullWidth onPress={onSave} disabled={!canSave} />

        {budget ? (
          <Button
            label={t.common.delete}
            variant="danger"
            fullWidth
            onPress={() =>
              void confirm({
                title: t.common.delete,
                body: t.personal.deleteConfirm,
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
