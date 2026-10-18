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

import { parseIncomingShare, type IncomingShare } from './incoming';

export type { IncomingShare } from './incoming';

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
  getInitialShare?: () => Promise<unknown>;
  clearShare?: (id: string) => Promise<void>;
  addListener?: (event: 'onShare', listener: (payload: unknown) => void) => { remove: () => void };
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

/**
 * An image another app shared to Waves (the share sheet), copied into the app
 * cache. Null when nothing is waiting, or on a binary without the receiver.
 * Reading does not consume it: call `clearShare` once it has been routed.
 */
export async function getInitialShare(): Promise<IncomingShare | null> {
  const native = load();
  if (!native?.getInitialShare) return null;
  try {
    return parseIncomingShare(await native.getInitialShare());
  } catch {
    return null;
  }
}

/** Tells the native side this share is done, so it is not offered again. */
export async function clearShare(id: string): Promise<void> {
  try {
    await load()?.clearShare?.(id);
  } catch {
    // Best effort: the JS dedupe still stops a second expense.
  }
}

/** Shares that arrive while the app is already running. Returns the unsubscribe. */
export function addShareListener(listener: (share: IncomingShare) => void): () => void {
  const subscription = load()?.addListener?.('onShare', (payload) => {
    const share = parseIncomingShare(payload);
    if (share) listener(share);
  });
  return () => subscription?.remove();
}
