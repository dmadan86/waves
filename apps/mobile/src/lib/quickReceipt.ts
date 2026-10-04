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
 *
 * The camera button opens the in-app camera directly (no chooser); the camera
 * carries its own gallery button. Where the binary has no camera module the
 * button falls back to the document scanner / system camera, as before.
 */

import { useCallback, useState } from 'react';

import { useStrings } from '@/i18n';
import { captureReceipt, pickReceiptImage, receiptFromFile, type PickedImage } from '@/lib/image';
import { cameraAvailable } from '@/lib/qrScan';
import { useToast } from '@/lib/toast';

export interface CameraShot {
  readonly uri: string;
  readonly width: number;
  readonly height: number;
}

export interface QuickReceipt {
  /** The held photo, or null before one is picked (or after it is removed). */
  readonly receipt: PickedImage | null;
  /** Between a shot or pick being made and its image being ready. */
  readonly busy: boolean;
  /** Whether the in-app camera is showing. */
  readonly cameraOpen: boolean;
  /** The camera button: opens the camera straight away. */
  readonly attach: () => void;
  /** Backs out of the camera. */
  readonly closeCamera: () => void;
  /** The shutter produced a file. */
  readonly onShot: (shot: CameraShot) => void;
  /** The camera's gallery button. A cancelled pick leaves the camera open. */
  readonly onLibrary: () => void;
  /** Camera permission was refused: say so, and open the library instead. */
  readonly onDenied: () => void;
  /** Drops the held photo — the chip's "x", and the sheet's own reset. */
  readonly clear: () => void;
}

export function useQuickReceipt(): QuickReceipt {
  const { t } = useStrings();
  const toast = useToast();
  const [receipt, setReceipt] = useState<PickedImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);

  const run = useCallback(async (get: () => Promise<PickedImage | null>): Promise<boolean> => {
    setBusy(true);
    try {
      const image = await get();
      if (image) setReceipt(image);
      return image != null;
    } catch {
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const attach = useCallback((): void => {
    if (cameraAvailable()) {
      setCameraOpen(true);
      return;
    }
    // No camera module in this build: the scanner / system camera, as before.
    void run(captureReceipt);
  }, [run]);

  const closeCamera = useCallback((): void => setCameraOpen(false), []);

  const onShot = useCallback(
    (shot: CameraShot): void => {
      setCameraOpen(false);
      void run(() => receiptFromFile(shot.uri, shot));
    },
    [run],
  );

  const onLibrary = useCallback((): void => {
    void (async () => {
      const ok = await run(pickReceiptImage);
      if (ok) setCameraOpen(false);
    })();
  }, [run]);

  const onDenied = useCallback((): void => {
    setCameraOpen(false);
    toast.show(t.quickExpense.receiptCameraDenied);
    void run(pickReceiptImage);
  }, [run, toast, t.quickExpense.receiptCameraDenied]);

  const clear = useCallback((): void => setReceipt(null), []);

  return { receipt, busy, cameraOpen, attach, closeCamera, onShot, onLibrary, onDenied, clear };
}
