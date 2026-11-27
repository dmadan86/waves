/**
 * Per-field last-write-wins merge of couple records.
 *
 * State is a join-semilattice: per field the larger hlc wins, and `deleted` is
 * the larger delete hlc. So applyOps is idempotent, commutative and associative.
 *
 * Delete rule: a field is alive only if its hlc is newer than the record's
 * `deleted` hlc. A delete therefore hides every field written before it, and a
 * later put revives only the fields it writes (the record then shows just those
 * fields). A record with no alive field is tombstoned and left out of the UI.
 *
 * createdBy rule: unless the batch is `trusted` (a snapshot), a put's createdBy
 * must equal the sender's member on first sight, else it is dropped. Two partners
 * may legitimately create the same deterministic id (both tap "paid in full"):
 * a put for a known record with a different createdBy is accepted only from that
 * author, and the EARLIEST creation wins. `createdHlc` is the smallest hlc of any
 * put seen (ties by createdBy), so every phone settles on the same author and the
 * fields then merge as usual. Kind must always match. A delete that arrives first
 * leaves a stub (kind and createdBy empty) the first put fills in.
 */

import { compareHlc } from './hlc';

export type Field = readonly [value: unknown, hlc: string];

export interface RecordState {
  readonly id: string;
  readonly kind: string;
  readonly createdBy: string;
  /** Smallest put hlc seen: decides which author wins a double creation. */
  readonly createdHlc?: string;
  readonly fields: Readonly<Record<string, Field>>;
  readonly deleted?: string;
}

export interface PutOp {
  readonly op: 'put';
  readonly id: string;
  readonly kind: string;
  readonly createdBy: string;
  readonly fields: Readonly<Record<string, Field>>;
}
export interface DelOp {
  readonly op: 'del';
  readonly id: string;
  readonly hlc: string;
}
export type MergeOp = PutOp | DelOp;

export type Store = Readonly<Record<string, RecordState>>;

const minHlc = (fields: Readonly<Record<string, Field>>): string | undefined =>
  Object.values(fields).reduce<string | undefined>(
    (m, f) => (m === undefined || compareHlc(f[1], m) < 0 ? f[1] : m),
    undefined,
  );

const newer = (a: string, b: string | undefined): boolean =>
  b === undefined || compareHlc(a, b) > 0;

export function applyOps(
  store: Store,
  ops: readonly MergeOp[],
  senderMemberId: string,
  opts: { trusted?: boolean } = {},
): Store {
  const out: Record<string, RecordState> = { ...store };
  for (const op of ops) {
    const cur = out[op.id];
    if (op.op === 'del') {
      if (!cur) out[op.id] = { id: op.id, kind: '', createdBy: '', fields: {}, deleted: op.hlc };
      else if (newer(op.hlc, cur.deleted)) out[op.id] = { ...cur, deleted: op.hlc };
      continue;
    }
    if (op.op !== 'put') continue;
    const known = cur && cur.createdBy !== '';
    if (known && op.kind !== cur.kind) continue;
    if (
      !opts.trusted &&
      op.createdBy !== senderMemberId &&
      (!known || op.createdBy !== cur.createdBy)
    )
      continue;
    const fields: Record<string, Field> = { ...cur?.fields };
    for (const [k, f] of Object.entries(op.fields))
      if (!fields[k] || newer(f[1], fields[k]![1])) fields[k] = f;
    let createdBy = op.createdBy;
    let createdHlc = minHlc(op.fields);
    if (known) {
      const was = cur.createdHlc ?? minHlc(cur.fields);
      const c = createdHlc === undefined ? 1 : was === undefined ? -1 : compareHlc(createdHlc, was);
      if (c > 0 || (c === 0 && op.createdBy >= cur.createdBy)) {
        createdBy = cur.createdBy;
        createdHlc = was;
      }
    }
    out[op.id] = {
      ...cur,
      id: op.id,
      kind: op.kind,
      createdBy,
      ...(createdHlc === undefined ? {} : { createdHlc }),
      fields,
    };
  }
  return out;
}

/** Plain record for the UI, or null when tombstoned. Hlcs are stripped. */
export function materialise(rec: RecordState): Record<string, unknown> | null {
  const data: Record<string, unknown> = {};
  let alive = false;
  for (const [k, [v, h]] of Object.entries(rec.fields)) {
    if (newer(h, rec.deleted)) {
      data[k] = v;
      alive = true;
    }
  }
  if (!alive || rec.createdBy === '') return null;
  return { ...data, id: rec.id, kind: rec.kind, createdBy: rec.createdBy };
}

export function materialiseAll(store: Store): Record<string, unknown>[] {
  return Object.keys(store)
    .sort()
    .map((id) => store[id]!)
    .map(materialise)
    .filter((r): r is Record<string, unknown> => r !== null);
}
