import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Network from 'expo-network';
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { format, money, type CurrencyCode } from '@waves/core';
import {
  Button,
  directionalIcon,
  EmptyState,
  IconButton,
  iconSize,
  ListRow,
  Row,
  Screen,
  Text,
  Toggle,
  useTheme,
} from '@waves/ui';
import { useGroup, useGroupLedger, useResplitDeparted } from '@/data/hooks';
import { expenseTitle } from '@/data/expenseTitle';
import { displayName } from '@/data/types';
import { fill, plural, useStrings } from '@/i18n';
import { useViewerId } from '@/lib/auth';
import { useBottomClearance } from '@/lib/clearance';
import {
  buildResplitItem,
  classifyDepartedExpenses,
  summarizeDepartedExpenses,
  type Expense,
} from '@/lib/departedExpenses';
import { useDialog } from '@/lib/dialog';
import { friendlyError } from '@/lib/errors';
import { settleHref } from '@/lib/groupTab';
import { router, useGoBack } from '@/lib/navigation';
import { SPEC_INK } from '@/lib/specPalette';
import { SyncStatus, useSync } from '@/sync';

export default function DepartedExpensesScreen() {
  const { id = '', memberId = '' } = useLocalSearchParams<{ id: string; memberId: string }>();
  const theme = useTheme();
  const goBack = useGoBack(`/group/${id}`);
  const clearance = useBottomClearance();
  const { t, locale } = useStrings();
  const s = t.departedExpenses;
  const viewerId = useViewerId();
  const { group, members, everyone, expenses } = useGroup(id);
  const ledger = useGroupLedger(id, viewerId);
  const mutation = useResplitDeparted(id);
  const { status } = useSync();
  const network = Network.useNetworkState();
  const { confirm } = useDialog();
  const [equalSelected, setEqualSelected] = useState(false);
  const [customSelected, setCustomSelected] = useState<Record<string, boolean>>({});
  const member = everyone.data?.find((m) => m.id === memberId);
  const admin = members.data?.some(
    (m) => m.id === ledger.myMemberId && m.role === 'admin' && !m.left_at,
  );
  const { equal, custom, paid } = classifyDepartedExpenses(
    expenses.rows,
    memberId,
    ledger.myMemberId ?? undefined,
  );
  const selected = [
    ...(equalSelected ? equal : []),
    ...custom.filter((c) => customSelected[c.expense.id] && !c.noneRemaining),
  ];
  const items = selected.flatMap((c) => buildResplitItem(c, memberId) ?? []);
  const fmt = (amount: bigint, currency = group.data?.default_currency ?? 'INR') =>
    format(money(amount, currency as CurrencyCode), { locale });
  const totals = (rows: Expense[]) => summarizeDepartedExpenses(rows, memberId, group.data).totals;
  const showTotals = (values: Map<string, bigint>) =>
    [...values].map(([currency, amount]) => fmt(amount, currency)).join(' · ') || fmt(0n);
  const moved = totals(selected.map((c) => c.expense));
  const recipients = new Set(selected.flatMap((c) => c.remainingParticipants));
  const onlyViewer = recipients.size === 1 && recipients.has(ledger.myMemberId ?? '');
  const count = items.length;
  const offline =
    status === SyncStatus.Offline ||
    network.isConnected === false ||
    network.isInternetReachable === false;
  const allowed = !!admin && !!member?.left_at && !offline && !mutation.isPending && count > 0;
  const name = member ? displayName(member, null, undefined, t.misc.someone) : '';
  const label = fill(s.title, { name });
  const submit = async () => {
    if (!allowed) return;
    const balance = new Map(
      [...ledger.net].map(([currency, balances]) => [
        currency,
        (balances.get(memberId) ?? 0n) + (moved.get(currency) ?? 0n),
      ]),
    );
    const body = fill(onlyViewer ? s.onlyViewerDialog : s.dialog, {
      name,
      amount: showTotals(moved),
      n: recipients.size,
      perEach: showTotals(
        new Map(
          [...moved].map(([currency, amount]) => [currency, amount / BigInt(recipients.size || 1)]),
        ),
      ),
      balance: showTotals(balance),
    });
    if (!(await confirm({ title: label, body, confirmLabel: plural(locale, count, s.confirm) })))
      return;
    const connection = await Network.getNetworkStateAsync().catch(() => null);
    if (!connection || connection.isConnected === false || connection.isInternetReachable === false)
      return;
    mutation.mutate({ memberId, items }, { onSuccess: () => router.back() });
  };
  const expenseRow = (expense: Expense, detail?: string) => {
    const v = expense.currentVersion!;
    return (
      <ListRow
        quiet
        key={expense.id}
        title={expenseTitle(v.description, v.category, t)}
        subtitle={`${v.expense_date}${detail ? ` · ${detail}` : ''}`}
        onPress={() => router.push(`/group/${id}/expense/${expense.id}`)}
      />
    );
  };
  if (!member || !admin || !member.left_at)
    return (
      <Screen>
        <EmptyState title={t.people.memberNotFound} body={t.people.memberNotFoundBody} />
      </Screen>
    );
  return (
    <Screen>
      <View style={{ paddingHorizontal: theme.spacing.md }}>
        <IconButton label={t.common.back} onPress={goBack}>
          <Ionicons
            name={directionalIcon('chevron-back')}
            size={iconSize.md}
            color={theme.color.text}
          />
        </IconButton>
      </View>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingTop: theme.spacing.sm,
          paddingBottom: theme.spacing.lg,
          gap: theme.spacing.md,
        }}
      >
        <View style={{ gap: 2 }}>
          <Text
            style={{
              fontSize: 28,
              lineHeight: 34,
              fontWeight: '800',
              color: theme.scheme === 'dark' ? theme.color.text : SPEC_INK,
            }}
          >
            {label}
          </Text>
          <Text tone="muted">
            {fill(
              plural(
                locale,
                summarizeDepartedExpenses(expenses.rows, memberId, group.data).count,
                s.owed,
              ),
              { name, amount: showTotals(totals(expenses.rows)) },
            )}
          </Text>
        </View>
        <Text variant="subheading">
          {fill(plural(locale, equal.length, s.equal), {
            amount: showTotals(totals(equal.map((c) => c.expense))),
          })}
        </Text>
        {equal.map((c) =>
          expenseRow(
            c.expense,
            `${fmt(c.memberShare, c.expense.currentVersion!.currency)} · ${fill(s.perEach, { amount: fmt(c.perEach, c.expense.currentVersion!.currency) })}`,
          ),
        )}
        {equal.length > 0 && (
          <Button
            size="sm"
            variant={equalSelected ? 'secondary' : 'primary'}
            accessibilityState={{ selected: equalSelected }}
            label={plural(
              locale,
              new Set(equal.flatMap((c) => c.remainingParticipants)).size,
              s.splitAmong,
            )}
            disabled={mutation.isPending}
            onPress={() => setEqualSelected(!equalSelected)}
          />
        )}
        <Text variant="subheading">{plural(locale, custom.length, s.custom)}</Text>
        {custom.map((c) => (
          <View key={c.expense.id}>
            {expenseRow(c.expense, fmt(c.memberShare, c.expense.currentVersion!.currency))}
            <Row
              style={{ justifyContent: 'flex-end', alignItems: 'center', gap: theme.spacing.sm }}
            >
              <Text variant="caption" tone="muted">
                {customSelected[c.expense.id] ? s.shareEqually : s.keep}
              </Text>
              <Toggle
                accessibilityLabel={`${c.expense.currentVersion!.description}: ${s.keep} / ${s.shareEqually}`}
                value={!!customSelected[c.expense.id]}
                disabled={c.noneRemaining || mutation.isPending}
                onValueChange={(value) =>
                  setCustomSelected((prev) => ({ ...prev, [c.expense.id]: value }))
                }
              />
            </Row>
          </View>
        ))}
        <Text variant="subheading">
          {fill(plural(locale, paid.length, s.paid), {
            name,
            amount: showTotals(
              new Map(
                [...ledger.net].map(([currency, balances]) => [
                  currency,
                  (balances.get(memberId) ?? 0n) > 0n ? balances.get(memberId)! : 0n,
                ]),
              ),
            ),
          })}
        </Text>
        {paid.map((expense) => expenseRow(expense))}
        <Button
          variant="ghost"
          size="sm"
          label={fill(s.settle, { name })}
          onPress={() => router.push(settleHref(id))}
        />
        {mutation.isError && (
          <Text tone="negative">
            {friendlyError(mutation.error, t.couldNotSave, 'departed.resplit')}
          </Text>
        )}
      </ScrollView>
      <View
        style={{
          paddingHorizontal: theme.spacing.lg,
          paddingTop: theme.spacing.sm,
          paddingBottom: clearance,
          gap: theme.spacing.sm,
          borderTopWidth: 1,
          borderColor: theme.color.border,
        }}
      >
        {offline && <Text tone="muted">{s.offline}</Text>}
        <Button
          label={plural(locale, count, s.confirm)}
          disabled={!allowed}
          onPress={() => void submit()}
        />
      </View>
    </Screen>
  );
}
