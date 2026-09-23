/**
 * On web there is no inbox to read, so the store answers as an empty one — and
 * the sign-out wipe can call every function unconditionally.
 */

import { describe, expect, it } from 'vitest';

import {
  forgetEverything,
  forgetMessage,
  forgetMessagesForOwner,
  knownKeys,
  loadMessages,
  saveMessages,
  settleMessages,
  SmsSettlement,
  unsettleMessage,
} from '@/lib/smsMessageStore.web';

describe('the web message store', () => {
  it('stores nothing and knows nothing', async () => {
    expect(await saveMessages('alice', [])).toBe(0);
    expect(await loadMessages('alice')).toEqual([]);
    expect(await knownKeys('alice')).toEqual(new Set());
  });

  it('accepts every write and wipe as a no-op rather than throwing', async () => {
    await expect(settleMessages()).resolves.toBeUndefined();
    await expect(unsettleMessage()).resolves.toBeUndefined();
    await expect(forgetMessage()).resolves.toBeUndefined();
    await expect(forgetMessagesForOwner()).resolves.toBeUndefined();
    await expect(forgetEverything()).resolves.toBeUndefined();
  });

  it('shares the settlement values with the native store', () => {
    expect(SmsSettlement.Placed).toBe('placed');
    expect(SmsSettlement.Dismissed).toBe('dismissed');
  });
});
