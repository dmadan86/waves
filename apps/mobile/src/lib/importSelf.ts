/**
 * "Which one is you?" for the ledger import — pure parts.
 *
 * The importer needs to know which name in the file is the person holding the
 * phone. Asking is the safe default; this only *suggests*, and only when the
 * suggestion is unambiguous, because a wrong silent guess would merge the
 * person's ledger with a stranger who shares their first name. The suggestion
 * is shown as "We think this is you" and is one tap to change.
 */

/**
 * Folded for comparison only. Accents are dropped from Latin letters ("José" is
 * "Jose") but never from other scripts, where the combining marks are vowel
 * signs that make a different name ("किरण" is not "करण").
 */
export function foldSelfName(name: string): string {
  let out = '';
  let base = '';
  for (const ch of name.normalize('NFD')) {
    if (/\p{M}/u.test(ch)) {
      if (/\p{Script=Latin}/u.test(base)) continue;
    } else {
      base = ch;
    }
    out += ch;
  }
  return out.normalize('NFC').toLocaleLowerCase().trim().replace(/\s+/g, ' ');
}

const words = (name: string): string[] => foldSelfName(name).split(' ').filter(Boolean);

const same = (a: string[], b: string[]): boolean => {
  if (a.length === 0 || a.length !== b.length) return false;
  return a.every((word, i) => {
    const other = b[i]!;
    if (word === other) return true;
    // A trailing initial may stand for a full surname, never for a different one.
    const last = i === a.length - 1 && i > 0;
    return (
      last &&
      ((word.length === 1 && other.startsWith(word)) ||
        (other.length === 1 && word.startsWith(other)))
    );
  });
};

const only = (people: readonly string[], test: (person: string) => boolean): string | null => {
  const found = people.filter(test);
  return found.length === 1 ? found[0]! : null;
};

/**
 * The name in the file that is confidently the signed-in person, or null. Only
 * this may be pre-selected: every word of the name agrees ("Madan D" and
 * "Madan Dhanapal" do; "Madan D" and "Madan K" do not), and exactly one name in
 * the file does. A wrong silent pick would file a stranger's history as yours.
 */
export function suggestSelf(
  people: readonly string[],
  displayName: string | null | undefined,
): string | null {
  const mine = words(displayName ?? '');
  if (mine.length === 0) return null;
  return only(people, (person) => same(mine, words(person)));
}

/**
 * A weaker resemblance — same first name, or the initials as a whole name — to
 * show as "Is this you?" on that row. It is never selected for the person.
 */
export function maybeSelf(
  people: readonly string[],
  displayName: string | null | undefined,
): string | null {
  const mine = words(displayName ?? '');
  if (mine.length === 0 || suggestSelf(people, displayName) !== null) return null;
  const initials = mine.map((word) => word[0]).join('');
  return only(people, (person) => {
    const theirs = words(person);
    if (theirs[0] === mine[0]) return true;
    return initials.length >= 2 && theirs.length === 1 && theirs[0] === initials;
  });
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
