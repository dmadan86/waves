/**
 * The decisions behind keeping a small copy of every group image on the phone:
 * which images there are, which to fetch next, and which to throw away. All
 * pure, so the rules are tested without a file system or a network; the disk
 * and the downloads live in `thumbStore.ts` and `thumbPrefetch.ts`.
 */

import { SyncTable } from '@waves/core';

import type { LogicalBucket } from './index';

/** One image some group on this device refers to. */
export interface ThumbRef {
  readonly bucket: LogicalBucket;
  /** The ORIGINAL's object path; the thumbnail key is derived from it. */
  readonly path: string;
  readonly groupId: string;
  /** Restricted buckets are signed by subject (expense / settlement id). */
  readonly subjectId: string | null;
  /**
   * Changes when the bytes behind an unchanged path change. Only a group cover
   * needs it — it is overwritten in place at `<groupId>/cover.<ext>` — so it is
   * the group row's update stamp there and null everywhere else.
   */
  readonly version: string | null;
  readonly createdAt: string | null;
  /** Lower goes first. A cover (seen on the dashboard) outranks a receipt. */
  readonly priority: number;
}

/** What the planner needs to know about a thumbnail already on disk. */
export interface CachedThumb {
  readonly id: string;
  readonly groupId: string;
  readonly bytes: number;
  readonly version: string | null;
  /** Epoch ms of the last time something drew it. */
  readonly lastUsed: number;
  /** Epoch ms of when it was written. */
  readonly savedAt: number;
}

/** The stable identity of an image across bucket and path. */
export function thumbId(bucket: LogicalBucket, path: string): string {
  return `${bucket}\u0000${path}`;
}

/** A thumbnail budget, and the size a not-yet-fetched one is assumed to be. */
export const THUMB_CAP_BYTES = 100 * 1024 * 1024;
export const THUMB_ESTIMATE_BYTES = 40 * 1024;

type Row = Readonly<Record<string, unknown>>;
type Tables = Readonly<Partial<Record<SyncTable, Readonly<Record<string, Row>>>>>;

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function rows(tables: Tables, table: SyncTable): Row[] {
  return Object.values(tables[table] ?? {});
}

function isGone(tables: Tables, table: SyncTable, id: string | null): boolean {
  if (!id) return false;
  const row = tables[table]?.[id];
  return row !== undefined && row.deleted_at != null;
}

/**
 * Every image in the viewer's active groups, read straight off the sync mirror:
 * group covers, expense receipts/attachments and payment proofs. A group that is
 * archived or deleted is not active; a tombstoned row, or one whose expense or
 * settlement is deleted, is not an image anybody will open.
 *
 * The rows reached this device already filtered by RLS — a private attachment
 * this person is not a party to was never pulled — so this cannot widen what
 * they can see; it only decides what to keep a copy of.
 */
export function collectThumbRefs(mirror: { readonly tables: Tables }): ThumbRef[] {
  const { tables } = mirror;
  const active = new Set<string>();
  const refs: ThumbRef[] = [];

  for (const group of rows(tables, SyncTable.Groups)) {
    const id = str(group.id);
    if (!id || group.deleted_at != null || group.archived_at != null) continue;
    active.add(id);
    const photo = str(group.photo_path);
    if (photo) {
      const stamp = group.updated_at ?? group.updated_seq ?? null;
      refs.push({
        bucket: 'group-photos',
        path: photo,
        groupId: id,
        subjectId: null,
        version: stamp == null ? null : String(stamp),
        createdAt: null,
        priority: 0,
      });
    }
  }

  for (const row of rows(tables, SyncTable.ExpenseAttachments)) {
    const path = str(row.storage_path);
    const groupId = str(row.group_id);
    const expenseId = str(row.expense_id);
    if (!path || !groupId || !expenseId || row.deleted_at != null) continue;
    if (!active.has(groupId) || isGone(tables, SyncTable.Expenses, expenseId)) continue;
    refs.push({
      bucket: 'expense-attachments',
      path,
      groupId,
      subjectId: expenseId,
      version: null,
      createdAt: str(row.created_at),
      priority: 1,
    });
  }

  for (const row of rows(tables, SyncTable.SettlementProofs)) {
    const path = str(row.storage_path);
    const groupId = str(row.group_id);
    const settlementId = str(row.settlement_id);
    if (!path || !groupId || !settlementId || row.deleted_at != null) continue;
    if (!active.has(groupId) || isGone(tables, SyncTable.Settlements, settlementId)) continue;
    refs.push({
      bucket: 'settlement-proofs',
      path,
      groupId,
      subjectId: settlementId,
      version: null,
      createdAt: str(row.created_at),
      priority: 1,
    });
  }

  return refs;
}

/** Priority first, then newest first; an undated row sorts last. */
function compareRefs(a: ThumbRef, b: ThumbRef): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  if (a.createdAt === b.createdAt) return 0;
  if (a.createdAt === null) return 1;
  if (b.createdAt === null) return -1;
  return a.createdAt < b.createdAt ? 1 : -1;
}

/**
 * Which thumbnails to fetch, in order.
 *
 * Deduplicated by image, ordered covers-then-newest, and bounded by the cap:
 * walking that order, every image counts against the budget — at its real size
 * if it is on disk, at an estimate if not — and the plan stops where the budget
 * runs out. So a phone in a group with more images than the cap holds keeps the
 * newest ones rather than churning through the whole history. An image already
 * cached at the right version is skipped; one that failed recently is skipped
 * until it is retried.
 */
export function planPrefetch(
  refs: readonly ThumbRef[],
  cached: ReadonlyMap<string, Pick<CachedThumb, 'bytes' | 'version'>>,
  options: {
    readonly capBytes?: number;
    readonly estimateBytes?: number;
    readonly skip?: ReadonlySet<string>;
  } = {},
): ThumbRef[] {
  const cap = options.capBytes ?? THUMB_CAP_BYTES;
  const estimate = options.estimateBytes ?? THUMB_ESTIMATE_BYTES;
  const seen = new Set<string>();
  const plan: ThumbRef[] = [];
  let budget = 0;

  for (const ref of [...refs].sort(compareRefs)) {
    const id = thumbId(ref.bucket, ref.path);
    if (seen.has(id)) continue;
    seen.add(id);

    const have = cached.get(id);
    budget += have ? have.bytes : estimate;
    if (budget > cap) break;

    const current = have !== undefined && (ref.version === null || have.version === ref.version);
    if (current || options.skip?.has(id)) continue;
    plan.push(ref);
  }
  return plan;
}

/**
 * Least-recently-used eviction: the ids to delete, oldest use first, until what
 * is left fits the cap. `keep` (the thumbnail just written) is never chosen.
 */
export function planEviction(
  entries: readonly Pick<CachedThumb, 'id' | 'bytes' | 'lastUsed'>[],
  capBytes: number = THUMB_CAP_BYTES,
  keep?: string,
): string[] {
  let total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  if (total <= capBytes) return [];
  const evict: string[] = [];
  const oldestFirst = [...entries].sort((a, b) => a.lastUsed - b.lastUsed);
  for (const entry of oldestFirst) {
    if (total <= capBytes) break;
    if (entry.id === keep) continue;
    evict.push(entry.id);
    total -= entry.bytes;
  }
  return evict;
}

/** Every cached thumbnail of one group — what leaving or forgetting it drops. */
export function entriesOfGroup(
  entries: readonly Pick<CachedThumb, 'id' | 'groupId'>[],
  groupId: string,
): string[] {
  return entries.filter((entry) => entry.groupId === groupId).map((entry) => entry.id);
}

/**
 * Cached thumbnails no live image refers to any more: removed receipts, a
 * replaced proof, a group that went away while the app was closed. A thumbnail
 * written in the last `graceMs` is kept even so — the uploader seeds its own
 * copy before the row describing it has come back down the sync.
 */
export function planPrune(
  entries: readonly Pick<CachedThumb, 'id' | 'savedAt'>[],
  liveIds: ReadonlySet<string>,
  now: number,
  graceMs: number = 10 * 60 * 1000,
): string[] {
  return entries
    .filter((entry) => !liveIds.has(entry.id) && now - entry.savedAt > graceMs)
    .map((entry) => entry.id);
}

/**
 * Run `worker` over `items` with at most `limit` in flight, in order. A worker
 * that throws does not stop the rest — one bad image is not a reason to give up
 * on the others.
 */
export async function runBounded<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const lane = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next] as T;
      next += 1;
      try {
        await worker(item);
      } catch {
        // Best-effort; the next run retries what did not land.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane));
}
