/**
 * The quick-expense sheet's one receipt: picked, held in memory, and shown as
 * a thumbnail — nothing is uploaded until the sheet actually saves.
 *
 * This deliberately does not go through `lib/receiptQueue`, the durable queue
 * the full expense form's gallery uses for an expense that may gain several
 * attachments over a longer edit. The quick sheet holds exactly one candidate
 * receipt for the length of one sheet visit — seconds, not a screen somebody
 * can walk away from mid-edit — so there is nothing here that needs to survive
 * an app kill. The caller (`QuickExpenseSheet`) uploads the held `PickedImage`
 * itself once it knows which expense it belongs to, the same way the full
 * form's own "kept bill" (`uploadExpenseReceipt`) does.
 */

import { useCallback, useState } from 'react';

import { useStrings } from '@/i18n';
import { useDialog } from '@/lib/dialog';
import { captureReceipt, pickReceiptImage, type PickedImage } from '@/lib/image';
import { receiptPhotoActions } from '@/lib/receiptPhotoActions';

export interface QuickReceipt {
  /** The held photo, or null before one is picked (or after it is removed). */
  readonly receipt: PickedImage | null;
  /** Between the chooser's answer and the picker returning. */
  readonly busy: boolean;
  /** Opens the camera/library chooser. */
  readonly attach: () => void;
  /** Drops the held photo — the chip's "x", and the sheet's own reset. */
  readonly clear: () => void;
}

export function useQuickReceipt(): QuickReceipt {
  const { t } = useStrings();
  const { choose } = useDialog();
  const [receipt, setReceipt] = useState<PickedImage | null>(null);
  const [busy, setBusy] = useState(false);

  const attach = useCallback((): void => {
    void (async () => {
      const picked = await choose({
        title: t.quickExpense.addReceipt,
        options: receiptPhotoActions(t.quickExpense),
      });
      if (picked !== 'camera' && picked !== 'library') return;
      setBusy(true);
      try {
        // Camera first tries the document scanner (a flatter, easier-to-read
        // crop than a photo of a table); library goes straight to the photo
        // roll for a bill already on the phone. Both are the same helpers the
        // full expense form attaches with.
        const image = picked === 'camera' ? await captureReceipt() : await pickReceiptImage();
        if (image) setReceipt(image);
      } finally {
        setBusy(false);
      }
    })();
  }, [choose, t.quickExpense]);

  const clear = useCallback((): void => setReceipt(null), []);

  return { receipt, busy, attach, clear };
}
