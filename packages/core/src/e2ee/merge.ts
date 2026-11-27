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
 * createdBy rule: fixed the first time a put is seen. Unless the batch is
 * `trusted` (a snapshot), a put's createdBy must equal the sender's member on
 * first sight, else it is rejected; later puts must repeat the same createdBy
 * and kind. A rejected op is dropped, so an edit that overtakes its creating put
 * is dropped too and must be re-sent (snapshots cover that). A delete that
 * arrives first leaves a stub (kind and createdBy empty) the first put fills in.
 */

import { compareHlc } from './hlc';

export type Field = readonly [value: unknown, hlc: string];

export interface RecordState {
  readonly id: string;
  readonly kind: string;
  readonly createdBy: string;
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
    if (known) {
      if (op.createdBy !== cur.createdBy || op.kind !== cur.kind) continue;
    } else if (!opts.trusted && op.createdBy !== senderMemberId) continue;
    const fields: Record<string, Field> = { ...cur?.fields };
    for (const [k, f] of Object.entries(op.fields))
      if (!fields[k] || newer(f[1], fields[k]![1])) fields[k] = f;
    out[op.id] = { ...cur, id: op.id, kind: op.kind, createdBy: op.createdBy, fields };
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
