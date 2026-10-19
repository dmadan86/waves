/**
 * Stand-ins for the inline (same-screen) pieces of the follow-up card, for the
 * shallow fakeReact tests: the receipt hook, the sheets and the in-card views are
 * plain tags, so a test can read their props and drive their callbacks, and the
 * sync `mutate` and ids are controllable.
 */

import { vi } from 'vitest';

export const inlineWorld = {
  scan: vi.fn(),
  pick: vi.fn(),
  retry: vi.fn(),
  remove: vi.fn(),
  mutate: vi.fn(async (..._args: unknown[]): Promise<unknown> => undefined),
  uuid: 0,
  receiptStatus: 'idle' as 'idle' | 'uploading' | 'attached' | 'failed',
  /** The callbacks the card handed to the receipt hook, so a test can finish an upload. */
  receiptCallbacks: null as null | { onAttached: () => void; onRemoved: () => void },
};

export function resetInlineWorld(): void {
  inlineWorld.scan.mockReset();
  inlineWorld.pick.mockReset();
  inlineWorld.retry.mockReset();
  inlineWorld.remove.mockReset();
  inlineWorld.mutate.mockReset();
  inlineWorld.mutate.mockResolvedValue(undefined);
  inlineWorld.uuid = 0;
  inlineWorld.receiptStatus = 'idle';
  inlineWorld.receiptCallbacks = null;
}

export function cryptoModule() {
  return { randomUUID: () => `uuid-${++inlineWorld.uuid}` };
}

export function useInlineReceiptStub(input: { onAttached: () => void; onRemoved: () => void }) {
  inlineWorld.receiptCallbacks = input;
  return {
    picker: { receipt: null, busy: false, cameraOpen: false },
    status: inlineWorld.receiptStatus,
    image: null,
    scan: inlineWorld.scan,
    pick: inlineWorld.pick,
    retry: inlineWorld.retry,
    remove: inlineWorld.remove,
  };
}
