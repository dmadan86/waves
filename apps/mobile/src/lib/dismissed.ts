/**
 * Explanatory panels a person has closed, remembered so they stay closed.
 *
 * A "how this works" note earns its space the first time somebody reads it and
 * costs that space on every visit after. `DismissibleCallout` gives those notes
 * a close mark; this module is its memory. Only notes that say the same thing
 * whatever the state belong here — an error, a warning about the present or a
 * note a safe decision depends on is never closable (see the PR that added
 * this for the full inventory).
 *
 * Each flag is filed per account, the way the onboarding flags are: closing a
 * note on a shared handset closes it for the person who read it, not for the
 * next account to sign in. With nobody signed in the flag is filed under
 * `device`.
 *
 * Nothing in here rejects. An unreadable flag reads as "not closed" — the cost
 * of a spurious note is one more tap on the ×, and a note that silently never
 * appears is worse. A write that fails still closes the note for this visit.
 */

import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * The storage key for one note and one account. `name` is `<screen>.<note>`,
 * stable across releases: renaming it re-shows the note to everybody.
 */
export const dismissedKey = (name: string, ownerId: string | null | undefined): string =>
  `dismissed:callout:${name}:${ownerId || 'device'}`;

/** Has this account closed this note? Never rejects; unreadable is "no". */
export async function isDismissed(
  name: string,
  ownerId: string | null | undefined,
): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(dismissedKey(name, ownerId))) === 'yes';
  } catch {
    return false;
  }
}

/** Remember that this account closed this note. Never rejects. */
export async function rememberDismissed(
  name: string,
  ownerId: string | null | undefined,
): Promise<void> {
  try {
    await AsyncStorage.setItem(dismissedKey(name, ownerId), 'yes');
  } catch {
    // The note stays closed for this visit and comes back next time. Harmless.
  }
}

export type Dismissal = {
  /** `null` while the flag is still being read — render nothing, so no flash. */
  readonly dismissed: boolean | null;
  /** Close the note now and remember it. */
  readonly dismiss: () => void;
};

/** The note's closed flag for one account, read once and written on close. */
export function useDismissed(name: string, ownerId: string | null | undefined): Dismissal {
  const key = dismissedKey(name, ownerId);
  // Tagged with the key it answers, so switching account (or note) reads as
  // "still loading" until the new flag is in, without a reset inside the effect.
  const [answer, setAnswer] = useState<{ key: string; dismissed: boolean } | null>(null);

  useEffect(() => {
    let live = true;
    void isDismissed(name, ownerId).then((dismissed) => {
      if (live) setAnswer({ key, dismissed });
    });
    return () => {
      live = false;
    };
  }, [key, name, ownerId]);

  const dismiss = useCallback(() => {
    setAnswer({ key, dismissed: true });
    void rememberDismissed(name, ownerId);
  }, [key, name, ownerId]);

  return { dismissed: answer?.key === key ? answer.dismissed : null, dismiss };
}
