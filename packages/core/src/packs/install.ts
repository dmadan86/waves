/**
 * What installing a pack actually does.
 *
 * Nothing clever: it writes ordinary custom tags into the person's own catalog,
 * through the same `tag.create` mutation the tag editor uses. No new write path,
 * no server-side install, no privileged step — which is why installing works
 * offline, and why every screen that already renders a custom tag renders a
 * packed one without knowing the difference.
 *
 * Two properties are worth naming because the rest follows from them:
 *
 * **Installing twice is installing once.** Each tag's id is derived from the
 * pack and the entry (`packTagId`), so a second install upserts the same rows
 * rather than doubling somebody's picker — whether the second install is a
 * double tap, a retry after a dropped connection, or another device that was
 * offline when the first one happened.
 *
 * **An installed tag belongs to the person, not the pack.** They can rename it,
 * recolour it, hide it, delete it; expenses filed under it carry its label as a
 * snapshot (`category_meta`). That is what lets an uninstall — or a pack pulled
 * after publication — leave the categories exactly where they are. Taking them
 * back would rewrite somebody's history over a decision that was not theirs.
 */

import { nextSortOrder, type CategoryTagRow } from '../category/catalog';
import { deterministicId } from '../ids';
import type { TagUpsertPayload } from '../sync/protocol';
import type { Pack, PackEntry } from './types';

/**
 * The id the entry's tag will have, in this person's catalog.
 *
 * Derived, not random, so the write is idempotent — see the note above. Two
 * people installing the same pack get the same ids in their own catalogs, which
 * is fine: a tag id is unique per owner, never globally.
 */
export function packTagId(packId: string, entryKey: string): string {
  return deterministicId(`pack:${packId}:${entryKey}`);
}

export interface InstallPlan {
  /** The tags to write, in the pack's own order. */
  readonly create: readonly TagUpsertPayload[];
  /** Entries whose tag is already in the catalog — a re-install, or an update
   *  where only some entries are new. Reported so the UI can say "3 added"
   *  rather than claiming to have added all twelve. */
  readonly alreadyPresent: number;
}

/**
 * The rows an install should write, given what the catalog already holds.
 *
 * Existing tags are left completely alone. If somebody installed a pack, renamed
 * one of its categories to something that suits them better, and then installed
 * a newer version of the pack, their name survives: an update adds what is new
 * and does not overwrite what a person has made theirs.
 */
export function installPlan(pack: Pack, existing: readonly CategoryTagRow[]): InstallPlan {
  const known = new Set(existing.map((row) => row.id));
  const create: TagUpsertPayload[] = [];
  let alreadyPresent = 0;

  // Packed tags land after whatever the catalog already holds, in pack order, so
  // installing one never reshuffles the list somebody has arranged.
  let order = nextSortOrder(existing);

  for (const entry of pack.entries) {
    const tagId = packTagId(pack.id, entry.key);
    if (known.has(tagId)) {
      alreadyPresent += 1;
      continue;
    }
    create.push(tagPayloadFor(entry, tagId, order));
    order += 1;
  }

  return { create, alreadyPresent };
}

/** One entry as the tag it becomes. */
function tagPayloadFor(entry: PackEntry, tagId: string, sortOrder: number): TagUpsertPayload {
  return {
    tagId,
    // A custom tag, not an override: a pack adds vocabulary, it never redefines
    // a built-in category out from under somebody.
    builtinId: null,
    label: entry.label,
    icon: entry.icon,
    tint: entry.tint,
    axis: entry.axis,
    sortOrder,
    hidden: false,
  };
}
