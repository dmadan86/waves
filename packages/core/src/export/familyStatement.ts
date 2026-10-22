import { computeNetBalances, isLive } from '../balances/balances';
import { isSettled, type ExpenseSnapshot, type SettlementSnapshot } from '../balances/types';
import { familyTransfers } from '../group/families';
import { unitMembers, unitNetBalances, unitOf, type GroupUnits } from '../group/units';
import type { Transfer } from '../simplify';
import { formatMinor } from './pdf';
import { wrapText } from './ledger';

export interface FamilyStatementExpense extends ExpenseSnapshot {
  readonly description: string;
}

export interface FamilyStatement {
  readonly group: string;
  readonly name: string;
  readonly members: readonly string[];
  readonly expenses: readonly (FamilyStatementExpense & { share: bigint; paid: bigint })[];
  /** Confirmed payments only, including internal payments (which cancel in net). */
  readonly settlements: readonly SettlementSnapshot[];
  /** Paid/share are expense totals; net also includes confirmed settlements. */
  readonly totals: readonly { currency: string; paid: bigint; share: bigint; net: bigint }[];
  readonly transfers: readonly Transfer[];
  readonly labels: Readonly<Record<string, string>>;
}

/** Uses the same snapshots as balances. Amounts are added, never re-split or rounded. */
export function familyStatement(
  group: { readonly name: string; readonly currency: string },
  units: GroupUnits,
  unitId: string,
  expenses: readonly FamilyStatementExpense[],
  settlements: readonly SettlementSnapshot[],
  nameOf: (memberId: string) => string = (id) => id,
): FamilyStatement {
  const unit = units[unitId];
  if (!unit) throw new Error(`Unknown family: ${unitId}`);
  const members = unitMembers(unit);
  const memberSet = new Set(members);
  const sum = (rows: Readonly<Record<string, bigint>>): bigint =>
    members.reduce((total, id) => total + (rows[id] ?? 0n), 0n);
  // Include payer-only bills too, so the visible lines reconcile with total paid.
  const lines = expenses
    .filter(isLive)
    .filter((expense) => members.some((id) => id in expense.shares || id in expense.payers))
    .map((expense) => ({ ...expense, share: sum(expense.shares), paid: sum(expense.payers) }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const payments = settlements
    .filter(
      (payment) =>
        isSettled(payment.status) && (memberSet.has(payment.from) || memberSet.has(payment.to)),
    )
    .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  const net = computeNetBalances(expenses, settlements);
  const rolled = unitNetBalances(net, units);
  const currencies = new Set([
    group.currency,
    ...lines.map((line) => line.currency),
    ...payments.map((payment) => payment.currency),
  ]);
  const totals = [...currencies].sort().map((currency) => ({
    currency,
    paid: lines
      .filter((line) => line.currency === currency)
      .reduce((total, line) => total + line.paid, 0n),
    share: lines
      .filter((line) => line.currency === currency)
      .reduce((total, line) => total + line.share, 0n),
    net: rolled.get(currency)?.get(unitId) ?? 0n,
  }));
  const transfers = familyTransfers(net, units).filter(
    (transfer) => memberSet.has(transfer.from) || memberSet.has(transfer.to),
  );
  const ids = new Set([
    ...members,
    ...payments.flatMap((payment) => [payment.from, payment.to]),
    ...transfers.flatMap((transfer) => [transfer.from, transfer.to]),
  ]);
  const labels = Object.fromEntries(
    [...ids].map((id) => {
      const familyId = unitOf(units, id);
      const family = familyId ? units[familyId] : undefined;
      return [id, family ? `${family.name} (${nameOf(id)})` : nameOf(id)];
    }),
  );
  return {
    group: group.name,
    name: unit.name,
    members: members.map(nameOf),
    expenses: lines,
    settlements: payments,
    totals,
    transfers,
    labels,
  };
}

/** Plain text with short lines for native sharing and WhatsApp. */
export function formatFamilyStatement(statement: FamilyStatement): string {
  const amount = (value: bigint, currency: string): string =>
    `${currency} ${formatMinor(value, currency)}`;
  const lines = [
    statement.name,
    statement.group,
    `Members: ${statement.members.join(', ')}`,
    '',
    'Expenses',
  ];
  if (!statement.expenses.length) lines.push('No expenses.');
  for (const expense of statement.expenses) {
    lines.push(
      `${expense.date} · ${expense.description}`,
      `Total: ${amount(expense.amount, expense.currency)}`,
      `Family share: ${amount(expense.share, expense.currency)}`,
      `Family paid: ${amount(expense.paid, expense.currency)}`,
      '',
    );
  }
  if (statement.settlements.length) lines.push('Settlements');
  for (const payment of statement.settlements) {
    lines.push(
      `${payment.at.slice(0, 10)} · ${statement.labels[payment.from]} → ${statement.labels[payment.to]}`,
      amount(payment.amount, payment.currency),
    );
  }
  lines.push('', 'Totals');
  for (const total of statement.totals) {
    lines.push(
      `Paid: ${amount(total.paid, total.currency)}`,
      `Share: ${amount(total.share, total.currency)}`,
      `Net: ${amount(total.net, total.currency)}`,
    );
  }
  lines.push('', 'Who pays whom');
  if (!statement.transfers.length) lines.push('All settled.');
  for (const transfer of statement.transfers) {
    lines.push(
      `${statement.labels[transfer.from]} → ${statement.labels[transfer.to]}`,
      amount(transfer.amount, transfer.currency),
    );
  }
  return lines.flatMap((line) => (line ? wrapText(line, 48) : [''])).join('\n');
}
