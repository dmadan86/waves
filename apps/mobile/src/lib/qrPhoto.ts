/**
 * Reading an invite QR out of a picture instead of off the camera.
 *
 * The commonest way an invite arrives is as a QR image in a chat on this very
 * phone, so there is nothing to point a camera at. The person picks the image
 * from their photos and it is decoded here with the same reader the live camera
 * uses (`scanFromURLAsync`), then judged by the same `tokenFromScan` — a photo
 * of a pizza-menu QR is refused with the same words as a live one.
 *
 * Both native calls are injected, and the real ones are dynamic imports, so
 * this file can be tested without a device and never evaluates `expo-camera`
 * or `expo-image-picker` on a binary that lacks them.
 */

import { tokenFromScan } from '@/lib/inviteLink';

/** What a picked photo turned out to hold. `cancelled` is not an error. */
export type PhotoQrOutcome =
  | { kind: 'token'; token: string }
  | { kind: 'cancelled' }
  /** Nothing in the picture decoded as a QR (or the picture would not load). */
  | { kind: 'no-qr' }
  /** There was a QR, but none of them is a Waves invite. */
  | { kind: 'invalid' };

/** The slice of a decoded barcode this file needs. */
export type DecodedCode = { data: string };

/** The first decoded code that is a Waves invite wins, in the order found. */
export function outcomeFromCodes(codes: readonly DecodedCode[]): PhotoQrOutcome {
  if (codes.length === 0) return { kind: 'no-qr' };
  for (const code of codes) {
    const token = tokenFromScan(code.data);
    if (token) return { kind: 'token', token };
  }
  return { kind: 'invalid' };
}

export type PhotoQrDeps = {
  /** Opens the photo library; the picked image's uri, or null on cancel. */
  pick: () => Promise<string | null>;
  /** Decodes every QR in the image at `uri`. */
  scan: (uri: string) => Promise<readonly DecodedCode[]>;
};

/** Pick a photo, decode it, and say what it held. Never throws: a picker or
 *  decoder failure reads as "no QR found", which is what the person sees. */
export async function readInviteFromPhoto(deps: PhotoQrDeps): Promise<PhotoQrOutcome> {
  let uri: string | null;
  try {
    uri = await deps.pick();
  } catch {
    return { kind: 'no-qr' };
  }
  if (!uri) return { kind: 'cancelled' };
  try {
    return outcomeFromCodes(await deps.scan(uri));
  } catch {
    return { kind: 'no-qr' };
  }
}

/** The device implementations. The modern system photo pickers (iOS 14+, Android
 *  13+) need no library permission, so none is requested up front; one that
 *  does need it is asked for by `launchImageLibraryAsync` itself. */
export const devicePhotoQrDeps: PhotoQrDeps = {
  pick: async () => {
    const ImagePicker = await import('expo-image-picker');
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 1,
      base64: false,
    });
    return result.canceled ? null : (result.assets[0]?.uri ?? null);
  },
  scan: async (uri) => {
    const { scanFromURLAsync } = await import('expo-camera');
    return scanFromURLAsync(uri, ['qr']);
  },
};
