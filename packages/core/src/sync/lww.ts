/**
 * Merging two edits of the same record, field by field.
 *
 * The private personal ledger (A48) stores every record as one opaque `data`
 * blob, and the sync edge writes that blob whole: `personal_records.upsert({ id,
 * data })`. Which means the last device to sync replaces the other's work
 * entirely, even when the two of them changed nothing in common:
 *
 *     phone  edits the amount of a subscription          →  syncs
 *     tablet marks the same record as a bill, same minute →  syncs
 *     → the amount is back to what it was, on both devices, with no conflict
 *       shown and nothing in the log to say it happened
 *
 * That is record-granularity last-write-wins, and it loses data that did not
 * actually conflict. This module makes the grain a field instead of a record:
 * two people changing two different fields both keep their change, and only a
 * genuine collision — the same field, twice — has to pick a winner.
 *
 * HOW IT IS STORED, AND WHY IT IS STORED THAT WAY.
 *
 * The blob keeps its exact shape. One sibling key is added:
 *
 *     {
 *       "amount": "649.00",
 *       "note":   "Netflix",
 *       "kind":   "subscription",
 *       "_meta": {
 *         "amount": { "t": 1790000012345, "d": "dev_a1" },
 *         "note":   { "t": 1790000019999, "d": "dev_b2" },
 *         "kind":   { "t": 1790000019999, "d": "dev_b2" }
 *       }
 *     }
 *
 * `t` is when the field was last set, in epoch milliseconds; `d` is the device
 * that set it. Nothing else moves, and that is the whole reason this shape was
 * chosen rather than a tidier one that nested the value and its stamp together.
 * `personal/types.ts` keeps every key it does not recognise in `carried` and
 * writes it back out on encode, so `_meta` rides through an app version that has
 * never heard of it, untouched. A version that knows about merging and a version
 * that does not can share a ledger from the day this lands. Restructuring the
 * blob would have needed both a migration and a flag day; an additive sibling
 * key needs neither.
 *
 * A field with no stamp is not an error. It is a field written before any of
 * this existed, and it is treated as stamped at time zero — the oldest thing in
 * the file — so a real write always beats it.
 *
 * WHY NOT YJS OR AUTOMERGE.
 *
 * Those libraries solve concurrent editing of *sequences*: two people typing
 * into the same paragraph, two people inserting at the same index of a list.
 * They carry the machinery — per-character identity, a binary document format,
 * a change history that has to be compacted — because that problem genuinely
 * needs it.
 *
 * This data is not that. A personal record is a flat map of scalars: an amount,
 * a date, a cadence, a category, a boolean. There is no index for two edits to
 * fight over, and "both edits survive" means "both fields survive", which is an
 * LWW-Map and about a hundred lines. Taking the dependency would also put a
 * binary document in the place where a readable JSON blob is today, and the
 * tolerant decoders and carried fields that this ledger just adopted — the thing
 * that lets an old app round-trip a new field — all assume that blob. It would
 * be a large, opinionated dependency bought to solve a problem this data does
 * not have, paid for by giving up the migration story.
 *
 * WHAT THIS IS NOT.
 *
 * It is not a merge for the *dismissal set*, and that is deliberate — see
 * {@link TwoPhaseSet} at the bottom of this file. A set of things somebody has
 * dismissed is add/remove, not a value that gets overwritten, and modelling it
 * as one register would let an unrelated later write resurrect a dismissal.
 *
 * Pure. Nothing here reads the clock; the caller injects `now` (ADR-009), which
 * is what makes the skew handling testable rather than a hope.
 */

/** Where the per-field stamps live inside a record's `data` blob. */
export const FIELD_META_KEY = '_meta';

/** When one field was last set, and by which device. */
export interface FieldStamp {
  /** Epoch milliseconds, as the writing device's clock read it. */
  readonly t: number;
  /** The writing device's id. Only ever compared as a string — it breaks ties,
   *  it does not identify anybody to the merge. */
  readonly d: string;
}

/** Field name → the stamp on that field. */
export type FieldMeta = Readonly<Record<string, FieldStamp>>;

/** A record's `data` blob: its own fields, plus optionally `_meta`. */
export type StampedData = Readonly<Record<string, unknown>>;

/**
 * How far into the future an incoming stamp is believed.
 *
 * Five minutes. Long enough to absorb an honest disagreement between two phones
 * and a server, short enough that a device with a badly wrong clock is pulled
 * back to roughly now instead of owning every field it touches until the date it
 * thinks it is actually arrives.
 */
export const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;

/** The stamp a field with no `_meta` entry is treated as carrying: older than
 *  anything anybody has actually written. */
const EPOCH: FieldStamp = { t: 0, d: '' };

// ─────────────────────────────────────────────────────── reading a blob ──

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The stamps in a blob, defensively.
 *
 * Every field is optional and every value is suspect: this blob came off the
 * wire, or out of a version that wrote `_meta` for its own reasons, or out of a
 * truncated write. An entry that is not a `{ t, d }` is dropped rather than
 * trusted, which degrades that one field to "unstamped" — it loses to a real
 * write, which is the safe direction.
 */
export function readFieldMeta(data: StampedData | null | undefined): FieldMeta {
  const raw = data?.[FIELD_META_KEY];
  if (!isPlainObject(raw)) return {};
  const meta: Record<string, FieldStamp> = {};
  for (const key of Object.keys(raw)) {
    const entry = raw[key];
    if (!isPlainObject(entry)) continue;
    const t = entry.t;
    const d = entry.d;
    if (typeof t !== 'number' || !Number.isFinite(t)) continue;
    meta[key] = { t: Math.max(0, Math.floor(t)), d: typeof d === 'string' ? d : '' };
  }
  return meta;
}

/** The blob without its stamps. For a caller that wants the record's own fields
 *  and nothing else; the decoders do not need this, because `_meta` lands in
 *  `carried` and is written straight back out. */
export function stripFieldMeta(data: StampedData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(data)) {
    if (key === FIELD_META_KEY) continue;
    out[key] = data[key];
  }
  return out;
}

/** A field counts as present when the key is there and holds something. An
 *  explicit `undefined` is JSON's way of saying nothing at all, so it reads as
 *  absent rather than as a value that could win. */
function has(data: StampedData, key: string): boolean {
  return key in data && data[key] !== undefined;
}

function fieldKeys(data: StampedData): string[] {
  return Object.keys(data).filter((key) => key !== FIELD_META_KEY && data[key] !== undefined);
}

// ───────────────────────────────────────────────── comparing two writes ──

/**
 * A stable string for any JSON value, with object keys sorted.
 *
 * Used for two things: deciding whether an edit actually changed a field, and
 * breaking a tie that `t` and `d` could not. `JSON.stringify` would do neither
 * reliably — it depends on key insertion order and throws on a bigint — and
 * both of those would show up as two devices disagreeing about which value won,
 * which is the one outcome this module exists to prevent.
 */
function canonical(value: unknown): string {
  if (value === null) return 'z';
  const type = typeof value;
  if (type === 'string') return `s:${value as string}`;
  if (type === 'number' || type === 'bigint' || type === 'boolean') {
    return `${type[0]}:${String(value)}`;
  }
  if (Array.isArray(value)) return `a:[${value.map(canonical).join(',')}]`;
  if (isPlainObject(value)) {
    const parts = Object.keys(value)
      .sort()
      .map((key) => `${key}=${canonical(value[key])}`);
    return `o:{${parts.join(',')}}`;
  }
  return 'u';
}

/**
 * Which of two writes to the same field wins: newest, then highest device id.
 *
 * The device id is not a tiebreak of convenience — it is what makes the answer
 * the same everywhere. Two devices that write the same field in the same
 * millisecond must agree on the winner no matter which order the writes reach
 * them, or the ledger settles differently on each phone and never converges.
 *
 * Returns < 0 when `a` loses, > 0 when `a` wins, 0 when the two writes are
 * indistinguishable — same instant, same device — which the caller then settles
 * on the value itself.
 */
function compareStamps(a: FieldStamp, b: FieldStamp): number {
  if (a.t !== b.t) return a.t < b.t ? -1 : 1;
  if (a.d !== b.d) return a.d < b.d ? -1 : 1;
  return 0;
}

/**
 * An incoming stamp, pulled back to now if it claims to be from the future.
 *
 * Device clocks are wrong, and one that is a year fast does not just win the
 * race — it wins every field it ever touches, forever, and no correctly-clocked
 * device can edit that record again. Clamping to `now + CLOCK_SKEW_TOLERANCE_MS`
 * turns "a year from now" into "just now": the skewed device still beats stale
 * writes, as a recent edit should, and the next real edit from any device beats
 * it a moment later.
 *
 * The other direction is left alone on purpose. A stamp far in the *past* is
 * indistinguishable from a genuinely old write — the record was edited on a
 * phone that was in a drawer for a month — and there is nothing to clamp it
 * towards without inventing an edit that did not happen. A device whose clock
 * runs slow is covered where it actually matters instead: {@link stampFields}
 * never issues a stamp that loses to the record it is editing.
 */
function clampStamp(stamp: FieldStamp, ceiling: number | null): FieldStamp {
  if (ceiling === null || stamp.t <= ceiling) return stamp;
  return { t: ceiling, d: stamp.d };
}

// ─────────────────────────────────────────────────────────── the merge ──

export interface MergeOptions {
  /** This device's idea of now, in epoch milliseconds. Supplied, stamps from
   *  the future are clamped to `now + skewToleranceMs`; omitted, they are
   *  believed. Pass it whenever the merge is folding in a write from somewhere
   *  else; omit it to replay a merge deterministically in a test. */
  readonly now?: number;
  /** Overrides {@link CLOCK_SKEW_TOLERANCE_MS}. */
  readonly skewToleranceMs?: number;
}

/**
 * Two versions of one record's `data`, merged field by field.
 *
 * The rules, in the order they apply to each field:
 *
 *   * present on one side only → that value, with its stamp;
 *   * present on both → the newer stamp wins (missing stamp = time zero);
 *   * same instant → the higher device id wins;
 *   * same instant and same device → the higher canonical value wins, so even a
 *     device that wrote twice inside one millisecond cannot make two peers
 *     disagree.
 *
 * That ordering is total, so this is a join over a semilattice: commutative,
 * associative and idempotent. Merge in any order, merge twice, merge a batch
 * that arrived scrambled — the answer is the same, which is the only property
 * that makes an offline queue safe to replay.
 *
 * The result's `_meta` describes exactly the fields the result has. A stamp for
 * a field that is not there is dropped: `_meta` is a description of this blob,
 * never a memory of one that no longer exists.
 */
export function mergeFields(
  left: StampedData,
  right: StampedData,
  options: MergeOptions = {},
): Record<string, unknown> {
  const ceiling =
    options.now === undefined
      ? null
      : options.now + (options.skewToleranceMs ?? CLOCK_SKEW_TOLERANCE_MS);

  const leftMeta = readFieldMeta(left);
  const rightMeta = readFieldMeta(right);

  const out: Record<string, unknown> = {};
  const meta: Record<string, FieldStamp> = {};

  const keys = new Set([...fieldKeys(left), ...fieldKeys(right)]);
  for (const key of keys) {
    const inLeft = has(left, key);
    const inRight = has(right, key);

    if (inLeft && !inRight) {
      take(out, meta, key, left[key], leftMeta[key], ceiling);
      continue;
    }
    if (inRight && !inLeft) {
      take(out, meta, key, right[key], rightMeta[key], ceiling);
      continue;
    }

    const leftStamp = clampStamp(leftMeta[key] ?? EPOCH, ceiling);
    const rightStamp = clampStamp(rightMeta[key] ?? EPOCH, ceiling);
    let order = compareStamps(leftStamp, rightStamp);
    if (order === 0) {
      // A plain code-unit comparison, never `localeCompare`: that one answers
      // differently depending on the locale and the ICU build, and two phones
      // disagreeing about which value won is the exact failure this tiebreak
      // exists to close.
      const a = canonical(left[key]);
      const b = canonical(right[key]);
      order = a === b ? 0 : a < b ? -1 : 1;
    }

    if (order >= 0) {
      take(out, meta, key, left[key], leftMeta[key], ceiling);
    } else {
      take(out, meta, key, right[key], rightMeta[key], ceiling);
    }
  }

  if (Object.keys(meta).length > 0) out[FIELD_META_KEY] = meta;
  return out;
}

/** Write one field and its stamp into the result. A field that never had a
 *  stamp does not gain one here: absent already means time zero, and inventing
 *  `{ t: 0 }` entries would grow every blob to say nothing. */
function take(
  out: Record<string, unknown>,
  meta: Record<string, FieldStamp>,
  key: string,
  value: unknown,
  stamp: FieldStamp | undefined,
  ceiling: number | null,
): void {
  out[key] = value;
  if (stamp) meta[key] = clampStamp(stamp, ceiling);
}

/** The same merge across a list, in one call. Order does not matter — that is
 *  the point of the property — so a caller with a handful of copies of one
 *  record can hand them over however they arrived. */
export function mergeAllFields(
  versions: readonly StampedData[],
  options: MergeOptions = {},
): Record<string, unknown> {
  return versions.reduce<Record<string, unknown>>(
    (acc, version) => mergeFields(acc, version, options),
    {},
  );
}

// ───────────────────────────────────────────────────────── stamping ──

export interface StampOptions {
  /** This device's idea of now, in epoch milliseconds. */
  readonly now: number;
  /** This device's id. Stable per install; it decides ties, so two devices
   *  sharing one id can tie on both `t` and `d` and fall through to the value. */
  readonly deviceId: string;
}

/**
 * The blob to write, with a fresh stamp on everything this edit changed.
 *
 * `previous` is the record as it was stored — the mirror row's `data` — and it
 * is required rather than optional, explicitly `null` for a create, because
 * getting it wrong is silent. Stamp a field the person did not touch and this
 * device wins that field against an edit somebody else really made, which is
 * exactly the whole-record overwrite this module exists to replace. Passing
 * `null` when the row is in fact known does not throw; it just quietly goes back
 * to being last-write-wins for that write.
 *
 * A field whose value is unchanged keeps the stamp it already had. A field that
 * is new, changed, or cleared to null gets a new one.
 *
 * The new stamp is `max(now, the newest stamp on this record + 1)`, not `now`.
 * A phone whose clock runs slow would otherwise write edits that lose to the
 * very values it is editing — the person changes the amount, the change syncs,
 * and the old amount comes back — which looks like the app throwing work away
 * and is indistinguishable from it. Riding one tick above the record's own high
 * water mark makes an edit always beat what it edited, whatever the clock says.
 * It stays bounded because {@link mergeFields} clamps futures on the way in, so
 * the high water mark itself can never run away.
 */
export function stampFields(
  previous: StampedData | null | undefined,
  next: StampedData,
  options: StampOptions,
): Record<string, unknown> {
  // Both sides can carry stamps: the stored row has its own, and `next` usually
  // came from decode-then-encode, which round-trips `_meta` through `carried`.
  // Take the newer of the two per field, so a stale copy of the meta cannot
  // reset a field's history.
  const base: Record<string, FieldStamp> = { ...readFieldMeta(previous) };
  for (const [key, stamp] of Object.entries(readFieldMeta(next))) {
    const held = base[key];
    if (!held || compareStamps(stamp, held) > 0) base[key] = stamp;
  }

  let highest = 0;
  for (const stamp of Object.values(base)) highest = Math.max(highest, stamp.t);
  const stamp: FieldStamp = {
    t: Math.max(options.now, highest + 1),
    d: options.deviceId,
  };

  const out: Record<string, unknown> = {};
  const meta: Record<string, FieldStamp> = {};

  for (const key of fieldKeys(next)) {
    out[key] = next[key];
    const unchanged =
      previous != null && has(previous, key) && canonical(previous[key]) === canonical(next[key]);
    if (unchanged) {
      const held = base[key];
      if (held) meta[key] = held;
    } else {
      meta[key] = stamp;
    }
  }

  // Only when there is something to say. `_meta` is present exactly when at
  // least one field carries a stamp, on both this path and the merge's, so two
  // equal blobs are deep-equal rather than differing by an empty object.
  if (Object.keys(meta).length > 0) out[FIELD_META_KEY] = meta;
  return out;
}

/**
 * An incoming write, with a stamp put on the fields it silently changed.
 *
 * This is what lets the merge work against clients that know nothing about it,
 * and it is the piece that makes the whole thing deployable rather than a thing
 * that starts working after everybody updates.
 *
 * The problem it solves. A client sends the *whole* blob on every edit, not a
 * patch — the fields the person changed and the fields they did not, all
 * together, exactly as that device last saw them. A device that does not stamp
 * its edits therefore sends stale stamps on everything, including the one field
 * it actually changed, and a naive merge would throw that change away. Stamping
 * everything that differs would be just as wrong in the other direction: a field
 * this device last saw a week ago also "differs" from what somebody else has
 * since written, and restamping it would let a stale copy clobber a newer edit —
 * which is the bug this whole module exists to close.
 *
 * The rule that separates the two, and it is exact:
 *
 *     the stamp on this field is IDENTICAL to the stored one,
 *     and the value is not
 *       → the writer changed it without restamping. It is a real edit, made
 *         against the version that is stored, so it gets a stamp of its own.
 *
 *     the stamp differs
 *       → somebody else has written this field since this writer last saw it.
 *         Whatever value the writer is carrying is a stale copy, not an edit.
 *         Leave it alone and let the stamps decide.
 *
 * So on the server: the phone that edits an amount offline keeps its edit, and
 * the note it was carrying around unchanged does not overwrite the note
 * somebody else corrected in the meantime. Neither device had to be updated for
 * that to be true.
 *
 * The one case the rule cannot read is a blob with no `_meta` at all while the
 * stored row has one — a writer that dropped the stamps rather than carrying
 * them. There is nothing in it to compare, so it is taken at its word and every
 * differing field is stamped: back to whole-record last-write-wins for that one
 * write, which is what happens today anyway, rather than ignoring the write
 * entirely.
 *
 * Meant to be called once, on the server, on the way in — it is the only place
 * that sees both versions at a serialised moment, and stamping there also means
 * a wrong client clock cannot reach the stored record at all.
 */
export function adoptUnstampedEdits(
  stored: StampedData | null | undefined,
  incoming: StampedData,
  options: StampOptions,
): Record<string, unknown> {
  if (stored == null) return { ...incoming };

  const storedMeta = readFieldMeta(stored);
  const incomingMeta = readFieldMeta(incoming);
  // Nothing to compare against: this writer carried no stamps at all.
  const blind = Object.keys(incomingMeta).length === 0;

  let highest = 0;
  for (const held of Object.values(storedMeta)) highest = Math.max(highest, held.t);
  for (const held of Object.values(incomingMeta)) highest = Math.max(highest, held.t);
  // One tick above everything either side knows about, for the same reason
  // `stampFields` does it: an edit must beat what it edited, whatever the clock
  // running this says.
  const fresh: FieldStamp = { t: Math.max(options.now, highest + 1), d: options.deviceId };

  const out: Record<string, unknown> = {};
  const meta: Record<string, FieldStamp> = { ...incomingMeta };

  for (const key of fieldKeys(incoming)) {
    out[key] = incoming[key];
    // A field the stored record does not have wins by being present; it needs
    // no stamp to do that.
    if (!has(stored, key)) continue;
    if (canonical(stored[key]) === canonical(incoming[key])) continue;
    const seen = incomingMeta[key] ?? EPOCH;
    const held = storedMeta[key] ?? EPOCH;
    if (blind || compareStamps(seen, held) === 0) meta[key] = fresh;
  }

  for (const key of Object.keys(meta)) {
    if (!(key in out)) delete meta[key];
  }
  if (Object.keys(meta).length > 0) out[FIELD_META_KEY] = meta;
  return out;
}

// ──────────────────────────────────────────── the dismissal set (2P-Set) ──

/**
 * A set that two devices can both add to and both remove from, and still agree.
 *
 * The case this exists for is "candidates I have dismissed": the recurring-rule
 * detector proposes the same things on every run, and a proposal the person has
 * already said no to must stay said-no-to. That is a set with adds and removes,
 * and the obvious implementation — a `dismissed: string[]` field on a record,
 * merged by {@link mergeFields} like everything else — is wrong in a way that is
 * easy to miss:
 *
 *     phone  dismisses "netflix"       → dismissed = ["netflix"], t = 5
 *     tablet (still has dismissed = []) changes something unrelated
 *            and writes the record back → dismissed = [],          t = 6
 *     → "netflix" is proposed again, because a newer write of the whole array
 *       beat an older write of the whole array
 *
 * A register holds one value and the newest write replaces it. Membership is not
 * one value; it is one decision per element, and each of those decisions needs
 * to survive on its own. So each element is tracked separately, and a merge is
 * the union of both sides' adds and both sides' tombstones.
 *
 * REMOVED WINS, AND WHAT THAT COSTS.
 *
 * An element that has been removed is not a member, whatever else arrives. A
 * late add from a device that had not heard about the removal cannot bring it
 * back, which is the guarantee that makes the structure worth having — but it
 * runs both ways, and the cost is real: **a removal cannot be undone by merging
 * anything.** The tombstone is permanent by design, because "permanent" is the
 * only rule that every device can apply without knowing the order things
 * happened in.
 *
 * So re-admitting something that was removed is not a delete of its tombstone.
 * It is a new element, with a new id — `netflix#2`, a fresh uuid, whatever the
 * caller's id scheme allows — and the caller has to mint it. A caller that
 * cannot mint one wants a different structure (an add-wins set, which buys that
 * at the price of per-add identity and a garbage-collection problem), and should
 * say so rather than quietly deleting from `removed`.
 */
export interface TwoPhaseSet {
  /** Sorted and deduped, so two equal sets are deep-equal. */
  readonly added: readonly string[];
  /** Sorted and deduped. Permanent — see the note above. */
  readonly removed: readonly string[];
}

const EMPTY_SET: TwoPhaseSet = { added: [], removed: [] };

export function emptyTwoPhaseSet(): TwoPhaseSet {
  return EMPTY_SET;
}

/** Whatever the wire handed us, as a set. Anything that is not a list of
 *  strings reads as empty rather than throwing in a render. */
export function readTwoPhaseSet(value: unknown): TwoPhaseSet {
  if (!isPlainObject(value)) return EMPTY_SET;
  return { added: strings(value.added), removed: strings(value.removed) };
}

function strings(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return canonicalise(value.filter((item): item is string => typeof item === 'string'));
}

function canonicalise(items: readonly string[]): readonly string[] {
  return [...new Set(items)].sort();
}

/** Add an element. Adding something already removed is accepted and changes
 *  nothing about membership — the tombstone still wins — which is deliberate:
 *  a device replaying its queue must not be told its write failed. */
export function twoPhaseAdd(set: TwoPhaseSet, id: string): TwoPhaseSet {
  if (set.added.includes(id)) return set;
  return { added: canonicalise([...set.added, id]), removed: set.removed };
}

/** Remove an element, permanently. */
export function twoPhaseRemove(set: TwoPhaseSet, id: string): TwoPhaseSet {
  if (set.removed.includes(id)) return set;
  return { added: set.added, removed: canonicalise([...set.removed, id]) };
}

/** The union of both sides, on both lists. Commutative, associative and
 *  idempotent for the same reason set union is. */
export function mergeTwoPhaseSets(left: TwoPhaseSet, right: TwoPhaseSet): TwoPhaseSet {
  return {
    added: canonicalise([...left.added, ...right.added]),
    removed: canonicalise([...left.removed, ...right.removed]),
  };
}

/** Is this element in the set? Added and not removed. */
export function twoPhaseHas(set: TwoPhaseSet, id: string): boolean {
  return set.added.includes(id) && !set.removed.includes(id);
}

/** The members, sorted. What a caller iterates. */
export function twoPhaseMembers(set: TwoPhaseSet): readonly string[] {
  const removed = new Set(set.removed);
  return set.added.filter((id) => !removed.has(id));
}
