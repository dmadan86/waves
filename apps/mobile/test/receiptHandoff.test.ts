import { describe, expect, it, vi } from 'vitest';

import { dropHandedReceipt, handOffReceipt, peekHandedReceipt } from '../src/lib/receiptHandoff';

vi.mock('@/lib/image', () => ({}));

const shot = { uri: 'file:///bill.jpg', base64: 'AAAA', mimeType: 'image/jpeg' } as never;

describe('receipt hand-off', () => {
  it('parks a receipt under a key the next screen can read until it is dropped', () => {
    const key = handOffReceipt(shot);
    expect(peekHandedReceipt(key)).toBe(shot);
    expect(peekHandedReceipt(key)).toBe(shot);
    dropHandedReceipt(key);
    expect(peekHandedReceipt(key)).toBeNull();
  });

  it('answers nothing for no key or an unknown one', () => {
    expect(peekHandedReceipt(undefined)).toBeNull();
    expect(peekHandedReceipt('nope')).toBeNull();
    expect(handOffReceipt(shot)).not.toBe(handOffReceipt(shot));
  });
});
