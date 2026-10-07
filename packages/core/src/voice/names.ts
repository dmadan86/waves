/**
 * Matching a spoken name against the people or groups it might mean.
 *
 * Speech-to-text spells names the way they sound ("renny", "rainy" and "reni"
 * for Renny), so an exact comparison is not enough — and a guess that quietly
 * picks the wrong person is worse than a question. Every result therefore says
 * how sure it is: resolved (with a `fuzzy` flag when the spelling only sounds
 * alike), ambiguous (several fit equally — the caller asks), or unresolved.
 */

export interface VoiceNameCandidate {
  readonly id: string;
  readonly name: string;
  /** This candidate is the person speaking ("Madan" said by Madan means "me"). */
  readonly isMe?: boolean;
}

export type NameResolution =
  | { readonly status: 'me' }
  | {
      readonly status: 'resolved';
      readonly id: string;
      readonly name: string;
      /** Matched by sound or near-spelling, not letter for letter. */
      readonly fuzzy: boolean;
    }
  | { readonly status: 'ambiguous'; readonly candidates: readonly VoiceNameCandidate[] }
  | { readonly status: 'unresolved' };

/** Words that mean "the person speaking" — English, Hinglish and Hindi-in-Latin. */
const ME_WORDS = new Set([
  'me',
  'i',
  'myself',
  'mine',
  'my',
  'main',
  'mai',
  'mujhe',
  'mujhko',
  'mera',
  'mere',
  'meri',
  'we',
  'us',
  'ourselves',
  'hum',
  'humne',
]);

export function isMeWord(word: string): boolean {
  return ME_WORDS.has(word.toLowerCase());
}

/** Letters only, lowercased, diacritics folded. */
export function nameToken(word: string): string {
  return word
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

export function nameTokens(text: string): string[] {
  return text.split(/\s+/).map(nameToken).filter(Boolean);
}

/** A rough sound key: enough to equate "Priya"/"Pria", "Sumit"/"Sumeet", "Arun"/"Arrun",
 *  "Renny"/"rainy". */
export function phoneticKey(word: string): string {
  return (
    word
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/ph/g, 'f')
      .replace(/w/g, 'v')
      .replace(/(?<=[a-z])h/g, '')
      // "ai"/"ay"/"ei"/"ey" mid-word are the long e an Indian-English ear hears:
      // a phone's recogniser writes "Renny" as "rainy", "Shreya" as "shraya".
      .replace(/(?<=.)(ai|ay|ei|ey)/g, 'e')
      .replace(/ee|ea|ie|y/g, 'i')
      .replace(/oo/g, 'u')
      .replace(/ck|c(?=[aou])|q/g, 'k')
      .replace(/(.)\1+/g, '$1')
      .replace(/(?<=.)[aeiou]/g, 'a')
  );
}

/** The consonants alone, repeats folded: "renny" and "rainy" are both "rny". */
function skeleton(word: string): string {
  return word.replace(/[aeiou]/g, '').replace(/(.)\1+/g, '$1');
}

/** Edit distance of at most one (insert, delete, substitute, or swap). */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  if (a.length === b.length) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true;
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
  }
  const [long, short] = a.length > b.length ? [a, b] : [b, a];
  return long.slice(i + 1) === short.slice(i);
}

export function namesSoundAlike(heard: string, name: string): boolean {
  if (heard === name) return true;
  if (Math.min(heard.length, name.length) < 4) return false;
  if (Math.min(heard.length, name.length) >= 5 && withinOneEdit(heard, name)) return true;
  const key = phoneticKey(heard);
  return key.length >= 3 && key === phoneticKey(name);
}

/** 3 exact, 2 sounds alike, 1 same consonant skeleton, 0 unrelated. */
function tokenTier(heard: string, name: string): 0 | 1 | 2 | 3 {
  if (heard === name) return heard.length >= 2 ? 3 : 0;
  if (heard.length < 3 || name.length < 3) return 0;
  if (namesSoundAlike(heard, name)) return 2;
  const a = skeleton(heard);
  const b = skeleton(name);
  if (a.length >= 3 && a === b && heard[0] === name[0]) return 1;
  return 0;
}

const FILLER = new Set([
  'the',
  'a',
  'an',
  'of',
  'and',
  'ji',
  'bhai',
  'bhaiya',
  'didi',
  'sir',
  'group',
]);

interface Scored<T> {
  readonly item: T;
  readonly score: number;
  readonly worst: number;
}

/**
 * Every heard token must find a partner among the candidate's tokens for the
 * match to count; the score is the sum of the best tiers, so a full-name match
 * outranks a first-name one, and an exact outranks a sounds-alike.
 */
function scoreAgainst(
  heard: readonly string[],
  candidateTokens: readonly string[],
  requireAll: boolean,
): { score: number; worst: number } | null {
  let score = 0;
  let worst = 3;
  let matched = 0;
  for (const token of heard) {
    let best = 0;
    for (const other of candidateTokens) best = Math.max(best, tokenTier(token, other));
    if (best > 0) {
      matched += 1;
      score += best;
      worst = Math.min(worst, best);
    }
  }
  if (matched === 0) return null;
  if (requireAll && matched < heard.length) return null;
  return { score, worst };
}

/**
 * Who a spoken name means.
 *
 * "me", "I", "myself" and the Hinglish "main"/"mujhe" are the speaker; a name
 * that matches the speaker's own member row is also the speaker. Anything else
 * is matched against the candidates by token: exact first, then by sound. When
 * two candidates fit equally the answer is `ambiguous` — never a coin toss.
 */
export function resolveSpokenName(
  heard: string,
  candidates: readonly VoiceNameCandidate[],
): NameResolution {
  const tokens = nameTokens(heard).filter((token) => !FILLER.has(token));
  if (tokens.length === 0) return { status: 'unresolved' };
  if (tokens.length === 1 && isMeWord(tokens[0] ?? '')) return { status: 'me' };

  const scored: Scored<VoiceNameCandidate>[] = [];
  for (const candidate of candidates) {
    const result = scoreAgainst(
      tokens,
      nameTokens(candidate.name).filter((token) => !FILLER.has(token)),
      tokens.length <= 2,
    );
    if (result) scored.push({ item: candidate, ...result });
  }
  if (scored.length === 0) return { status: 'unresolved' };

  const top = Math.max(...scored.map((entry) => entry.score));
  const best = scored.filter((entry) => entry.score === top);
  if (best.length > 1) return { status: 'ambiguous', candidates: best.map((entry) => entry.item) };

  const winner = best[0];
  if (!winner) return { status: 'unresolved' };
  const { item, worst } = winner;
  if (item.isMe) return { status: 'me' };
  return { status: 'resolved', id: item.id, name: item.name, fuzzy: worst < 3 };
}

export interface VoiceGroupCandidate {
  readonly id: string;
  readonly name: string | null;
}

export type GroupResolution =
  | {
      readonly status: 'resolved';
      readonly id: string;
      readonly name: string;
      /** The spoken words are the whole of the name, spelled right. */
      readonly exact: boolean;
    }
  | { readonly status: 'ambiguous'; readonly candidates: readonly VoiceGroupCandidate[] }
  | { readonly status: 'unresolved' };

/**
 * Which group a spoken name means. "goa" finds "Goa Trip 2026" when nothing
 * else says goa; with "Goa Trip" and "Goa Flat" both present it is ambiguous
 * and the caller asks, unless more of the name was said ("goa trip").
 */
export function resolveSpokenGroup(
  heard: string,
  groups: readonly VoiceGroupCandidate[],
): GroupResolution {
  const tokens = nameTokens(heard).filter((token) => !FILLER.has(token));
  if (tokens.length === 0) return { status: 'unresolved' };

  const scored: (Scored<VoiceGroupCandidate> & { covered: boolean })[] = [];
  for (const group of groups) {
    if (!group.name) continue;
    const groupTokens = nameTokens(group.name).filter((token) => !FILLER.has(token));
    if (groupTokens.length === 0) continue;
    const result = scoreAgainst(tokens, groupTokens, true);
    if (!result) continue;
    // Naming the whole group beats naming part of it; leftover words in the
    // group's name cost a little, so "goa trip" prefers "Goa Trip" to
    // "Goa Trip Day 2".
    const coveredCount = groupTokens.filter((groupToken) =>
      tokens.some((token) => tokenTier(token, groupToken) > 0),
    ).length;
    const covered = coveredCount === groupTokens.length;
    scored.push({
      item: group,
      score: result.score * 10 + (covered ? 5 : 0) - (groupTokens.length - coveredCount),
      worst: result.worst,
      covered,
    });
  }
  if (scored.length === 0) return { status: 'unresolved' };

  const top = Math.max(...scored.map((entry) => entry.score));
  const best = scored.filter((entry) => entry.score === top);
  if (best.length > 1) return { status: 'ambiguous', candidates: best.map((entry) => entry.item) };
  const winner = best[0];
  if (!winner) return { status: 'unresolved' };
  return {
    status: 'resolved',
    id: winner.item.id,
    name: winner.item.name ?? '',
    exact:
      winner.covered &&
      winner.worst === 3 &&
      tokens.length === nameTokens(winner.item.name ?? '').filter((t) => !FILLER.has(t)).length,
  };
}
