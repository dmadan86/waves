/**
 * The sign-out wipe does every step, even after one of them fails.
 *
 * `clearLocalPrivateData` runs six independent erasures: the sync mirror and
 * queue, the receipt queue, the bank messages, the SMS drafts made from them
 * (which never synced, so the phone holds the only copy), the cloud-backup
 * credentials and the image cache. A wipe that stops at the first error leaves the rest of the
 * departing person's data on a phone somebody else is about to use — so each
 * step is attempted regardless, and only then is the first failure rethrown.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  calls: [] as string[],
  engineClear: vi.fn(),
  clearReceiptQueue: vi.fn(),
  forgetBankMessages: vi.fn(),
  forgetSmsDrafts: vi.fn(),
  clearBackupState: vi.fn(),
  clearImageCache: vi.fn(),
}));

vi.mock('../src/sync/engine', () => ({ syncEngine: { clear: h.engineClear } }));
vi.mock('@/lib/receiptQueue', () => ({ clearReceiptQueue: h.clearReceiptQueue }));
vi.mock('@/lib/smsMessageStore', () => ({ forgetMessagesForOwner: h.forgetBankMessages }));
vi.mock('@/lib/smsDraftStore', () => ({ forgetSmsDraftsForOwner: h.forgetSmsDrafts }));
vi.mock('@/lib/backup/engine', () => ({ clearBackupState: h.clearBackupState }));
vi.mock('@/lib/storage/imageCache', () => ({ clearImageCache: h.clearImageCache }));

const { clearLocalPrivateData } = await import('../src/sync/localWipe');

beforeEach(() => {
  h.calls.length = 0;
  h.engineClear.mockReset().mockImplementation(async () => void h.calls.push('engine.clear'));
  h.clearReceiptQueue
    .mockReset()
    .mockImplementation(async () => void h.calls.push('clearReceiptQueue'));
  h.forgetBankMessages
    .mockReset()
    .mockImplementation(async (owner: string) => void h.calls.push(`forgetBankMessages:${owner}`));
  h.forgetSmsDrafts
    .mockReset()
    .mockImplementation(async (owner: string) => void h.calls.push(`forgetSmsDrafts:${owner}`));
  h.clearBackupState
    .mockReset()
    .mockImplementation(async (owner: string) => void h.calls.push(`clearBackupState:${owner}`));
  h.clearImageCache.mockReset().mockImplementation(() => void h.calls.push('clearImageCache'));
});

describe('clearLocalPrivateData', () => {
  it('runs every step for the departing owner', async () => {
    await clearLocalPrivateData('owner-1');

    expect(h.calls).toEqual([
      'engine.clear',
      'clearReceiptQueue',
      'forgetBankMessages:owner-1',
      'forgetSmsDrafts:owner-1',
      'clearBackupState:owner-1',
      'clearImageCache',
    ]);
  });

  it('still runs every later step when the receipt queue fails, then rethrows that failure', async () => {
    // Given clearing the receipt queue throws.
    const boom = new Error('receipt queue locked');
    h.clearReceiptQueue.mockRejectedValue(boom);

    // When the wipe runs for an owner, then the receipt error comes back out…
    await expect(clearLocalPrivateData('owner-1')).rejects.toBe(boom);

    // …and nothing after it was skipped.
    expect(h.engineClear).toHaveBeenCalledTimes(1);
    expect(h.forgetBankMessages).toHaveBeenCalledWith('owner-1');
    expect(h.forgetSmsDrafts).toHaveBeenCalledWith('owner-1');
    expect(h.clearBackupState).toHaveBeenCalledWith('owner-1');
    expect(h.clearImageCache).toHaveBeenCalledTimes(1);
  });

  it('rethrows the first failure when several steps fail', async () => {
    const first = new Error('first');
    h.clearReceiptQueue.mockRejectedValue(first);
    h.clearBackupState.mockRejectedValue(new Error('second'));
    h.clearImageCache.mockImplementation(() => {
      throw new Error('third');
    });

    await expect(clearLocalPrivateData('owner-2')).rejects.toBe(first);
    expect(h.forgetBankMessages).toHaveBeenCalledWith('owner-2');
    expect(h.clearImageCache).toHaveBeenCalledTimes(1);
  });

  it('catches a synchronous throw from the image cache and still reports it', async () => {
    const cacheError = new Error('cache dir busy');
    h.clearImageCache.mockImplementation(() => {
      throw cacheError;
    });

    await expect(clearLocalPrivateData('owner-3')).rejects.toBe(cacheError);
    expect(h.engineClear).toHaveBeenCalledTimes(1);
    expect(h.clearBackupState).toHaveBeenCalledWith('owner-3');
  });

  it('clears the SMS drafts even when the bank-message store fails, then rethrows that', async () => {
    // Given the bank-message store will not open.
    const locked = new Error('messages db locked');
    h.forgetBankMessages.mockRejectedValue(locked);

    await expect(clearLocalPrivateData('owner-4')).rejects.toBe(locked);

    // The drafts made from those messages are still wiped for that account.
    expect(h.forgetSmsDrafts).toHaveBeenCalledWith('owner-4');
    expect(h.clearBackupState).toHaveBeenCalledWith('owner-4');
  });
});
