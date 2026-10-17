/**
 * Reading a statement's pages through `parse-statement`, a few at a time.
 *
 * Pure apart from the injected `call`, so the chunking, the continuation token,
 * the split-on-dense retry and the final balance check are unit tests.
 *
 * One file is one use of the monthly allowance: the first request carries no
 * continuation and reserves it; every later request carries the token the first
 * answer returned.
 */

import {
  applyBalanceCheck,
  STATEMENT_MAX_CHARS_PER_REQUEST,
  STATEMENT_MAX_IMAGES_PER_REQUEST,
  STATEMENT_MAX_ROWS,
  STATEMENT_PAGES_PER_REQUEST,
  type StatementRow,
  type StatementWarning,
} from '@waves/core';

export type StatementPageInput =
  | { readonly kind: 'text'; readonly page: number; readonly text: string }
  | {
      readonly kind: 'image';
      readonly page: number;
      readonly base64: string;
      readonly mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
    };

export interface StatementHints {
  readonly currency: string;
  readonly today: string;
  readonly locale: string | null;
  readonly country: string | null;
  readonly bank: string | null;
}

export interface ParseRequest {
  readonly importId: string;
  readonly continuation: string | null;
  readonly pages: readonly StatementPageInput[];
  readonly hints: StatementHints;
}

export type ParseCallResult =
  | {
      readonly kind: 'ok';
      readonly rows: StatementRow[];
      readonly currency: string | null;
      readonly openingBalance: string | null;
      readonly warnings: readonly StatementWarning[];
      readonly continuation: string | null;
      readonly quota: { used: number; limit: number } | null;
    }
  | { readonly kind: 'paid' }
  | { readonly kind: 'quota'; readonly used: number; readonly limit: number }
  | { readonly kind: 'expired' }
  | { readonly kind: 'dense' }
  | { readonly kind: 'refused' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'rate' }
  | { readonly kind: 'error' };

export type ReadFailure = Exclude<ParseCallResult['kind'], 'ok'>;

export type ReadOutcome =
  | {
      readonly ok: true;
      readonly rows: StatementRow[];
      readonly currency: string | null;
      readonly openingBalance: string | null;
      readonly quota: { used: number; limit: number } | null;
      readonly truncated: boolean;
    }
  | { readonly ok: false; readonly reason: ReadFailure };

const weight = (page: StatementPageInput): number => (page.kind === 'text' ? page.text.length : 0);

/** Pages into requests: at most 5 pages, 60k characters and 3 images each. */
export function chunkPages(pages: readonly StatementPageInput[]): StatementPageInput[][] {
  const chunks: StatementPageInput[][] = [];
  let current: StatementPageInput[] = [];
  let chars = 0;
  let images = 0;
  for (const page of pages) {
    const w = weight(page);
    const full =
      current.length >= STATEMENT_PAGES_PER_REQUEST ||
      (current.length > 0 && chars + w > STATEMENT_MAX_CHARS_PER_REQUEST) ||
      (page.kind === 'image' && images >= STATEMENT_MAX_IMAGES_PER_REQUEST);
    if (full) {
      chunks.push(current);
      current = [];
      chars = 0;
      images = 0;
    }
    current.push(page);
    chars += w;
    if (page.kind === 'image') images += 1;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

export interface ReadArgs {
  readonly pages: readonly StatementPageInput[];
  readonly importId: string;
  readonly hints: StatementHints;
  readonly call: (request: ParseRequest) => Promise<ParseCallResult>;
  readonly onProgress?: (done: number, total: number) => void;
}

export async function readStatementPages(args: ReadArgs): Promise<ReadOutcome> {
  const chunks = chunkPages(args.pages);
  const rows: StatementRow[] = [];
  let currency: string | null = null;
  let openingBalance: string | null = null;
  let quota: { used: number; limit: number } | null = null;
  let continuation: string | null = null;
  let done = 0;
  const total = args.pages.length;

  // A queue, so a chunk the model found too dense can be put back as two halves.
  const queue = [...chunks];
  while (queue.length > 0) {
    const chunk = queue.shift()!;
    const result = await args.call({
      importId: args.importId,
      continuation,
      pages: chunk,
      hints: args.hints,
    });
    if (result.kind === 'dense') {
      if (chunk.length === 1) return { ok: false, reason: 'dense' };
      const mid = Math.ceil(chunk.length / 2);
      queue.unshift(chunk.slice(0, mid), chunk.slice(mid));
      continue;
    }
    if (result.kind !== 'ok') return { ok: false, reason: result.kind };

    continuation = result.continuation ?? continuation;
    quota = quota ?? result.quota;
    currency = currency ?? result.currency;
    if (openingBalance === null && rows.length === 0) openingBalance = result.openingBalance;
    rows.push(...result.rows);
    done += chunk.length;
    args.onProgress?.(done, total);
  }

  const truncated = rows.length > STATEMENT_MAX_ROWS;
  const kept = rows.slice(0, STATEMENT_MAX_ROWS).map((row, index) => ({ ...row, index }));
  // One check over the whole file: balances run across page and request boundaries.
  const checked = applyBalanceCheck(kept, { openingBalance });
  return { ok: true, rows: checked.rows, currency, openingBalance, quota, truncated };
}
