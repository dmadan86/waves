/**
 * The link that launched the app, read once per process.
 *
 * The root layout's lock gate unmounts the navigator while the app is locked,
 * so the navigator remounts after every unlock. Re-reading the URL into fresh
 * state each time held the redirect decision (and its spinner) for a frame or
 * more after the person had already unlocked. The answer cannot change, so it
 * is kept here, and the read starts at import — long before the unlock.
 */
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';

let known: string | null | undefined = Platform.OS === 'web' ? null : undefined;
let pending: Promise<void> | null = null;

/** `undefined` until the OS has answered; afterwards the link or `null`. */
export const knownInitialUrl = (): string | null | undefined => known;

/** Start (once) the read. Never rejects. */
export function readInitialUrl(): Promise<void> {
  if (known !== undefined) return Promise.resolve();
  pending ??= Linking.getInitialURL().then(
    (url) => {
      known = url;
    },
    () => {
      known = null;
    },
  );
  return pending;
}

/** Test seam. */
export function resetInitialUrl(): void {
  known = Platform.OS === 'web' ? null : undefined;
  pending = null;
}
