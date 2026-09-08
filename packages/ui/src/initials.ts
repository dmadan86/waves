/**
 * The letters an avatar falls back to when a person has no picture.
 *
 * Its own module, free of React Native, because this is the kind of thing that
 * can be wrong without looking broken: the circle still draws, still takes the
 * name's colour, still lines up — it simply says the wrong letters, and nobody
 * reads an avatar closely enough to notice one is lying.
 *
 * The case that forced it out of `Avatar`: contacts imported from a phone
 * arrive carrying whatever punctuation the address book had in front of the
 * name — ".Rvs Amirnath", ".Rvs Arun T", ".Rvs Anoop". Taking the first
 * character literally drew all three as the same ".A" circle, and the
 * who-pays-whom screen puts two of them on one row, so a screen whose whole
 * job is telling people apart was drawing them identically.
 */

/**
 * Everything in front of a word's first letter or digit — punctuation, symbols,
 * stray marks. Unicode-aware on purpose: the app runs in four languages, and a
 * Tamil or Arabic name must keep its own first letter, not lose it to an
 * ASCII-shaped rule.
 */
const LEADING_NOISE = /^[^\p{L}\p{N}]+/u;

function wordsForInitials(name: string): string[] {
  const raw = name.split(/\s+/).filter((word) => word.length > 0);
  const words = raw
    .map((word) => word.replace(LEADING_NOISE, ''))
    .filter((word) => word.length > 0);

  // Some phone books prefix imported names with a short marker like `.Rvs`.
  // Using that marker makes every avatar in that imported cluster identical
  // (`RA`, `RA`, `RA`), so skip it when there is an actual name after it.
  const firstRaw = raw[0] ?? '';
  const firstWord = words[0] ?? '';
  if (LEADING_NOISE.test(firstRaw) && [...firstWord].length <= 3 && words.length > 1) {
    return words.slice(1);
  }
  return words;
}

/**
 * Up to two letters, from the first two words that have a letter or digit in
 * them at all.
 */
export function initialsOf(name: string): string {
  const words = wordsForInitials(name).slice(0, 2);

  return (
    words
      .map((word) => {
        // Spread rather than `charAt(0)`: a character outside the BMP is two
        // code units, and taking the first of them renders half a glyph.
        const [first = ''] = [...word];
        return first.toUpperCase();
      })
      .join('') || '?'
  );
}
