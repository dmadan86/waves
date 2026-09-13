/**
 * Turning text somebody actually typed — or a bank actually sent — into
 * something a digit-based parser can read.
 *
 * This lives in core rather than beside any one reader because the voice
 * parser, the receipt reader and the SMS importer all hit the same problems,
 * and three copies of a numeral table is three places for a locale to go
 * missing. There is no locale data here beyond Unicode's own: nothing below
 * decides what a number *means*, only which codepoints are digits.
 */

/**
 * The digit blocks this app's locales and their neighbours actually type or
 * speak: Devanagari (hi), Tamil (ta), Arabic-Indic and Eastern Arabic
 * (ar, fa, ur), the other Indic scripts, Thai and Burmese.
 *
 * Each block is ten consecutive codepoints starting at the zero, which is a
 * property of the Unicode standard rather than a coincidence, so a single
 * subtraction converts any of them.
 */
const NATIVE_DIGIT_BLOCKS: readonly number[] = [
  0x0660, // Arabic-Indic
  0x06f0, // Extended Arabic-Indic (Persian, Urdu)
  0x0966, // Devanagari
  0x09e6, // Bengali
  0x0be6, // Tamil
  0x0c66, // Telugu
  0x0ce6, // Kannada
  0x0d66, // Malayalam
  0x0e50, // Thai
  0x1040, // Burmese
];

const NATIVE_DIGITS =
  /[\u0660-\u0669\u06f0-\u06f9\u0966-\u096f\u09e6-\u09ef\u0be6-\u0bef\u0c66-\u0c6f\u0ce6-\u0cef\u0d66-\u0d6f\u0e50-\u0e59\u1040-\u1049]/g;

/** Native numerals to ASCII, so Hindi, Tamil and Arabic amounts all read as numbers. */
export function normaliseDigits(text: string): string {
  return text.replace(NATIVE_DIGITS, (character) => {
    const code = character.codePointAt(0) ?? 0;
    for (const base of NATIVE_DIGIT_BLOCKS) {
      if (code >= base && code <= base + 9) return String(code - base);
    }
    return character;
  });
}

/**
 * Bidirectional formatting controls, which carry no meaning for a parser but
 * sit *inside* words and numbers in Arabic, Hebrew and Urdu text.
 *
 * An Arabic bank alert routinely wraps its amount in an isolate so the digits
 * render left-to-right inside a right-to-left sentence. Those marks are
 * invisible, and a regex that does not expect them simply fails to match a
 * number that is plainly there — the failure looks like "the parser does not
 * speak Arabic" when it is really "the parser does not speak Unicode".
 */
const BIDI_CONTROLS = /[\u200e\u200f\u061c\u202a-\u202e\u2066-\u2069]/g;

export function stripBidiControls(text: string): string {
  return text.replace(BIDI_CONTROLS, '');
}

/**
 * Arabic's own separators to the ASCII ones. U+066B is the decimal separator
 * and U+066C the thousands separator — the mirror image of the Latin habit, and
 * reading them the wrong way round is a factor-of-a-thousand mistake rather
 * than a cosmetic one.
 */
export function normaliseArabicSeparators(text: string): string {
  return text.replace(/\u066b/g, '.').replace(/\u066c/g, ',');
}

/**
 * Everything above, in the order it has to happen: compatibility folding first
 * (so presentation forms and fullwidth digits become their ordinary shapes),
 * then the invisible marks, then the numerals, then the separators.
 *
 * NFKC is deliberate. It is the normalisation that treats a presentation form
 * and its plain equivalent as the same character, which is exactly what a
 * parser reading somebody else's message wants; NFC would leave a fullwidth
 * digit unreadable.
 */
export function normaliseForParsing(text: string): string {
  return normaliseArabicSeparators(normaliseDigits(stripBidiControls(text.normalize('NFKC'))));
}

/**
 * A word reduced to the letters and digits that identify it, with diacritics
 * removed — "août" and "aout", "ağu" and "agu", read the same. Used for looking
 * a token up in a table, never for display.
 */
export function foldToken(token: string): string {
  return token
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}
