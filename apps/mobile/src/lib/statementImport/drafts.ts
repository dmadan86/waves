/**
 * Statement rows into Review drafts.
 *
 * The same device-only store as the bank messages (`smsDrafts`), marked
 * `source: 'statement'`. Never posted: a draft is confirmed through Review like
 * any other. Nothing of the statement's text is kept: the description is the
 * counterparty or a trimmed narration, `raw_text` is always null.
 *
 * A row whose reference matches an SMS draft already waiting does not become a
 * second draft: it enriches that one (`merged_sms`).
 */

import { guessCategory, parseNarration, type StatementItem, type StatementPlan } from '@waves/core';

import type { CaptureRow } from '@/data/types';

import type { DraftCache } from '../smsDraftCache';
import { draftRowFromPayload, type SerialisedCapture } from '../smsLocalDrafts';

export interface StatementDraftProvenance {
  readonly source: 'statement';
  readonly dedupeKey: string;
  readonly direction: 'debit' | 'credit';
  readonly ref: string | null;
  /** Signed minor units, as printed. */
  readonly balance: string | null;
  readonly confidence: number;
  readonly dateInferred: boolean;
}

const MAX_DESCRIPTION = 80;

/** Who/what the row is about, in the statement's own words. */
export function draftDescription(narration: string): string {
  const parsed = parseNarration(narration);
  const text = parsed.counterparty ?? narration.replace(/\s+/g, ' ').trim();
  return text.length > MAX_DESCRIPTION ? `${text.slice(0, MAX_DESCRIPTION - 1)}…` : text;
}

/** Below this a row reads as hard to read in Review. */
const FLAGGED_CONFIDENCE = 0.5;

export function draftPayload(
  item: StatementItem,
  currency: string,
  today: string,
): SerialisedCapture & { captureKey: string } {
  const description = draftDescription(item.row.description);
  const flagged = item.flags.length > 0;
  const undated = item.row.date === null;
  const provenance: StatementDraftProvenance = {
    source: 'statement',
    dedupeKey: item.key,
    direction: item.row.direction,
    ref: item.row.ref,
    balance: item.row.balance,
    confidence: flagged ? Math.min(item.row.confidence, FLAGGED_CONFIDENCE) : item.row.confidence,
    dateInferred: undated,
  };
  return {
    captureKey: item.key,
    captureId: '',
    description,
    category: guessCategory(description),
    expenseDate: item.row.date ?? today,
    currency,
    amount: item.row.amount,
    rawText: null,
    parsed: { ...provenance },
  };
}

export interface ApplyDeps {
  readonly ownerId: string;
  readonly drafts: DraftCache;
  /** The stable id for the draft a key becomes (`smsCaptureId`). */
  readonly idFor: (key: string) => Promise<string>;
  readonly now: () => string;
}

export interface ApplyResult {
  /** New drafts written. */
  readonly added: number;
  /** Statement rows folded into an SMS draft that was already waiting. */
  readonly enriched: number;
  /** Ticked rows this phone already had, or had already used or dismissed. */
  readonly alreadyHad: number;
}

/** What an SMS draft learns from the statement row that matches it. */
export function enrichDraft(row: CaptureRow, item: StatementItem): CaptureRow {
  const parsed = { ...(row.parsed ?? {}) } as Record<string, unknown>;
  parsed.statement = { matched: true, balance: item.row.balance };
  // The bank's statement names the payee more reliably than a message does.
  const description =
    row.description.trim() === '' ? draftDescription(item.row.description) : row.description;
  return { ...row, description, parsed };
}

/**
 * Write the ticked rows as drafts and fold the matched ones into their SMS
 * drafts. Each is its own attempt: one that refuses does not take the others
 * down, and the counts are what actually landed.
 */
export async function applyStatementPlan(
  plan: StatementPlan,
  ticked: ReadonlySet<string>,
  context: { currency: string; today: string },
  deps: ApplyDeps,
): Promise<ApplyResult> {
  let added = 0;
  let enriched = 0;
  let alreadyHad = 0;

  for (const item of plan.items) {
    if (item.status === 'duplicate_in_file') continue;

    if (item.status === 'merged_sms') {
      const id = await deps.idFor(item.key);
      const done = await deps.drafts.update(deps.ownerId, id, (row) => enrichDraft(row, item));
      if (done) enriched += 1;
      continue;
    }

    if (!ticked.has(item.key)) continue;
    const { captureKey: _key, ...payload } = draftPayload(item, context.currency, context.today);
    const captureId = await deps.idFor(item.key);
    const row = draftRowFromPayload(deps.ownerId, { ...payload, captureId }, deps.now());
    if (await deps.drafts.put(deps.ownerId, row)) added += 1;
    else alreadyHad += 1;
  }
  return { added, enriched, alreadyHad };
}
