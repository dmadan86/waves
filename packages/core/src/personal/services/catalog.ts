/**
 * The services a person already knows they pay for, and the strings a bank
 * hands them instead.
 *
 * The detector next door (detect.ts) finds repetition on its own: three charges
 * a month apart are a subscription whether or not anybody has heard of the
 * merchant. That is the honest way round, and it is also useless on the first
 * day — a ledger three weeks old has no repetition in it yet, and somebody who
 * has just imported a statement is exactly the person who wants to be told "you
 * pay for Netflix, Airtel and the electricity board" rather than to be asked to
 * come back in ninety days.
 *
 * So this table exists to *shorten the evidence a charge needs*, and to do
 * nothing else. Nothing here asserts that a payment recurs. It says that if
 * this one does, here is what it is called, what sort of thing it is, and how
 * often that sort of thing usually lands. A candidate built on this alone comes
 * back marked `fromCatalogOnly` at the lowest confidence, because one Netflix
 * charge is still one charge and the screen must be able to say so.
 *
 * The alternative — ship no table, wait for the third month — is cheaper to
 * maintain and is what a purist would do. It also means the feature does
 * nothing at all for a quarter of a year for every new person, which is a long
 * time to look like a ledger that cannot read.
 *
 * **Vocabulary.** India-first, like `guessCategory` and the SMS parser before
 * it, for the same reason: the entries that matter are the ones a user's
 * statement actually names, and this app's statements name TNEB and JioFiber
 * far more often than they name a US cable company. Nothing here is
 * India-*only* — Spotify and Adobe bill the same everywhere — but the long tail
 * leans where the users are.
 *
 * **What a cadence here means.** The plan most people are on, not a fact about
 * any particular charge. It is a starting value for a rule the person is about
 * to confirm, and a real series always overrides it with the gaps it measured.
 */

import { normaliseMerchantName } from '../../category/merchant';
import type { Cadence } from '../types';

/**
 * What sort of repeating payment this is.
 *
 * Four, because they are the four a screen treats differently. A
 * `subscription` can be cancelled and the money saved, so it is worth
 * surfacing loudly. A `bill` cannot — telling somebody to cancel their
 * electricity is not advice — so it is worth *predicting* instead. `income` is
 * the credit side, which the same detector produces from the same evidence.
 * `other` is the pile that keeps the first three meaningful: a monthly SIP
 * repeats exactly like a subscription and is not spending at all, and lumping
 * it in with Netflix would put "you could save ₹5,000 a month" next to
 * somebody's savings.
 *
 * Deliberately declared here rather than on `PersonalRecurring`: a detected
 * candidate is not yet a rule, and a field on the stored shape would have to be
 * decoded, carried and migrated for a value nobody has agreed to yet.
 */
export type RecurringKind = 'subscription' | 'bill' | 'income' | 'other';

export interface ServiceEntry {
  /** Stable across releases — a stored candidate may name it. Never reused. */
  readonly id: string;
  /** English, as the service spells itself. The app translates through its own
   *  string table (TDR §11); a brand name usually survives that untouched. */
  readonly name: string;
  readonly kind: RecurringKind;
  /**
   * Lowercase fragments matched against a *normalised* merchant name.
   *
   * Already normalised themselves, which is a constraint rather than a
   * convenience: `normaliseMerchantName` deletes "pvt", "ltd", "india", "com"
   * and every run of digits, so a pattern containing one of those could never
   * match anything and would sit here looking like coverage it does not give.
   */
  readonly patterns: readonly string[];
  readonly cadence: Cadence;
  /** Every `interval` cadence units. Omitted means 1; carried only by the few
   *  services billed on a multiple, so the table is not forty copies of `1`. */
  readonly interval?: number;
}

/**
 * A pattern this short must match a whole token rather than any substring.
 *
 * Without the rule the short ids are unusable, and they are the ones a statement
 * most often carries alone: "EMI" is inside "pr**emi**um", "SIP" is inside
 * "gos**sip**", "LIC" is inside "po**lic**e", "VI" is inside "ser**vi**ce",
 * "ACT" is inside "cont**act**". Dropping all five would be the other way to
 * fix it, and it would lose the exact strings banks actually print.
 *
 * Longer patterns keep matching anywhere, because they have to: "JIOHOTSTAR"
 * arrives as one token and only a substring finds "hotstar" inside it.
 */
const WHOLE_TOKEN_MAX = 5;

export const SERVICES: readonly ServiceEntry[] = [
  // ── Streaming, music, software ────────────────────────────────────────
  {
    id: 'netflix',
    name: 'Netflix',
    kind: 'subscription',
    patterns: ['netflix'],
    cadence: 'monthly',
  },
  {
    id: 'prime-video',
    name: 'Prime Video',
    kind: 'subscription',
    patterns: ['prime video', 'primevideo'],
    cadence: 'monthly',
  },
  {
    id: 'amazon-prime',
    name: 'Amazon Prime',
    kind: 'subscription',
    patterns: ['amazon prime', 'amazonprime'],
    cadence: 'yearly',
  },
  {
    id: 'hotstar',
    name: 'JioHotstar',
    kind: 'subscription',
    patterns: ['hotstar', 'jiohotstar', 'jio hotstar', 'disney hotstar'],
    cadence: 'yearly',
  },
  {
    id: 'spotify',
    name: 'Spotify',
    kind: 'subscription',
    patterns: ['spotify'],
    cadence: 'monthly',
  },
  {
    id: 'youtube-premium',
    name: 'YouTube Premium',
    kind: 'subscription',
    patterns: ['youtube', 'youtube premium', 'youtubepremium'],
    cadence: 'monthly',
  },
  {
    id: 'apple',
    name: 'Apple',
    kind: 'subscription',
    // One entry for the lot: iCloud, Music and TV all bill through the same
    // merchant string, and a person reading "Apple · ₹149" knows which is
    // theirs far better than a guess between three would.
    patterns: ['apple', 'icloud', 'apple music', 'apple tv', 'itunes'],
    cadence: 'monthly',
  },
  {
    id: 'google-one',
    name: 'Google One',
    kind: 'subscription',
    patterns: ['google one', 'googleone', 'google storage'],
    cadence: 'monthly',
  },
  {
    id: 'adobe',
    name: 'Adobe',
    kind: 'subscription',
    patterns: ['adobe', 'creative cloud', 'creativecloud'],
    cadence: 'monthly',
  },
  {
    id: 'microsoft-365',
    name: 'Microsoft 365',
    kind: 'subscription',
    patterns: ['microsoft', 'microsoft office', 'ms office'],
    cadence: 'yearly',
  },
  {
    id: 'openai',
    name: 'ChatGPT',
    kind: 'subscription',
    patterns: ['openai', 'chatgpt'],
    cadence: 'monthly',
  },
  {
    id: 'anthropic',
    name: 'Claude',
    kind: 'subscription',
    // Not bare "claude": it is a person's name long before it is a merchant's,
    // and a transfer to a friend must not come back labelled as a product.
    patterns: ['anthropic', 'claude ai'],
    cadence: 'monthly',
  },

  // ── Telecom and internet ──────────────────────────────────────────────
  {
    id: 'airtel-broadband',
    name: 'Airtel Broadband',
    kind: 'bill',
    // Listed before plain Airtel for readability only — the longest pattern
    // wins regardless of order, which is the point of matching by length.
    patterns: ['airtel broadband', 'airtel xstream', 'airtel fiber', 'airtel fibre'],
    cadence: 'monthly',
  },
  {
    id: 'airtel',
    name: 'Airtel',
    kind: 'bill',
    patterns: ['airtel'],
    cadence: 'monthly',
  },
  {
    id: 'jiofiber',
    name: 'JioFiber',
    kind: 'bill',
    patterns: ['jiofiber', 'jio fiber', 'jio fibre'],
    cadence: 'monthly',
  },
  {
    id: 'jio',
    name: 'Jio',
    kind: 'bill',
    patterns: ['jio', 'reliance jio', 'jio prepaid', 'jio postpaid'],
    cadence: 'monthly',
  },
  {
    id: 'vodafone-idea',
    name: 'Vi',
    kind: 'bill',
    patterns: ['vi', 'vodafone', 'vodafone idea'],
    cadence: 'monthly',
  },
  {
    id: 'bsnl',
    name: 'BSNL',
    kind: 'bill',
    patterns: ['bsnl'],
    cadence: 'monthly',
  },
  {
    id: 'act-fibernet',
    name: 'ACT Fibernet',
    kind: 'bill',
    patterns: ['act', 'actcorp', 'act fibernet', 'actfibernet', 'act broadband'],
    cadence: 'monthly',
  },
  {
    id: 'hathway',
    name: 'Hathway',
    kind: 'bill',
    patterns: ['hathway'],
    cadence: 'monthly',
  },

  // ── Utilities ─────────────────────────────────────────────────────────
  // The boards, not "electricity": a bill arrives named TANGEDCO or BESCOM and
  // a person recognises their own board instantly, where a generic label makes
  // them open the row to find out which one it was.
  {
    id: 'tneb',
    name: 'TNEB',
    kind: 'bill',
    patterns: ['tneb', 'tangedco'],
    cadence: 'monthly',
  },
  {
    id: 'bescom',
    name: 'BESCOM',
    kind: 'bill',
    patterns: ['bescom'],
    cadence: 'monthly',
  },
  {
    id: 'mseb',
    name: 'MSEB',
    kind: 'bill',
    patterns: ['mseb', 'msedcl', 'mahavitaran'],
    cadence: 'monthly',
  },
  {
    id: 'bses',
    name: 'BSES',
    kind: 'bill',
    patterns: ['bses', 'bses rajdhani', 'bses yamuna'],
    cadence: 'monthly',
  },
  {
    id: 'adani-electricity',
    name: 'Adani Electricity',
    kind: 'bill',
    patterns: ['adani electricity', 'adanielectricity'],
    cadence: 'monthly',
  },
  {
    id: 'tata-power',
    name: 'Tata Power',
    kind: 'bill',
    patterns: ['tata power', 'tatapower'],
    cadence: 'monthly',
  },
  {
    id: 'piped-gas',
    name: 'Piped gas',
    kind: 'bill',
    patterns: ['piped gas', 'mahanagar gas', 'indraprastha gas', 'gujarat gas', 'adani gas'],
    cadence: 'monthly',
  },
  {
    id: 'water',
    name: 'Water',
    kind: 'bill',
    patterns: ['water bill', 'water board', 'metro water', 'jal board', 'jal nigam'],
    cadence: 'monthly',
  },

  // ── Money and life ────────────────────────────────────────────────────
  {
    id: 'rent',
    name: 'Rent',
    kind: 'bill',
    patterns: ['rent', 'house rent', 'monthly rent'],
    cadence: 'monthly',
  },
  {
    id: 'insurance',
    name: 'Insurance premium',
    kind: 'bill',
    // Not "premium payment": `normaliseMerchantName` deletes "payment" as
    // gateway noise, so the pattern could never meet a string to match.
    patterns: ['lic', 'insurance', 'lic premium', 'life insurance', 'policy premium'],
    cadence: 'yearly',
  },
  {
    id: 'loan-emi',
    name: 'Loan EMI',
    kind: 'bill',
    patterns: ['emi', 'loan emi', 'home loan', 'car loan', 'loan repayment'],
    cadence: 'monthly',
  },
  {
    id: 'sip',
    name: 'SIP',
    kind: 'other',
    // `other`, not `subscription`: a SIP repeats exactly like one and is
    // savings. Offering to cancel it would be the worst advice this app gives.
    patterns: ['sip', 'folio', 'mutual fund', 'mutualfund', 'systematic investment'],
    cadence: 'monthly',
  },
  {
    id: 'gym',
    name: 'Gym',
    kind: 'subscription',
    patterns: ['gym', 'cult fit', 'cultfit', 'fitness first', 'anytime fitness'],
    cadence: 'monthly',
  },
  {
    id: 'school-fees',
    name: 'School fees',
    kind: 'bill',
    patterns: ['school fee', 'school fees', 'tuition fee', 'college fee'],
    // Termly, which is the one place the interval earns its keep.
    cadence: 'monthly',
    interval: 3,
  },
  {
    id: 'salary',
    name: 'Salary',
    kind: 'income',
    patterns: ['salary', 'payroll', 'salary credit', 'sal credit'],
    cadence: 'monthly',
  },
];

/**
 * The service a merchant string names, or null when none of them is recognised.
 *
 * Null is an ordinary answer, never a fallback entry: the detector still finds
 * a series on gaps alone, and inventing a "Other subscription" row here would
 * put a name on a screen that nobody could check against their own memory.
 *
 * The longest matching pattern wins, across the whole table rather than within
 * one entry, which is the only rule that gets "airtel broadband" right — it
 * matches both `airtel` and `airtel broadband`, and the shorter one is the
 * wrong answer by exactly the amount it is shorter. Equal lengths fall to table
 * order, so the answer is stable rather than dependent on iteration luck.
 *
 * Safe to hand an already-normalised name: `normaliseMerchantName` is
 * idempotent (its output contains nothing left for it to strip), so the
 * detector passes its group key straight in rather than keeping the raw string
 * alive for a second pass.
 */
export function matchService(merchantName: string): ServiceEntry | null {
  const name = normaliseMerchantName(merchantName);
  if (name.length === 0) return null;
  const tokens = new Set(name.split(' '));

  let best: ServiceEntry | null = null;
  let bestLength = 0;
  for (const service of SERVICES) {
    for (const pattern of service.patterns) {
      // `<=` rather than `<`, so the first entry in table order keeps a tie.
      if (pattern.length <= bestLength) continue;
      const hit = pattern.length <= WHOLE_TOKEN_MAX ? tokens.has(pattern) : name.includes(pattern);
      if (!hit) continue;
      best = service;
      bestLength = pattern.length;
    }
  }
  return best;
}

/** The catalog entry with this id, or null. For re-reading a stored candidate
 *  whose service has since been removed from the table. */
export function serviceById(id: string | null): ServiceEntry | null {
  if (id === null) return null;
  return SERVICES.find((service) => service.id === id) ?? null;
}
