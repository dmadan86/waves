/** How backup reaches the couple space without importing it (and its React Native chain): `e2ee/runtime` fills this in at app start. */

import type { BackupCouple } from './payload';

export const coupleBridge = {
  backup: (): BackupCouple[] => [],
  restore: (_entries: readonly BackupCouple[]): Promise<void> => Promise.resolve(),
  count: (): number => 0,
  formerCount: (): number => 0,
};
