/**
 * Who paid, in which group, and how it is split — read out of a spoken sentence.
 *
 * "madan paid 500 rupees in goa trip group for dinner", "madan and renny split
 * 500 equally", "i paid 1200 for cab split with arjun and meera": the amount and
 * description are the easy half. This reads the social half — the payer, the
 * group, the people, the way it divides — into one structured {@link VoiceIntent}
 * that the review screen can pre-fill and show back. Pure: no clock (except the
 * `now` it is given), no network, no model.
 *
 * Input is a transcript as speech-to-text hands it back: lowercase or not, no
 * punctuation, Indian English with Hindi grammar mixed in ("madan ne 500 diya
 * dinner ka"). Spoken numbers are expected as digits already (the mobile
 * pipeline folds "five hundred" first); "2k" and "three fifty" are folded here.
 *
 * Nothing is guessed silently. A name that fits nobody stays `unresolved`, one
 * that fits two people stays `ambiguous`, and `notes` records every assumption
 * (a defaulted payer, a fuzzy name, a percentage order) so the screen can say
 * what it understood and ask about the rest.
 */

import { guessCategory, type CategoryId } from '../category/categories';
import { isCurrencyCode, minorUnitScale } from '../money/currency';
import { normaliseDigits } from '../text/digits';
import { normaliseSpokenAmounts } from '../text/spokenAmount';
import {
  isMeWord,
  resolveSpokenGroup,
  resolveSpokenName,
  type GroupResolution,
  type VoiceGroupCandidate,
  type VoiceNameCandidate,
} from './names';

export type VoiceSplitMode = 'equal' | 'exact' | 'percent' | 'full_on';

export type PartyStatus = 'me' | 'resolved' | 'ambiguous' | 'unresolved';

export interface VoiceParty {
  readonly kind: 'me' | 'member';
  /** As heard ("renny"), or the member's own name once resolved. */
  readonly name: string;
  readonly memberId?: string;
  readonly status: PartyStatus;
  /** Who it might be, when `ambiguous`. */
  readonly candidates?: readonly VoiceNameCandidate[];
  /** Matched by sound rather than spelling ("rainy" for Renny). */
  readonly fuzzy?: boolean;
}

export interface VoicePayer extends VoiceParty {
  /** Said out loud ("madan paid"), as opposed to assumed to be the speaker. */
  readonly explicit: boolean;
}

export interface VoiceParticipant extends VoiceParty {
  readonly exactMinor?: bigint;
  readonly percent?: number;
}

export interface VoiceGroupHint {
  readonly name: string;
  readonly groupId?: string;
  readonly status: 'resolved' | 'ambiguous' | 'unresolved';
  readonly candidates?: readonly VoiceGroupCandidate[];
}

export interface VoiceIntentItem {
  readonly amountMinor: bigint;
  readonly currency?: string;
  readonly description?: string;
}

export interface VoiceIntent {
  readonly transcript: string;
  readonly amountMinor: bigint | null;
  readonly currency?: string;
  readonly description?: string;
  readonly category?: CategoryId;
  /** `YYYY-MM-DD`, for the few date words understood here. */
  readonly date?: string;
  /** More than one priced expense in the sentence, each with its own words. */
  readonly items?: readonly VoiceIntentItem[];
  readonly payer: VoicePayer;
  readonly groupHint?: VoiceGroupHint;
  /** Where the group came from: spoken, the group the mic was opened in, or nowhere yet. */
  readonly groupSource: 'named' | 'current' | 'ambiguous' | 'unresolved' | 'none';
  readonly targetGroupId?: string;
  /** Who it is split between; absent means everyone in the group. */
  readonly participants?: readonly VoiceParticipant[];
  readonly everyone: boolean;
  readonly splitMode: VoiceSplitMode;
  readonly splitCount?: number;
  /** The sentence with the payer, group and split phrases taken out. */
  readonly remainder: string;
  /** Every assumption and doubt, as short codes for the screen to explain. */
  readonly notes: readonly string[];
  /**
   * Someone other than the speaker paid, or the people or the way it divides
   * were named — beyond "I paid, split equally among the group". A group named
   * on its own is not counted: it is where the expense goes, not who owes what.
   */
  readonly hasSocialDetail: boolean;
}

export interface VoiceIntentContext {
  /** Members of the group being spoken into, when it is already known. */
  readonly members?: readonly VoiceNameCandidate[];
  readonly groups?: readonly VoiceGroupCandidate[];
  /** The group the mic was opened inside, used when the sentence names none. */
  readonly currentGroupId?: string | null;
  readonly now?: Date;
}

/* ───────────────────────────── vocabulary ───────────────────────────── */

const CURRENCY_WORDS = new Map<string, string>([
  ['rupees', 'INR'],
  ['rupee', 'INR'],
  ['rupaye', 'INR'],
  ['rupaiye', 'INR'],
  ['rs', 'INR'],
  ['inr', 'INR'],
  ['dollars', 'USD'],
  ['dollar', 'USD'],
  ['usd', 'USD'],
  ['bucks', 'USD'],
  ['dirhams', 'AED'],
  ['dirham', 'AED'],
  ['aed', 'AED'],
  ['pounds', 'GBP'],
  ['pound', 'GBP'],
  ['gbp', 'GBP'],
  ['quid', 'GBP'],
  ['euros', 'EUR'],
  ['euro', 'EUR'],
  ['eur', 'EUR'],
  ['aud', 'AUD'],
  ['cad', 'CAD'],
  ['₹', 'INR'],
  ['$', 'USD'],
  ['€', 'EUR'],
  ['£', 'GBP'],
]);

const SYMBOLS = new Set(['₹', '$', '€', '£']);

const LEAD_WORDS = new Set([
  'add',
  'expense',
  'new',
  'please',
  'hey',
  'hi',
  'ok',
  'okay',
  'note',
  'log',
  'record',
  'create',
  'enter',
  'book',
  'um',
  'uh',
  'so',
  'listen',
  'actually',
]);

/** Words that can never be part of a person's name when reading a name phrase. */
const NOT_NAME = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'aur',
  'for',
  'in',
  'on',
  'at',
  'to',
  'of',
  'by',
  'with',
  'from',
  'into',
  'under',
  'that',
  'this',
  'it',
  'is',
  'was',
  'were',
  'so',
  'then',
  'but',
  'because',
  'if',
  'when',
  'also',
  'just',
  'only',
  'has',
  'have',
  'had',
  'will',
  'would',
  'add',
  'expense',
  'group',
  'split',
  'equally',
  'evenly',
  'equal',
  'paid',
  'pays',
  'pay',
  'gave',
  'spent',
  'owes',
  'owe',
  'between',
  'among',
  'amongst',
  'each',
  'all',
  'everyone',
  'everybody',
  'rupees',
  'rupee',
  'rs',
  'dollars',
  'dirham',
  'dirhams',
  'today',
  'yesterday',
  'tomorrow',
  'ne',
  'ko',
  'ka',
  'ki',
  'ke',
  'se',
  'mein',
  'liye',
  'saath',
  'sath',
  'beech',
  'diya',
  'di',
  'diye',
  'kiya',
  'hai',
  'tha',
  'thi',
  'barabar',
  'baant',
  'bant',
  'aadha',
  'half',
  'percent',
  'pct',
  'people',
  'persons',
  'ways',
  'both',
  'nothing',
  'full',
  'whole',
  'entire',
  'owed',
  'back',
  'treat',
  'bill',
  'amount',
  'money',
  'total',
  'everything',
  'sab',
  'sabhi',
  'sabko',
  'poora',
  'pura',
  'saara',
  'sara',
  'not',
  'dont',
  'do',
  'did',
  'about',
  'around',
  'last',
  'night',
  'day',
  'ago',
  'before',
  'after',
  'now',
  'again',
  'inr',
  'usd',
  'aed',
  'gbp',
  'eur',
  'cab',
  'dinner',
  'lunch',
  'breakfast',
  'groceries',
  'taxi',
  'food',
  'petrol',
  'fuel',
  'movie',
  'tickets',
  'hotel',
  'rent',
  'coffee',
  'tea',
  'snacks',
]);

const EVERYONE_WORDS = new Set(['everyone', 'everybody', 'all', 'sab', 'sabhi', 'sabko', 'sabke']);

const SEPARATORS = new Set(['and', 'aur', '&', ',', 'plus', '+']);

const PAY_VERBS = new Set([
  'paid',
  'pays',
  'paying',
  'pay',
  'gave',
  'give',
  'gives',
  'spent',
  'spend',
  'covered',
  'cover',
  'bought',
  'treated',
  'footed',
]);
const PAY_AUX = new Set([
  'has',
  'have',
  'had',
  'just',
  'also',
  'already',
  'will',
  'would',
  'then',
  'ne',
]);
const HINGLISH_PAY_VERBS = new Set([
  'diya',
  'di',
  'diye',
  'kiya',
  'kharch',
  'kharcha',
  'bhara',
  'bhare',
  'bhari',
  'chukaya',
  'pay',
  'paid',
  'kar',
]);

const SPLIT_VERBS = new Set([
  'split',
  'splitting',
  'divide',
  'divided',
  'share',
  'shared',
  'baant',
  'bant',
  'baanto',
  'bantna',
  'baantna',
  'batwara',
]);

const EQUAL_WORDS = new Set(['equally', 'evenly', 'equal', 'barabar', 'barabari']);

const SPLIT_CUE = new Set([
  ...SPLIT_VERBS,
  'owes',
  'owe',
  'between',
  'among',
  'amongst',
  'each',
  'unequally',
  'exact',
  'exactly',
  'shares',
]);

const FULL_WORDS = new Set([
  'full',
  'whole',
  'entire',
  'everything',
  'all',
  'poora',
  'pura',
  'saara',
  'sara',
  'fully',
]);

/** Words dropped from the description. */
const DESCRIPTION_STOP = new Set([
  'for',
  'on',
  'the',
  'a',
  'an',
  'of',
  'in',
  'to',
  'at',
  'ka',
  'ki',
  'ke',
  'ko',
  'ne',
  'se',
  'hai',
  'tha',
  'thi',
  'diya',
  'di',
  'diye',
  'is',
  'was',
  'it',
  'this',
  'that',
  'my',
  'our',
  'some',
  'from',
  'via',
  'into',
  'as',
  'also',
  'just',
  'only',
  'equally',
  'evenly',
  'split',
  'with',
  'by',
  'group',
  'mein',
  'me',
  'i',
  'we',
  'paid',
  'pay',
  'spent',
  'liye',
  'wala',
  'wali',
  'wale',
  'then',
  'please',
  'total',
  'amount',
  'bill',
  'worth',
  'rupees',
  'rupee',
  'rs',
  'between',
  'among',
  'and',
  'aur',
  'plus',
  'today',
  'yesterday',
  'ago',
  'day',
  'days',
  'night',
  'last',
  'about',
  'around',
  'kal',
  'aaj',
  'parso',
  'each',
  'both',
  'everyone',
  'all',
  'do',
  'karo',
  'kar',
  'dena',
  'de',
]);

/* ───────────────────────────── tokens ───────────────────────────── */

function prepare(raw: string): string {
  let text = normaliseSpokenAmounts(normaliseDigits(raw.normalize('NFKC')));
  text = text
    .toLowerCase()
    .replace(/(\p{L})['’]s\b/gu, '$1')
    .replace(/['’]/g, '')
    .replace(/(\d),(?=\d{3}(?!\d))/g, '$1')
    .replace(/(\p{L})-(?=\p{L})/gu, '$1 ')
    // "rs.500", "rs 500" and "₹500" all read as a number then a currency word.
    .replace(/\brs\.?(?=\s*\d)/g, 'rs ')
    .replace(/\s*[.;!?]+(?=\s|$)/g, ' ')
    .replace(/\s*[|/]\s*/g, ' ');
  return text;
}

const TOKEN_RE = /\d+(?:\.\d+)?|[\p{L}\p{M}]+|[,:%₹$€£&+]/gu;

function tokenise(text: string): string[] {
  return text.match(TOKEN_RE) ?? [];
}

const isNumber = (token: string | undefined): boolean => token !== undefined && /^\d/.test(token);

/** Words that lead into a name and never are one, so never joined into one. */
const NEVER_PART_OF_A_NAME = new Set([
  'with',
  'for',
  'by',
  'to',
  'from',
  'on',
  'at',
  'of',
  'the',
  'between',
  'among',
  'amongst',
  'is',
  'was',
  'ne',
  'ko',
  'ka',
  'ki',
  'ke',
  'se',
]);

/** What a recogniser writes for "paid" after a name: "madhan p 500", "bilal pit 500". */
const MISHEARD_PAID = new Set(['p', 'pid', 'pit', 'peed']);

/**
 * Undo what a recogniser does to a name it doesn't know, when the group says
 * who it must be:
 *
 * - a name split into words — "so neil" for Sunil, "job in" for Jobin, "d pack"
 *   for Deepak, "a run" for Arun — is joined back when neither word is anybody
 *   on its own but the two together are;
 * - "for" heard as "full" between an amount and a name ("8000 full renny");
 * - "paid" heard as "p" or "pit" between a name and an amount.
 */
function repairMisheard(tokens: string[], members: readonly VoiceNameCandidate[]): string[] {
  if (members.length === 0) return tokens;
  const known = (word: string): boolean => resolveSpokenName(word, members).status !== 'unresolved';
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i] ?? '';
    const next = tokens[i + 1];
    const splittable = (word: string | undefined): word is string =>
      word !== undefined &&
      /^\p{L}+$/u.test(word) &&
      word.length <= 6 &&
      !SEPARATORS.has(word) &&
      !NEVER_PART_OF_A_NAME.has(word) &&
      !isMeWord(word) &&
      !EVERYONE_WORDS.has(word) &&
      !PAY_VERBS.has(word) &&
      !SPLIT_VERBS.has(word);
    if (
      splittable(token) &&
      splittable(next) &&
      !known(token) &&
      !known(next) &&
      resolveSpokenName(`${token} ${next}`, members).status === 'resolved'
    ) {
      out.push(token + next);
      i += 1;
      continue;
    }
    const prev = out[out.length - 1];
    if (token === 'full' && prev !== undefined && isNumber(prev) && next && known(next)) {
      out.push('for');
      continue;
    }
    if (
      MISHEARD_PAID.has(token) &&
      prev !== undefined &&
      /^\p{L}/u.test(prev) &&
      known(prev) &&
      isNumber(tokens[i + 1])
    ) {
      out.push('paid');
      continue;
    }
    out.push(token);
  }
  return out;
}

/**
 * "8000 for renny" comes back from a recogniser as "8004 renny" (eight thousand
 * plus four) or "80004 renny" (8000 then 4): the "for" became a digit. When the
 * word after such a number is somebody in the group, read it as the round
 * amount and "for" again. A real 8004 before a name is far rarer than this.
 */
function unglueFor(tokens: string[], members: readonly VoiceNameCandidate[]): string[] {
  if (members.length === 0) return tokens;
  const out: string[] = [];
  tokens.forEach((token, i) => {
    const next = tokens[i + 1];
    const glued = /^[1-9]\d*4$/.test(token) && next !== undefined && /^\p{L}/u.test(next);
    if (!glued || resolveSpokenName(next, members).status === 'unresolved') {
      out.push(token);
      return;
    }
    const concatenated = token.slice(0, -1);
    const summed = Number(token) - 4;
    // "80004" is 8000 then 4; "8004" and "504" are eight thousand / five hundred plus four.
    if (/[1-9]000$/.test(concatenated)) out.push(concatenated, 'for');
    else if (summed >= 100 && summed % 100 === 0) out.push(String(summed), 'for');
    else out.push(token);
  });
  return out;
}
const isAlpha = (token: string | undefined): boolean =>
  token !== undefined && /^\p{L}/u.test(token);

function localIso(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function daysBefore(now: Date, days: number): string {
  const copy = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  copy.setDate(copy.getDate() - days);
  return localIso(copy);
}

/* ───────────────────────────── the parser ───────────────────────────── */

type ListKind = 'with' | 'between' | 'for' | 'subject';

interface RawName {
  readonly text: string;
  readonly everyone?: boolean;
}

interface SharePair {
  readonly name: string;
  readonly value: number;
  readonly percent: boolean;
}

export function parseVoiceIntent(transcript: string, ctx: VoiceIntentContext = {}): VoiceIntent {
  const now = ctx.now ?? new Date();
  const members = ctx.members ?? [];
  const groups = ctx.groups ?? [];
  const memberMode = members.length > 0;
  const tok = repairMisheard(unglueFor(tokenise(prepare(transcript)), members), members);
  const n = tok.length;
  /** The token at `i`, or an empty string past either end. */
  const at = (i: number): string => tok[i] ?? '';
  const used: boolean[] = tok.map(() => false);
  const notes: string[] = [];
  const note = (code: string): void => {
    if (!notes.includes(code)) notes.push(code);
  };
  const mark = (from: number, to: number = from + 1): void => {
    for (let i = Math.max(0, from); i < Math.min(n, to); i += 1) used[i] = true;
  };
  const free = (i: number): boolean => i >= 0 && i < n && !used[i];

  /** A token that can be (part of) a person's name. */
  const nameLike = (i: number): boolean => {
    const t = at(i);
    if (!free(i) || !isAlpha(t)) return false;
    if (isMeWord(t) || EVERYONE_WORDS.has(t)) return true;
    if (t.length < 2) return false;
    return !NOT_NAME.has(t);
  };
  /** Does this phrase point at somebody the group actually has? */
  const knownName = (phrase: string): boolean => {
    if (isMeWord(phrase)) return true;
    return resolveSpokenName(phrase, members).status !== 'unresolved';
  };

  // Lead-in fillers ("add expense", "hey") leave the sentence untouched.
  for (let i = 0; i < n && LEAD_WORDS.has(at(i)); i += 1) mark(i);

  /* ── payer ── */

  let payerRaw: string | null = null;
  let payerExplicit = false;
  let transfer = false;

  /** Name tokens ending just before `end`, as far back as they go (up to three). */
  const subjectBefore = (end: number): { start: number; text: string } | null => {
    let start = end;
    while (start > 0 && end - start < 3 && nameLike(start - 1)) start -= 1;
    if (start === end) return null;
    // Members known: drop leading words that are not any member's name, so
    // "dinner madan paid" reads "madan".
    if (memberMode) {
      while (start < end - 1 && !knownName(tok.slice(start, end).join(' '))) start += 1;
    }
    return { start, text: tok.slice(start, end).join(' ') };
  };

  /** "arjun and meera" going backwards from `end`, as one name list. */
  const listBefore = (end: number): { start: number; names: string[] } | null => {
    const names: string[] = [];
    let cursor = end;
    let start = end;
    for (;;) {
      const phrase = subjectBefore(cursor);
      if (!phrase) break;
      names.unshift(phrase.text);
      start = phrase.start;
      let sep = phrase.start - 1;
      if (sep >= 0 && free(sep) && SEPARATORS.has(at(sep))) {
        while (sep > 0 && free(sep - 1) && SEPARATORS.has(at(sep - 1))) sep -= 1;
        cursor = sep;
        if (!nameLike(cursor - 1)) break;
        continue;
      }
      break;
    }
    return names.length > 0 ? { start, names } : null;
  };

  // "madan ne 500 diya" — the Hindi subject marker.
  const neIdx = tok.findIndex((t, i) => t === 'ne' && free(i) && i > 0);
  if (neIdx > 0) {
    const subject = listBefore(neIdx);
    if (subject) {
      // "arjun ne mujhe 500 diya" is money handed to me, not an expense.
      const after = tok.slice(neIdx + 1, neIdx + 5);
      if (after.some((t) => t === 'mujhe' || t === 'mujhko' || t === 'mera')) transfer = true;
      else {
        payerRaw = subject.names.join(' and ');
        payerExplicit = true;
        if (subject.names.length > 1) note('multiple_payers');
        mark(subject.start, neIdx + 1);
        for (let j = neIdx + 1; j < Math.min(n, neIdx + 8); j += 1) {
          if (HINGLISH_PAY_VERBS.has(at(j)) && free(j)) {
            mark(j);
            if (at(j + 1) === 'kiya' && free(j + 1)) mark(j + 1);
            break;
          }
          if (isNumber(at(j)) && at(j + 1) === 'ka') break;
        }
      }
    }
  }

  // "paid by madan" / "payment by madan" / "paid by me"
  if (payerRaw === null && !transfer) {
    for (let i = 0; i < n - 2; i += 1) {
      if (!free(i) || !(at(i) === 'paid' || at(i) === 'payment' || at(i) === 'paying')) continue;
      let by = i + 1;
      while (by < n && by < i + 4 && at(by) !== 'by' && !isNumber(at(by)) && at(by) !== 'for')
        by += 1;
      if (at(by) !== 'by' || !free(by)) continue;
      const names: string[] = [];
      let j = by + 1;
      for (;;) {
        let end = j;
        while (end < n && end < j + 3 && nameLike(end)) end += 1;
        if (end === j) break;
        names.push(tok.slice(j, end).join(' '));
        j = end;
        if (j < n && free(j) && SEPARATORS.has(at(j)) && nameLike(j + 1)) j += 1;
        else break;
      }
      if (names.length === 0) continue;
      payerRaw = names.join(' and ');
      payerExplicit = true;
      if (names.length > 1) note('multiple_payers');
      mark(i, j);
      break;
    }
  }

  // "madan paid 500", "i spent 300", "madan gave 500 for dinner"
  if (payerRaw === null && !transfer) {
    for (let v = 0; v < n; v += 1) {
      if (!free(v) || !PAY_VERBS.has(at(v))) continue;
      const verb = at(v);
      const next = at(v + 1);
      if (verb === 'gave' || verb === 'give' || verb === 'gives') {
        // "gave 500" is a payer; "gave me 500" / "gave arjun 500" hands money over.
        const money =
          isNumber(next) || SYMBOLS.has(next ?? '') || next === 'rs' || next === 'rupees';
        if (!money) {
          if (next === 'me' || next === 'us' || (isAlpha(next) && isNumber(at(v + 2))))
            transfer = true;
          continue;
        }
      }
      if ((verb === 'paid' || verb === 'pays') && (next === 'me' || next === 'back')) {
        transfer = true;
        continue;
      }
      let end = v;
      while (end > 0 && free(end - 1) && (PAY_AUX.has(at(end - 1)) || at(end - 1) === ','))
        end -= 1;
      const subject = listBefore(end);
      if (!subject) {
        // "paid 500 for dinner" — nobody named, so the speaker paid.
        if (verb === 'paid' || verb === 'spent' || verb === 'covered') {
          mark(v);
          note('payer_default_me');
        }
        break;
      }
      payerRaw = subject.names.join(' and ');
      payerExplicit = true;
      if (subject.names.length > 1) note('multiple_payers');
      mark(subject.start, v + 1);
      break;
    }
  }
  if (transfer) note('looks_like_transfer');

  /* ── group ── */

  let groupHint: VoiceGroupHint | undefined;

  const hintFrom = (phrase: string, resolution: GroupResolution): VoiceGroupHint => {
    if (resolution.status === 'resolved')
      return { name: resolution.name || phrase, groupId: resolution.id, status: 'resolved' };
    if (resolution.status === 'ambiguous')
      return { name: phrase, status: 'ambiguous', candidates: resolution.candidates };
    return { name: phrase, status: 'unresolved' };
  };

  const GROUP_LEFT_STOP = new Set([
    'in',
    'to',
    'into',
    'under',
    'for',
    'on',
    'at',
    'the',
    'a',
    'an',
    'my',
    'our',
    'ke',
    'ka',
    'ki',
    'wale',
    'wala',
    'wali',
    'mein',
    'me',
    'paid',
    'pay',
    'with',
    'split',
    'and',
    'aur',
    'by',
    'from',
    ',',
    ':',
    'ne',
    'diya',
    'of',
    'new',
    'this',
    'that',
    'called',
    'named',
    // "the latest group", "this group": a pointer, not a name.
    'latest',
    'last',
    'recent',
    'current',
    'active',
    'previous',
    'prev',
    'most',
  ]);
  const GROUP_PREPS = new Set(['in', 'to', 'into', 'under', 'for', 'on', 'at', 'inside']);
  const RIGHT_STOP = new Set([
    'for',
    'split',
    'paid',
    'pay',
    'with',
    'and',
    'aur',
    'mein',
    'me',
    'ke',
    'ka',
    'ki',
    'ko',
    'ne',
    'equally',
    'evenly',
    'between',
    'among',
    'on',
    'in',
    'to',
    ',',
    'today',
    'yesterday',
    'by',
    'at',
  ]);

  // "goa trip: dinner 500" — a name and a colon up front.
  const colon = tok.indexOf(':');
  if (colon > 0 && colon <= 5 && tok.slice(0, colon).every((t, i) => free(i) && isAlpha(t))) {
    const phrase = tok.slice(0, colon).join(' ');
    const resolution = resolveSpokenGroup(phrase, groups);
    if (groups.length === 0 || resolution.status !== 'unresolved') {
      groupHint = hintFrom(phrase, resolution);
      mark(0, colon + 1);
    }
  }

  // "in goa trip group", "goa trip group mein", "to group goa trip"
  for (let g = 0; g < n && !groupHint; g += 1) {
    if (!free(g) || at(g) !== 'group') continue;
    let left = g;
    while (
      left > 0 &&
      g - left < 4 &&
      free(left - 1) &&
      isAlpha(at(left - 1)) &&
      !GROUP_LEFT_STOP.has(at(left - 1))
    )
      left -= 1;
    let phrase = tok.slice(left, g).join(' ');
    let from = left;
    let to = g + 1;
    if (!phrase) {
      // "in group goa trip": the name follows the word.
      let right = g + 1;
      while (
        right < n &&
        right - g <= 4 &&
        free(right) &&
        !RIGHT_STOP.has(at(right)) &&
        !isNumber(at(right))
      )
        right += 1;
      if (right === g + 1) continue;
      // Try the longest run first, then shorter ones — the rest is the description.
      let chosen = right;
      if (groups.length > 0) {
        for (let r = right; r > g + 1; r -= 1) {
          if (resolveSpokenGroup(tok.slice(g + 1, r).join(' '), groups).status !== 'unresolved') {
            chosen = r;
            break;
          }
        }
      }
      phrase = tok.slice(g + 1, chosen).join(' ');
      to = chosen;
      from = g;
    } else if (groups.length > 0) {
      // Longest suffix of the left words that names a group ("my goa trip" → "goa trip").
      for (let l = left; l < g; l += 1) {
        if (resolveSpokenGroup(tok.slice(l, g).join(' '), groups).status !== 'unresolved') {
          left = l;
          break;
        }
      }
      from = left;
      phrase = tok.slice(left, g).join(' ');
    }
    groupHint = hintFrom(phrase, resolveSpokenGroup(phrase, groups));
    // The preposition and Hinglish "mein" around it go too.
    if (from > 0 && free(from - 1) && GROUP_PREPS.has(at(from - 1))) from -= 1;
    if (from > 0 && free(from - 1) && (at(from - 1) === 'ke' || at(from - 1) === 'wale')) from -= 1;
    if ((at(to) === 'mein' || at(to) === 'me') && free(to)) to += 1;
    mark(from, to);
  }

  // "in goa trip" with no "group" — only when it really is one of this person's groups.
  if (!groupHint && groups.length > 0) {
    for (let p = 0; p < n - 1 && !groupHint; p += 1) {
      if (!free(p) || !GROUP_PREPS.has(at(p))) continue;
      const strong =
        at(p) === 'in' ||
        at(p) === 'to' ||
        at(p) === 'into' ||
        at(p) === 'under' ||
        at(p) === 'inside';
      let end = p + 1;
      while (end < n && end - p <= 4 && free(end) && isAlpha(at(end)) && !RIGHT_STOP.has(at(end)))
        end += 1;
      for (let r = end; r > p + 1; r -= 1) {
        const phrase = tok.slice(p + 1, r).join(' ');
        const resolution = resolveSpokenGroup(phrase, groups);
        if (resolution.status === 'unresolved') continue;
        // "for"/"on"/"at" also lead descriptions ("for dinner"); they must name the group in full.
        if (!strong && !(resolution.status === 'resolved' && resolution.exact)) continue;
        // A person is not a group: "in arjun" never reads as one when he is a member.
        groupHint = hintFrom(phrase, resolution);
        let to = r;
        if ((at(to) === 'mein' || at(to) === 'me') && free(to) && at(to) !== 'me') to += 1;
        mark(p, to);
        break;
      }
    }
  }

  /* ── people and how it splits ── */

  const lists: { kind: ListKind; names: RawName[] }[] = [];
  let everyone = false;
  let splitMode: VoiceSplitMode = 'equal';
  let fullOnNames: RawName[] | null = null;

  /** One name phrase going forward, or null. `strict` means it must be somebody known. */
  const phraseAt = (i: number, strict: boolean): { text: string; end: number } | null => {
    if (!nameLike(i)) return null;
    if (EVERYONE_WORDS.has(at(i))) return { text: at(i), end: i + 1 };
    if (memberMode && nameLike(i + 1) && !EVERYONE_WORDS.has(at(i + 1))) {
      const two = `${at(i)} ${at(i + 1)}`;
      if (resolveSpokenName(two, members).status === 'resolved' && !isMeWord(at(i + 1)))
        return { text: two, end: i + 2 };
    }
    if (strict && !knownName(at(i))) return null;
    return { text: at(i), end: i + 1 };
  };

  /** "arjun and meera and me" going forward; stops at the first thing that is not a name. */
  const listAfter = (start: number, strict: boolean): { names: RawName[]; end: number } | null => {
    const names: RawName[] = [];
    let i = start;
    for (;;) {
      const phrase = phraseAt(i, strict);
      if (!phrase) break;
      names.push({ text: phrase.text, everyone: EVERYONE_WORDS.has(phrase.text) });
      i = phrase.end;
      // "arjun ko" / "arjun ke" — Hindi markers hang off a name, unless "ke saath" follows.
      if (
        free(i) &&
        (at(i) === 'ko' || at(i) === 'ke') &&
        at(i + 1) !== 'saath' &&
        at(i + 1) !== 'sath' &&
        at(i + 1) !== 'liye' &&
        at(i + 1) !== 'beech'
      )
        i += 1;
      let j = i;
      while (j < n && free(j) && SEPARATORS.has(at(j))) j += 1;
      if (j > i && nameLike(j)) i = j;
      else if (strict && nameLike(i) && !isMeWord(at(i)) && knownName(at(i))) continue;
      else break;
    }
    // "for rose flowers" is a description, not a person: a weak list must not
    // run straight into another word that could be a name.
    if (strict && nameLike(i) && !isMeWord(at(i)) && !EVERYONE_WORDS.has(at(i))) return null;
    return names.length > 0 ? { names, end: i } : null;
  };

  const hasCue = tok.some((t, i) => free(i) && SPLIT_CUE.has(t));

  // "everyone" / "all of us"
  for (let e = 0; e < n; e += 1) {
    if (!free(e) || !EVERYONE_WORDS.has(at(e))) continue;
    if (at(e) === 'all' && at(e - 1) === 'on') continue;
    if (at(e) === 'all' && FULL_WORDS.has(at(e)) && (at(e + 1) === 'on' || at(e + 1) === 'for'))
      continue;
    everyone = true;
    mark(e);
    // Hinglish "sab me baant do": the postposition belongs to "everyone", not to "me".
    if (
      (at(e + 1) === 'me' || at(e + 1) === 'mein' || at(e + 1) === 'ke' || at(e + 1) === 'ko') &&
      free(e + 1)
    )
      mark(e + 1);
    if (at(e) === 'all' && at(e + 1) === 'of' && (at(e + 2) === 'us' || at(e + 2) === 'them'))
      mark(e + 1, e + 3);
    if (
      (at(e - 1) === 'for' ||
        at(e - 1) === 'among' ||
        at(e - 1) === 'between' ||
        at(e - 1) === 'with') &&
      free(e - 1)
    )
      mark(e - 1);
  }
  if (lists.some((l) => l.names.some((name) => name.everyone))) everyone = true;

  // "split with a and b", "split it between a, b and me", "split 500 among everyone"
  for (let s = 0; s < n; s += 1) {
    if (!free(s) || !SPLIT_VERBS.has(at(s))) continue;
    let c = s + 1;
    while (c < n && c - s <= 6 && !['with', 'between', 'among', 'amongst'].includes(at(c))) {
      if (SEPARATORS.has(at(c)) && !isNumber(at(c + 1))) break;
      c += 1;
    }
    if (c >= n || !['with', 'between', 'among', 'amongst'].includes(at(c))) continue;
    // "split among 3 people" names nobody.
    if (isNumber(at(c + 1)) && /^(people|persons|ppl|ways|folks|heads)$/.test(at(c + 2) ?? ''))
      continue;
    const list = listAfter(c + 1, false);
    if (!list) continue;
    lists.push({ kind: at(c) === 'with' ? 'with' : 'between', names: [...list.names] });
    mark(s, s + 1);
    mark(c, list.end);
    break;
  }

  // "between a, b and me" without the word split
  if (lists.length === 0) {
    for (let c = 0; c < n; c += 1) {
      if (!free(c) || !(at(c) === 'between' || at(c) === 'among' || at(c) === 'amongst')) continue;
      if (isNumber(at(c + 1))) continue;
      const list = listAfter(c + 1, memberMode);
      if (!list) continue;
      lists.push({ kind: 'between', names: [...list.names] });
      mark(c, list.end);
      break;
    }
  }

  // Hinglish: "arjun aur meera ke saath split", "arjun aur meera ke beech", "... mein baant do"
  if (lists.length === 0) {
    for (let k = 1; k < n - 1; k += 1) {
      const saath = (at(k + 1) === 'saath' || at(k + 1) === 'sath') && at(k) === 'ke';
      const beech = at(k + 1) === 'beech' && at(k) === 'ke';
      const mein =
        at(k) === 'mein' &&
        tok.slice(k + 1, k + 4).some((t) => SPLIT_VERBS.has(t) || EQUAL_WORDS.has(t));
      if (!(saath || beech || mein) || !free(k)) continue;
      const list = listBefore(k);
      if (!list) continue;
      lists.push({ kind: saath ? 'with' : 'between', names: list.names.map((text) => ({ text })) });
      mark(list.start, k + (mein ? 1 : 2));
      break;
    }
  }

  // "for arjun and meera" — only when they really are people in the group.
  if (lists.length === 0 && memberMode) {
    for (let f = 0; f < n; f += 1) {
      if (!free(f) || at(f) !== 'for') continue;
      const list = listAfter(f + 1, true);
      if (!list) continue;
      lists.push({ kind: 'for', names: [...list.names] });
      mark(f, list.end);
      break;
    }
  }

  // "bare with": "dinner with arjun and meera 500" — only for known people.
  if (lists.length === 0 && memberMode) {
    for (let w = 0; w < n; w += 1) {
      if (!free(w) || at(w) !== 'with') continue;
      const list = listAfter(w + 1, true);
      if (!list) continue;
      lists.push({ kind: 'with', names: [...list.names] });
      mark(w, list.end);
      break;
    }
  }

  // "madan and renny split 500 equally" — the people come before the verb.
  if (lists.length === 0) {
    for (let s = 1; s < n; s += 1) {
      if (!free(s) || !SPLIT_VERBS.has(at(s))) continue;
      const list = listBefore(s);
      if (!list) continue;
      // Not a description ("dinner split 500 …") unless the words are people.
      const joined = list.names.length >= 2;
      const known = list.names.every((name) => knownName(name));
      if (memberMode ? !known : !(joined && list.start === 0)) continue;
      if (!memberMode && list.start !== 0) continue;
      lists.push({ kind: 'subject', names: list.names.map((text) => ({ text })) });
      mark(list.start, s + 1);
      break;
    }
  }

  // Remaining split verbs ("split 500 equally", "split it") carry no one.
  for (let s = 0; s < n; s += 1) if (free(s) && SPLIT_VERBS.has(at(s))) mark(s);

  // Equal-split words.
  for (let i = 0; i < n; i += 1) {
    if (free(i) && EQUAL_WORDS.has(at(i))) {
      mark(i);
      continue;
    }
    const pair =
      free(i) &&
      free(i + 1) &&
      ((at(i) === 'half' && at(i + 1) === 'half') ||
        (at(i) === 'aadha' && at(i + 1) === 'aadha') ||
        (at(i) === 'fifty' && at(i + 1) === 'fifty') ||
        (at(i) === '50' && at(i + 1) === '50'));
    if (pair) mark(i, i + 2);
  }

  // Full amount on one person.
  const owesFull = (): void => {
    for (let i = 0; i < n; i += 1) {
      // "i owe nothing" / "i dont owe anything" — the speaker's share is zero.
      if (
        free(i) &&
        isMeWord(at(i)) &&
        (at(i + 1) === 'owe' || at(i + 1) === 'owes') &&
        (at(i + 2) === 'nothing' || at(i + 2) === 'zero' || at(i + 2) === 'no')
      ) {
        mark(i, i + 3);
        fullOnNames = fullOnNames ?? [];
        note('speaker_owes_nothing');
        return;
      }
      if (
        free(i) &&
        isMeWord(at(i)) &&
        (at(i + 1) === 'dont' || at(i + 1) === 'do') &&
        (at(i + 2) === 'owe' || (at(i + 2) === 'not' && at(i + 3) === 'owe'))
      ) {
        const end = at(i + 2) === 'owe' ? i + 3 : i + 4;
        mark(i, end + (at(end) === 'anything' || at(end) === 'any' ? 1 : 0));
        fullOnNames = fullOnNames ?? [];
        note('speaker_owes_nothing');
        return;
      }
    }
    for (let i = 1; i < n; i += 1) {
      // "arjun owes full", "arjun owes the whole amount", "arjun owes everything"
      if (free(i) && (at(i) === 'owes' || at(i) === 'owe')) {
        let j = i + 1;
        if (at(j) === 'me' || at(j) === 'us') j += 1;
        if (at(j) === 'the' || at(j) === 'it') j += 1;
        if (FULL_WORDS.has(at(j) ?? '')) {
          const subject = subjectBefore(i);
          if (!subject || isMeWord(subject.text)) continue;
          fullOnNames = [{ text: subject.text }];
          let end = j + 1;
          if (at(end) === 'of') end += 1;
          if (at(end) === 'it' || at(end) === 'amount') end += 1;
          mark(subject.start, end);
          return;
        }
      }
    }
    for (let i = 0; i < n; i += 1) {
      // "full amount on arjun", "all on arjun", "put it all on arjun", "charge it to arjun"
      if (!free(i) || !FULL_WORDS.has(at(i))) continue;
      let j = i + 1;
      if (at(j) === 'amount') j += 1;
      if (at(j) === 'of') j += 1;
      if (at(j) === 'it') j += 1;
      if (at(j) !== 'on' && at(j) !== 'to' && at(j) !== 'for') continue;
      const phrase = phraseAt(j + 1, false);
      if (!phrase) continue;
      fullOnNames = [{ text: phrase.text }];
      let start = i;
      if (at(start - 1) === 'it') start -= 1;
      if (at(start - 1) === 'put' || at(start - 1) === 'charge') start -= 1;
      mark(start, phrase.end);
      return;
    }
    for (let i = 0; i < n; i += 1) {
      // "arjun ko poora" (Hinglish): all of it on Arjun
      if (free(i) && at(i) === 'ko' && FULL_WORDS.has(at(i + 1) ?? '') && nameLike(i - 1)) {
        fullOnNames = [{ text: at(i - 1) }];
        mark(i - 1, i + 2);
        return;
      }
    }
  };
  owesFull();

  // Exact amounts and percentages: "arjun 300 meera 200", "arjun 60 percent meera 40".
  const pairs: SharePair[] = [];
  if (fullOnNames === null) {
    const OWE_SKIP = new Set([
      'owes',
      'owe',
      'pays',
      'pay',
      'ko',
      'will',
      'is',
      'has',
      'gets',
      'get',
      'takes',
      'take',
      ':',
      '=',
      'at',
    ]);
    const CCY = new Set([...CURRENCY_WORDS.keys()]);
    const accepted = (name: string): boolean =>
      memberMode ? knownName(name) : hasCue && !EVERYONE_WORDS.has(name);
    const taken: [number, number][] = [];
    for (let i = 0; i < n; i += 1) {
      if (!nameLike(i)) continue;
      // name [owes] NUM [rupees|%|percent]
      let j = i + 1;
      while (j < n && free(j) && OWE_SKIP.has(at(j))) j += 1;
      if (!(free(j) && isNumber(at(j)))) continue;
      let end = j + 1;
      let percent = false;
      if (free(end) && (at(end) === '%' || at(end) === 'percent' || at(end) === 'pct')) {
        percent = true;
        end += 1;
      } else if (free(end) && CCY.has(at(end))) end += 1;
      if (!accepted(at(i))) continue;
      pairs.push({ name: at(i), value: Number(at(j)), percent });
      taken.push([i, end]);
      i = end - 1;
    }
    // NUM [rupees] for|to|ko NAME  ("300 for arjun 200 for meera")
    if (pairs.length < 2) {
      pairs.length = 0;
      taken.length = 0;
      for (let i = 0; i < n; i += 1) {
        if (!(free(i) && isNumber(at(i)))) continue;
        let j = i + 1;
        let percent = false;
        if (free(j) && (at(j) === '%' || at(j) === 'percent')) {
          percent = true;
          j += 1;
        } else if (free(j) && CCY.has(at(j))) j += 1;
        if (!(free(j) && (at(j) === 'for' || at(j) === 'to' || at(j) === 'ko' || at(j) === 'by')))
          continue;
        if (!nameLike(j + 1) || !accepted(at(j + 1))) continue;
        pairs.push({ name: at(j + 1), value: Number(at(i)), percent });
        taken.push([i, j + 2]);
        i = j + 1;
      }
    }
    const lone =
      pairs.length === 1 && tok.some((t, i) => !used[i] && (t === 'owes' || t === 'owe'));
    if (pairs.length >= 2 || (lone && memberMode)) for (const [a, b] of taken) mark(a, b);
    else pairs.length = 0;
  }

  /* ── amount, currency, date, description ── */

  // "split 3 ways" / "between 4 people"
  let splitCount: number | undefined;
  for (let i = 0; i < n - 1; i += 1) {
    if (!(free(i) && isNumber(at(i)))) continue;
    const word = at(i + 1);
    const before = at(i - 1);
    if (
      /^(people|persons|ppl|ways|folks|heads)$/.test(word ?? '') ||
      ((before === 'between' || before === 'among' || before === 'amongst') &&
        Number.isInteger(Number(at(i))))
    ) {
      splitCount = Number(at(i));
      mark(i, /^(people|persons|ppl|ways|folks|heads)$/.test(word ?? '') ? i + 2 : i + 1);
      if (before === 'between' || before === 'among' || before === 'amongst') mark(i - 1);
    }
  }

  // Bare percentages: "split 500 60 40 with arjun".
  let bareShares: number[] | null = null;
  if (fullOnNames === null && pairs.length === 0 && (hasCue || lists.length > 0)) {
    const isMoney = (i: number): boolean => {
      const prev = at(i - 1);
      const next = at(i + 1);
      return CURRENCY_WORDS.has(prev ?? '') || CURRENCY_WORDS.has(next ?? '');
    };
    for (let i = 0; i < n - 1 && !bareShares; i += 1) {
      if (!(free(i) && isNumber(at(i)) && free(i + 1) && isNumber(at(i + 1)))) continue;
      let end = i;
      const run: number[] = [];
      while (end < n && free(end) && isNumber(at(end)) && !isMoney(end)) {
        run.push(Number(at(end)));
        end += 1;
      }
      // The longest stretch of plain numbers that adds up to 100: "500 60 40" → 60, 40.
      for (let len = run.length; len >= 2 && !bareShares; len -= 1) {
        for (let from = 0; from + len <= run.length; from += 1) {
          const part = run.slice(from, from + len);
          if (
            part.every((v) => v > 0 && v <= 100) &&
            Math.abs(part.reduce((a, b) => a + b, 0) - 100) < 1e-9
          ) {
            bareShares = part;
            mark(i + from, i + from + len);
            break;
          }
        }
      }
      i = Math.max(i, end - 1);
    }
  }

  // Amount, currency
  const amountIdx: number[] = [];
  let currency: string | undefined;
  const moneyAdjacent = new Set<number>();
  for (let i = 0; i < n; i += 1) {
    if (!free(i) || !isNumber(at(i))) continue;
    const prev = at(i - 1);
    const next = at(i + 1);
    const before = free(i - 1) && CURRENCY_WORDS.has(prev ?? '');
    const after = free(i + 1) && CURRENCY_WORDS.has(next ?? '');
    if (before || after) {
      amountIdx.push(i);
      moneyAdjacent.add(i);
      currency = currency ?? CURRENCY_WORDS.get(before ? prev : (next as string));
    }
  }
  // No currency word anywhere near a number: take free numbers that are not part of a date or ordinal.
  if (amountIdx.length === 0) {
    for (let i = 0; i < n; i += 1) {
      if (!free(i) || !isNumber(at(i))) continue;
      if (/^(days?|day|st|nd|rd|th|min|mins|hours?|kg|km)$/.test(at(i + 1) ?? '')) continue;
      amountIdx.push(i);
    }
  }
  if (!currency) {
    for (let i = 0; i < n; i += 1) {
      if (CURRENCY_WORDS.has(at(i)) && free(i)) {
        currency = CURRENCY_WORDS.get(at(i));
        break;
      }
    }
  }

  const scale = (code: string | undefined): number =>
    code && isCurrencyCode(code) ? Number(minorUnitScale(code)) : 100;
  const toMinor = (value: number, code: string | undefined): bigint =>
    BigInt(Math.round(value * scale(code)));

  // Date words.
  let date: string | undefined;
  const dateTokens = new Set<number>();
  for (let i = 0; i < n; i += 1) {
    if (!free(i)) continue;
    const t = at(i);
    if (t === 'today' || t === 'aaj') {
      date = daysBefore(now, 0);
      dateTokens.add(i);
    } else if (t === 'yesterday' || t === 'kal') {
      date = daysBefore(now, 1);
      dateTokens.add(i);
      if (t === 'kal') note('date_kal_assumed_yesterday');
    } else if (t === 'parso') {
      date = daysBefore(now, 2);
      dateTokens.add(i);
    } else if (t === 'day' && at(i + 1) === 'before' && at(i + 2) === 'yesterday') {
      date = daysBefore(now, 2);
      dateTokens
        .add(i)
        .add(i + 1)
        .add(i + 2);
    } else if (isNumber(t) && /^days?$/.test(at(i + 1) ?? '') && at(i + 2) === 'ago') {
      date = daysBefore(now, Number(t));
      dateTokens
        .add(i)
        .add(i + 1)
        .add(i + 2);
      const amt = amountIdx.indexOf(i);
      if (amt >= 0) amountIdx.splice(amt, 1);
    }
  }
  if (tok.includes('last') && tok.includes('night') && !date) date = daysBefore(now, 1);

  // Total and the per-person shares.
  const statedTotal = amountIdx[0] !== undefined ? Number(at(amountIdx[0])) : null;
  let amountMinor: bigint | null = statedTotal === null ? null : toMinor(statedTotal, currency);
  let remainderExtra = '';
  if (pairs.length > 0 && !pairs.some((p) => p.percent)) {
    const sum = pairs.reduce((a, p) => a + p.value, 0);
    // "a 60 b 40" with a separate total of 500 is a percentage split, not ₹60 and ₹40.
    if (statedTotal !== null && sum === 100 && statedTotal !== 100)
      pairs.forEach((p, i) => (pairs[i] = { ...p, percent: true }));
    else if (statedTotal === null) {
      amountMinor = toMinor(sum, currency);
      remainderExtra = ` ${sum}`;
    }
  }

  if (amountIdx.length > 1) note('multiple_amounts');

  // Items, when several priced things were said.
  let items: VoiceIntentItem[] | undefined;
  const descriptionTokens = (from: number, to: number): string => {
    const words: string[] = [];
    for (let i = from; i < to; i += 1) {
      if (used[i] || dateTokens.has(i)) continue;
      const t = at(i);
      if (
        !isAlpha(t) ||
        (DESCRIPTION_STOP.has(t) && t !== 'and') ||
        CURRENCY_WORDS.has(t) ||
        isMeWord(t)
      )
        continue;
      if (t === 'and' || t === 'aur') {
        words.push('and');
        continue;
      }
      words.push(t);
    }
    while (words[0] === 'and') words.shift();
    while (words[words.length - 1] === 'and') words.pop();
    return words.join(' ').replace(/\b(and )+and\b/g, 'and');
  };

  if (amountIdx.length > 1 && pairs.length === 0) {
    const cuts: number[] = [];
    // Cut after each priced number when words lead ("dinner 500 cab 200"), before it when the number leads.
    const firstWord = tok.findIndex(
      (t, i) => !used[i] && isAlpha(t) && !DESCRIPTION_STOP.has(t) && !CURRENCY_WORDS.has(t),
    );
    const leadsWithNumber = firstWord === -1 || firstWord > (amountIdx[0] ?? 0);
    for (let k = 1; k < amountIdx.length; k += 1) {
      const prevAmount = amountIdx[k - 1] ?? 0;
      const here = amountIdx[k] ?? n;
      // A separator between them is the natural cut; else just before / after the number.
      let cut = -1;
      for (let i = prevAmount + 1; i < here; i += 1) {
        if (SEPARATORS.has(at(i)) || at(i) === 'then') {
          cut = i;
          break;
        }
      }
      if (cut < 0)
        cut = leadsWithNumber
          ? here
          : prevAmount + 1 + (CURRENCY_WORDS.has(at(prevAmount + 1)) ? 1 : 0);
      cuts.push(cut);
    }
    const bounds = [0, ...cuts, n];
    const built: VoiceIntentItem[] = [];
    let carry: string | undefined = currency;
    for (let b = 0; b < bounds.length - 1; b += 1) {
      const lo = bounds[b] ?? 0;
      const hi = bounds[b + 1] ?? n;
      const idx = amountIdx.find((i) => i >= lo && i < hi);
      if (idx === undefined) continue;
      const local = ((): string | undefined => {
        for (let i = lo; i < hi; i += 1)
          if (CURRENCY_WORDS.has(at(i)) && free(i)) return CURRENCY_WORDS.get(at(i));
        return undefined;
      })();
      carry = local ?? carry;
      const description = descriptionTokens(lo, hi);
      built.push({
        amountMinor: toMinor(Number(at(idx)), carry),
        ...(carry ? { currency: carry } : {}),
        ...(description ? { description } : {}),
      });
    }
    if (built.length > 1) items = built;
  }

  const description = items ? undefined : descriptionTokens(0, n) || undefined;
  const category = description ? (guessCategory(description) ?? undefined) : undefined;

  /* ── assemble people ── */

  const payerName = payerRaw ?? 'me';
  const payerIsMe = payerRaw === null || isMeWord(payerRaw);
  if (payerRaw !== null && /^(we|us|hum|humne)$/.test(payerRaw)) note('we_paid');

  const keyOf = (name: string): string => (isMeWord(name) ? 'me' : name.toLowerCase());
  const payerKey = payerIsMe ? 'me' : keyOf(payerName);

  let people: RawName[] | undefined;
  let kind: ListKind | undefined;
  if (fullOnNames !== null) {
    splitMode = 'full_on';
    // "i owe nothing" names nobody itself; whoever it was said for owes it.
    const spoken = lists[0]?.names.filter((name) => !name.everyone) ?? [];
    people = fullOnNames.length === 0 && spoken.length > 0 ? spoken : fullOnNames;
    kind = 'for';
  } else if (pairs.length > 0) {
    splitMode = pairs.some((p) => p.percent) ? 'percent' : 'exact';
    people = pairs.map((p) => ({ text: p.name }));
    kind = 'between';
  } else if (lists.length > 0) {
    const first = lists[0];
    kind = first?.kind;
    people = first?.names.filter((name) => !name.everyone);
  }
  if (bareShares) splitMode = 'percent';

  const seen = new Set<string>();
  const ordered: RawName[] = [];
  const push = (name: RawName): void => {
    const key = keyOf(name.text);
    if (seen.has(key)) return;
    seen.add(key);
    ordered.push(name);
  };
  if (people && (kind === 'with' || bareShares)) {
    // "split with arjun" — the payer and the speaker are in it too.
    push({ text: payerIsMe ? 'me' : payerName });
    if (!payerIsMe) {
      push({ text: 'me' });
      note('me_included_by_with');
    }
  }
  for (const name of people ?? []) push(name);

  let participants: VoiceParticipant[] | undefined;
  if (ordered.length > 0 || (fullOnNames !== null && fullOnNames.length === 0)) {
    if (ordered.length === 0) {
      participants = undefined;
      note('full_on_target_missing');
    } else {
      participants = ordered.map((name, index): VoiceParticipant => {
        const base: VoiceParticipant = isMeWord(name.text)
          ? { kind: 'me', name: 'me', status: 'me' }
          : { kind: 'member', name: name.text, status: 'unresolved' };
        const pair = pairs.find((p) => keyOf(p.name) === keyOf(name.text));
        if (pair && splitMode === 'exact')
          return { ...base, exactMinor: toMinor(pair.value, currency) };
        if (pair && splitMode === 'percent') return { ...base, percent: pair.value };
        if (bareShares && bareShares[index] !== undefined)
          return { ...base, percent: bareShares[index] };
        return base;
      });
      if (bareShares && bareShares.length !== participants.length) {
        note('percent_count_mismatch');
        splitMode = 'equal';
        participants = participants.map(({ percent: _percent, ...rest }) => rest);
      } else if (bareShares) note('percent_order_assumed');
      // The payer paid but is not in the split: say so rather than assume.
      if (!participants.some((p) => keyOf(p.name) === payerKey) && splitMode !== 'full_on')
        note('payer_not_in_split');
    }
  }
  if (splitMode === 'exact' && participants && statedTotal !== null) {
    const sum = participants.reduce((a, p) => a + (p.exactMinor ?? 0n), 0n);
    if (
      amountMinor !== null &&
      sum < amountMinor &&
      !participants.some((p) => keyOf(p.name) === payerKey)
    ) {
      participants = [
        ...participants,
        payerIsMe
          ? { kind: 'me', name: 'me', status: 'me', exactMinor: amountMinor - sum }
          : {
              kind: 'member',
              name: payerName,
              status: 'unresolved',
              exactMinor: amountMinor - sum,
            },
      ];
      note('payer_gets_remainder');
    } else if (amountMinor !== null && sum !== amountMinor) note('exact_sum_mismatch');
  }

  let payer: VoicePayer = payerIsMe
    ? { kind: 'me', name: 'me', status: 'me', explicit: payerExplicit }
    : { kind: 'member', name: payerName, status: 'unresolved', explicit: payerExplicit };

  // Group status
  let groupSource: VoiceIntent['groupSource'] = 'none';
  let targetGroupId: string | undefined;
  if (groupHint) {
    if (groupHint.status === 'resolved') {
      groupSource = 'named';
      targetGroupId = groupHint.groupId;
    } else groupSource = groupHint.status === 'ambiguous' ? 'ambiguous' : 'unresolved';
  } else if (ctx.currentGroupId) {
    groupSource = 'current';
    targetGroupId = ctx.currentGroupId;
  }
  if (groupHint && groupHint.status === 'unresolved' && groups.length === 0)
    note('group_unchecked');

  const remainder = tok
    .map((t, i) => (used[i] ? '' : t))
    .filter(Boolean)
    .join(' ')
    .concat(remainderExtra)
    .trim();

  let intent: VoiceIntent = {
    transcript,
    amountMinor,
    ...(currency ? { currency } : {}),
    ...(description ? { description } : {}),
    ...(category ? { category } : {}),
    ...(date ? { date } : {}),
    ...(items ? { items } : {}),
    payer,
    ...(groupHint ? { groupHint } : {}),
    groupSource,
    ...(targetGroupId ? { targetGroupId } : {}),
    ...(participants ? { participants } : {}),
    everyone: everyone && !participants,
    splitMode,
    ...(splitCount !== undefined ? { splitCount } : {}),
    remainder,
    notes,
    hasSocialDetail:
      (payerExplicit && !payerIsMe) || participants !== undefined || splitMode !== 'equal',
  };
  if (memberMode) intent = resolveIntentPeople(intent, members);
  payer = intent.payer;
  return intent;
}

/**
 * Match the payer's and participants' spoken names against a group's members.
 * Run again whenever the group changes — the same words mean different people in
 * different groups.
 */
export function resolveIntentPeople(
  intent: VoiceIntent,
  members: readonly VoiceNameCandidate[],
): VoiceIntent {
  const notes = [...intent.notes];
  const note = (code: string): void => {
    if (!notes.includes(code)) notes.push(code);
  };

  const resolve = <T extends VoiceParty>(party: T): T => {
    if (party.kind === 'me' && party.status === 'me') {
      const me = members.find((m) => m.isMe);
      return me ? { ...party, memberId: me.id } : party;
    }
    const result = resolveSpokenName(party.name, members);
    if (result.status === 'me') {
      const me = members.find((m) => m.isMe);
      return { ...party, kind: 'me', name: 'me', status: 'me', ...(me ? { memberId: me.id } : {}) };
    }
    if (result.status === 'resolved') {
      if (result.fuzzy) note(`name_fuzzy:${party.name}->${result.name}`);
      return {
        ...party,
        kind: 'member',
        name: result.name,
        memberId: result.id,
        status: 'resolved',
        fuzzy: result.fuzzy,
        candidates: undefined,
      };
    }
    if (result.status === 'ambiguous') {
      note(`name_ambiguous:${party.name}`);
      return { ...party, status: 'ambiguous', candidates: result.candidates, memberId: undefined };
    }
    note(`name_unresolved:${party.name}`);
    return { ...party, status: 'unresolved', memberId: undefined, candidates: undefined };
  };

  const payer = resolve(intent.payer);
  let participants = intent.participants?.map(resolve);
  // The payer named as a member and the speaker's own row are one person.
  if (participants) {
    const seen = new Set<string>();
    participants = participants.filter((p) => {
      const key = p.memberId ?? `name:${p.name.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  const dropNote = (code: string): boolean => !code.startsWith('payer_not_in_split');
  const kept = notes.filter(dropNote);
  if (
    participants &&
    intent.splitMode !== 'full_on' &&
    !participants.some(
      (p) =>
        (payer.memberId && p.memberId === payer.memberId) ||
        (!payer.memberId && p.name === payer.name),
    )
  )
    kept.push('payer_not_in_split');
  return { ...intent, payer, ...(participants ? { participants } : {}), notes: kept };
}
