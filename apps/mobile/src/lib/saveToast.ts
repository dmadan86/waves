/**
 * The one line said after a group or an expense is saved, before the screen
 * that saved it closes. Pure, so the wording rules are testable without a
 * screen: offline wins over everything, because the honest news is that the
 * save is queued, not done.
 */

import type { UiStrings } from '@/i18n';
import { fill } from '@/i18n';

/** A save is only queued, not sent, while the phone is offline or on a barred network. */
// Takes the SyncStatus string, not the enum: the engine drags native modules into tests.
export function isQueuedOffline(status: string): boolean {
  return status === 'offline' || status === 'metered';
}

export function saveToastText(
  t: UiStrings,
  input:
    | { kind: 'group'; name: string; offline: boolean }
    | { kind: 'expense'; editing: boolean; label: string; offline: boolean },
): string {
  if (input.offline) return t.common.savedOffline;
  if (input.kind === 'group') {
    const name = input.name.trim();
    return name ? fill(t.common.groupCreatedNamed, { name }) : t.common.groupCreated;
  }
  if (input.editing) return t.common.expenseUpdated;
  return fill(t.common.expenseAdded, { what: input.label });
}
