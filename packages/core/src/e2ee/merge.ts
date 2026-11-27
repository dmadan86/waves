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
import { parseHlc } from './hlc';

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
  /** Set only for the immutable first creation, authenticated by sender identity. */
  readonly create?: true;
}
export interface DelOp {
  readonly op: 'del';
  readonly id: string;
  readonly hlc: string;
}
export type MergeOp = PutOp | DelOp;
export interface PendingOp {
  readonly op: MergeOp;
  readonly sender: string;
  readonly receivedAt: number;
}

export type Store = Readonly<Record<string, RecordState>>;

export type MergeResult = Store;
export interface DetailedMergeResult {
  readonly store: Store;
  readonly rejected: readonly { op: unknown; reason: string }[];
  readonly pending: readonly MergeOp[];
}

/** Typed diagnostics API; applyOps remains source compatible with Store callers. */
export function mergeOps(
  store: Store,
  ops: readonly unknown[],
  senderMemberId: string,
  opts: { trusted?: boolean; isSharedId?: (id: string) => boolean } = {},
): DetailedMergeResult {
  const merged = applyOps(store, ops as readonly MergeOp[], senderMemberId, opts);
  const meta = diagnostics.get(merged as object) ?? { rejected: [], pending: [] };
  return { store: merged, rejected: meta.rejected, pending: meta.pending as readonly MergeOp[] };
}

const diagnostics = new WeakMap<
  object,
  { rejected: readonly { op: unknown; reason: string }[]; pending: readonly unknown[] }
>();
export function getMergeDiagnostics(store: Store): {
  rejected: readonly { op: unknown; reason: string }[];
  pending: readonly unknown[];
} {
  return diagnostics.get(store as object) ?? { rejected: [], pending: [] };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FIELDS: Record<string, ReadonlySet<string>> = {
  txn: new Set([
    'kind',
    'category',
    'amount',
    'currency',
    'date',
    'note',
    'description',
    'paid_by',
    'paidBy',
    'split',
    'splits',
    'updated_at',
    'created_at',
    'property_id',
    'kind',
    'loanId',
    'recurringId',
    'paymentMethod',
    'place',
    'reimbursable',
    'receiptKey',
    'investmentId',
    'propertyId',
    'tenancy_id',
    'receipt',
    'title',
    'extra',
    'x',
    'y',
    'a',
    'b',
    'n',
    'amt',
    'title',
    'extra',
  ]),
  rent: new Set([
    'kind',
    'loanId',
    'recurringId',
    'paymentMethod',
    'place',
    'reimbursable',
    'receiptKey',
    'investmentId',
    'propertyId',
    'amount',
    'currency',
    'date',
    'due_date',
    'paid_date',
    'note',
    'description',
    'status',
    'property_id',
    'tenancy_id',
    'tenant',
    'title',
    'extra',
    'created_at',
    'updated_at',
    'x',
    'y',
    'a',
    'b',
    'n',
    'amt',
  ]),
  property: new Set([
    'type',
    'name',
    'address',
    'locality',
    'address',
    'rent',
    'currency',
    'status',
    'bedrooms',
    'bathrooms',
    'notes',
    'created_at',
    'updated_at',
    'note',
  ]),
  settlement: new Set([
    'amount',
    'currency',
    'date',
    'note',
    'from',
    'to',
    'from_member_id',
    'to_member_id',
    'created_at',
    'updated_at',
  ]),
  tenancy: new Set([
    'propertyId',
    'unit',
    'rentFrequency',
    'escalationPct',
    'endedOn',
    'depositReturned',
    'depositKept',
    'endDate',
    'unit',
    'depositHeld',
    'rentFrequency',
    'startDate',
    'endDate',
    'escalationPct',
    'status',
    'endedOn',
    'depositReturned',
    'depositKept',
    'name',
    'tenantName',
    'tenantPhone',
    'note',
    'start_date',
    'end_date',
    'rent',
    'currency',
    'tenant',
    'property_id',
    'notes',
    'created_at',
    'updated_at',
  ]),
  _former: new Set(['name']),
  recurring: new Set([
    'txnKind',
    'amount',
    'currency',
    'category',
    'note',
    'cadence',
    'interval',
    'secondDay',
    'anchorDate',
    'nextDate',
    'endDate',
    'autoPost',
    'active',
    'investmentId',
    'tenancyId',
  ]),
  loan: new Set([
    'direction',
    'counterpart',
    'principal',
    'currency',
    'note',
    'startDate',
    'status',
    'synced',
    'shareSeq',
  ]),
  budget: new Set(['category', 'limit', 'currency']),
  date: new Set(['label', 'name', 'day', 'month', 'year']),
  investment: new Set([
    'type',
    'name',
    'currency',
    'openingInvested',
    'openingAsOf',
    'currentValue',
    'valueAsOf',
    'taxWrapper',
    'openingAsOf',
    'currentValue',
    'valueAsOf',
    'maturityDate',
    'taxWrapper',
    'status',
    'note',
  ]),
};

export function validateOp(
  input: unknown,
): { ok: true; op: MergeOp } | { ok: false; reason: string } {
  try {
    if (!input || typeof input !== 'object') return { ok: false, reason: 'shape' };
    const op = input as Record<string, unknown>;
    if (typeof op.id !== 'string' || op.id.length < 1 || op.id.length > 128)
      return { ok: false, reason: 'id' };
    if (op.id.startsWith('__meta:')) return { ok: false, reason: 'id' };
    if (UUID.test(op.id) === false && !/^[A-Za-z0-9_:-]{1,128}$/.test(op.id))
      return { ok: false, reason: 'id' };
    if (op.op === 'del') {
      if (typeof op.hlc !== 'string') return { ok: false, reason: 'hlc' };
      validateHlc(op.hlc);
      return { ok: true, op: input as DelOp };
    }
    if (
      op.op !== 'put' ||
      typeof op.kind !== 'string' ||
      !FIELDS[op.kind] ||
      typeof op.createdBy !== 'string' ||
      !op.createdBy ||
      op.createdBy.length > 128 ||
      !op.fields ||
      typeof op.fields !== 'object' ||
      Array.isArray(op.fields)
    )
      return { ok: false, reason: 'shape' };
    const entries = Object.entries(op.fields as Record<string, unknown>);
    const allowedFields = FIELDS[op.kind]!;
    if (!entries.length || entries.length > 128) return { ok: false, reason: 'fields' };
    for (const [name, raw] of entries) {
      if (
        !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name) ||
        !Array.isArray(raw) ||
        raw.length !== 2 ||
        typeof raw[1] !== 'string'
      )
        return { ok: false, reason: 'field' };
      validateHlc(raw[1]);
      const value = raw[0];
      const isObject = value !== null && typeof value === 'object' && !Array.isArray(value);
      const isCarried = !allowedFields.has(name);
      const isEncodedObject = isObject && (isCarried || (op.kind === 'loan' && name === 'synced'));
      if (!(
        value === null ||
        (typeof value === 'string' && value.length <= 8192) ||
        typeof value === 'boolean' ||
        (typeof value === 'number' && Number.isFinite(value)) ||
        (typeof value === 'bigint' && value.toString().length <= 40) ||
        isEncodedObject
      ))
        return { ok: false, reason: 'value' };
      if (isEncodedObject) {
        const json = JSON.stringify(value);
        if (!json || json.length > 8192) return { ok: false, reason: 'value' };
      }
      if (
        (JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? String(v) : v))?.length ?? 0) >
        16384
      )
        return { ok: false, reason: 'value' };
    }
    return { ok: true, op: input as MergeOp };
  } catch {
    return { ok: false, reason: 'invalid' };
  }
}

function validateHlc(s: string): void {
  const h = parseHlc(s);
  if (
    h.wall < 0 ||
    h.wall > Date.now() + 86_400_000 ||
    h.counter < 0 ||
    h.counter > 1_000_000 ||
    !h.device ||
    h.device.length > 128
  )
    throw new Error('invalid');
}

export function validateMessage(
  msg: unknown,
):
  | { ok: true; ops: readonly MergeOp[]; rejected: readonly { op: unknown; reason: string }[] }
  | { ok: false; reason: string } {
  if (
    !msg ||
    typeof msg !== 'object' ||
    typeof (msg as { msgId?: unknown }).msgId !== 'string' ||
    (msg as { msgId: string }).msgId.length < 1 ||
    (msg as { msgId: string }).msgId.length > 128 ||
    !Array.isArray((msg as { ops?: unknown }).ops) ||
    (msg as { ops: unknown[] }).ops.length > 4096
  )
    return { ok: false, reason: 'shape' };
  const ops: MergeOp[] = [],
    rejected: { op: unknown; reason: string }[] = [];
  for (const raw of (msg as { ops: unknown[] }).ops) {
    const r = validateOp(raw);
    if (r.ok) ops.push(r.op);
    else rejected.push({ op: raw, reason: r.reason });
  }
  return { ok: true, ops, rejected };
}

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
  opts: { trusted?: boolean; isSharedId?: (id: string) => boolean } = {},
): MergeResult {
  const out: Record<string, RecordState> = { ...store };
  const rejected: { op: unknown; reason: string }[] = [];
  const pending: MergeOp[] = [];
  for (const raw of ops as readonly unknown[]) {
    const valid = validateOp(raw);
    if (!valid.ok) {
      rejected.push({ op: raw, reason: valid.reason });
      continue;
    }
    const op = valid.op;
    const cur = out[op.id];
    if (op.op === 'del') {
      if (!cur) out[op.id] = { id: op.id, kind: '', createdBy: '', fields: {}, deleted: op.hlc };
      else if (newer(op.hlc, cur.deleted)) out[op.id] = { ...cur, deleted: op.hlc };
      continue;
    }
    if (op.op !== 'put') continue;
    const known = cur && cur.createdBy !== '';
    if (known && op.kind !== cur.kind) continue;
    if (!opts.trusted && !known && op.createdBy !== senderMemberId && op.create !== true) {
      pending.push(op);
      continue;
    }
    const shared = opts.isSharedId?.(op.id) ?? false;
    if (
      !opts.trusted &&
      ((!known && op.createdBy !== senderMemberId) ||
        (known &&
          op.createdBy !== cur.createdBy &&
          !(shared && op.create === true && op.createdBy === senderMemberId) &&
          // A shared-id edit names the creator its author saw; the creator itself never moves.
          !(shared && op.create !== true)))
    )
      continue;
    const fields: Record<string, Field> = { ...cur?.fields };
    for (const [k, f] of Object.entries(op.fields))
      if (!fields[k] || newer(f[1], fields[k]![1])) fields[k] = f;
    let createdBy = op.createdBy;
    let createdHlc = minHlc(op.fields);
    if (known) {
      const was = cur.createdHlc ?? minHlc(cur.fields);
      if (op.create !== true) {
        // An edit never moves the creator; its clock only lowers the creation floor, so order can't matter.
        createdBy = cur.createdBy;
        createdHlc =
          was === undefined || (createdHlc !== undefined && compareHlc(createdHlc, was) < 0)
            ? createdHlc
            : was;
      } else {
        const c =
          createdHlc === undefined ? 1 : was === undefined ? -1 : compareHlc(createdHlc, was);
        if (c > 0 || (c === 0 && op.createdBy >= cur.createdBy)) {
          createdBy = cur.createdBy;
          createdHlc = was;
        }
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
  diagnostics.set(out, { rejected, pending });
  return out as MergeResult;
}

/** Replays locally persisted pre-creation edits after their authenticated create arrives. */
export function mergePending(store: Store, pending: readonly PendingOp[]): MergeResult {
  let result: MergeResult = store;
  const wait: PendingOp[] = [];
  for (const item of pending) {
    if (!store[item.op.id]?.createdBy) {
      wait.push(item);
      continue;
    }
    result = applyOps(result, [item.op], item.sender);
  }
  diagnostics.set(result as object, { rejected: [], pending: wait });
  return result;
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
