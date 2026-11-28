/**
 * Home's "To collect" / "To pay" tiles, from the same per-person rows "Needs you"
 * uses, so the counts and amounts always agree with the list they open.
 * Currencies are never summed (ADR-004): the headline currency fills the tiles,
 * every other currency is its own line.
 */

interface PersonRow {
  person_key: string;
  currency: string;
  net: string | bigint;
  is_demo?: boolean;
}

export interface CollectPay {
  collect: { amount: bigint; people: number };
  pay: { amount: bigint; people: number };
  /** Other currencies with a balance, biggest first; amounts are positive. */
  others: { currency: string; owed: bigint; owing: bigint }[];
}

export function collectPay(rows: readonly PersonRow[], headlineCurrency: string): CollectPay {
  const out: CollectPay = {
    collect: { amount: 0n, people: 0 },
    pay: { amount: 0n, people: 0 },
    others: [],
  };
  const rest = new Map<string, { currency: string; owed: bigint; owing: bigint }>();
  for (const row of rows) {
    if (row.is_demo) continue;
    const net = BigInt(row.net);
    if (net === 0n) continue;
    if (row.currency === headlineCurrency) {
      const side = net > 0n ? out.collect : out.pay;
      side.amount += net > 0n ? net : -net;
      side.people += 1;
    } else {
      const entry = rest.get(row.currency) ?? { currency: row.currency, owed: 0n, owing: 0n };
      if (net > 0n) entry.owed += net;
      else entry.owing += -net;
      rest.set(row.currency, entry);
    }
  }
  out.others = [...rest.values()].sort((a, b) => a.currency.localeCompare(b.currency));
  return out;
}
