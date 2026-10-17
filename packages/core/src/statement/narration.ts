/**
 * The narration column of an Indian bank statement, read.
 *
 * Every bank writes the payment rail's reference into the narration in its own
 * punctuation:
 *
 *   HDFC   UPI-SWIGGY-SWIGGY@ICICI-ICIC0000001-627412345678-ORDER
 *   ICICI  UPI/627412345678/Payment from PhonePe/swiggy@icici/ICICI Bank
 *   SBI    TO TRANSFER-UPI/DR/627412345678/SWIGGY/ICIC/swiggy@icici/Payment
 *   Axis   UPI/P2M/627412345678/SWIGGY/Payment
 *   Kotak  UPI/SWIGGY/627412345678/Payment for order
 *   NEFT   NEFT-HDFCN52026101234567-ACME LTD-SALARY
 *
 * What matters downstream is the reference: it is the same number the bank's own
 * SMS carries, so it is the key a statement row and an SMS draft share.
 * Everything here is a pure function of the string.
 */

export type NarrationKind = 'upi' | 'neft' | 'rtgs' | 'imps' | 'cheque' | 'atm' | 'pos' | 'other';

export interface Narration {
  readonly kind: NarrationKind;
  /** Upper-cased, alphanumeric only, or null when the narration carries none. */
  readonly ref: string | null;
  /** Who was paid or who paid, as written (a VPA keeps its handle only). */
  readonly counterparty: string | null;
}

/** What `dedupeKey` in the SMS parser produces from a reference. */
export function normaliseRef(raw: string): string {
  return raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

/** Codes that sit where a name could. */
const CODES = new Set([
  'upi',
  'dr',
  'cr',
  'p2m',
  'p2a',
  'p2p',
  'neft',
  'rtgs',
  'imps',
  'to',
  'by',
  'transfer',
  'trf',
  'payment',
  'pay',
  'ft',
  'mob',
  'ib',
  'ach',
  'ecs',
  'from',
  'for',
  'phonepe',
  'gpay',
  'paytm',
  'bhim',
  'credit',
  'debit',
]);

const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const BANK_CODE = /^[A-Z]{4}$/;
/** A 12-digit run: the UPI RRN and the IMPS reference. */
const RRN = /(?<!\d)\d{12}(?!\d)/;
/** NEFT / RTGS UTR: four letters of bank, then a letter or digit and 9+ digits. */
const UTR = /\b[A-Z]{4}[A-Z0-9]\d{9,}\b/;

function counterpartyFrom(segments: readonly string[]): string | null {
  for (const segment of segments) {
    const piece = segment.trim();
    if (piece.length < 2 || !/\p{L}/u.test(piece)) continue;
    const words = piece
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
    if (words.every((word) => CODES.has(word))) continue;
    // A reference (UTR, RRN, cheque) is digits, not a name.
    if (/\d{6,}/.test(piece)) continue;
    const upper = piece.toUpperCase();
    if (IFSC.test(upper) || BANK_CODE.test(upper)) continue;
    // A bare VPA: keep the handle, not the bank behind the "@".
    const handle = piece.includes('@') ? piece.split('@')[0]!.trim() : piece;
    if (handle.length < 2 || !/\p{L}/u.test(handle)) continue;
    // Free-text tails ("Payment from PhonePe", "Payment for order") say nothing about who.
    if (/^(payment|paid|sent|received|upi)\b/i.test(handle)) continue;
    return handle.slice(0, 80);
  }
  return null;
}

export function parseNarration(text: string): Narration {
  const raw = text.replace(/\s+/g, ' ').trim();
  const upper = raw.toUpperCase();
  const segments = raw.split(/[/\-*|]/);

  const rrn = RRN.exec(raw)?.[0] ?? null;
  const utr = UTR.exec(upper)?.[0] ?? null;

  if (/\bUPI\b/.test(upper)) {
    return {
      kind: 'upi',
      ref: rrn ? normaliseRef(rrn) : null,
      counterparty: counterpartyFrom(segments),
    };
  }
  if (/\bIMPS\b/.test(upper)) {
    return {
      kind: 'imps',
      ref: rrn ? normaliseRef(rrn) : null,
      counterparty: counterpartyFrom(segments),
    };
  }
  if (/\bRTGS\b/.test(upper)) {
    return {
      kind: 'rtgs',
      ref: utr ? normaliseRef(utr) : null,
      counterparty: counterpartyFrom(segments),
    };
  }
  if (/\bNEFT\b/.test(upper)) {
    return {
      kind: 'neft',
      ref: utr ? normaliseRef(utr) : null,
      counterparty: counterpartyFrom(segments),
    };
  }
  if (/\b(?:CHQ|CHEQUE|CLG|CLEARING)\b/.test(upper)) {
    const number = chequeNumber(upper);
    return { kind: 'cheque', ref: number, counterparty: null };
  }
  if (/\bATM\b|\bATW\b|\bNWD\b|\bCASH WDL\b|\bCASH WITHDRAWAL\b/.test(upper)) {
    return { kind: 'atm', ref: null, counterparty: null };
  }
  if (/\bPOS\b|\bPUR\b|\bECOM\b/.test(upper)) {
    const after = raw.replace(/^.*?\b(?:POS|PUR|ECOM)\b[\sX*\d-]*/i, '');
    return { kind: 'pos', ref: null, counterparty: counterpartyFrom([after]) };
  }
  return {
    kind: 'other',
    ref: utr ? normaliseRef(utr) : null,
    counterparty: counterpartyFrom(segments),
  };
}

/**
 * The reference for a row: the printed Chq./Ref. column when it is a real
 * reference, else the narration's. A column of zeros ("0000000000000000") is
 * the bank saying there is none.
 */
export function referenceFor(
  refColumn: string | null | undefined,
  narration: string,
): string | null {
  const printed = refColumn ? normaliseRef(refColumn) : '';
  if (printed.length >= 6 && !/^0+$/.test(printed)) {
    // A HDFC ref column often repeats the UPI RRN with leading zeros: 000627412345678.
    const rrn = /^0{0,4}(\d{12})$/.exec(printed)?.[1];
    return rrn ?? printed;
  }
  return parseNarration(narration).ref;
}

const SPACE = new Set([' ', '\t', '\n', '\r', '\f', '\v', '\u00a0']);

function skipSpace(text: string, from: number): number {
  let i = from;
  while (i < text.length && SPACE.has(text.charAt(i))) i += 1;
  return i;
}

/** "CHQ NO: 123456" / "CHEQUE #123456": scanned by hand so whitespace runs cost linear time. */
function chequeNumber(upper: string): string | null {
  const head = /\b(?:CHQ|CHEQUE)/g;
  let m: RegExpExecArray | null;
  while ((m = head.exec(upper)) !== null) {
    let i = skipSpace(upper, m.index + m[0].length);
    for (const label of ['NUMBER', 'NO.', 'NO', '#']) {
      if (upper.startsWith(label, i)) {
        i += label.length;
        break;
      }
    }
    i = skipSpace(upper, i);
    if (upper.charAt(i) === ':') i += 1;
    i = skipSpace(upper, i);
    const digits = /^\d{6}\b/.exec(upper.slice(i, i + 7));
    if (digits) return digits[0].slice(0, 6);
  }
  return null;
}
