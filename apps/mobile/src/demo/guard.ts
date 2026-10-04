/**
 * The one promise the demo makes: nothing in it ever reaches the server.
 *
 * Every write in this app funnels through `useSync().mutate` — expenses,
 * settlements, members, group edits, pins, tags, comments, everything (see
 * the big comment over `mutate` in `@/sync/provider`). A handful of admin
 * actions (`leaveGroup`, `deleteGroup`, `updateMember`, `setMemberRole`) go
 * around it and call an RPC directly. Those two choke points are where this
 * is enforced — not in every screen that opens an add-expense form or a
 * settle sheet, which is what makes it safe to forget to check: the person
 * who wires up the next write path still has to go through one of these two
 * functions, or nothing they write will ever sync anyway, queue or no queue.
 *
 * The check itself does not care *which* field carried the id — a scope id,
 * a `groupId` buried in a payload, a `memberId` two keys deep in a patch —
 * because the cost of missing one is a demo expense quietly reaching a real
 * database with a `group_id` nothing else references. `touchesDemo` walks
 * the whole payload rather than naming fields, so a new mutation kind with a
 * demo id anywhere in it is caught by construction, not by remembering to
 * update a list here when it is added.
 */

import { isDemoId } from './ids';

/** Thrown by a guarded write instead of ever reaching the queue or the
 *  network. Never shown as its raw message — the demo gate (`demo/gateStore`)
 *  is what the person actually sees; this is just what makes the mutation's
 *  own promise reject instead of silently resolving. */
export class DemoWriteBlockedError extends Error {
  constructor() {
    super('This is a demo — nothing here is saved.');
    this.name = 'DemoWriteBlockedError';
  }
}

/** True if `value` is, or contains anywhere inside it, a demo id. Walks
 *  plain objects and arrays; stops at anything else (functions, dates,
 *  bigints have no business inside a mutation payload in the first place). */
function containsDemoId(value: unknown, depth = 0): boolean {
  if (depth > 6) return false; // a payload is never this deep; a cycle would be a bug elsewhere.
  if (typeof value === 'string') return isDemoId(value);
  if (Array.isArray(value)) return value.some((item) => containsDemoId(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.values(value).some((item) => containsDemoId(item, depth + 1));
  }
  return false;
}

/**
 * Would this write touch the demo group, one of its members, one of its
 * expenses, or its settlement? `scopeId` is whatever the caller already
 * treats as "the group" (or the personal scope, for a capture/tag/pin —
 * none of which are ever a demo id, so this never false-positives there);
 * `payload` is the rest of what would be written.
 */
export function touchesDemo(scopeId: string | null | undefined, payload?: unknown): boolean {
  if (isDemoId(scopeId)) return true;
  return payload !== undefined && containsDemoId(payload);
}
