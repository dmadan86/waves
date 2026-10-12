// Share an image and its text in one go. The system share sheet (and
// expo-sharing, which wraps it) sends a file OR text, and WhatsApp drops the
// text when a file comes with it; a native ACTION_SEND / UIActivityViewController
// carries both, so WhatsApp shows the text as the image's caption and mail gets
// the image as an attachment under a subject and body.
//
// Autolinking discovers the module from expo-module.config.json. It is resolved
// optionally so web and binaries built before this module existed answer
// `unavailable` instead of throwing, and the caller keeps its old behaviour.
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

export type ShareTarget = 'whatsapp' | 'email' | 'any';
export type ShareImageResult = 'shared' | 'unavailable' | 'cancelled';

export interface ShareImageWithTextOptions {
  readonly fileUri: string;
  readonly mimeType: string;
  readonly text: string;
  readonly subject?: string;
  readonly target: ShareTarget;
}

interface WavesShareNative {
  shareImageWithText: (options: {
    fileUri: string;
    mimeType: string;
    text: string;
    subject: string;
    target: ShareTarget;
  }) => Promise<ShareImageResult>;
}

function load(): WavesShareNative | null {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return null;
  return requireOptionalNativeModule<WavesShareNative>('WavesShare');
}

export function isAvailable(): boolean {
  return load() != null;
}

/**
 * `shared` once the target app / sheet has been presented, `unavailable` when
 * the module is missing or the target app is not installed, `cancelled` when
 * the user dismissed the sheet or picked another route (no fallback wanted).
 */
export async function shareImageWithText(
  options: ShareImageWithTextOptions,
): Promise<ShareImageResult> {
  const native = load();
  if (!native) return 'unavailable';
  return native.shareImageWithText({ ...options, subject: options.subject ?? '' });
}
