/**
 * The sign-out wipe, on its own so it can be tested without React.
 *
 * Moved out of `provider.tsx` unchanged: the provider is the only caller, and
 * the rule it keeps (every step attempted, first failure rethrown) is the kind
 * that breaks silently, so it earns a test of its own.
 */

import { clearBackupState } from '@/lib/backup/engine';
import { clearReceiptQueue } from '@/lib/receiptQueue';
import { forgetMessagesForOwner as forgetBankMessages } from '@/lib/smsMessageStore';
import { clearImageCache } from '@/lib/storage/imageCache';

import { syncEngine } from './engine';

/**
 * Everything of the departing account's that lives on this device.
 *
 * `ownerId` is who is leaving, captured before the session went null — the
 * backup state is keyed by account (its tokens are a live, write-capable grant
 * into that person's Google Drive, and its recovery key opens their backup), so
 * the wipe has to be told whose. The keystore cannot be enumerated, which is
 * why this is targeted rather than a prefix sweep, and a prefix sweep would be
 * wrong anyway: a third account's settings on a shared phone are not this
 * sign-out's to delete.
 *
 * Every step is attempted even after one fails, and the first failure is
 * rethrown. A wipe that stopped halfway is a privacy problem, not a cosmetic
 * one.
 */
export async function clearLocalPrivateData(ownerId: string): Promise<void> {
  const failures: unknown[] = [];
  await syncEngine.clear().catch((error: unknown) => failures.push(error));
  await clearReceiptQueue().catch((error: unknown) => failures.push(error));
  // The bank messages this phone read, bodies and all (`lib/smsMessageStore`).
  // The mirror's crypto-erase above already makes them unopenable — but
  // ciphertext nobody can read is still this person's inbox sitting on a device
  // somebody else is about to use, and the promise the Bank messages screen
  // makes is that it is not there any more.
  await forgetBankMessages(ownerId).catch((error: unknown) => failures.push(error));
  await clearBackupState(ownerId).catch((error: unknown) => failures.push(error));
  try {
    clearImageCache();
  } catch (error) {
    failures.push(error);
  }
  if (failures.length > 0) throw failures[0];
}
