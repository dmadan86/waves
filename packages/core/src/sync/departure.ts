/**
 * What leaving takes with it, and how to keep a copy of it first.
 *
 * Signing out wipes this device's mirror (see the mobile `SyncProvider`): the
 * rows, the queue, the drafts and the receipt bytes all go, because the next
 * person to hold the phone must not find the last account's ledger in it.
 * Everything the server already has comes back on the next sign-in — but a
 * mutation still sitting in the queue has reached nobody, a refusal has been
 * told "no" and is being kept only here, and a draft was never submitted at all.
 * Those are the whole risk, and they are what this file counts and what a
 * snapshot preserves.
 *
 * Drafts are not part of {@link unsentWork} because they are not queue work —
 * they live in their own table behind an async read, so the screen counts them
 * and hands them to {@link deviceSnapshot} rather than this file going after
 * them.
 *
 * Pure on purpose: the counting is arithmetic over the queue and the snapshot is
 * a plain object, so both are unit-testable without a device, a network or a
 * filesystem. The screen that writes the file and the sheet that shows the
 * numbers stay thin shells around this.
 */

import type { MirrorRow, MirrorState } from './mirror';
import { personalScope } from './protocol';
import { pendingMutations, rejectedMutations, type QueuedMutation } from './queue';

/**
 * Unsent work, split the way a person thinks about it: the private ledger on
 * the Me tab, and everything else (groups, expenses, captures, tags).
 *
 * `refused` is counted apart from the two because it is not waiting for a
 * network — the server has already said no, and another minute of signal will
 * not clear it. Telling someone "3 changes are still sending" when one of them
 * will never send is the kind of reassurance that loses data.
 */
export interface UnsentWork {
  /** Pending mutations on the personal-finance scope (A48). */
  readonly personal: number;
  /** Pending mutations on every other scope — groups, captures, tags, packs. */
  readonly other: number;
  /** Mutations the server refused. They need a person, not a retry. */
  readonly refused: number;
  /** Everything above, which is also "how much would be lost". */
  readonly total: number;
}

/** Nothing queued, nothing refused — the answer for a device that is up to date. */
export const NO_UNSENT_WORK: UnsentWork = { personal: 0, other: 0, refused: 0, total: 0 };

/**
 * Count what has not reached the account yet.
 *
 * `ownerId` decides which scope key counts as the personal ledger; an empty one
 * (signed out already, which should not happen here) simply puts everything in
 * `other` rather than guessing.
 */
export function unsentWork(queue: readonly QueuedMutation[], ownerId: string): UnsentWork {
  const scope = ownerId ? personalScope(ownerId) : null;
  let personal = 0;
  let other = 0;
  for (const item of pendingMutations(queue)) {
    if (scope !== null && item.groupId === scope) personal += 1;
    else other += 1;
  }
  const refused = rejectedMutations(queue).length;
  return { personal, other, refused, total: personal + other + refused };
}

/**
 * One autosaved form, exactly as the device store holds it.
 *
 * `value` is deliberately `unknown` and is never looked inside: a draft is
 * whatever screen wrote it, it is free-typed text, and a snapshot that reshaped
 * it would be a snapshot that could lose a field the day a form gains one.
 * It goes into the file the way it came out of the store.
 */
export interface DeviceDraft {
  readonly key: string;
  readonly value: unknown;
  /** ISO timestamp of the last autosave. */
  readonly savedAt: string;
}

/** Marks a file as ours before anything tries to read it. */
export const SNAPSHOT_FORMAT = 'waves.device.snapshot';
/** The envelope version. Bumped only when the shape below changes. */
export const SNAPSHOT_VERSION = 1;

/**
 * Everything this device holds for one account, in one plain JSON object.
 *
 * Deliberately the *raw* mirror rows rather than a prettied-up ledger: a
 * readable per-group PDF already exists (`groupExport`), and the job here is
 * different — this is the copy somebody takes because they are about to erase
 * the original, so losing a field nobody thought to render would be the one
 * unforgivable outcome. The queue rides along in `unsent`, and the autosaved
 * forms in `drafts`, for the same reason: neither exists anywhere else in the
 * world.
 */
export interface DeviceSnapshot {
  readonly format: typeof SNAPSHOT_FORMAT;
  readonly version: number;
  /** ISO timestamp the copy was taken. */
  readonly exportedAt: string;
  readonly ownerId: string;
  /** Per-scope sync cursors, so a reader can tell how current the copy is. */
  readonly cursors: Readonly<Record<string, number>>;
  /** Mirror rows by table, each table's rows ordered by their id. */
  readonly tables: Readonly<Record<string, readonly MirrorRow[]>>;
  /** Mutations that never reached the server, refusals included, in queue order. */
  readonly unsent: readonly QueuedMutation[];
  /**
   * Autosaved forms, ordered by key. These have never been submitted, so unlike
   * the mirror there is no server copy to come back — the sign-out wipe deletes
   * the drafts table outright, and this file is the only place they survive.
   */
  readonly drafts: readonly DeviceDraft[];
  readonly counts: {
    readonly rows: number;
    readonly unsent: number;
    readonly drafts: number;
  };
}

/**
 * Build the snapshot. Ordering is fixed (tables by name, rows by key, queue by
 * `seq`, drafts by key) so the same device state produces the same bytes twice —
 * a diffable file, and a test that can assert on it without sorting first.
 *
 * The drafts are handed in rather than fetched: they live in the device store
 * behind an async read, and this function stays pure so the whole snapshot is
 * testable without a filesystem.
 */
export function deviceSnapshot(input: {
  readonly mirror: MirrorState;
  readonly queue: readonly QueuedMutation[];
  readonly drafts: readonly DeviceDraft[];
  readonly ownerId: string;
  readonly exportedAt: string;
}): DeviceSnapshot {
  const source = input.mirror;
  const tables: Record<string, readonly MirrorRow[]> = {};
  let rows = 0;
  for (const table of Object.keys(source.tables).sort()) {
    const byId = source.tables[table as keyof typeof source.tables] ?? {};
    const ordered = Object.keys(byId)
      .sort()
      .map((id) => byId[id])
      .filter((row): row is MirrorRow => row !== undefined);
    rows += ordered.length;
    tables[table] = ordered;
  }
  const unsent = [...input.queue].sort((a, b) => a.seq - b.seq);
  const drafts = [...input.drafts].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return {
    format: SNAPSHOT_FORMAT,
    version: SNAPSHOT_VERSION,
    exportedAt: input.exportedAt,
    ownerId: input.ownerId,
    cursors: { ...source.cursors },
    tables,
    unsent,
    drafts,
    counts: { rows, unsent: unsent.length, drafts: drafts.length },
  };
}

/**
 * The filename a snapshot is saved under — dated, so two copies taken on
 * different days sit beside each other in a downloads folder instead of one
 * quietly replacing the other. Colons are stripped: they are legal in an ISO
 * timestamp and illegal in a filename on Android and Windows alike.
 */
export function snapshotFilename(exportedAt: string): string {
  const stamp = exportedAt.replace(/[:.]/g, '-').replace(/Z$/, '');
  return `waves-device-copy-${stamp}.json`;
}
