/**
 * Spoken amounts: which number in a sentence is the money, what it means, and
 * whether the screen has to ask.
 *
 * A transcript carries several numbers and only some of them are money. "500
 * each for 3 people on the 5th, flight 302 at 7" has one amount (500, and it is
 * per person), one count (3), and three numbers that are nothing to do with the
 * bill. This module is the one place that tells them apart, and the one place
 * that knows when a reading is a coin toss:
 *
 * - `decimal-or-hundreds` — "one fifty" is ₹150 to an Indian speaker and $1.50
 *   to an American one. With no currency or group to lean on, both are kept.
 * - `teen-vs-ty` — the recogniser's own alternatives disagree ("fifteen" and
 *   "fifty", "one fifty" and "ten fifty"). Only raised when they really do.
 * - `total-or-each` — "500 each" with nobody counted yet.
 * - `currency` — a bare "dollars" with no dollar group to say which.
 *
 * It also folds the spoken forms the English number reader never knew: Hindi,
 * Tamil and Arabic number words as people say them in Latin letters ("do hazaar
 * paanch sau", "rendu aayiram", "khamsa mia"), the Hindi fractions ("dedh sau",
 * "dhai hazaar", "saade teen sau") and a self-correction ("fifteen, sorry,
 * fifty").
 *
 * Money stays exact: every value is carried as a decimal string or scaled
 * bigint, and minor units come from {@link decimalToMinor}, never from
 * multiplying a float. Pure — no clock, no network, no locale lookup.
 */

import { isCurrencyCode, minorUnitExponent } from '../money/currency';

export type VoiceAmountRole = 'total' | 'each' | 'count' | 'percent' | 'date-ish' | 'quantity';

export type VoiceAmountAmbiguity =
  'none' | 'decimal-or-hundreds' | 'teen-vs-ty' | 'total-or-each' | 'currency';

/** Why a number that is not money was set aside. */
export type VoiceAmountDetail = 'time' | 'date' | 'identifier' | 'unit' | 'split' | 'party';

export interface VoiceAmountSpan {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  /** The value as an exact decimal string ("1500", "20.05"). */
  readonly value: string;
  readonly role: VoiceAmountRole;
  readonly detail?: VoiceAmountDetail;
  /** A currency word or symbol sits right against it. */
  readonly currencyAdjacent: boolean;
}

/** One answer the screen can offer when the amount is in doubt. */
export interface VoiceAmountOption {
  /** Minor units, in the expense's currency. For `each`, the per-person amount. */
  readonly minor: bigint;
  readonly role: 'total' | 'each';
}

export interface VoiceAmountReading {
  readonly spans: readonly VoiceAmountSpan[];
  /** What the chosen amount is: the whole bill, or one person's share. */
  readonly role: 'total' | 'each' | null;
  readonly totalMinor: bigint | null;
  readonly eachMinor: bigint | null;
  /** How many people the bill is for, when the sentence said. */
  readonly count: number | null;
  readonly ambiguity: VoiceAmountAmbiguity;
  /** The choices for an amount ambiguity, the current reading first. Empty otherwise. */
  readonly options: readonly VoiceAmountOption[];
  /** The currencies to choose between, when the currency itself is in doubt. */
  readonly currencyOptions: readonly string[];
}

/* ───────────────────────────── exact money ───────────────────────────── */

function exponentOf(currency: string | null | undefined): number {
  return currency && isCurrencyCode(currency) ? minorUnitExponent(currency) : 2;
}

/**
 * A decimal string to minor units, exactly: "20.05" → 2005n in a two-decimal
 * currency, "3000" → 3000n in yen. Extra places round half up. Null when the
 * text is not a plain non-negative decimal.
 */
export function decimalToMinor(value: string, currency: string | null | undefined): bigint | null {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value.replace(/,/g, '').trim());
  if (!match) return null;
  const exponent = exponentOf(currency);
  const fraction = match[2] ?? '';
  const kept = fraction.slice(0, exponent).padEnd(exponent, '0');
  let minor = BigInt(match[1] ?? '0') * 10n ** BigInt(exponent) + (kept ? BigInt(kept) : 0n);
  if (fraction.length > exponent && Number(fraction[exponent]) >= 5) minor += 1n;
  return minor;
}

/**
 * A parsed major amount to minor units through its shortest decimal spelling,
 * so 20.05 is 2005 and never 2004.9999. The parser's numbers all come from
 * decimal text, which this round-trips exactly.
 */
export function majorToMinor(major: number, currency: string | null | undefined): bigint {
  let text = String(major);
  if (/e/i.test(text)) text = major.toFixed(12).replace(/\.?0+$/, '');
  return decimalToMinor(text, currency) ?? 0n;
}

/** Minor units back to a plain major decimal string ("2005" → "20.05"). */
export function minorToDecimal(minor: bigint, currency: string | null | undefined): string {
  const exponent = exponentOf(currency);
  if (exponent === 0) return minor.toString();
  const scale = 10n ** BigInt(exponent);
  const whole = minor / scale;
  const rest = minor % scale;
  if (rest === 0n) return whole.toString();
  return `${whole}.${rest.toString().padStart(exponent, '0').replace(/0+$/, '')}`;
}

/* ───────────────────────────── vocabulary ───────────────────────────── */

const ENGLISH_UNITS: readonly (readonly [string, number])[] = [
  ['zero', 0],
  ['one', 1],
  ['two', 2],
  ['three', 3],
  ['four', 4],
  ['five', 5],
  ['six', 6],
  ['seven', 7],
  ['eight', 8],
  ['nine', 9],
  ['ten', 10],
  ['eleven', 11],
  ['twelve', 12],
  ['thirteen', 13],
  ['fourteen', 14],
  ['fifteen', 15],
  ['sixteen', 16],
  ['seventeen', 17],
  ['eighteen', 18],
  ['nineteen', 19],
  ['twenty', 20],
  ['thirty', 30],
  ['forty', 40],
  ['fourty', 40],
  ['fifty', 50],
  ['sixty', 60],
  ['seventy', 70],
  ['eighty', 80],
  ['ninety', 90],
];

/**
 * Number words as Hindi, Tamil and Arabic speakers say them, in the Latin
 * spellings recognisers hand back. Hindi "saath" (60) is left out on purpose:
 * it is also "with" ("Ravi ke saath"), and a person is worth more than a
 * sixty. The Devanagari fractions are here too, since the localized-word table
 * upstream only knows whole numbers.
 */
const REGIONAL_UNITS: readonly (readonly [string, number])[] = [
  // Hindi / Hinglish
  ['ek', 1],
  ['do', 2],
  ['teen', 3],
  ['tin', 3],
  ['char', 4],
  ['chaar', 4],
  ['paanch', 5],
  ['panch', 5],
  ['paach', 5],
  ['panj', 5],
  ['chhe', 6],
  ['chhah', 6],
  ['chah', 6],
  ['chhey', 6],
  ['saat', 7],
  ['aath', 8],
  ['nau', 9],
  ['das', 10],
  ['dus', 10],
  ['gyarah', 11],
  ['gyaarah', 11],
  ['barah', 12],
  ['baarah', 12],
  ['terah', 13],
  ['chaudah', 14],
  ['pandrah', 15],
  ['pandra', 15],
  ['solah', 16],
  ['satrah', 17],
  ['atharah', 18],
  ['athaarah', 18],
  ['unnees', 19],
  ['unnis', 19],
  ['bees', 20],
  ['bis', 20],
  ['ikkees', 21],
  ['baees', 22],
  ['bais', 22],
  ['teis', 23],
  ['chaubees', 24],
  ['pachees', 25],
  ['pachchees', 25],
  ['pachis', 25],
  ['chhabbees', 26],
  ['tees', 30],
  ['tis', 30],
  ['paintees', 35],
  ['chalees', 40],
  ['chaalis', 40],
  ['chalis', 40],
  ['pachaas', 50],
  ['pachas', 50],
  ['pachpan', 55],
  ['sattar', 70],
  ['pachattar', 75],
  ['assi', 80],
  ['nabbe', 90],
  ['nabbey', 90],
  // Tamil
  ['onnu', 1],
  ['ondru', 1],
  ['oru', 1],
  ['rendu', 2],
  ['randu', 2],
  ['irandu', 2],
  ['erandu', 2],
  ['moonu', 3],
  ['moondru', 3],
  ['munu', 3],
  ['naalu', 4],
  ['naangu', 4],
  ['nalu', 4],
  ['anju', 5],
  ['aindhu', 5],
  ['ainthu', 5],
  ['aaru', 6],
  ['ezhu', 7],
  ['elu', 7],
  ['ettu', 8],
  ['ombodhu', 9],
  ['onbadhu', 9],
  ['onbathu', 9],
  ['pathu', 10],
  ['patthu', 10],
  ['irubadhu', 20],
  ['irupathu', 20],
  ['iruvathu', 20],
  ['muppadhu', 30],
  ['muppathu', 30],
  ['naarpadhu', 40],
  ['narpathu', 40],
  ['aimbadhu', 50],
  ['aimbathu', 50],
  ['ambadhu', 50],
  ['ambathu', 50],
  ['aruvadhu', 60],
  ['arubathu', 60],
  ['ezhubadhu', 70],
  ['elubathu', 70],
  ['enbadhu', 80],
  ['enbathu', 80],
  ['thonnooru', 90],
  ['thonnuru', 90],
  // Arabic (Gulf and Levantine spellings)
  ['wahid', 1],
  ['wahed', 1],
  ['ithnain', 2],
  ['itnain', 2],
  ['ithnan', 2],
  ['itnen', 2],
  ['thalatha', 3],
  ['talata', 3],
  ['thalath', 3],
  ['talat', 3],
  ['tlata', 3],
  ['arba', 4],
  ['arbaa', 4],
  ['arbaah', 4],
  ['khamsa', 5],
  ['khamsah', 5],
  ['khams', 5],
  ['hamsa', 5],
  ['sitta', 6],
  ['sittah', 6],
  ['sabaa', 7],
  ['saba', 7],
  ['thamania', 8],
  ['thamanya', 8],
  ['tamanya', 8],
  ['thamaniya', 8],
  ['tisaa', 9],
  ['tisa', 9],
  ['ashara', 10],
  ['ashra', 10],
  ['ishreen', 20],
  ['eshreen', 20],
  ['ishrin', 20],
  ['thalatheen', 30],
  ['talateen', 30],
  ['arbaeen', 40],
  ['arbain', 40],
  ['khamseen', 50],
  ['khamsin', 50],
  ['sitteen', 60],
  ['sabaeen', 70],
  ['thamaneen', 80],
  ['tisaeen', 90],
];

interface Multiplier {
  readonly factor: bigint;
  /** Closes a chunk ("two thousand five hundred"). */
  readonly group: boolean;
  /** Only a multiplier with a number in front of it ("mia" is also a name). */
  readonly needsCount?: boolean;
}

const ENGLISH_MULTIPLIERS: readonly (readonly [string, Multiplier])[] = [
  ['hundred', { factor: 100n, group: false }],
  ['thousand', { factor: 1_000n, group: true }],
  ['lakh', { factor: 100_000n, group: true }],
  ['lakhs', { factor: 100_000n, group: true }],
  ['lac', { factor: 100_000n, group: true }],
  ['lacs', { factor: 100_000n, group: true }],
  ['crore', { factor: 10_000_000n, group: true }],
  ['crores', { factor: 10_000_000n, group: true }],
  ['million', { factor: 1_000_000n, group: true }],
  ['billion', { factor: 1_000_000_000n, group: true }],
];

const REGIONAL_MULTIPLIERS: readonly (readonly [string, Multiplier])[] = [
  // Hindi
  ['sau', { factor: 100n, group: false }],
  ['hazaar', { factor: 1_000n, group: true }],
  ['hazar', { factor: 1_000n, group: true }],
  ['hajar', { factor: 1_000n, group: true }],
  ['hajaar', { factor: 1_000n, group: true }],
  ['hazzar', { factor: 1_000n, group: true }],
  ['हज़ार', { factor: 1_000n, group: true }],
  ['हज़ार', { factor: 1_000n, group: true }],
  ['laakh', { factor: 100_000n, group: true }],
  ['karod', { factor: 10_000_000n, group: true }],
  ['karor', { factor: 10_000_000n, group: true }],
  ['karodh', { factor: 10_000_000n, group: true }],
  // Tamil
  ['nooru', { factor: 100n, group: false }],
  ['nuru', { factor: 100n, group: false }],
  ['aayiram', { factor: 1_000n, group: true }],
  ['ayiram', { factor: 1_000n, group: true }],
  ['aayram', { factor: 1_000n, group: true }],
  ['latcham', { factor: 100_000n, group: true }],
  ['laksham', { factor: 100_000n, group: true }],
  ['latsam', { factor: 100_000n, group: true }],
  ['kodi', { factor: 10_000_000n, group: true, needsCount: true }],
  // Arabic
  ['mia', { factor: 100n, group: false, needsCount: true }],
  ['miya', { factor: 100n, group: false, needsCount: true }],
  ['meya', { factor: 100n, group: false, needsCount: true }],
  ['miyya', { factor: 100n, group: false, needsCount: true }],
  ['mieh', { factor: 100n, group: false, needsCount: true }],
  ['alf', { factor: 1_000n, group: true }],
  ['alaf', { factor: 1_000n, group: true }],
  ['aalaf', { factor: 1_000n, group: true }],
  ['alaaf', { factor: 1_000n, group: true }],
  ['malyoon', { factor: 1_000_000n, group: true }],
  ['milyon', { factor: 1_000_000n, group: true }],
];

/** Words that are a whole number on their own: duals and fused compounds. */
const COMPOUNDS: ReadonlyMap<string, { value: bigint; group: boolean }> = nfcKeys([
  // Arabic duals
  ['alfain', { value: 2_000n, group: true }],
  ['alfein', { value: 2_000n, group: true }],
  ['alfayn', { value: 2_000n, group: true }],
  ['alfeen', { value: 2_000n, group: true }],
  ['mitain', { value: 200n, group: false }],
  ['miteen', { value: 200n, group: false }],
  ['mitein', { value: 200n, group: false }],
  ['meetain', { value: 200n, group: false }],
  // Tamil fused hundreds and thousands
  ['irunooru', { value: 200n, group: false }],
  ['munnooru', { value: 300n, group: false }],
  ['naanooru', { value: 400n, group: false }],
  ['ainooru', { value: 500n, group: false }],
  ['ainnooru', { value: 500n, group: false }],
  ['aynooru', { value: 500n, group: false }],
  ['anjunooru', { value: 500n, group: false }],
  ['arunooru', { value: 600n, group: false }],
  ['ezhunooru', { value: 700n, group: false }],
  ['ennooru', { value: 800n, group: false }],
  ['tholaayiram', { value: 900n, group: false }],
  ['rendaayiram', { value: 2_000n, group: true }],
  ['moonaayiram', { value: 3_000n, group: true }],
  ['naalaayiram', { value: 4_000n, group: true }],
  ['anjaayiram', { value: 5_000n, group: true }],
  ['pathaayiram', { value: 10_000n, group: true }],
]);

/** Hindi fractions: dedh (1½), dhai (2½), and the ones that shift the next number. */
const FRACTIONS: ReadonlyMap<string, { kind: 'value' | 'shift'; quarters: bigint }> = nfcKeys([
  ['dedh', { kind: 'value', quarters: 6n }],
  ['derh', { kind: 'value', quarters: 6n }],
  ['डेढ़', { kind: 'value', quarters: 6n }],
  ['डेढ़', { kind: 'value', quarters: 6n }],
  ['डेढ', { kind: 'value', quarters: 6n }],
  ['dhai', { kind: 'value', quarters: 10n }],
  ['dhaai', { kind: 'value', quarters: 10n }],
  ['adhai', { kind: 'value', quarters: 10n }],
  ['adhaai', { kind: 'value', quarters: 10n }],
  ['ढाई', { kind: 'value', quarters: 10n }],
  ['saade', { kind: 'shift', quarters: 2n }],
  ['sade', { kind: 'shift', quarters: 2n }],
  ['saadhe', { kind: 'shift', quarters: 2n }],
  ['sadhe', { kind: 'shift', quarters: 2n }],
  ['साढ़े', { kind: 'shift', quarters: 2n }],
  ['साढ़े', { kind: 'shift', quarters: 2n }],
  ['साढे', { kind: 'shift', quarters: 2n }],
  ['sava', { kind: 'shift', quarters: 1n }],
  ['savva', { kind: 'shift', quarters: 1n }],
  ['sawa', { kind: 'shift', quarters: 1n }],
  ['सवा', { kind: 'shift', quarters: 1n }],
  ['paune', { kind: 'shift', quarters: -1n }],
  ['pone', { kind: 'shift', quarters: -1n }],
  ['पौने', { kind: 'shift', quarters: -1n }],
]);

const POINT_WORDS = new Set(['point', 'dot', 'decimal']);
const CONNECTORS = new Set(['and', 'aur', 'wa', 'w']);

/** Lookup keys in one Unicode form, so a Devanagari nukta matches however it was typed. */
function nfcKeys<V>(entries: Iterable<readonly [string, V]>): Map<string, V> {
  return new Map([...entries].map(([key, value]) => [key.normalize('NFC'), value] as const));
}

const UNIT_VALUES = nfcKeys<number>([...ENGLISH_UNITS, ...REGIONAL_UNITS]);
const MULTIPLIERS = nfcKeys<Multiplier>([...ENGLISH_MULTIPLIERS, ...REGIONAL_MULTIPLIERS]);
const REGIONAL_WORDS = new Set<string>([
  ...REGIONAL_UNITS.map(([word]) => word.normalize('NFC')),
  ...REGIONAL_MULTIPLIERS.map(([word]) => word.normalize('NFC')),
  ...COMPOUNDS.keys(),
  ...FRACTIONS.keys(),
]);

/**
 * Regional words that are also everyday English (or a name), so they are only
 * read as a number with a currency beside them or a multiplier after them.
 */
const RISKY_ALONE = new Set([
  'do',
  'teen',
  'tin',
  'char',
  'das',
  'dus',
  'bis',
  'tis',
  'oru',
  'ek',
  'nau',
  'saba',
  'aaru',
  'ettu',
  'pathu',
  'elu',
  'khams',
  'arba',
  'talat',
  'sade',
  'pone',
  'sawa',
  'mia',
]);

/* ───────────────────────────── evaluation ───────────────────────────── */

/** Values are carried scaled by a million so halves, quarters and decimals stay exact. */
const SCALE = 1_000_000n;

function scaledFromDigits(token: string): bigint | null {
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(token.replace(/,/g, ''));
  if (!match) return null;
  return BigInt(match[1] ?? '0') * SCALE + BigInt((match[2] ?? '').padEnd(6, '0') || '0');
}

function scaledToDecimal(value: bigint): string {
  const whole = value / SCALE;
  const rest = value % SCALE;
  if (rest === 0n) return whole.toString();
  return `${whole}.${rest.toString().padStart(6, '0').replace(/0+$/, '')}`;
}

/** The token list of a spoken number, normalised for lookup. */
function numberTokens(run: string): string[] {
  return run
    .normalize('NFC')
    .toLowerCase()
    .split(/[\s\-–]+/u)
    .map((token) => token.replace(/^[,.]+|[,.]+$/g, ''))
    .filter((token) => token.length > 0);
}

/**
 * The value of one spoken number, as an exact decimal string — English,
 * Indian and the regional words above, mixed freely, with digits allowed
 * ("2 hazaar"). Null when the words do not make a number.
 *
 *   "do hazaar paanch sau" → "2500"     "saade teen sau" → "350"
 *   "one point five lakh"  → "150000"   "khamsa mia"     → "500"
 */
export function spokenNumberValue(run: string): string | null {
  let total = 0n;
  let current = 0n;
  let seen = false;
  let fraction: string | null = null;
  let shift: bigint | null = null;

  for (const token of numberTokens(run)) {
    if (CONNECTORS.has(token)) continue;
    if (POINT_WORDS.has(token)) {
      if (fraction !== null) return null;
      total += current;
      current = 0n;
      fraction = '';
      continue;
    }

    const multiplier = MULTIPLIERS.get(token);
    if (fraction !== null) {
      if (/^\d+$/.test(token)) {
        fraction += token;
        continue;
      }
      const digit = UNIT_VALUES.get(token);
      if (digit !== undefined && digit <= 9) {
        fraction += String(digit);
        continue;
      }
      if (multiplier && fraction.length > 0 && fraction.length <= 6) {
        // "one point five lakh": the decimal scales with the word after it.
        const base = total + current + BigInt(fraction.padEnd(6, '0'));
        total = base * multiplier.factor;
        current = 0n;
        fraction = null;
        seen = true;
        continue;
      }
      return null;
    }

    const digits = scaledFromDigits(token);
    if (digits !== null) {
      current += digits;
      seen = true;
      continue;
    }
    const fractionWord = FRACTIONS.get(token);
    if (fractionWord) {
      if (fractionWord.kind === 'value') {
        current += (fractionWord.quarters * SCALE) / 4n;
        seen = true;
      } else {
        shift = (fractionWord.quarters * SCALE) / 4n;
      }
      continue;
    }
    const unit = UNIT_VALUES.get(token);
    if (unit !== undefined) {
      current += BigInt(unit) * SCALE + (shift ?? 0n);
      shift = null;
      seen = true;
      continue;
    }
    const compound = COMPOUNDS.get(token);
    if (compound) {
      if (compound.group) {
        total += current + compound.value * SCALE;
        current = 0n;
      } else current += compound.value * SCALE;
      seen = true;
      continue;
    }
    if (multiplier) {
      // "sava sau" is 125, "paune sau" 75: a shift with no number is on one.
      const base = current === 0n ? SCALE + (shift ?? 0n) : current;
      shift = null;
      if (multiplier.group) {
        total += base * multiplier.factor;
        current = 0n;
      } else current = base * multiplier.factor;
      seen = true;
      continue;
    }
    return null;
  }

  if (fraction) total += BigInt(fraction.slice(0, 6).padEnd(6, '0'));
  const value = total + current;
  return seen && value > 0n ? scaledToDecimal(value) : null;
}

/* ───────────────────────────── folding ───────────────────────────── */

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const ALL_NUMBER_WORDS = [
  ...UNIT_VALUES.keys(),
  ...MULTIPLIERS.keys(),
  ...COMPOUNDS.keys(),
  ...FRACTIONS.keys(),
  ...POINT_WORDS,
]
  .sort((a, b) => b.length - a.length)
  .map(escapeRegExp)
  .join('|');

const NOT_WORD_BEFORE = String.raw`(?<![\p{L}\p{M}\p{N}])`;
const NOT_WORD_AFTER = String.raw`(?![\p{L}\p{M}\p{N}])`;
const NUMBER_TOKEN = `${NOT_WORD_BEFORE}(?:\\d[\\d,]*(?:\\.\\d+)?|(?:${ALL_NUMBER_WORDS}))${NOT_WORD_AFTER}`;
const NUMBER_JOIN = String.raw`(?:[\s\-–]+(?:(?:and|aur|wa|w)[\s\-–]+)?)`;
const NUMBER_RUN = `${NUMBER_TOKEN}(?:${NUMBER_JOIN}${NUMBER_TOKEN})*`;

/** A currency word (or symbol), in every spelling the folds below need to see. */
const CURRENCY_WORD = String.raw`(?:(?:us|u\.s\.|american|australian|aussie|canadian|singapore(?:an)?|new\s+zealand|hong\s+kong|sri\s+lankan|nepali|pakistani|saudi|emirati|uae)\s+)?(?:rupees?|rupaye|rupaiye|rupya|rupiya|rupaiya|rupai|roobai|rubai|rupay|rs\.?|inr|dollars?|bucks?|usd|aud|cad|sgd|nzd|hkd|euros?|eur|pounds?|quid|sterling|gbp|dirhams?|dirhem|derham|darahim|aed|riyals?|sar|yen|jpy|ringgit|baht|pesos?|francs?|takas?|naira|paise|paisa|cents?|pence|fils)`;
const CURRENCY_AFTER = new RegExp(`^\\s*${CURRENCY_WORD}(?![\\p{L}])`, 'iu');
const CURRENCY_BEFORE = new RegExp(
  String.raw`(?:[₹$€£¥₺₩₫฿₦₱₽]|(?<![\p{L}])(?:rs\.?|inr|usd|aud|aed|gbp|eur|rp|idr))\s*$`,
  'iu',
);

/** Spoken currency words outside the English table, brought to the word it knows. */
const REGIONAL_CURRENCY: readonly (readonly [RegExp, string])[] = [
  [
    /(?<![\p{L}])(?:rupiya|rupaiya|rupaiye|rupiye|rupai|roobai|roopai|rubai|rupay)(?![\p{L}])/giu,
    'rupees',
  ],
  [/(?<![\p{L}])(?:darahim|derham|drahim|dirhem)(?![\p{L}])/giu, 'dirhams'],
];

const FILLER_ONLY =
  /^[\s\p{P}\p{S}]*(?:(?:um+|uh+|er+|hmm+|ok|okay|so|just|only)[\s\p{P}\p{S}]*)*$/iu;

function isWholeUtterance(before: string, after: string): boolean {
  return FILLER_ONLY.test(before) && FILLER_ONLY.test(after);
}

/**
 * The spoken correction between two numbers: "fifteen, sorry, fifty", "500 no
 * wait 600", "do sau matlab teen sau". Only ever read when a number sits on
 * both sides of it, so "sorry I'm late" and "I actually paid" are untouched.
 */
const CORRECTION_MARKERS = [
  'sorry',
  'i\\s+mean',
  'i\\s+meant',
  'no\\s+wait',
  'no\\s+no',
  'no\\s+sorry',
  'wait',
  'no',
  'actually',
  'mera\\s+matlab',
  'matlab',
  'nahi\\s+nahi',
  'nahi',
  'nahin',
  'correction',
  'make\\s+that',
  'make\\s+it',
  'or\\s+rather',
  'rather',
  'scratch\\s+that',
  'oops',
].join('|');

/** Markers strong enough to reach back over a short description ("400 for petrol, no wait, 450"). */
const STRONG_CORRECTION_MARKERS =
  'no\\s+wait|sorry|i\\s+mean|i\\s+meant|correction|scratch\\s+that';

const SELF_CORRECTION = new RegExp(
  `(${NUMBER_RUN})(\\s+${CURRENCY_WORD}(?![\\p{L}]))?` +
    // A short description between the number and a strong marker is the
    // first attempt's own: it is dropped with it.
    `(\\s+(?:for|on)\\s+[\\p{L}]+(?:\\s+[\\p{L}]+)?(?=[\\s,.;:!—–-]*(?:${STRONG_CORRECTION_MARKERS})(?![\\p{L}])))?` +
    `[\\s,.;:!—–-]*${NOT_WORD_BEFORE}(?:${CORRECTION_MARKERS})${NOT_WORD_AFTER}[\\s,.;:!—–-]*` +
    `(?:(?:it\\s+was|it['’]?s|it\\s+is|that['’]?s|make\\s+(?:it|that))\\s+)?(${NUMBER_RUN})`,
  'giu',
);

/** The corrected number, written as digits, with the currency the first one carried. */
export function applySpokenCorrections(text: string): string {
  return text.replace(
    SELF_CORRECTION,
    (
      match,
      _first: string,
      firstCurrency: string | undefined,
      firstNote: string | undefined,
      second: string,
      offset: number,
    ) => {
      const tokens = numberTokens(second);
      if (tokens.length === 1 && RISKY_ALONE.has(tokens[0] ?? '')) return match;
      const rest = text.slice(offset + match.length);
      const currency = firstCurrency && !CURRENCY_AFTER.test(rest) ? firstCurrency : '';
      // The first attempt's description stays when the correction says none.
      const note = firstNote && !/^\s*[\p{L}]/u.test(rest) ? firstNote : '';
      // "four fifty" is a price said the short way: leave it in words for the
      // price-idiom reader, which knows 450 from 4.50 by the currency.
      const [head, tail] = tokens.map((token) => UNIT_VALUES.get(token));
      if (tokens.length === 2 && head !== undefined && tail !== undefined && tail >= 10)
        return `${second}${currency}${note}`;
      const value = spokenNumberValue(second);
      if (value === null) return match;
      return `${value}${currency}${note}`;
    },
  );
}

const RUN_RE = new RegExp(NUMBER_RUN, 'giu');

/**
 * Regional number words to digits, when the sentence says they are an amount:
 * a multiplier in the run ("paanch sau"), a currency beside it ("pachaas
 * rupaye"), a Hindi fraction ("dedh sau"), or nothing else said at all
 * ("aimbadhu"). Runs that are plain English or digits are left for the English
 * reader, which already has its own rules about context.
 */
function foldRegionalRuns(text: string): string {
  return text.replace(RUN_RE, (run: string, offset: number, whole: string) => {
    const tokens = numberTokens(run);
    if (!tokens.some((token) => REGIONAL_WORDS.has(token))) return run;
    const before = whole.slice(0, offset);
    const after = whole.slice(offset + run.length);
    const currency = CURRENCY_AFTER.test(after) || CURRENCY_BEFORE.test(before);
    const alone = isWholeUtterance(before, after);
    if (tokens.length === 1 && RISKY_ALONE.has(tokens[0] ?? '') && !currency) return run;
    const hasMultiplier = tokens.some((token, index) => {
      const multiplier = MULTIPLIERS.get(token);
      if (multiplier) return !multiplier.needsCount || index > 0;
      return COMPOUNDS.has(token);
    });
    const hasFraction = tokens.some((token) => FRACTIONS.has(token));
    if (!hasMultiplier && !currency && !alone && !hasFraction) return run;
    return spokenNumberValue(run) ?? run;
  });
}

/**
 * Every spoken-amount fold this module owns, in order: regional currency
 * words, a self-correction, then regional number words. Safe to run twice.
 */
export function foldSpokenAmountWords(text: string): string {
  let folded = text.normalize('NFC');
  for (const [pattern, word] of REGIONAL_CURRENCY) folded = folded.replace(pattern, word);
  folded = folded.replace(HALF_OF, (_match, word: string) => {
    const multiplier = MULTIPLIERS.get(word.toLowerCase());
    return multiplier ? scaledToDecimal((multiplier.factor * SCALE) / 2n) : _match;
  });
  return foldRegionalRuns(applySpokenCorrections(folded));
}

/** "half a lakh", "half a million": half of the scale word. */
const HALF_OF = /(?<![\p{L}])half\s+(?:a\s+|an\s+)?(lakh|lac|crore|million|thousand)(?![\p{L}])/giu;

/* ───────────────────────────── roles ───────────────────────────── */

const MONTH =
  'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';

const ORDINAL_AFTER = /^(?:st|nd|rd|th)(?![\p{L}])/iu;
const TIME_AFTER =
  /^\s*(?::\d|am(?![\p{L}])|pm(?![\p{L}])|a\.m|p\.m|o['’]?\s?clock|baje(?![\p{L}])|hrs(?![\p{L}])|hours?\s+(?:sharp|later)|in\s+the\s+(?:morning|evening|afternoon|night))/iu;
const TIME_BEFORE = /(?<![\p{L}])(?:at|by|around|till|until|before|after|since)\s*$/iu;
const DATE_AFTER = new RegExp(
  `^\\s*(?:(?:st|nd|rd|th)\\s+)?(?:of\\s+)?(?:${MONTH})(?![\\p{L}])|^\\s*(?:days?|weeks?|months?|years?)\\s+(?:ago|back|before)`,
  'iu',
);
const DATE_BEFORE = new RegExp(`(?<![\\p{L}])(?:${MONTH})\\.?\\s*$`, 'iu');
const YEAR_BEFORE = /(?<![\p{L}])(?:in|since|year|of|till|until|from)\s*$/iu;
/** A label that is always a label: "flight 302", "flight 6E 204", "gate 4", "PNR 4521". */
const IDENTIFIER_BEFORE =
  /(?<![\p{L}])(?:flight(?:\s+(?:is|was|no\.?|number))?(?:\s+[a-z\d]{1,3}(?=\s))?|gate|seat|platform|terminal|pnr|coach|berth|pin|otp|code|ext|extension|chapter|episode|page|version|channel|number|num|no\.?|(?:order|invoice|bill|bus|train|room|table|ticket)\s+(?:no\.?|number|#))\s*#?\s*$|#\s*$/iu;
/** A label only while it is small: "room 204" is a room, "room 4500" is the rent. */
const SMALL_IDENTIFIER_BEFORE =
  /(?<![\p{L}])(?:room|table|floor|flat|apt|apartment|house|door|row|route|bay|block|sector|level|plot|ward|suite)\s*$/iu;
const SPLIT_AFTER = /^\s*(?:people|persons?|ppl|ways?|folks?|heads?)(?![\p{L}])/iu;
const SPLIT_BEFORE = /(?<![\p{L}])(?:among|amongst|between)\s*$/iu;
const PARTY_AFTER =
  /^\s*(?:of\s+us|pax|friends?|guests?|members?|adults?|kids?|children|couples?)(?![\p{L}])/iu;
const PARTY_BEFORE = /(?<![\p{L}])(?:table\s+for|party\s+of|group\s+of|we\s+were|we\s+are)\s*$/iu;
const PERCENT_AFTER = /^\s*(?:%|percent(?![\p{L}])|per\s*cent(?![\p{L}]))/iu;
/**
 * A unit of measure, time or a counted thing that is never priced by its own
 * number. Food and drink nouns are left out on purpose: "10 tea" and "5 snacks"
 * are prices the way people here say them, not counts.
 */
const UNIT_AFTER =
  /^\s*(?:x(?![\p{L}])|kgs?|kilos?|kilograms?|g(?![\p{L}])|gms?|grams?|kms?|kilomet(?:er|re)s?|miles?|ml|litres?|liters?|ltrs?|items?|pieces?|pcs|tickets|nights?|hours?|hrs?|minutes?|mins?|seconds?|secs?|days?|weeks?|months?|years?|yrs?|units?|times|rounds?|dozens?|stars?|floors?|rooms|steps?|seats|beds|bhk|gb|mb|inch(?:es)?|feet|ft|cm|mm|pages?|copies)(?![\p{L}])/iu;
const EACH_AFTER = new RegExp(
  `^\\s*(?:${CURRENCY_WORD}\\s+)?(?:each(?:\\s+person)?|apiece|per\\s+(?:person|head|plate|pax|ticket|piece|item|each)|a\\s+(?:head|person|piece|plate)|for\\s+each(?:\\s+(?:person|of\\s+us))?)(?![\\p{L}])`,
  'iu',
);
const EACH_BEFORE =
  /(?<![\p{L}])(?:each(?:\s+of\s+us)?|per\s+(?:person|head))\s+(?:paid|spent|pay|owes?|gave|chipped\s+in|put\s+in)\s*(?:[₹$€£]|rs\.?)?\s*$/iu;

const MASK_BASE = 0xe000;
const MASKED_DIGIT = '\\uE000-\\uE009';

/** A written number, its optional ordinal, and the clock form "7:30". */
const NUMBER_SPAN = new RegExp(
  `(?<![\\p{L}\\p{N}${MASKED_DIGIT}])(?<![\\p{N}][.,])(\\d{4}-\\d{1,2}-\\d{1,2}|\\d{1,2}/\\d{1,2}(?:/\\d{2,4})?|\\d{1,2}:\\d{2}|\\d[\\d,]*(?:\\.\\d+)?)(?![\\p{N}])`,
  'gu',
);

function numericValue(raw: string): string {
  const cleaned = raw.replace(/,/g, '');
  return /^\d+(?:\.\d+)?$/.test(cleaned) ? cleaned.replace(/^0+(?=\d)/, '') : cleaned;
}

function classify(
  raw: string,
  before: string,
  after: string,
): { role: VoiceAmountRole; detail?: VoiceAmountDetail; currencyAdjacent: boolean } {
  if (/[-/:]/.test(raw)) {
    return {
      role: 'date-ish',
      detail: raw.includes(':') ? 'time' : 'date',
      currencyAdjacent: false,
    };
  }
  const currencyAdjacent = CURRENCY_AFTER.test(after) || CURRENCY_BEFORE.test(before);
  const value = Number(raw.replace(/,/g, ''));
  const small = Number.isInteger(value) && value <= 31 && !raw.includes(',');

  if (ORDINAL_AFTER.test(after)) return { role: 'date-ish', detail: 'date', currencyAdjacent };
  if (PERCENT_AFTER.test(after)) return { role: 'percent', currencyAdjacent };
  if (currencyAdjacent) {
    const each = EACH_AFTER.test(after) || EACH_BEFORE.test(before);
    return { role: each ? 'each' : 'total', currencyAdjacent };
  }
  if (TIME_AFTER.test(after)) return { role: 'date-ish', detail: 'time', currencyAdjacent };
  if (small && DATE_AFTER.test(after))
    return { role: 'date-ish', detail: 'date', currencyAdjacent };
  if ((small || /^(?:19|20)\d\d$/.test(raw)) && DATE_BEFORE.test(before))
    return { role: 'date-ish', detail: 'date', currencyAdjacent };
  if (/^(?:19|20)\d\d$/.test(raw) && YEAR_BEFORE.test(before))
    return { role: 'date-ish', detail: 'date', currencyAdjacent };
  if (/^(?:days?|weeks?|months?|years?)\s+(?:ago|back)/iu.test(after.trim()))
    return { role: 'date-ish', detail: 'date', currencyAdjacent };
  if (Number.isInteger(value) && value <= 24 && TIME_BEFORE.test(before))
    return { role: 'date-ish', detail: 'time', currencyAdjacent };
  // A room or flat number is rarely round; a rent or a fare usually is.
  const labelLike = value < 1000 || (value < 10000 && value % 50 !== 0);
  if (
    !raw.includes(',') &&
    Number.isInteger(value) &&
    (IDENTIFIER_BEFORE.test(before) || (labelLike && SMALL_IDENTIFIER_BEFORE.test(before)))
  )
    return { role: 'quantity', detail: 'identifier', currencyAdjacent };
  if (SPLIT_AFTER.test(after) || (SPLIT_BEFORE.test(before) && Number.isInteger(value)))
    return { role: 'count', detail: 'split', currencyAdjacent };
  if (PARTY_AFTER.test(after) || PARTY_BEFORE.test(before))
    return { role: 'count', detail: 'party', currencyAdjacent };
  if (UNIT_AFTER.test(after)) return { role: 'quantity', detail: 'unit', currencyAdjacent };
  if (EACH_AFTER.test(after) || EACH_BEFORE.test(before)) return { role: 'each', currencyAdjacent };
  return { role: 'total', currencyAdjacent };
}

/**
 * Every written number in a (digit-normalised) sentence, with what it is. The
 * money is `total` or `each`; the rest is a count, a percentage, a date or
 * time, or a quantity/label ("2 coffees", "flight 302").
 */
export function findAmountSpans(text: string): VoiceAmountSpan[] {
  const spans: VoiceAmountSpan[] = [];
  NUMBER_SPAN.lastIndex = 0;
  for (let match = NUMBER_SPAN.exec(text); match !== null; match = NUMBER_SPAN.exec(text)) {
    const raw = match[1] ?? '';
    const start = match.index;
    const end = start + raw.length;
    const before = text.slice(0, start);
    const after = text.slice(end);
    let { role, detail, currencyAdjacent } = classify(raw, before, after);
    const previous = spans[spans.length - 1];
    // "at 5 30": the minutes of a time said in two numbers.
    if (
      previous?.detail === 'time' &&
      !currencyAdjacent &&
      /^\s+$/.test(text.slice(previous.end, start)) &&
      /^[0-5]\d$/.test(raw)
    ) {
      role = 'date-ish';
      detail = 'time';
    }
    // "room 12 and 14": a number listed after a label is another label.
    if (
      previous?.detail === 'identifier' &&
      !currencyAdjacent &&
      /^\s*(?:,|and|&|or)\s*$/iu.test(text.slice(previous.end, start))
    ) {
      role = 'quantity';
      detail = 'identifier';
    }
    // "2 beers 600": a single digit naming how many of something, with the
    // price right after it, is a count of things — not a second expense.
    if (
      previous &&
      previous.role === 'total' &&
      !previous.currencyAdjacent &&
      /^[1-9]$/.test(previous.value) &&
      /^\s+(?:[\p{L}]+\s+)?[\p{L}]{2,}s\s+$/u.test(text.slice(previous.end, start)) &&
      (role === 'total' || role === 'each') &&
      Number(raw.replace(/,/g, '')) >= 10 * Number(previous.value)
    ) {
      spans[spans.length - 1] = { ...previous, role: 'quantity', detail: 'unit' };
    }
    spans.push({
      start,
      end,
      text: raw,
      value: numericValue(raw),
      role,
      ...(detail ? { detail } : {}),
      currencyAdjacent,
    });
  }
  return spans;
}

/** A number that is never the money and must not be read as it. */
function isMaskable(span: VoiceAmountSpan): boolean {
  if (span.role === 'date-ish' || span.role === 'quantity') return true;
  return span.role === 'count' && span.detail === 'party';
}

/**
 * The sentence with every non-money number (a date, a time, a label, a
 * quantity, a party size) hidden from digit-based readers. The digits become
 * private-use characters — not `\d`, not letters — so an amount pattern skips
 * them and a note drops them, exactly as it already drops amounts.
 */
export function maskNonMoneyNumbers(
  text: string,
  keep: (span: VoiceAmountSpan, after: string) => boolean = () => false,
): string {
  const spans = findAmountSpans(text).filter(
    (span) => isMaskable(span) && !keep(span, text.slice(span.end)),
  );
  if (spans.length === 0) return text;
  let out = '';
  let cursor = 0;
  for (const span of spans) {
    out += text.slice(cursor, span.start);
    out += span.text.replace(/\d/g, (digit) =>
      String.fromCharCode(MASK_BASE + digit.charCodeAt(0) - 48),
    );
    cursor = span.end;
  }
  return out + text.slice(cursor);
}

/**
 * "1500 split 3 ways, 500 each": the share restates the bill, so it is hidden
 * like any other non-money number and only the total is read as an expense.
 * A sentence with only a share ("500 each") keeps it.
 */
export function maskRestatedShares(text: string): string {
  const spans = findAmountSpans(text);
  const hasTotal = spans.some((span) => span.role === 'total');
  const shares = spans.filter((span) => span.role === 'each');
  if (!hasTotal || shares.length === 0) return text;
  let out = '';
  let cursor = 0;
  for (const span of shares) {
    out += text.slice(cursor, span.start);
    out += span.text.replace(/\d/g, (digit) =>
      String.fromCharCode(MASK_BASE + digit.charCodeAt(0) - 48),
    );
    cursor = span.end;
  }
  return out + text.slice(cursor);
}

/** Masked digits back to ASCII. */
export function unmaskDigits(text: string): string {
  return text.replace(/[-]/g, (char) => String.fromCharCode(48 + char.charCodeAt(0) - MASK_BASE));
}

/* ───────────────────────────── currency ───────────────────────────── */

/** The dollars a bare "dollars" could be, in the order the screen offers them. */
export const VOICE_DOLLAR_CHOICES: readonly string[] = ['USD', 'AUD'];

const DOLLAR_CURRENCIES = new Set(['USD', 'AUD', 'CAD', 'SGD', 'NZD', 'HKD']);

const BARE_DOLLAR = /\$|(?<![\p{L}])(?:dollars?|bucks?)(?![\p{L}])/iu;
const QUALIFIED_DOLLAR =
  /(?<![\p{L}])(?:us|u\.s\.?|american|australian|aussie|canadian|singapore(?:an)?|new\s+zealand|hong\s+kong|kiwi)\s+(?:dollars?|bucks?)|(?<![\p{L}])(?:usd|aud|cad|sgd|nzd|hkd)(?![\p{L}])|(?:us|a|au|c|s|nz|hk)\$/iu;

/**
 * Which dollars a sentence meant. A named one ("US dollars", "AUD", "A$")
 * stands; a bare "dollars", "bucks" or "$" takes the group's currency when the
 * group is in dollars, and otherwise needs asking. The phone's location is
 * never consulted: it says where someone is, not what they paid in.
 *
 * Null when the sentence has no bare dollar to resolve.
 */
export function resolveSpokenDollar(
  text: string,
  groupCurrency: string | null | undefined,
): { currency: string; options: readonly string[] } | null {
  if (!BARE_DOLLAR.test(text) || QUALIFIED_DOLLAR.test(text)) return null;
  if (groupCurrency && DOLLAR_CURRENCIES.has(groupCurrency))
    return { currency: groupCurrency, options: [] };
  return { currency: 'USD', options: VOICE_DOLLAR_CHOICES };
}

/** Currencies whose speakers say "twelve fifty" for 12.50, not 1250. */
const DECIMAL_SPOKEN = new Set(['USD', 'AUD', 'CAD', 'NZD', 'SGD', 'HKD', 'EUR', 'GBP']);

/* ───────────────────────────── the reading ───────────────────────────── */

export interface VoiceAmountContext {
  /** The expense's currency, for minor units. */
  readonly currency?: string | null;
  /** A currency the sentence named out loud (not one taken from a group). */
  readonly spokenCurrency?: string | null;
  /** The currency of the group the expense is going to, when known. */
  readonly groupCurrency?: string | null;
  /** People the bill is for, when known from elsewhere (named people, a count). */
  readonly count?: number | null;
  /** The minor amount the expense parser actually chose, when it chose one. */
  readonly chosenMinor?: bigint | null;
  /**
   * "three fifty" style pairs that were read as hundreds with nothing to say
   * so ({@link findAmbiguousPriceIdioms} on the sentence before folding).
   */
  readonly idioms?: readonly { readonly hundreds: string; readonly decimal: string }[];
  /** The amount each of the recogniser's alternative transcripts gave. */
  readonly alternativeMinors?: readonly (bigint | null)[];
  /** Currencies to choose between (from {@link resolveSpokenDollar}). */
  readonly currencyOptions?: readonly string[];
}

/**
 * The amount a sentence names, what it stands for, and whether the reader has
 * to be asked. `text` is the digit-normalised sentence (spoken numbers already
 * written as digits, the way the expense parser sees it).
 */
export function readVoiceAmounts(text: string, ctx: VoiceAmountContext = {}): VoiceAmountReading {
  const spans = findAmountSpans(text);
  const money = spans.filter((span) => span.role === 'total' || span.role === 'each');
  const chosen = money.find((span) => span.currencyAdjacent) ?? money[0];
  // A count that includes the speaker: "3 people", "among 3", "5 of us".
  const splitSpan = spans.find(
    (span) =>
      span.role === 'count' &&
      (span.detail === 'split' ||
        (span.detail === 'party' && /^\s*(?:of\s+us|pax)/iu.test(text.slice(span.end)))),
  );
  const spokenCount = splitSpan ? Number(splitSpan.value) : null;
  const count =
    ctx.count ?? (spokenCount !== null && Number.isInteger(spokenCount) ? spokenCount : null);
  const currency = ctx.currency ?? null;

  const spokenMinor = chosen ? decimalToMinor(chosen.value, currency) : null;
  const role: 'total' | 'each' | null = chosen ? (chosen.role === 'each' ? 'each' : 'total') : null;
  const baseMinor = ctx.chosenMinor ?? spokenMinor;

  let totalMinor: bigint | null = baseMinor;
  let eachMinor: bigint | null = null;
  if (role === 'each' && baseMinor !== null) {
    eachMinor = baseMinor;
    totalMinor = count !== null && count > 0 ? baseMinor * BigInt(count) : null;
  }

  let ambiguity: VoiceAmountAmbiguity = 'none';
  let options: VoiceAmountOption[] = [];
  const pick = baseMinor;

  // 1. The recogniser's own alternatives disagree on the number.
  const rivals = (ctx.alternativeMinors ?? []).filter(
    (minor): minor is bigint => minor !== null && minor > 0n && pick !== null && minor !== pick,
  );
  const [rival] = rivals;
  if (pick !== null && rival !== undefined) {
    ambiguity = 'teen-vs-ty';
    options = [
      { minor: pick, role: 'total' },
      { minor: rival, role: 'total' },
    ];
  }

  // 2. "one fifty" with nothing to say whether it is 150 or 1.50.
  if (ambiguity === 'none' && pick !== null && !ctx.spokenCurrency && role === 'total') {
    const hundredsSpoken = ctx.groupCurrency && !DECIMAL_SPOKEN.has(ctx.groupCurrency);
    if (!hundredsSpoken) {
      for (const idiom of ctx.idioms ?? []) {
        const hundreds = decimalToMinor(idiom.hundreds, currency);
        const decimal = decimalToMinor(idiom.decimal, currency);
        if (hundreds === pick && decimal !== null && decimal !== pick) {
          ambiguity = 'decimal-or-hundreds';
          options = [
            { minor: hundreds, role: 'total' },
            { minor: decimal, role: 'total' },
          ];
          break;
        }
      }
    }
  }

  // 3. "500 each" and nobody counted.
  if (ambiguity === 'none' && role === 'each' && totalMinor === null && eachMinor !== null) {
    ambiguity = 'total-or-each';
    options = [
      { minor: eachMinor, role: 'total' },
      { minor: eachMinor, role: 'each' },
    ];
  }

  const currencyOptions = ctx.currencyOptions ?? [];
  if (ambiguity === 'none' && currencyOptions.length > 1) ambiguity = 'currency';

  return {
    spans,
    role,
    totalMinor,
    eachMinor,
    count,
    ambiguity,
    options,
    currencyOptions,
  };
}

/**
 * True when nothing about the amount needs asking: no competing number, no
 * open currency. The fast path may only skip the review when this holds.
 */
export function isVoiceAmountClear(reading: VoiceAmountReading | null | undefined): boolean {
  if (!reading) return false;
  return (
    reading.ambiguity === 'none' &&
    reading.currencyOptions.length <= 1 &&
    reading.totalMinor !== null
  );
}
