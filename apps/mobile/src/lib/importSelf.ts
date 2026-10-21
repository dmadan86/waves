/**
 * "Which one is you?" for the ledger import — pure parts.
 *
 * The importer needs to know which name in the file is the person holding the
 * phone. Asking is the safe default; this only *suggests*, and only when the
 * suggestion is unambiguous, because a wrong silent guess would merge the
 * person's ledger with a stranger who shares their first name. The suggestion
 * is shown as "We think this is you" and is one tap to change.
 */

import { foldName } from '@/lib/groupImport/people';

const words = (name: string): string[] => foldName(name).split(' ').filter(Boolean);

/**
 * The name in the file that is most likely the signed-in person, or null.
 *
 * In order: the same name (case, accent and spacing ignored); then the same
 * first name; then the same initials ("MD" for "Madan D"). A step only counts
 * when exactly one name in the file matches it — two Madans is no suggestion.
 */
export function suggestSelf(
  people: readonly string[],
  displayName: string | null | undefined,
): string | null {
  const mine = foldName(displayName ?? '');
  if (mine === '') return null;
  const myWords = words(mine);

  const only = (test: (person: string) => boolean): string | null => {
    const found = people.filter(test);
    return found.length === 1 ? found[0]! : null;
  };

  const exact = only((person) => foldName(person) === mine);
  if (exact) return exact;

  const first = only((person) => words(person)[0] === myWords[0]);
  if (first) return first;

  const initials = myWords.map((word) => word[0]).join('');
  if (initials.length >= 2) {
    return only((person) => {
      const theirs = words(person);
      return theirs.length === 1 ? theirs[0] === initials : false;
    });
  }
  return null;
}

/**
 * What the Import button does when tapped. It is never disabled: before "you"
 * is settled it guides to the question instead of sitting dead.
 */
export function importGate(state: {
  claimedByMe: boolean;
  notInFile: boolean;
}): 'ready' | 'needYou' {
  return state.claimedByMe || state.notInFile ? 'ready' : 'needYou';
}
