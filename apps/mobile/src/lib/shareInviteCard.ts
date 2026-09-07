import { decode as decodeBase64 } from 'base64-arraybuffer';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';

type CaptureTarget = Parameters<typeof captureRef>[0];

export interface ShareInviteCardOptions {
  readonly cardRef: CaptureTarget;
  readonly filename: string;
  readonly dialogTitle: string;
  readonly fallback: () => Promise<void>;
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
    if (!(await Sharing.isAvailableAsync())) {
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
    await Sharing.shareAsync(file.uri, {
      mimeType: 'image/png',
      dialogTitle: options.dialogTitle,
      UTI: 'public.png',
    });
  } catch {
    await options.fallback();
  }
}
