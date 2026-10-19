/**
 * A receipt photo for the expense just saved, attached without leaving the voice
 * screen: pick (library) or scan (camera), then upload to the expense's bill slot
 * with the same helper the expense form uses (`uploadExpenseReceipt`).
 *
 * The upload starts as soon as a photo is held, runs at most once at a time, and
 * keeps the photo on failure so "Try again" re-sends the very same image.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { removeExpenseReceipt, uploadExpenseReceipt } from '@/data/api';
import type { PickedImage } from '@/lib/image';
import { attachReceipt, runOnce } from '@/lib/assistantInline';
import { useQuickReceipt, type QuickReceipt } from '@/lib/quickReceipt';

export type InlineReceiptStatus = 'idle' | 'uploading' | 'attached' | 'failed';

export interface InlineReceipt {
  readonly picker: QuickReceipt;
  readonly status: InlineReceiptStatus;
  /** The held photo, for its thumbnail. */
  readonly image: PickedImage | null;
  /** Scan with the camera. */
  scan(): void;
  /** Pick from the library. */
  pick(): void;
  /** Send the held photo again after a failure. */
  retry(): void;
  /** Take the attached bill back off the expense. */
  remove(): void;
}

export function useInlineReceipt(input: {
  groupId: string | null;
  expenseId: string;
  onAttached: () => void;
  onRemoved: () => void;
}): InlineReceipt {
  const picker = useQuickReceipt();
  const [status, setStatus] = useState<InlineReceiptStatus>('idle');
  const lock = useRef(false);
  const removing = useRef(false);
  const sentFor = useRef<PickedImage | null>(null);
  const { groupId, expenseId, onAttached, onRemoved } = input;
  const image = picker.receipt;

  const send = useCallback(
    async (held: PickedImage): Promise<void> => {
      if (!groupId) return;
      setStatus('uploading');
      const out = await attachReceipt(lock, () =>
        uploadExpenseReceipt({
          groupId,
          expenseId,
          base64: held.base64,
          mimeType: held.mimeType,
        }),
      );
      if (out === 'busy') return;
      setStatus(out === 'attached' ? 'attached' : 'failed');
      if (out === 'attached') onAttached();
    },
    [groupId, expenseId, onAttached],
  );

  // A photo was just picked or shot: send it once.
  useEffect(() => {
    if (!image || sentFor.current === image) return;
    sentFor.current = image;
    void send(image);
  }, [image, send]);

  const retry = useCallback((): void => {
    if (image) void send(image);
  }, [image, send]);

  const remove = useCallback((): void => {
    if (!groupId) return;
    void runOnce(removing, async () => {
      try {
        await removeExpenseReceipt(groupId, expenseId);
        sentFor.current = null;
        picker.clear();
        setStatus('idle');
        onRemoved();
      } catch {
        setStatus('failed');
      }
    });
  }, [groupId, expenseId, picker, onRemoved]);

  return {
    picker,
    status,
    image,
    scan: picker.attach,
    pick: picker.onLibrary,
    retry,
    remove,
  };
}
