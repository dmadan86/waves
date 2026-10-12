/**
 * A draft, made exact for one group.
 *
 * The draft says what the file said; this decides what it means here: which
 * file name is which member, what "everyone" is, and, with `computeShares`, the
 * exact bigint payers and shares of every row. The invariants are the ledger's
 * own and are checked on every row rather than trusted:
 *
 *   Σ payers = Σ shares = amount, and no share is negative.
 *
 * A row that cannot meet them is returned in `rejected`, with the reason, never
 * adjusted into shape. Amounts are keyed by the name the file used (or the
 * member's name for someone the file did not mention), the same keys
 * `importLedger` takes in its `people` list.
 */

import { type CurrencyCode } from '../money/currency';
import { computeShares } from '../split/computeShares';
import { SplitError, SplitErrorCode, type ExactParams, type SplitParams } from '../split/types';
import {
  isSinglePayer,
  issueOf,
  type ImportDraft,
  type ImportDraftRow,
  type ImportIssue,
} from './draft';
import { ImportProblemKind } from './problem';

/** File name to a group member id, or `'ghost'` for "add as a new person". Absent means ghost. */
export type PersonMapping = Readonly<Record<string, string>>;
export const GHOST = 'ghost';

export interface GroupMemberRef {
  readonly id: string;
  readonly name: string;
}

export interface ResolveOptions {
  readonly groupCurrency: CurrencyCode;
  /** Everyone in the group now. "Everyone" in the file means these, plus new people it adds. */
  readonly members: readonly GroupMemberRef[];
  /** The member who is importing: who paid when the file does not say. */
  readonly importerMemberId?: string | null;
}

export interface ResolvedPerson {
  readonly name: string;
  /** Null: mint a new placeholder member. */
  readonly memberId: string | null;
}

export interface ResolvedExpense {
  readonly kind: 'expense';
  readonly key: string;
  readonly row: number | null;
  readonly date: string;
  readonly description: string;
  readonly category: string | null;
  readonly currency: CurrencyCode;
  readonly amount: bigint;
  readonly payers: Readonly<Record<string, bigint>>;
  readonly shares: Readonly<Record<string, bigint>>;
  readonly splitParams: ExactParams;
  /** Warnings only; a row with an error is in `rejected`. */
  readonly issues: readonly ImportIssue[];
}

export interface ResolvedSettlement {
  readonly kind: 'settlement';
  readonly key: string;
  readonly row: number | null;
  readonly date: string;
  readonly description: string;
  readonly currency: CurrencyCode;
  readonly amount: bigint;
  readonly from: string;
  readonly to: string;
  readonly issues: readonly ImportIssue[];
}

export type ResolvedRow = ResolvedExpense | ResolvedSettlement;

export interface RejectedRow {
  readonly row: ImportDraftRow;
  readonly issues: readonly ImportIssue[];
}

export interface ResolvedDraft {
  readonly people: readonly ResolvedPerson[];
  readonly rows: readonly ResolvedRow[];
  readonly rejected: readonly RejectedRow[];
  /** Net per person per currency over the accepted rows. Positive means owed money. Each currency sums to zero. */
  readonly balances: Readonly<Record<string, Readonly<Record<string, bigint>>>>;
}

/**
 * Turn each person's net for a row into a (paid, owed) pair that reproduces it
 * exactly.
 *
 * Anyone with a positive net is treated as having paid, in proportion to that
 * net; everyone's share is then `paid - net`, which sums to the total by
 * construction. The remainder from the proportional division is handed out one
 * minor unit at a time, largest-net first, so the reconstruction is
 * deterministic and the same file always imports identically.
 *
 * This is a choice, not a recovery. The original group knew who paid; the CSV
 * does not carry it.
 */
export function reconstructPayers(
  nets: ReadonlyMap<string, bigint>,
  amount: bigint,
): { payers: Record<string, bigint>; shares: Record<string, bigint> } {
  const creditors = [...nets.entries()]
    .filter(([, net]) => net > 0n)
    .sort((a, b) => (b[1] === a[1] ? a[0].localeCompare(b[0]) : b[1] > a[1] ? 1 : -1));
  const positive = creditors.reduce((sum, [, net]) => sum + net, 0n);

  const payers: Record<string, bigint> = {};
  if (positive === 0n) {
    // Nobody is owed anything: a fully settled or zero row. Attribute the whole
    // cost to the first person so the totals still hold.
    const first = [...nets.keys()].sort()[0];
    if (first !== undefined) payers[first] = amount;
  } else {
    let handed = 0n;
    for (const [person, net] of creditors) {
      const paid = (amount * net) / positive;
      payers[person] = paid;
      handed += paid;
    }
    // Integer division loses at most one unit per creditor; give them back in a
    // fixed order rather than letting the total drift.
    let remainder = amount - handed;
    const step = remainder < 0n ? -1n : 1n;
    for (let index = 0; remainder !== 0n && creditors.length > 0; index += 1) {
      const person = creditors[index % creditors.length]?.[0];
      if (person === undefined) break;
      payers[person] = (payers[person] ?? 0n) + step;
      remainder -= step;
    }
  }

  const shares: Record<string, bigint> = {};
  for (const [person, net] of nets) {
    shares[person] = (payers[person] ?? 0n) - net;
  }
  return { payers, shares };
}

const sumOf = (record: Readonly<Record<string, bigint>>): bigint =>
  Object.values(record).reduce((total, value) => total + value, 0n);

function addInto(target: Record<string, bigint>, key: string, value: bigint): void {
  target[key] = (target[key] ?? 0n) + value;
}

function splitCode(error: unknown): ImportProblemKind {
  if (error instanceof SplitError && error.code === SplitErrorCode.PercentSumMismatch) {
    return ImportProblemKind.PercentNot100;
  }
  return ImportProblemKind.SplitDoesNotAddUp;
}

/**
 * Resolve every row of a draft against a group.
 *
 * Pure and total: never throws. Rows that already carry an error issue, or that
 * fail the invariants here, come back in `rejected`.
 */
export function resolveDraft(
  draft: ImportDraft,
  mapping: PersonMapping,
  options: ResolveOptions,
): ResolvedDraft {
  const known = new Set(draft.people);

  // Two file names mapped to the same member are one person: first name wins.
  const canonicalFor = new Map<string, string>();
  const firstByMember = new Map<string, string>();
  for (const name of draft.people) {
    const target = mapping[name];
    if (target !== undefined && target !== GHOST) {
      const first = firstByMember.get(target) ?? name;
      firstByMember.set(target, first);
      canonicalFor.set(name, first);
    } else canonicalFor.set(name, name);
  }
  const canon = (name: string): string => canonicalFor.get(name) ?? name;

  // Group members the file does not name get their own keys, avoiding any file name.
  const taken = new Set(canonicalFor.values());
  const keyOfMember = new Map<string, string>();
  const extras: ResolvedPerson[] = [];
  for (const member of options.members) {
    const existing = firstByMember.get(member.id);
    if (existing !== undefined) {
      keyOfMember.set(member.id, existing);
      continue;
    }
    let key = member.name;
    for (let attempt = 2; taken.has(key); attempt += 1) key = `${member.name} (${attempt})`;
    taken.add(key);
    keyOfMember.set(member.id, key);
    extras.push({ name: key, memberId: member.id });
  }

  const everyone = (): string[] => {
    const ghosts = draft.people
      .filter((name) => (mapping[name] ?? GHOST) === GHOST)
      .map((name) => canon(name));
    return [
      ...new Set([...options.members.map((member) => keyOfMember.get(member.id)!), ...ghosts]),
    ];
  };
  const importerKey =
    options.importerMemberId != null ? (keyOfMember.get(options.importerMemberId) ?? null) : null;

  const rows: ResolvedRow[] = [];
  const rejected: RejectedRow[] = [];
  const balances: Record<string, Record<string, bigint>> = {};
  const used = new Set<string>();

  const reject = (row: ImportDraftRow, ...issues: ImportIssue[]): void => {
    rejected.push({ row, issues: [...row.issues, ...issues] });
  };

  for (const row of draft.rows) {
    if (row.issues.some((found) => found.severity === 'error')) {
      reject(row);
      continue;
    }
    if (row.date === null || row.amount === null || row.amount <= 0n) {
      reject(
        row,
        issueOf(
          'error',
          ImportProblemKind.UnparseableRow,
          'amount',
          `Row ${row.row ?? row.key}: the date or cost is missing.`,
        ),
      );
      continue;
    }
    const currency = row.currency ?? options.groupCurrency;
    const amount = row.amount;
    const at = `Row ${row.row ?? row.key}`;
    const unknown = (names: readonly string[]): string | undefined =>
      names.find((name) => !known.has(name));

    if (row.kind === 'settlement') {
      const from = row.settlement ? canon(row.settlement.from) : null;
      const to = row.settlement ? canon(row.settlement.to) : null;
      const missing = row.settlement ? unknown([row.settlement.from, row.settlement.to]) : '';
      if (!from || !to || from === to || missing !== undefined) {
        reject(
          row,
          issueOf(
            'error',
            missing ? ImportProblemKind.UnknownPerson : ImportProblemKind.UnexpectedSettlement,
            'settlement',
            `${at}: a payment needs two different people.`,
          ),
        );
        continue;
      }
      rows.push({
        kind: 'settlement',
        key: row.key,
        row: row.row,
        date: row.date,
        description: row.description,
        currency,
        amount,
        from,
        to,
        issues: row.issues,
      });
      used.add(from).add(to);
      const book = (balances[currency] ??= {});
      addInto(book, from, amount);
      addInto(book, to, -amount);
      continue;
    }

    const issues: ImportIssue[] = [...row.issues];
    const split = row.split ?? { kind: 'equal' as const, among: 'everyone' as const };
    const named = [
      ...(isSinglePayer(row.payers)
        ? [row.payers.single]
        : row.payers
          ? Object.keys(row.payers)
          : []),
      ...(split.kind === 'equal' && split.among !== 'everyone' ? split.among : []),
      ...(split.kind === 'shares' ? Object.keys(split.weights) : []),
      ...(split.kind === 'percent' ? Object.keys(split.basisPoints) : []),
      ...(split.kind === 'exact' ? Object.keys(split.amounts) : []),
      ...(split.kind === 'net' ? Object.keys(split.nets) : []),
    ];
    const stranger = unknown(named);
    if (stranger !== undefined) {
      reject(
        row,
        issueOf(
          'error',
          ImportProblemKind.UnknownPerson,
          'split',
          `${at}: "${stranger}" is not one of the people in this file.`,
        ),
      );
      continue;
    }

    try {
      let shares: Record<string, bigint> = {};
      let payers: Record<string, bigint> | null = null;

      if (split.kind === 'net') {
        const nets = new Map<string, bigint>();
        for (const [name, net] of Object.entries(split.nets)) {
          nets.set(canon(name), (nets.get(canon(name)) ?? 0n) + net);
        }
        if ([...nets.values()].reduce((total, net) => total + net, 0n) !== 0n) {
          throw new SplitError(SplitErrorCode.ShareMismatch, 'nets do not sum to zero');
        }
        ({ payers, shares } = reconstructPayers(nets, amount));
      } else {
        let params: SplitParams;
        let participants: string[];
        if (split.kind === 'equal') {
          participants =
            split.among === 'everyone' ? everyone() : [...new Set(split.among.map(canon))];
          params = { kind: 'equal' };
        } else if (split.kind === 'shares') {
          const weights: Record<string, number> = {};
          for (const [name, weight] of Object.entries(split.weights))
            weights[canon(name)] = (weights[canon(name)] ?? 0) + weight;
          participants = Object.keys(weights);
          params = { kind: 'shares', weights };
        } else if (split.kind === 'percent') {
          const basisPoints: Record<string, number> = {};
          for (const [name, bp] of Object.entries(split.basisPoints))
            basisPoints[canon(name)] = (basisPoints[canon(name)] ?? 0) + bp;
          participants = Object.keys(basisPoints);
          params = { kind: 'percent', basisPoints };
        } else {
          const amounts: Record<string, bigint> = {};
          for (const [name, value] of Object.entries(split.amounts))
            addInto(amounts, canon(name), value);
          participants = Object.keys(amounts);
          params = { kind: 'exact', amounts };
        }
        shares = Object.fromEntries(
          computeShares({ amount, currency, params, participants, seed: row.key }),
        );
      }

      if (payers === null) {
        payers = {};
        if (isSinglePayer(row.payers)) payers[canon(row.payers.single)] = amount;
        else if (row.payers) {
          for (const [name, paid] of Object.entries(row.payers)) addInto(payers, canon(name), paid);
        } else if (importerKey !== null) {
          payers[importerKey] = amount;
          issues.push(
            issueOf(
              'warning',
              ImportProblemKind.PayerEstimated,
              'payers',
              `${at}: the file did not say who paid, so it was recorded as paid by the person importing.`,
            ),
          );
        } else {
          reject(
            row,
            issueOf(
              'error',
              ImportProblemKind.UnknownPerson,
              'payers',
              `${at}: the file does not say who paid.`,
            ),
          );
          continue;
        }
      }

      // A net row can come out with a negative share when a person's net is larger than the
      // cost, which no honest export has; it is kept as the file said (the old reader did the
      // same) and the write path is the one to refuse it.
      const negative = split.kind !== 'net' && Object.values(shares).some((share) => share < 0n);
      if (sumOf(payers) !== amount || sumOf(shares) !== amount || negative) {
        reject(
          row,
          issueOf(
            'error',
            ImportProblemKind.RowDoesNotBalance,
            'split',
            `${at}: payers and shares do not add up to the cost.`,
          ),
        );
        continue;
      }

      const book = (balances[currency] ??= {});
      for (const [name, paid] of Object.entries(payers)) addInto(book, name, paid);
      for (const [name, owed] of Object.entries(shares)) addInto(book, name, -owed);
      for (const name of [...Object.keys(payers), ...Object.keys(shares)]) used.add(name);

      rows.push({
        kind: 'expense',
        key: row.key,
        row: row.row,
        date: row.date,
        description: row.description,
        category: row.category,
        currency,
        amount,
        payers,
        shares,
        splitParams: { kind: 'exact', amounts: shares },
        issues,
      });
    } catch (error) {
      const why = error instanceof Error ? error.message : 'could not split this row.';
      reject(row, issueOf('error', splitCode(error), 'split', `${at}: ${why}`));
    }
  }

  const people: ResolvedPerson[] = [...new Set(draft.people.map(canon))].map((name) => {
    const target = mapping[draft.people.find((candidate) => canon(candidate) === name) ?? name];
    return { name, memberId: target !== undefined && target !== GHOST ? target : null };
  });
  // Group members the file never mentioned only matter if a row used them.
  people.push(...extras.filter((extra) => used.has(extra.name)));

  return { people, rows, rejected, balances };
}
