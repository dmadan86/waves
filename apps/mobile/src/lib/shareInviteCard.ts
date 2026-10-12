import { decode as decodeBase64 } from 'base64-arraybuffer';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';

import { shareImageWithText, type ShareTarget } from '../../modules/waves-share';

type CaptureTarget = Parameters<typeof captureRef>[0];

export interface ShareInviteCardOptions {
  readonly cardRef: CaptureTarget;
  readonly filename: string;
  readonly dialogTitle: string;
  readonly fallback: () => Promise<void>;
  /**
   * With `text` and `target`, the card and the message go out together in one
   * WhatsApp message / mail / share sheet instead of the card alone. If that
   * cannot be done (no native module, WhatsApp or a mail app not installed),
   * `fallback` runs for `whatsapp` / `email`, and the plain image share for
   * `any`.
   */
  readonly text?: string;
  readonly subject?: string;
  readonly target?: ShareTarget;
}

/**
 * Share the whole rendered invitation card as a PNG.
 *
 * The QR widget can export only itself, which drops the group name and member
 * context. Capturing the outer card keeps the invitation readable when a user,
 * rider, traveller, or financer forwards it as an image. If capture or native
 * sharing is unavailable, the caller's link-only share remains the fallback.
 */
export async function shareInviteCard(options: ShareInviteCardOptions): Promise<void> {
  try {
    // The native share does not need expo-sharing, so only a card-only share
    // is cut short by its absence.
    const withText = options.text != null && options.target != null;
    if (!withText && !(await Sharing.isAvailableAsync())) {
      await options.fallback();
      return;
    }

    const base64 = await captureRef(options.cardRef, {
      format: 'png',
      quality: 1,
      result: 'base64',
    });
    if (!base64) {
      await options.fallback();
      return;
    }

    const file = new FileSystem.File(FileSystem.Paths.cache, options.filename);
    if (file.exists) file.delete();
    file.create();
    file.write(new Uint8Array(decodeBase64(base64)));
    if (options.text != null && options.target != null) {
      const result = await shareImageWithText({
        fileUri: file.uri,
        mimeType: 'image/png',
        text: options.text,
        subject: options.subject,
        target: options.target,
      });
      if (result === 'shared' || result === 'cancelled') return;
      if (options.target !== 'any' || !(await Sharing.isAvailableAsync())) {
        await options.fallback();
        return;
      }
    }
    await Sharing.shareAsync(file.uri, {
      mimeType: 'image/png',
      dialogTitle: options.dialogTitle,
      UTI: 'public.png',
    });
  } catch {
    await options.fallback();
  }
}
