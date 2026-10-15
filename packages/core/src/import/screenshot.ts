/**
 * Screenshot import: what the vision model said, checked.
 *
 * The `import-screenshot` edge function asks a model to transcribe a screenshot
 * of an expense list (a Splitwise screen, a UPI or bank history, a chat, a paper
 * list) into rows. The model reads; it does not decide. Everything it returns
 * goes through {@link validateScreenshotExtraction} before a person sees it, and
 * even then every row reaches the review screen as something to check, never as
 * an expense.
 *
 * Pure: no I/O, no clock, no randomness. Amounts stay integers in minor units
 * (ADR-003); they are plain numbers here because the result crosses JSON, and
 * anything beyond Number.MAX_SAFE_INTEGER is rejected rather than rounded.
 */

import { CategoryId, guessCategory } from '../category/categories';

export const SCREENSHOT_IMAGE_KINDS = [
  'expense_list',
  'bank_or_upi_history',
  'chat_message',
  'receipt',
  'splitwise_screen',
  'spreadsheet',
  'other',
] as const;
export type ScreenshotImageKind = (typeof SCREENSHOT_IMAGE_KINDS)[number];

export const SCREENSHOT_DIRECTIONS = ['spent', 'received', 'transfer', 'unknown'] as const;
export type ScreenshotDirection = (typeof SCREENSHOT_DIRECTIONS)[number];

/** Rows below this start unticked in the review list. */
export const SCREENSHOT_LOW_CONFIDENCE = 0.6;

export type ScreenshotRowWarning =
  | 'bad_date'
  | 'bad_currency'
  | 'zero_amount'
  | 'split_sum_mismatch'
  | 'low_confidence'
  | 'credit_or_transfer';

export type ScreenshotWarningCode =
  'rows_dropped_invalid' | 'summary_rows_dropped' | 'no_rows' | 'image_kind_unknown';

export interface ScreenshotWarning {
  readonly code: ScreenshotWarningCode;
  /** How many rows the warning is about, where that makes sense. */
  readonly count: number;
}

export interface ScreenshotRow {
  /** Position in the model's output, so a dropped row leaves the others stable. */
  readonly index: number;
  /** YYYY-MM-DD, or null when the image gave none or it was not a real date. */
  readonly date: string | null;
  readonly dateText: string | null;
  readonly description: string;
  /** Integer minor units, >= 0. */
  readonly amountMinor: number;
  /** ISO 4217, or null meaning the image's (or the group's) currency. */
  readonly currency: string | null;
  readonly direction: ScreenshotDirection;
  readonly paidBy: string | null;
  readonly splitAmong: readonly string[];
  readonly perPerson: readonly { readonly name: string; readonly amountMinor: number }[];
  readonly category: CategoryId | null;
  /** 0..1. */
  readonly confidence: number;
  readonly warnings: readonly ScreenshotRowWarning[];
}

export interface ScreenshotExtraction {
  readonly imageKind: ScreenshotImageKind;
  readonly currency: string | null;
  readonly rows: readonly ScreenshotRow[];
  readonly warnings: readonly ScreenshotWarning[];
  /**
   * Every distinct name the image used, mapped to the group member it most
   * likely is, or null. A suggestion only: the person confirms the mapping.
   */
  readonly suggestedMembers: Readonly<Record<string, string | null>>;
}

export interface ScreenshotValidationOptions {
  /** Display names of the group's members. */
  readonly members?: readonly string[];
  /** Country code, for the category vocabulary of that market. */
  readonly country?: string | null;
}

export type ScreenshotValidation =
  | { readonly ok: true; readonly extraction: ScreenshotExtraction }
  | { readonly ok: false; readonly reason: 'malformed' };

const CURRENCY_RE = /^[A-Z]{3}$/;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** More rows than this in one screenshot is not a screenshot. */
const MAX_ROWS = 300;
const MAX_DESCRIPTION = 200;
const MAX_NAME = 60;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  return text === '' ? null : text.slice(0, max);
}

function validIsoDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = ISO_DATE_RE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1990 || year > 2100 || month < 1 || month > 12 || day < 1) return null;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth ? value : null;
}

function safeMinor(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** Lowercase, accents and punctuation gone; scripts other than Latin survive. */
function fold(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = prev[j]!;
      prev[j] = Math.min(
        above + 1,
        prev[j - 1]! + 1,
        diagonal + (a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return prev[b.length]!;
}

/**
 * Which member does this printed name probably mean? Exact (after folding),
 * then a unique first-name or prefix match, then a unique near miss. Ambiguity
 * is null: a wrong suggestion is worse than none.
 */
export function suggestMember(name: string, members: readonly string[]): string | null {
  const target = fold(name);
  if (target === '') return null;
  const folded = members.map((member) => ({ member, key: fold(member) }));

  const exact = folded.filter((m) => m.key === target);
  if (exact.length === 1) return exact[0]!.member;
  if (exact.length > 1) return null;

  if (target.length >= 2) {
    const partial = folded.filter(
      (m) =>
        m.key.startsWith(target) ||
        target.startsWith(m.key) ||
        m.key.split(' ')[0] === target.split(' ')[0],
    );
    const real = partial.filter((m) => m.key !== '');
    if (real.length === 1) return real[0]!.member;
    if (real.length > 1) return null;
  }

  if (target.length >= 4) {
    const allowed = target.length >= 8 ? 2 : 1;
    const near = folded
      .map((m) => ({ ...m, distance: editDistance(target, m.key) }))
      .filter((m) => m.distance <= allowed)
      .sort((x, y) => x.distance - y.distance);
    if (near.length > 0 && (near.length === 1 || near[0]!.distance < near[1]!.distance)) {
      return near[0]!.member;
    }
  }
  return null;
}

function dedupeNames(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const name = cleanText(value, MAX_NAME);
    if (!name) continue;
    const key = fold(name) || name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

function categoryFor(
  raw: unknown,
  description: string,
  country: string | null | undefined,
): CategoryId | null {
  if (typeof raw === 'string') {
    const wanted = raw.trim().toLowerCase();
    const known = Object.values(CategoryId).find((id) => id === wanted);
    if (known && known !== CategoryId.Other) return known;
  }
  return guessCategory(description, country);
}

export function validateScreenshotExtraction(
  raw: unknown,
  options: ScreenshotValidationOptions = {},
): ScreenshotValidation {
  if (!isRecord(raw) || !Array.isArray(raw.rows)) return { ok: false, reason: 'malformed' };

  const warnings: ScreenshotWarning[] = [];

  const kind = (SCREENSHOT_IMAGE_KINDS as readonly unknown[]).includes(raw.imageKind)
    ? (raw.imageKind as ScreenshotImageKind)
    : 'other';
  if (kind !== raw.imageKind) warnings.push({ code: 'image_kind_unknown', count: 1 });

  const imageCurrency =
    typeof raw.currency === 'string' && CURRENCY_RE.test(raw.currency.trim().toUpperCase())
      ? raw.currency.trim().toUpperCase()
      : null;

  const rows: ScreenshotRow[] = [];
  let invalid = 0;
  let summaries = 0;

  raw.rows.slice(0, MAX_ROWS).forEach((item, index) => {
    if (!isRecord(item)) {
      invalid += 1;
      return;
    }
    if (item.isTotalOrSummary === true) {
      summaries += 1;
      return;
    }
    const description = cleanText(item.description, MAX_DESCRIPTION);
    const amountMinor = safeMinor(item.amountMinor);
    if (description === null || amountMinor === null) {
      invalid += 1;
      return;
    }

    const rowWarnings: ScreenshotRowWarning[] = [];

    const date = validIsoDate(item.date);
    if (typeof item.date === 'string' && item.date.trim() !== '' && date === null) {
      rowWarnings.push('bad_date');
    }

    let currency: string | null = null;
    if (typeof item.currency === 'string' && item.currency.trim() !== '') {
      const code = item.currency.trim().toUpperCase();
      if (CURRENCY_RE.test(code)) currency = code;
      else rowWarnings.push('bad_currency');
    }

    if (amountMinor === 0) rowWarnings.push('zero_amount');

    const direction = (SCREENSHOT_DIRECTIONS as readonly unknown[]).includes(item.direction)
      ? (item.direction as ScreenshotDirection)
      : 'unknown';
    if (direction === 'received' || direction === 'transfer')
      rowWarnings.push('credit_or_transfer');

    const perPerson: { name: string; amountMinor: number }[] = [];
    if (Array.isArray(item.perPerson)) {
      for (const entry of item.perPerson) {
        if (!isRecord(entry)) continue;
        const name = cleanText(entry.name, MAX_NAME);
        const share = safeMinor(entry.amountMinor);
        if (name && share !== null) perPerson.push({ name, amountMinor: share });
      }
    }
    if (perPerson.length > 0) {
      const total = perPerson.reduce((sum, p) => sum + p.amountMinor, 0);
      if (total !== amountMinor) rowWarnings.push('split_sum_mismatch');
    }

    const confidence =
      typeof item.confidence === 'number' && Number.isFinite(item.confidence)
        ? Math.min(1, Math.max(0, item.confidence))
        : 0;
    if (confidence < SCREENSHOT_LOW_CONFIDENCE) rowWarnings.push('low_confidence');

    rows.push({
      index,
      date,
      dateText: cleanText(item.dateText, 40),
      description,
      amountMinor,
      currency,
      direction,
      paidBy: cleanText(item.paidBy, MAX_NAME),
      splitAmong: dedupeNames(item.splitAmong),
      perPerson,
      category: categoryFor(item.category, description, options.country),
      confidence,
      warnings: rowWarnings,
    });
  });

  invalid += Math.max(0, raw.rows.length - MAX_ROWS);
  if (invalid > 0) warnings.push({ code: 'rows_dropped_invalid', count: invalid });
  if (summaries > 0) warnings.push({ code: 'summary_rows_dropped', count: summaries });
  if (rows.length === 0) warnings.push({ code: 'no_rows', count: 0 });

  const members = options.members ?? [];
  const suggestedMembers: Record<string, string | null> = {};
  for (const row of rows) {
    const names = [
      ...(row.paidBy ? [row.paidBy] : []),
      ...row.splitAmong,
      ...row.perPerson.map((p) => p.name),
    ];
    for (const name of names) {
      if (!(name in suggestedMembers)) suggestedMembers[name] = suggestMember(name, members);
    }
  }

  return {
    ok: true,
    extraction: { imageKind: kind, currency: imageCurrency, rows, warnings, suggestedMembers },
  };
}
