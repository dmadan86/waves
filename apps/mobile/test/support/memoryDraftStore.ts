/**
 * `@/lib/smsDraftStore` without expo-sqlite or the keystore: the real draft
 * cache over a memory backend. For tests whose subject imports the data hooks
 * (which read local SMS drafts) but is not about the store itself.
 *
 *   vi.mock('@/lib/smsDraftStore', async () =>
 *     (await import('./support/memoryDraftStore')).memoryDraftStoreModule());
 */

import { createDraftCache, type DraftEntry } from '@/lib/smsDraftCache';

export function memoryDraftStoreModule() {
  const disk = new Map<string, Map<string, DraftEntry | null>>();
  const smsDrafts = createDraftCache({
    async load(ownerId) {
      return new Map(disk.get(ownerId) ?? []);
    },
    async write(ownerId, captureId, entry) {
      let map = disk.get(ownerId);
      if (!map) disk.set(ownerId, (map = new Map()));
      map.set(captureId, entry);
    },
    async forgetOwner(ownerId) {
      disk.delete(ownerId);
    },
    async forgetEverything() {
      disk.clear();
    },
  });
  return {
    smsDrafts,
    forgetSmsDraftsForOwner: (ownerId: string) => smsDrafts.forgetOwner(ownerId),
  };
}
