/**
 * Finding the payments that come back.
 *
 * A ledger already knows everything needed to answer "what do I pay for every
 * month?" — it is sitting in the dates — and yet the app asks people to type
 * each recurring rule in by hand, which is the one piece of data entry nobody
 * finishes. This reads it back out instead.
 *
 * **It proposes; it never files.** Nothing here writes a `PersonalRecurring`,
 * and deliberately so. The confident case and the guess come out of the same
 * function wearing the same shape, and the screen decides what a candidate is
 * worth. A detector that quietly created rules would be wrong roughly as often
 * as it was right and would be wrong *invisibly*, which is the failure a person
 * discovers three months later in a budget that never matched their bank.
 *
 * **Every candidate carries its evidence.** The entry ids and the dates that
 * produced it, not a count. This is the load-bearing decision in the module: a
 * row that says "Netflix, monthly, ₹649" is a claim, and a row that says "seen
 * 3× · 22 Jul, 22 Aug, 22 Sep" is a claim somebody can check in four seconds
 * against their own memory. The first gets dismissed the first time it is
 * wrong; the second gets corrected. It also means the UI never has to re-derive
 * anything to explain itself, so the explanation cannot drift from the verdict.
 *
 * **Income is not a special case.** A salary lands on the same day every month
 * with the same amount — it is the *easiest* series in the file — and the only
 * thing that makes it income rather than a subscription is the direction of the
 * money. So direction is part of the grouping key and nothing else changes. A
 * second function for credits would have been a second set of thresholds to
 * keep in step, and they would not have stayed in step.
 *
 * Pure, deterministic, and blind to the clock: `today` arrives through options
 * or not at all (ADR-009). Same entries, same candidates, same order, on a
 * phone, in a test and in an edge function.
 */

import { normaliseMerchantName } from '../../category/merchant';
import { addToDate, dayDelta } from '../compute';
import type { Cadence } from '../types';
import { matchService, type RecurringKind, type ServiceEntry } from './catalog';

/** Which way the money went. Named and typed to match `PersonalTxn.kind`, so a
 *  ledger's own txns can be handed straight to `detectRecurring`. */
export type EntryDirection = 'expense' | 'income';

/**
 * One line of history, as little of it as this needs.
 *
 * Structural rather than `PersonalTxn` on purpose: the detector reads five
 * fields and a stored txn has eleven, and tying it to the stored shape would
 * mean every test case here had to invent a `carried`, a `loanId` and a
 * `recurringId` to say "Netflix, ₹649, July". A `PersonalTxn` satisfies this
 * interface as it stands, and so does a row from an imported statement or a
 * classified SMS, none of which are the same type as each other.
 */
export interface RecurringEntry {
  readonly id: string;
  /** The merchant as the bank wrote it. Entries without one are skipped —
   *  "money left the account" is not evidence of anything repeating. */
  readonly merchant: string | null;
  readonly amount: bigint;
  readonly kind: EntryDirection;
  /** YYYY-MM-DD. */
  readonly date: string;
  readonly currency: string;
}

/**
 * How much evidence a candidate stands on.
 *
 * Confidence here is *quantity of evidence and nothing else* — three
 * matching gaps, one, or none. In particular a varying amount does not lower
 * it: an electricity bill is never the same twice, and a ladder that punished
 * variance would rank the single most reliably monthly payment in the file
 * below a coffee subscription.
 */
export type DetectionConfidence = 'high' | 'medium' | 'low';

/** One entry that contributed, kept whole so the screen can list the dates. */
export interface RecurringEvidence {
  readonly id: string;
  readonly date: string;
  readonly amount: bigint;
}

export interface RecurringCandidate {
  /** Stable for the same merchant, direction and currency, so a candidate the
   *  person has already dismissed can be recognised on the next run. */
  readonly key: string;
  /** The cleaned merchant string the grouping used. */
  readonly merchant: string;
  /** What to show: the catalog's name when one matched, the cleaned merchant
   *  otherwise. Never invented — an unrecognised merchant keeps its own name. */
  readonly name: string;
  readonly serviceId: string | null;
  readonly kind: RecurringKind;
  /** Named as `PersonalRecurring.txnKind` is, because that is the field it
   *  becomes if the person accepts. */
  readonly txnKind: EntryDirection;
  readonly cadence: Cadence;
  readonly interval: number;
  /** The median of the contributing amounts — the middle one, not the mean.
   *  A single summer electricity bill drags an average somewhere no month
   *  actually was, and "around ₹550" has to be a number that happened. */
  readonly amount: bigint;
  /**
   * The contributing amounts were not all identical.
   *
   * Carried rather than left for the screen to work out, because the screen
   * must phrase the two cases differently — "₹649" for Netflix and "around
   * ₹550" for the electricity board — and a UI that asserts an exact figure
   * for a bill that has never once been that figure is a UI that gets caught.
   */
  readonly amountVaries: boolean;
  readonly currency: string;
  readonly confidence: DetectionConfidence;
  /** No repetition was observed at all; this rests entirely on the merchant
   *  being a service the catalog knows. Always `low` confidence. */
  readonly fromCatalogOnly: boolean;
  /** Oldest first. Every entry that supports the cadence, and only those. */
  readonly evidence: readonly RecurringEvidence[];
  /** The most recent contributing date. */
  readonly lastDate: string;
  /** When the next one is due if the pattern holds. Derived from `lastDate`,
   *  never from the clock. */
  readonly nextDate: string;
}

export interface DetectOptions {
  /**
   * YYYY-MM-DD. Supplied only to drop series that have stopped.
   *
   * A subscription cancelled in March is still three perfect monthly gaps, and
   * offering in September to set up a rule for it is worse than saying nothing.
   * Omit it and nothing is dropped — the caller that has no clock (an export, a
   * test) gets every series the file contains, which is the honest default.
   */
  readonly today?: string;
  /** How far the contributing amounts may spread before the group stops
   *  looking like one payment. Percent of the largest; 20 by default. */
  readonly amountTolerancePercent?: number;
}

/**
 * A gap in days, and the cadence it means.
 *
 * The bands are wide because calendars are: a monthly charge lands 28 to 31
 * days apart depending on which month it crossed, and a weekly one slips a day
 * when the date falls on a bank holiday. They are also *disjoint*, which is
 * what lets a gap vote for exactly one cadence and keeps the tally honest.
 *
 * `semimonthly` is missing on purpose. Twice a month is two days of the month,
 * not a repeating interval, so it arrives as alternating gaps of 13–16 and
 * 15–18 days and cannot be read off a single gap at all — the fortnightly band
 * catches half of them and the other half vote for nothing, which is the right
 * outcome for a pattern this module cannot see. A person who is paid on the 1st
 * and the 16th picks `twiceAMonth` in the editor, where the rule is stated
 * rather than inferred.
 *
 * Order matters for one case only: equal vote counts fall to the shortest
 * cycle, so a file too thin to tell monthly from quarterly proposes the one
 * that comes back soonest and gets corrected sooner.
 */
interface CadenceBand {
  readonly cadence: Cadence;
  readonly interval: number;
  readonly minDays: number;
  readonly maxDays: number;
}

const BANDS: readonly CadenceBand[] = [
  { cadence: 'weekly', interval: 1, minDays: 6, maxDays: 8 },
  { cadence: 'weekly', interval: 2, minDays: 13, maxDays: 16 },
  { cadence: 'monthly', interval: 1, minDays: 28, maxDays: 31 },
  { cadence: 'monthly', interval: 3, minDays: 89, maxDays: 95 },
  { cadence: 'yearly', interval: 1, minDays: 364, maxDays: 367 },
];

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Which band a gap falls in, or -1. */
function bandFor(days: number): number {
  return BANDS.findIndex((band) => days >= band.minDays && days <= band.maxDays);
}

/** Roughly how long one cycle is, for deciding a series has stopped. Rough is
 *  all that is wanted: the staleness test already allows two whole cycles. */
function cycleDays(cadence: Cadence, interval: number): number {
  const base =
    cadence === 'weekly' ? 7 : cadence === 'semimonthly' ? 15 : cadence === 'yearly' ? 365 : 30;
  return base * Math.max(1, interval);
}

/**
 * Has this stopped?
 *
 * Two whole cycles plus a fortnight. One missed payment is a card that expired
 * or a bill that came late, and dropping a series on that would make the whole
 * list flicker month to month; two in a row, and it is gone.
 */
function stale(lastDate: string, today: string, cadence: Cadence, interval: number): boolean {
  return dayDelta(lastDate, today) > 2 * cycleDays(cadence, interval) + 14;
}

/** Plain code-unit comparison, not `localeCompare`: the output order is part of
 *  what the tests pin, and it must not depend on the device's locale. */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const RANK: Record<DetectionConfidence, number> = { high: 0, medium: 1, low: 2 };

interface Group {
  readonly merchant: string;
  readonly txnKind: EntryDirection;
  readonly currency: string;
  readonly rows: RecurringEntry[];
}

/**
 * The repeating payments a ledger's history implies.
 *
 * Grouped by cleaned merchant, direction and currency — currency included
 * because the same airline billed in two currencies is two different amounts,
 * and a spread test run across them would either reject a real series or accept
 * a nonsense one.
 *
 * A group becomes a candidate when two gaps agree, which needs three entries;
 * or when one gap agrees and the merchant is in the catalog, because "Netflix,
 * twice, a month apart" is a different claim from "this unknown string, twice";
 * or when a single entry names a catalogued service, which is the weakest thing
 * this returns and says so.
 *
 * Returned confident-first, then by merchant name — a total order over the
 * fields the caller can see, so two runs over the same file cannot disagree
 * about which row is at the top.
 */
export function detectRecurring(
  entries: readonly RecurringEntry[],
  options: DetectOptions = {},
): RecurringCandidate[] {
  const tolerance = BigInt(Math.max(0, Math.round(options.amountTolerancePercent ?? 20)));
  const today = options.today && YMD.test(options.today) ? options.today : null;

  const groups = new Map<string, Group>();
  for (const entry of entries) {
    if (!entry.merchant) continue;
    // A malformed date would sail through `dayDelta` as a zero-day gap and
    // quietly vote for nothing, so it is refused here where it is visible.
    if (!YMD.test(entry.date)) continue;
    const merchant = normaliseMerchantName(entry.merchant);
    if (merchant.length === 0) continue;

    const key = `${merchant}\u0000${entry.kind}\u0000${entry.currency}`;
    const group = groups.get(key);
    if (group) group.rows.push(entry);
    else
      groups.set(key, {
        merchant,
        txnKind: entry.kind,
        currency: entry.currency,
        rows: [entry],
      });
  }

  const candidates: RecurringCandidate[] = [];
  for (const [key, group] of groups) {
    const candidate = candidateFor(key, group, tolerance, today);
    if (candidate) candidates.push(candidate);
  }

  return candidates.sort(
    (a, b) =>
      RANK[a.confidence] - RANK[b.confidence] ||
      compareStrings(a.merchant, b.merchant) ||
      compareStrings(a.key, b.key),
  );
}

function candidateFor(
  key: string,
  group: Group,
  tolerance: bigint,
  today: string | null,
): RecurringCandidate | null {
  // Date first, then id: two charges on the same day must not swap places
  // between runs, or the evidence list would reorder for no reason.
  const rows = [...group.rows].sort(
    (a, b) => compareStrings(a.date, b.date) || compareStrings(a.id, b.id),
  );
  const service = matchService(group.merchant);

  if (rows.length === 1) {
    // Nothing repeated. Everything below this point is the catalog's word.
    if (!service) return null;
    const interval = service.interval ?? 1;
    if (today && stale(rows[0]!.date, today, service.cadence, interval)) return null;
    return build(key, group, service.cadence, interval, rows, 'low', true, service);
  }

  const votes = new Array<number>(BANDS.length).fill(0);
  const bands: number[] = [];
  for (let i = 1; i < rows.length; i += 1) {
    const band = bandFor(dayDelta(rows[i - 1]!.date, rows[i]!.date));
    bands.push(band);
    if (band >= 0) votes[band] = votes[band]! + 1;
  }

  let winner = -1;
  let best = 0;
  for (let i = 0; i < votes.length; i += 1) {
    // Strictly greater, so an equal tally keeps the earlier band — the shortest
    // cycle, which is the guess that comes back soonest to be corrected.
    if (votes[i]! > best) {
      winner = i;
      best = votes[i]!;
    }
  }
  if (winner === -1) return null;
  if (best < 2 && !service) return null;

  // Only the entries that sit on the winning cadence count. A one-off purchase
  // from a merchant somebody also subscribes to would otherwise appear in the
  // evidence list, widen `amountVaries` and move the median — three separate
  // ways for a row to look wrong to the one person able to check it.
  const contributing: RecurringEntry[] = [];
  const keep = new Set<number>();
  for (let i = 0; i < bands.length; i += 1) {
    if (bands[i] !== winner) continue;
    keep.add(i);
    keep.add(i + 1);
  }
  for (let i = 0; i < rows.length; i += 1) if (keep.has(i)) contributing.push(rows[i]!);

  // Percent of the largest, in whole bigints — no floats anywhere near money.
  const { low, high } = spread(contributing);
  if (high > 0n && (high - low) * 100n > tolerance * high) return null;

  const band = BANDS[winner]!;
  const lastDate = contributing[contributing.length - 1]!.date;
  if (today && stale(lastDate, today, band.cadence, band.interval)) return null;

  return build(
    key,
    group,
    band.cadence,
    band.interval,
    contributing,
    best >= 2 ? 'high' : 'medium',
    false,
    service,
  );
}

/** The smallest and largest amount in a non-empty run. */
function spread(rows: readonly RecurringEntry[]): { low: bigint; high: bigint } {
  let low = rows[0]!.amount;
  let high = low;
  for (const row of rows) {
    if (row.amount < low) low = row.amount;
    if (row.amount > high) high = row.amount;
  }
  return { low, high };
}

function build(
  key: string,
  group: Group,
  cadence: Cadence,
  interval: number,
  rows: readonly RecurringEntry[],
  confidence: DetectionConfidence,
  fromCatalogOnly: boolean,
  service: ServiceEntry | null,
): RecurringCandidate {
  const amounts = rows.map((row) => row.amount).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  // The lower middle of an even count, so the representative amount is always
  // one that was really charged rather than the average of two that were.
  const median = amounts[(amounts.length - 1) >> 1]!;
  const lastDate = rows[rows.length - 1]!.date;

  return {
    key,
    merchant: group.merchant,
    name: service?.name ?? group.merchant,
    serviceId: service?.id ?? null,
    // Direction wins over the catalog: a refund from Netflix is not a
    // subscription, whatever the merchant string says.
    kind: group.txnKind === 'income' ? 'income' : (service?.kind ?? 'other'),
    txnKind: group.txnKind,
    cadence,
    interval,
    amount: median,
    amountVaries: amounts[0] !== amounts[amounts.length - 1]!,
    currency: group.currency,
    confidence,
    fromCatalogOnly,
    evidence: rows.map((row) => ({ id: row.id, date: row.date, amount: row.amount })),
    lastDate,
    nextDate: addToDate(lastDate, cadence, interval),
  };
}
