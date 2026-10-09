/**
 * Where a mid-market rate comes from, in order, and how each answer becomes an
 * exact rational (ADR-003).
 *
 * Pure apart from the injected `fetch`, so the parsing, the fallbacks and the
 * exact-fraction conversion are unit-tested on Node (providers.test.ts). The
 * handler decides caching; this only answers "what is the rate, from whom, for
 * which day".
 *
 * The chain, tried in order, each call under its own short deadline:
 *
 *   1. ECB via Frankfurter (`ecb`). The official reference rates, so first —
 *      but only ~30 currencies (no VND, no AED).
 *   2. fawazahmed0's currency-api (`currency-api`): ~200 currencies with dated
 *      history, served from jsDelivr with a Cloudflare Pages mirror.
 *   3. ExchangeRate-API open access (`exchangerate-api`): latest only, so for a
 *      past day it is the last resort, and the rate is dated today — never the
 *      bill's day. Its terms require attribution, which the app shows.
 */

import { fetchJsonWithDeadline, type CircuitBreaker } from '../_shared/resilience.ts';

export type FxSource = 'ecb' | 'currency-api' | 'exchangerate-api';

/** One provider's answer: exact, validated, and the day it is true for. */
export interface ProviderRate {
  /** 1 `from` = num/den `to`, both positive integers as decimal strings. */
  readonly num: string;
  readonly den: string;
  /** The day the provider says this rate is for (YYYY-MM-DD). */
  readonly day: string;
  readonly source: FxSource;
}

/** Why a provider gave no rate. */
export type ProviderFailure =
  /** It does not publish this pair (or this day): asking again will not help. */
  | 'unsupported'
  /** Down, slow, refused or answered nonsense: another try might work. */
  | 'unavailable';

export type ProviderOutcome =
  | { readonly ok: true; readonly rate: ProviderRate }
  | { readonly ok: false; readonly reason: ProviderFailure };

export interface ChainRequest {
  /** Upper-case ISO-4217 codes. */
  readonly from: string;
  readonly to: string;
  /** The day asked for (YYYY-MM-DD), or null for the latest. */
  readonly date: string | null;
  /** Today in UTC (YYYY-MM-DD): what a latest-only provider's rate is dated. */
  readonly today: string;
}

export interface ChainDeps {
  readonly fetchFn: typeof fetch;
  /** Per call. A provider that has not answered by then is skipped. */
  readonly timeoutMs?: number;
  /** Skips a provider that keeps failing, rather than waiting on it each time. */
  readonly breaker?: CircuitBreaker;
}

export type ChainResult =
  | { readonly ok: true; readonly rate: ProviderRate }
  | {
      readonly ok: false;
      /** Every provider said "no such pair" (not one of them was merely down). */
      readonly unsupported: boolean;
      readonly failures: readonly { source: FxSource; reason: ProviderFailure }[];
    };

export const PROVIDER_TIMEOUT_MS = 4000;

/**
 * Bounds no real currency pair leaves. A value outside them is a provider bug
 * (or a unit mix-up), and storing it would convert a bill confidently and
 * wildly wrong.
 */
const MIN_RATE_EXP = -9;
const MAX_RATE_EXP = 9;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A provider's decimal as an exact num/den, with no float arithmetic.
 *
 * The upstreams send JSON numbers, so the value arrives as a double; `String`
 * of a double is the shortest text that reads back as the same double, which
 * for a published decimal is the decimal as published. That text is parsed as
 * digits — including the exponent form JavaScript uses below 1e-6
 * ("3.82e-7") — so 91.2534 becomes 912534/10000 exactly.
 *
 * Returns null for anything that is not a finite, positive rate inside sane
 * bounds.
 */
export function toRational(value: unknown): { num: string; den: string } | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'number' && (!Number.isFinite(value) || value <= 0)) return null;
  const text = String(value).trim();
  const match = /^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(text);
  if (!match) return null;
  const [, whole = '0', fraction = '', exponentText = '0'] = match;
  const exponent = Number(exponentText) - fraction.length;
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 40) return null;
  const digits = BigInt(whole + fraction);
  if (digits <= 0n) return null;
  const num = exponent >= 0 ? digits * 10n ** BigInt(exponent) : digits;
  const den = exponent >= 0 ? 1n : 10n ** BigInt(-exponent);
  // 10^MIN <= num/den <= 10^MAX, compared as integers.
  if (num * 10n ** BigInt(-MIN_RATE_EXP) < den) return null;
  if (num > den * 10n ** BigInt(MAX_RATE_EXP)) return null;
  return { num: num.toString(), den: den.toString() };
}

/** "0.00375" → 3, "266.6667" → 7: how much of the number the provider actually said. */
export function significantDigits(value: unknown): number {
  const text = String(value).trim().toLowerCase();
  const mantissa = text.split('e')[0] ?? '';
  const digits = mantissa.replace('.', '').replace(/^0+/, '');
  if (!/^\d*$/.test(digits)) return 0;
  // A trailing zero after the point is a stated digit, but JSON numbers lose
  // those anyway; trailing zeros of an integer are not precision.
  return mantissa.includes('.') ? digits.length : digits.replace(/0+$/, '').length;
}

/**
 * The more precise of a forward rate and the inverse of a reverse one.
 *
 * ExchangeRate-API rounds: VND→INR comes back as 0.00375 (three digits, so up
 * to ±0.13% wrong) while INR→VND comes back as 266.67. Inverting the side that
 * carries more significant digits keeps the exact fraction honest. An inverse
 * that disagrees with the forward value by more than 2% is a different snapshot
 * or a bad answer, and is ignored.
 */
export function preciseOf(
  forward: unknown,
  reverse: unknown,
): { num: string; den: string; inverted: boolean } | null {
  const f = toRational(forward);
  const r = toRational(reverse);
  if (!f) return r ? { num: r.den, den: r.num, inverted: true } : null;
  if (!r || significantDigits(reverse) <= significantDigits(forward)) {
    return { ...f, inverted: false };
  }
  // f * r should be 1: 0.98 < (fn*rn)/(fd*rd) < 1.02.
  const product = BigInt(f.num) * BigInt(r.num) * 100n;
  const unit = BigInt(f.den) * BigInt(r.den);
  if (product <= unit * 98n || product >= unit * 102n) return { ...f, inverted: false };
  return { num: r.den, den: r.num, inverted: true };
}

function realDay(day: unknown): day is string {
  return typeof day === 'string' && DAY.test(day) && !Number.isNaN(Date.parse(day));
}

async function getJson(
  deps: ChainDeps,
  url: string,
  label: string,
): Promise<{ status: number; ok: boolean; body: unknown } | null> {
  try {
    return await fetchJsonWithDeadline(
      deps.fetchFn,
      url,
      { headers: { Accept: 'application/json' } },
      deps.timeoutMs ?? PROVIDER_TIMEOUT_MS,
      label,
    );
  } catch {
    // Refused, reset, DNS, or past the deadline: all "try the next one".
    return null;
  }
}

const unavailable: ProviderOutcome = { ok: false, reason: 'unavailable' };
const unsupported: ProviderOutcome = { ok: false, reason: 'unsupported' };

function rate(
  exact: { num: string; den: string } | null,
  day: unknown,
  source: FxSource,
): ProviderOutcome {
  if (!exact || !realDay(day)) return unavailable;
  return { ok: true, rate: { ...exact, day, source } };
}

// ───────────────────────────────────────────────────────── 1. ECB ──

export function frankfurterUrl(req: ChainRequest): string {
  return `https://api.frankfurter.dev/v1/${req.date ?? 'latest'}?base=${req.from}&symbols=${req.to}`;
}

/** Frankfurter's answer for `to`. A 404/422 is a currency the ECB does not publish. */
export function parseFrankfurter(status: number, body: unknown, to: string): ProviderOutcome {
  if (status === 404 || status === 422) return unsupported;
  if (status < 200 || status >= 300 || !body || typeof body !== 'object') return unavailable;
  const payload = body as { date?: unknown; rates?: Record<string, unknown> };
  const value = payload.rates?.[to];
  if (value === undefined) return unsupported;
  return rate(toRational(value), payload.date, 'ecb');
}

async function ecb(req: ChainRequest, deps: ChainDeps): Promise<ProviderOutcome> {
  const reply = await getJson(deps, frankfurterUrl(req), 'ecb');
  if (!reply) return unavailable;
  return parseFrankfurter(reply.status, reply.body, req.to);
}

// ────────────────────────────────────────────── 2. currency-api ──

/** jsDelivr first, then the Cloudflare Pages mirror. Lower-case codes. */
export function currencyApiUrls(req: ChainRequest): string[] {
  const version = req.date ?? 'latest';
  const from = req.from.toLowerCase();
  return [
    `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${version}/v1/currencies/${from}.json`,
    `https://${version}.currency-api.pages.dev/v1/currencies/${from}.json`,
  ];
}

/** `{ date, [from]: { [to]: number } }`; the response's own `date` is the rate's day. */
export function parseCurrencyApi(body: unknown, from: string, to: string): ProviderOutcome {
  if (!body || typeof body !== 'object') return unavailable;
  const payload = body as Record<string, unknown>;
  const table = payload[from.toLowerCase()];
  if (!table || typeof table !== 'object') return unsupported;
  const value = (table as Record<string, unknown>)[to.toLowerCase()];
  if (value === undefined) return unsupported;
  return rate(toRational(value), payload.date, 'currency-api');
}

async function currencyApi(req: ChainRequest, deps: ChainDeps): Promise<ProviderOutcome> {
  let sawNotFound = false;
  for (const url of currencyApiUrls(req)) {
    const reply = await getJson(deps, url, 'currency-api');
    if (!reply) continue;
    if (reply.status === 404) {
      // No package for that day on this host; the mirror may still have it.
      sawNotFound = true;
      continue;
    }
    if (!reply.ok) continue;
    const outcome = parseCurrencyApi(reply.body, req.from, req.to);
    // A malformed body on one host is worth the other host.
    if (!outcome.ok && outcome.reason === 'unavailable') continue;
    return outcome;
  }
  return sawNotFound ? unsupported : unavailable;
}

// ──────────────────────────────────────────── 3. ExchangeRate-API ──

export function erApiUrl(base: string): string {
  return `https://open.er-api.com/v6/latest/${base}`;
}

/** `rates[code]` from an open.er-api.com body, or why there is none. */
export function erApiValue(
  body: unknown,
  code: string,
): { value: unknown } | { reason: ProviderFailure } {
  if (!body || typeof body !== 'object') return { reason: 'unavailable' };
  const payload = body as {
    result?: unknown;
    'error-type'?: unknown;
    rates?: Record<string, unknown>;
  };
  if (payload.result !== 'success') {
    return { reason: payload['error-type'] === 'unsupported-code' ? 'unsupported' : 'unavailable' };
  }
  const value = payload.rates?.[code];
  return value === undefined ? { reason: 'unsupported' } : { value };
}

async function exchangeRateApi(req: ChainRequest, deps: ChainDeps): Promise<ProviderOutcome> {
  const reply = await getJson(deps, erApiUrl(req.from), 'exchangerate-api');
  if (!reply) return unavailable;
  const forward = erApiValue(reply.body, req.to);
  if ('reason' in forward) {
    return reply.status === 404 ? unsupported : { ok: false, reason: forward.reason };
  }
  // A small forward value is a rounded one (0.00375): the other base's view of
  // the pair is the precise side.
  let reverse: unknown = undefined;
  const exact = toRational(forward.value);
  if (exact && BigInt(exact.num) < BigInt(exact.den)) {
    const back = await getJson(deps, erApiUrl(req.to), 'exchangerate-api');
    if (back) {
      const value = erApiValue(back.body, req.from);
      if ('value' in value) reverse = value.value;
    }
  }
  const chosen = preciseOf(forward.value, reverse);
  // Latest only: it is today's rate, and saying it was the bill's day's would
  // misreport when the number was true.
  return rate(chosen && { num: chosen.num, den: chosen.den }, req.today, 'exchangerate-api');
}

// ───────────────────────────────────────────────────────── chain ──

const PROVIDERS: readonly {
  source: FxSource;
  run: (req: ChainRequest, deps: ChainDeps) => Promise<ProviderOutcome>;
}[] = [
  { source: 'ecb', run: ecb },
  { source: 'currency-api', run: currencyApi },
  { source: 'exchangerate-api', run: exchangeRateApi },
];

/** The first provider that has the rate, in order; or why none did. */
export async function fetchFromChain(req: ChainRequest, deps: ChainDeps): Promise<ChainResult> {
  const failures: { source: FxSource; reason: ProviderFailure }[] = [];
  for (const provider of PROVIDERS) {
    const key = `fx:${provider.source}`;
    if (deps.breaker?.isOpen(key)) {
      failures.push({ source: provider.source, reason: 'unavailable' });
      continue;
    }
    let outcome: ProviderOutcome;
    try {
      outcome = await provider.run(req, deps);
    } catch {
      outcome = unavailable;
    }
    if (outcome.ok || outcome.reason === 'unsupported') deps.breaker?.success(key);
    else deps.breaker?.failure(key);
    if (outcome.ok) return outcome;
    failures.push({ source: provider.source, reason: outcome.reason });
  }
  return {
    ok: false,
    unsupported: failures.every((failure) => failure.reason === 'unsupported'),
    failures,
  };
}
