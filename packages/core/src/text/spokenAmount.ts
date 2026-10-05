/**
 * Spoken price idioms, folded into plain digits before an amount is read.
 *
 * People do not say "three hundred and fifty rupees" for ₹350. They say "three
 * fifty". Speech-to-text then hands back "three fifty", "three 50" or "3 50"
 * depending on the engine, and a digit-based reader sees "3" and "50" as two
 * amounts, or just "50", or (summing the words) 53. This is the one place that
 * knows the idiom, so every reader of a transcript agrees on what was said.
 *
 * The rule, kept deliberately small and explicit:
 *
 *   - "<1-99> <tens>"   means  X * 100 + Y     "three fifty" = 350, "twelve fifty" = 1250
 *   - "<X> <Y>" next to a dollar / euro / pound word or symbol is a decimal
 *     instead: "twelve fifty dollars" = 12.50, because that is how those prices
 *     are spoken. Rupees, dirhams and everything else keep the hundreds reading.
 *   - Digit shorthand "2k", "1.5k", "two k" means thousands.
 *
 * Not touched, because they are not prices: a percentage split ("60 40"), a time ("at three fifty", "3 50
 * pm"), a people count ("between three fifty"), a bare "5 10" (two numbers) and
 * anything already carrying a scale word ("three hundred fifty", "fifteen
 * hundred"), which the ordinary number-word reader handles.
 */

const UNITS = 'one|two|three|four|five|six|seven|eight|nine';
const TEENS = 'ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen';
const TENS = 'twenty|thirty|forty|fourty|fifty|sixty|seventy|eighty|ninety';

const VALUES = new Map<string, number>([
  ...UNITS.split('|').map((w, i): [string, number] => [w, i + 1]),
  ...TEENS.split('|').map((w, i): [string, number] => [w, i + 10]),
  ['twenty', 20],
  ['thirty', 30],
  ['forty', 40],
  ['fourty', 40],
  ['fifty', 50],
  ['sixty', 60],
  ['seventy', 70],
  ['eighty', 80],
  ['ninety', 90],
]);

/** A spoken 1–99: "three", "twelve", "twenty", "twenty five". */
const SMALL_WORD = `(?:(?:${TENS})(?:[\\s-]+(?:${UNITS}))?|${TEENS}|${UNITS})`;
/** A spoken 10–99 that starts like a price ending: "fifty", "twenty five", "fifteen". */
const ENDING_WORD = `(?:(?:${TENS})(?:[\\s-]+(?:${UNITS}))?|${TEENS})`;

function wordsToNumber(words: string): number {
  let total = 0;
  for (const part of words.toLowerCase().split(/[\s-]+/)) total += VALUES.get(part) ?? 0;
  return total;
}

/** Symbols and words that mark a number as money, split by how their prices are spoken. */
const DECIMAL_SYMBOLS = '[$€£]';
const DECIMAL_WORDS =
  '(?:us\\s+|canadian\\s+|australian\\s+|new\\s+zealand\\s+)?(?:dollars?|bucks?|euros?|pounds?|quid|usd|eur|gbp|cad|aud|nzd)';
const OTHER_SYMBOLS = '[₹¥₺₩₫฿₦₱₽]';
const OTHER_WORDS =
  '(?:rupees?|rupaye|rupaiye|rs\\.?|inr|dirhams?|aed|riyals?|sar|qar|yen|jpy|rand|zar|pesos?|baht|ringgit|myr|sgd|lira|try|krona|kronor|francs?|chf)';

const MONEY_AFTER_DECIMAL = new RegExp(`^\\s*${DECIMAL_WORDS}\\b`, 'i');
const MONEY_AFTER_OTHER = new RegExp(`^\\s*${OTHER_WORDS}(?![\\p{L}])`, 'iu');
const MONEY_BEFORE_DECIMAL = new RegExp(
  `(?:${DECIMAL_SYMBOLS}|\\b(?:usd|eur|gbp|cad|aud|nzd))\\s*$`,
  'i',
);
const MONEY_BEFORE_OTHER = new RegExp(`(?:${OTHER_SYMBOLS}|\\b(?:rs\\.?|inr))\\s*$`, 'iu');

/** The word before a pair that says it is not a price. */
const NON_PRICE_BEFORE =
  /\b(?:at|by|till|until|around|before|after|from|room|flat|floor|number|no|gate|table|seat|platform|page|line|route|bus|train|between|among|amongst|hundred|thousand|lakh|lakhs|lac|crore|million)\s*$/i;
/** What follows a pair that says it is a time, a count or a unit rather than a price. */
const NON_PRICE_AFTER =
  /^\s*(?::|am\b|pm\b|a\.m|p\.m|o'?clock|hours?\b|hrs?\b|minutes?\b|mins?\b|seconds?\b|people\b|persons?\b|ppl\b|ways?\b|folks?\b|heads?\b|percent\b|%|km\b|kg\b|grams?\b|litres?\b|liters?\b|days?\b|weeks?\b|months?\b|years?\b|hundred\b|thousand\b|lakhs?\b|lacs?\b|crores?\b|million\b|k\b|st\b|nd\b|rd\b|th\b)/i;

const X_DIGITS = String.raw`\d{1,2}`;
const SMALL_ANY = `(?:${SMALL_WORD}|${X_DIGITS})`;
const ENDING_ANY = `(?:${ENDING_WORD}|\\d{2})`;

const PRICE_PAIR = new RegExp(
  `(?<![\\p{L}\\p{N}.,])(${SMALL_ANY})[\\s-]+(${ENDING_ANY})(?![\\p{L}\\p{N}]|[.,]\\d)`,
  'giu',
);

function isDigits(token: string): boolean {
  return /^\d+$/.test(token);
}

/**
 * Fold "three fifty" / "three 50" / "3 50" into 350 (or 3.50 against a dollar,
 * euro or pound word), when the surroundings say it is a price. Left as spoken
 * otherwise.
 */
export function foldSpokenPriceIdiom(text: string): string {
  return text.replace(PRICE_PAIR, (match, x: string, y: string, offset: number, whole: string) => {
    const before = whole.slice(0, offset);
    const after = whole.slice(offset + match.length);
    if (NON_PRICE_BEFORE.test(before) || NON_PRICE_AFTER.test(after)) return match;

    const decimalMoney = MONEY_AFTER_DECIMAL.test(after) || MONEY_BEFORE_DECIMAL.test(before);
    const otherMoney = MONEY_AFTER_OTHER.test(after) || MONEY_BEFORE_OTHER.test(before);
    const money = decimalMoney || otherMoney;

    const xValue = isDigits(x) ? Number(x) : wordsToNumber(x);
    const yValue = isDigits(y) ? Number(y) : wordsToNumber(y);
    if (xValue < 1 || xValue > 99 || yValue < 10 || yValue > 99) return match;
    // "60 40" and "70 30" are a split by percentage, not ₹6040: two round
    // numbers that make exactly a hundred stay two numbers.
    if (xValue >= 10 && xValue % 5 === 0 && yValue % 5 === 0 && xValue + yValue === 100)
      return match;

    if (!money) {
      // No currency to lean on: only an ending that is unmistakably a price
      // ending. Two plain digit groups ("5 10") stay two numbers, and a teen
      // ("three fifteen") reads as a time as often as a price. A mixed pair
      // ("three 50", "3 fifty") is a recogniser split, never two amounts.
      if (yValue < 20) return match;
      if (isDigits(x) && isDigits(y) && yValue % 5 !== 0) return match;
    }

    if (decimalMoney) {
      return `${xValue}.${String(yValue).padStart(2, '0')}`;
    }
    return String(xValue * 100 + yValue);
  });
}

/** "2k", "1.5k", "two k", "2 K" — thousands. Never a bare letter inside a word ("5km"). */
const K_SUFFIX_DIGITS = /(?<![\p{L}\p{N}.,])(\d+(?:\.\d+)?)\s?k\b(?!\s*(?:m|g)\b)/giu;
const K_SUFFIX_WORDS = new RegExp(`(?<![\\p{L}\\p{N}])(${SMALL_WORD})[\\s-]+k\\b`, 'giu');

function trimNumber(value: number): string {
  return String(Math.round(value * 1e6) / 1e6);
}

export function foldThousandsShorthand(text: string): string {
  return text
    .replace(K_SUFFIX_DIGITS, (_m, n: string) => trimNumber(Number(n) * 1000))
    .replace(K_SUFFIX_WORDS, (_m, w: string) => trimNumber(wordsToNumber(w) * 1000));
}

/**
 * Everything above, in order: thousands shorthand first (so "2k" is already a
 * plain number), then the price idiom.
 */
export function normaliseSpokenAmounts(text: string): string {
  return foldSpokenPriceIdiom(foldThousandsShorthand(text));
}
