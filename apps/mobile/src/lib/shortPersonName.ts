/**
 * A person's name as it should read in a tight spot — under a face on the
 * "Suggested" row: their first name, without the punctuation and emoji a
 * phone's address book or an imported group can carry. ".Rvs Amirnath" reads
 * "Rvs", never ".Rvs Am…". Callers keep the whole, untouched name for what is
 * saved and what is spoken; this is only what is drawn.
 */
export function shortPersonName(raw: string): string {
  const cleaned = raw
    .replace(/[^\p{L}\p{M}\p{N}\s'’-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const first = cleaned.split(' ')[0] ?? '';
  if (!first) return raw.trim();
  return first.charAt(0).toUpperCase() + first.slice(1);
}

/**
 * Short names for a row of people, told apart. A first name that two people
 * share takes the initial of the next name ("Priya S.", "Priya N."). Where even
 * that repeats — contacts that all start with the same tag, ".Rvs Amirnath",
 * ".Rvs Arun" — the shared first word is not a name at all, so the second word
 * stands in for it ("Amirnath", "Arun"). Whatever still collides after that is
 * the same name twice, and is left as it is.
 */
export function shortPersonNames(raws: readonly string[]): string[] {
  const words = raws.map((raw) =>
    raw
      .replace(/[^\p{L}\p{M}\p{N}\s'’-]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .filter(Boolean),
  );
  const capital = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);
  const repeats = (labels: readonly string[]) => {
    const count = new Map<string, number>();
    for (const label of labels) count.set(label, (count.get(label) ?? 0) + 1);
    return (label: string): boolean => (count.get(label) ?? 0) > 1;
  };

  const firsts = raws.map(shortPersonName);
  const firstRepeats = repeats(firsts);
  const initialled = firsts.map((first, index) => {
    const next = words[index]?.[1];
    return firstRepeats(first) && next ? `${first} ${next.charAt(0).toUpperCase()}.` : first;
  });
  const initialRepeats = repeats(initialled);
  return initialled.map((label, index) => {
    const next = words[index]?.[1];
    return initialRepeats(label) && next ? capital(next) : label;
  });
}
