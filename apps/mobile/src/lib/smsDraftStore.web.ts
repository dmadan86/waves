/**
 * The web half of the SMS draft store: memory, and nothing else.
 *
 * A browser cannot read a phone's messages, so the only SMS drafts web ever
 * holds are ones pasted into it. They follow the same rule as a phone's —
 * nothing derived from an SMS reaches the server as a capture — and a browser
 * has no keystore to seal them with at rest (`sync/driver.web.ts` explains why
 * a key beside the data protects nothing). So they are kept in memory for the
 * life of the tab: a reload forgets them, which is the honest outcome for a
 * draft that was never meant to leave the place it was made.
 */

import { createDraftCache, type DraftBackend, type DraftEntry } from './smsDraftCache';

export type { DraftEntry } from './smsDraftCache';

const memory = new Map<string, Map<string, DraftEntry | null>>();

const memoryBackend: DraftBackend = {
  async load(ownerId) {
    return new Map(memory.get(ownerId) ?? []);
  },
  async write(ownerId, captureId, entry) {
    let map = memory.get(ownerId);
    if (!map) {
      map = new Map();
      memory.set(ownerId, map);
    }
    map.set(captureId, entry);
  },
  async forgetOwner(ownerId) {
    memory.delete(ownerId);
  },
  async forgetEverything() {
    memory.clear();
  },
};

export const smsDrafts = createDraftCache(memoryBackend);

export function forgetSmsDraftsForOwner(ownerId: string): Promise<void> {
  return smsDrafts.forgetOwner(ownerId);
}
