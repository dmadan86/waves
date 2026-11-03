import * as Clipboard from 'expo-clipboard';

const CLEAR_AFTER_MS = 60_000;
let pending: ReturnType<typeof setTimeout> | null = null;

/**
 * Copy something secret (recovery key, bank account, PAN) and wipe it from the
 * clipboard after a minute, but only if the clipboard still holds it, so
 * something the user copied since is left alone.
 *
 * shortcut: a JS timer, so it does not fire if the OS suspends or kills the app
 * inside the minute; upgrade to a native/background task if that matters.
 */
export async function copySensitive(value: string): Promise<void> {
  await Clipboard.setStringAsync(value);
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => {
    pending = null;
    void Clipboard.getStringAsync()
      .then((now) => (now === value ? Clipboard.setStringAsync('') : undefined))
      .catch(() => {});
  }, CLEAR_AFTER_MS);
}
