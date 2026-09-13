/**
 * Plain words for what a bank message says.
 *
 * A bank SMS is written for a machine as much as for a person: the sender is a
 * telecom routing header, the "merchant" is whatever the parser could pull out
 * of a sentence, and neither is safe to print at a grandmother. This module is
 * the one place that decides what a person is allowed to *see*, and its whole
 * rule is: **when we do not know, we say nothing.** A code on the screen is
 * worse than a blank, because a blank is honestly empty and a code looks like
 * information the reader is failing to understand.
 *
 * Nothing here parses money, dates or direction — that is
 * `packages/core/src/sms/parse.ts`, and this deliberately does not reach into
 * it. These are pure string judgements, so `test/smsPlain.test.ts` can pin
 * every one of them without a device.
 *
 * WHY IT LIVES IN THE APP AND NOT IN CORE. A candidate is a fact; a name is a
 * presentation choice, and the table below is a list of Indian banks that will
 * grow every time somebody's bank is missing. Core should not have to be
 * released for that.
 */

/**
 * India's DLT sender format is `XX-HEADER` or `XX-HEADER-S`.
 *
 * `XX` is an operator-and-circle code the carrier prepends (JM, AX, VM, AD, BP,
 * …) — it says which network carried the message and nothing about who sent it.
 * `HEADER` is the sender id the bank registered. The trailing single letter is
 * the message category: `-S` service, `-T` transactional, `-P` promotional,
 * `-G` government. So `JM-ICICIT-S` carries exactly one useful token, `ICICIT`,
 * and the other two are routing.
 */
const OPERATOR_PREFIX = /^[A-Z]{2}-/;
const CATEGORY_SUFFIX = /-[A-Z]$/;

/**
 * Registered sender ids, longest-first where one is a prefix of another.
 *
 * Matched on the *start* of the stripped id, because banks register several
 * headers off one stem (ICICIB, ICICIT, ICICIN) and a new one appearing is not
 * a reason to show a code. Anything not on this list is unknown, and unknown
 * shows nothing at all.
 */
const SENDER_NAMES: readonly (readonly [RegExp, string])[] = [
  [/^HDFC/, 'HDFC Bank'],
  [/^ICICI/, 'ICICI Bank'],
  [/^AXIS/, 'Axis Bank'],
  [/^(?:SBI|ATMSBI|SBICRD|SBIINB|SBIUPI)/, 'State Bank of India'],
  [/^KOTAK/, 'Kotak Mahindra Bank'],
  [/^INDUS/, 'IndusInd Bank'],
  [/^YES(?:BNK|BK|BANK)?/, 'Yes Bank'],
  [/^PNB/, 'Punjab National Bank'],
  [/^(?:BOB|BARB)/, 'Bank of Baroda'],
  [/^(?:CANBNK|CANARA|CNRB)/, 'Canara Bank'],
  [/^(?:UNIONB|UBIN|UNIONBK)/, 'Union Bank of India'],
  [/^IDFC/, 'IDFC First Bank'],
  [/^IDBI/, 'IDBI Bank'],
  [/^RBL/, 'RBL Bank'],
  [/^(?:FEDBNK|FEDERAL|FDRL)/, 'Federal Bank'],
  [/^(?:INDBNK|INDIANB|IDIB)/, 'Indian Bank'],
  [/^(?:CENTBK|CBIN|CENTBNK)/, 'Central Bank of India'],
  [/^(?:AUBANK|AUFINB)/, 'AU Small Finance Bank'],
  [/^BANDHAN/, 'Bandhan Bank'],
  [/^(?:CITI|CITIBK)/, 'Citibank'],
  [/^HSBC/, 'HSBC'],
  [/^(?:SCBANK|SCBIND|STANC|SCBL)/, 'Standard Chartered'],
  [/^AMEX/, 'American Express'],
  [/^DBSBNK/, 'DBS Bank'],
  [/^PAYTM/, 'Paytm'],
  [/^PHONEPE/, 'PhonePe'],
  [/^(?:GPAY|GOOGLEPAY)/, 'Google Pay'],
  [/^(?:AMZN|AMAZONPAY)/, 'Amazon Pay'],
  [/^SLICE/, 'slice'],
  [/^JUPITER/, 'Jupiter'],
  [/^(?:ONECRD|ONECARD)/, 'OneCard'],
];

/**
 * The bank's own name as it is written in the body of its messages.
 *
 * A pasted message carries no sender — the clipboard does not hold one — so the
 * only place left to look is the text, and a bank alert almost always names
 * itself in it ("ICICI Bank Acct XX123 debited…"). Word-bounded so that a shop
 * called "Citi Bakery" is not read as Citibank.
 */
const NAMES_IN_TEXT: readonly (readonly [RegExp, string])[] = [
  [/\bHDFC\b/i, 'HDFC Bank'],
  [/\bICICI\b/i, 'ICICI Bank'],
  [/\bAXIS\s*BANK\b/i, 'Axis Bank'],
  [/\b(?:SBI|State\s+Bank\s+of\s+India)\b/i, 'State Bank of India'],
  [/\bKOTAK\b/i, 'Kotak Mahindra Bank'],
  [/\bINDUSIND\b/i, 'IndusInd Bank'],
  [/\bYES\s*BANK\b/i, 'Yes Bank'],
  [/\b(?:PNB|Punjab\s+National)\b/i, 'Punjab National Bank'],
  [/\bBank\s+of\s+Baroda\b/i, 'Bank of Baroda'],
  [/\bCANARA\b/i, 'Canara Bank'],
  [/\bUNION\s+BANK\b/i, 'Union Bank of India'],
  [/\bIDFC\b/i, 'IDFC First Bank'],
  [/\bIDBI\b/i, 'IDBI Bank'],
  [/\bRBL\b/i, 'RBL Bank'],
  [/\bFEDERAL\s+BANK\b/i, 'Federal Bank'],
  [/\bINDIAN\s+BANK\b/i, 'Indian Bank'],
  [/\bCENTRAL\s+BANK\s+OF\s+INDIA\b/i, 'Central Bank of India'],
  [/\bAU\s+SMALL\s+FINANCE\b/i, 'AU Small Finance Bank'],
  [/\bBANDHAN\s+BANK\b/i, 'Bandhan Bank'],
  [/\bCITI\s*BANK\b/i, 'Citibank'],
  [/\bHSBC\b/i, 'HSBC'],
  [/\bSTANDARD\s+CHARTERED\b/i, 'Standard Chartered'],
  [/\bAMERICAN\s+EXPRESS\b/i, 'American Express'],
  [/\bDBS\s+BANK\b/i, 'DBS Bank'],
  [/\bPAYTM\b/i, 'Paytm'],
  [/\bPHONEPE\b/i, 'PhonePe'],
];

/**
 * `JM-ICICIT-S` → `ICICI Bank`. An id nobody recognises → `null`.
 *
 * Null rather than the raw string on purpose. `AX-AIRDUE-S` is a phone bill
 * reminder routed through the same machinery as a bank alert; printing its
 * header would put a telecom code under a payment and teach a person that this
 * screen speaks in codes.
 */
export function bankFromSender(sender: string | null | undefined): string | null {
  if (!sender) return null;
  const id = sender.trim().toUpperCase().replace(OPERATOR_PREFIX, '').replace(CATEGORY_SUFFIX, '');
  // A numeric sender is somebody's phone, not a registered bank header.
  if (!/^[A-Z]/.test(id)) return null;
  for (const [pattern, name] of SENDER_NAMES) {
    if (pattern.test(id)) return name;
  }
  return null;
}

/** The bank named in the message itself, for a paste that carries no sender. */
export function bankFromText(body: string | null | undefined): string | null {
  if (!body) return null;
  for (const [pattern, name] of NAMES_IN_TEXT) {
    if (pattern.test(body)) return name;
  }
  return null;
}

/**
 * Words the parser sometimes hands back as a "merchant" that are not a name.
 *
 * Every one of these is a fragment of bank grammar — the word before the thing
 * it was looking for — and showing it as the title of a payment says "you paid
 * VPA", which is nonsense a person cannot act on.
 */
const NOT_A_NAME = new Set([
  'A',
  'AC',
  'ACCT',
  'ACCOUNT',
  'AN',
  'ATM',
  'BANK',
  'CARD',
  'CREDIT',
  'CREDITED',
  'DEBIT',
  'DEBITED',
  'IMPS',
  'INFO',
  'INR',
  'NA',
  'NEFT',
  'OTP',
  'PAYMENT',
  'POS',
  'REF',
  'RRN',
  'RS',
  'RTGS',
  'THE',
  'TXN',
  'UPI',
  'VPA',
  'YOUR',
]);

/**
 * The merchant, if it is plausibly the name of somebody who was paid.
 *
 * This is a *display* guard, not a parser fix: `packages/core/src/sms/parse.ts`
 * owns the extraction and is being sharpened separately. What it cannot do is
 * promise never to be wrong, and a title is the one place on this screen where
 * being wrong is indistinguishable from being right — "9215676766" printed
 * where a shop's name goes reads as a shop called 9215676766.
 *
 * Rejected, and why:
 * - nothing but digits and punctuation — an account number or a phone number;
 * - a run of six or more digits at the front — "919951860002 Axis Bank", which
 *   is a phone number with the bank's name stuck to it;
 * - no letters at all;
 * - a single bank-grammar word (see {@link NOT_A_NAME});
 * - the bank's own name, which is who *sent* the message, not who was paid.
 *
 * The last of those asks for the word "bank" as well as a match, so that a
 * wallet somebody really did pay ("PAYTM") survives and "Axis Bank" does not.
 */
export function merchantName(raw: string | null | undefined): string | null {
  const name = raw?.trim();
  if (!name) return null;
  if (name.length < 2) return null;
  if (!/\p{L}/u.test(name)) return null;
  if (/^[+\d][\d\s().-]*$/.test(name)) return null;
  if (/^\d{6,}/.test(name)) return null;
  if (NOT_A_NAME.has(name.toUpperCase().replace(/[^A-Z]/g, ''))) return null;
  // "Axis Bank" is who sent the message, not who was paid.
  if (/\bbank\b/i.test(name) && bankFromText(name) !== null) return null;
  return name;
}
