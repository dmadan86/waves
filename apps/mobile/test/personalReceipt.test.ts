import { beforeEach, describe, expect, it, vi } from 'vitest';

import { decodeTxn } from '@waves/core';

import {
  isOwnReceiptKey,
  personalReceiptKey,
  removePersonalReceipt,
  staleReceiptKeys,
  uploadPersonalReceipt,
  WifiOnlyError,
} from '../src/lib/personalReceipt';
import { entryRecord, type EntryDraft } from '../src/lib/personalEntry';

const removeImage = vi.fn(async () => {});
const putImage = vi.fn(async () => 'x');
vi.mock('@/lib/storage', () => ({
  removeImage: (...a: unknown[]) => removeImage(...(a as [])),
  putImage: (...a: unknown[]) => putImage(...(a as [])),
  imageUrl: vi.fn(),
  StoragePaidOnlyError: class extends Error {},
  StorageCapError: class extends Error {},
}));
const permits = vi.fn(async () => true);
vi.mock('@/lib/receiptQueue', () => ({ networkPermits: () => permits() }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));

const DRAFT: EntryDraft = {
  kind: 'expense',
  amount: 5000n,
  currency: 'INR',
  category: 'food',
  note: 'lunch',
  date: '2026-10-19',
  loanId: null,
  recurringId: null,
};

beforeEach(() => {
  permits.mockResolvedValue(true);
  removeImage.mockClear();
  putImage.mockClear();
});

describe('personal receipts', () => {
  it('keys live under the owner and only the owner may aim a delete at them', () => {
    const key = personalReceiptKey('u1', 'f1');
    expect(key).toBe('personal/u1/f1.jpg');
    expect(isOwnReceiptKey('u1', key)).toBe(true);
    expect(isOwnReceiptKey('u2', key)).toBe(false);
    expect(isOwnReceiptKey('u1', 'personal/u1/../u2/x.jpg')).toBe(false);
    expect(isOwnReceiptKey('u1', 'g1/e1.jpg')).toBe(false);
    expect(isOwnReceiptKey(null, key)).toBe(false);
  });

  it('uploads to the private receipts bucket under the owner with no group charge', async () => {
    const key = await uploadPersonalReceipt({
      ownerId: 'u1',
      base64: 'AAA',
      mimeType: 'image/png',
    });
    expect(key).toBe('personal/u1/uuid-1.jpg');
    expect(putImage).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: 'receipts',
        path: key,
        groupId: null,
        contentType: 'image/png',
      }),
    );
  });

  it("removes the stored photo, but never someone else's key and never throws", async () => {
    await removePersonalReceipt('u1', 'personal/u1/a.jpg');
    expect(removeImage).toHaveBeenCalledWith('receipts', 'personal/u1/a.jpg');
    await removePersonalReceipt('u1', 'personal/u2/a.jpg');
    await removePersonalReceipt('u1', null);
    expect(removeImage).toHaveBeenCalledTimes(1);
    removeImage.mockRejectedValueOnce(new Error('offline'));
    await expect(removePersonalReceipt('u1', 'personal/u1/b.jpg')).resolves.toBeUndefined();
  });

  it('after a save, only the replaced or removed saved photo is stale', () => {
    const a = 'personal/u1/a.jpg';
    const b = 'personal/u1/b.jpg';
    expect(staleReceiptKeys('u1', a, b)).toEqual([a]);
    expect(staleReceiptKeys('u1', a, null)).toEqual([a]);
    expect(staleReceiptKeys('u1', a, a)).toEqual([]);
    expect(staleReceiptKeys('u1', null, b)).toEqual([]);
    expect(staleReceiptKeys('u2', a, null)).toEqual([]);
  });

  it('the entry blob keeps the key through an edit and drops it when removed', () => {
    const key = 'personal/u1/a.jpg';
    const record = entryRecord({ ...DRAFT, receiptKey: key }, null);
    expect(record.data.receiptKey).toBe(key);
    const txn = decodeTxn('t1', record.data);
    const edited = entryRecord({ ...DRAFT, note: 'edited', receiptKey: txn.receiptKey }, null, {
      txn,
    });
    expect(edited.data.receiptKey).toBe(key);
    expect(entryRecord({ ...DRAFT, receiptKey: null }, null, { txn }).data.receiptKey).toBeNull();
  });
});

describe('Wi-Fi only', () => {
  it('does not upload a personal receipt off Wi-Fi', async () => {
    permits.mockResolvedValue(false);
    await expect(uploadPersonalReceipt({ ownerId: 'o', base64: 'x' })).rejects.toBeInstanceOf(
      WifiOnlyError,
    );
    expect(putImage).not.toHaveBeenCalled();
  });
});
