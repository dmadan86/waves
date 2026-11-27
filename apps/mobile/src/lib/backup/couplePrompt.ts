/** Sign-out guard for shared rentals: they live only on the partners' phones, so a backup is the one copy that outlasts this one. */

const RECENT_MS = 7 * 24 * 3_600_000;

export function shouldPromptCoupleBackup(input: {
  coupleRecords: number;
  /** Epoch ms of the last successful backup, or null for never. */
  lastBackupAt: number | null;
  now: number;
}): boolean {
  if (input.coupleRecords === 0) return false;
  return input.lastBackupAt === null || input.now - input.lastBackupAt > RECENT_MS;
}
