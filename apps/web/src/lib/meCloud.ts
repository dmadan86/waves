'use client';

/**
 * The two Edge Function calls the Me page makes. Both carry the caller's JWT
 * (supabase-js adds it); neither is logged, and a refusal is read for its code only.
 */

import { validateStatementExtraction, type ParseCallResult, type ParseRequest } from '@waves/core';

import { supabase } from '@/lib/waves';

const TIMEOUT_MS = 120_000;

async function refusalOf(
  error: unknown,
): Promise<{ status: number; code: string; body: Record<string, unknown> | null }> {
  const response = (error as { context?: unknown })?.context;
  if (typeof Response !== 'undefined' && response instanceof Response) {
    const body = (await response
      .clone()
      .json()
      .catch(() => null)) as Record<string, unknown> | null;
    return { status: response.status, code: typeof body?.code === 'string' ? body.code : '', body };
  }
  return { status: 0, code: '', body: null };
}

/** `parse-statement`, exactly as the phone calls it: redacted page text or images and nothing else. */
export async function callParseStatement(request: ParseRequest): Promise<ParseCallResult> {
  try {
    const { data, error } = await supabase.functions.invoke('parse-statement', {
      body: {
        importId: request.importId,
        ...(request.continuation ? { continuation: request.continuation } : {}),
        pages: request.pages,
        hints: request.hints,
      },
      timeout: TIMEOUT_MS,
    });
    if (error) {
      const { status, code, body } = await refusalOf(error);
      if (status === 402 || code === 'STATEMENT_IMPORT_PAID') return { kind: 'paid' };
      if (code === 'STATEMENT_QUOTA_REACHED')
        return { kind: 'quota', used: Number(body?.used ?? 0), limit: Number(body?.limit ?? 0) };
      if (code === 'INVALID_CONTINUATION') return { kind: 'expired' };
      if (code === 'TOO_MANY_ROWS_IN_PAGES') return { kind: 'dense' };
      if (code === 'STATEMENT_SCAN_REFUSED') return { kind: 'refused' };
      if (status === 429) return { kind: 'rate' };
      if (status === 503) return { kind: 'unavailable' };
      return { kind: 'error' };
    }
    const answer = data as {
      rows?: unknown;
      currency?: unknown;
      openingBalance?: unknown;
      continuation?: unknown;
      quota?: { used?: unknown; limit?: unknown } | null;
    } | null;
    // Checked again here: a row is not trusted because the server sent it.
    const checked = validateStatementExtraction({
      currency: answer?.currency,
      openingBalance: answer?.openingBalance,
      rows: answer?.rows,
    });
    if (!checked.ok) return { kind: 'error' };
    return {
      kind: 'ok',
      rows: [...checked.extraction.rows],
      currency: checked.extraction.currency,
      openingBalance: checked.extraction.openingBalance,
      warnings: checked.extraction.warnings,
      continuation: typeof answer?.continuation === 'string' ? answer.continuation : null,
      quota:
        answer?.quota && typeof answer.quota.used === 'number'
          ? { used: answer.quota.used, limit: Number(answer.quota.limit) }
          : null,
    };
  } catch {
    return { kind: 'error' };
  }
}

/** The contract of `spending-ask` (built on feat/spending-ask): aggregates in, an answer and facts out. */
export interface SpendingAskRequest {
  question: string;
  from: string;
  to: string;
  currency?: string;
}
export interface SpendingAnswer {
  answer: string;
  facts: { label: string; amountMinor: string; currency: string }[];
  subscriptions?: {
    merchant: string;
    amountMinor: string;
    currency: string;
    cadence: 'monthly' | 'weekly' | 'yearly';
    lastDate: string;
  }[];
}
export type SpendingAskResult =
  | { ok: true; answer: SpendingAnswer }
  | { ok: false; reason: 'paid' | 'rate' | 'invalid' | 'error' };

export async function askSpending(request: SpendingAskRequest): Promise<SpendingAskResult> {
  try {
    const { data, error } = await supabase.functions.invoke('spending-ask', { body: request });
    if (error) {
      const { status } = await refusalOf(error);
      if (status === 402) return { ok: false, reason: 'paid' };
      if (status === 429) return { ok: false, reason: 'rate' };
      return { ok: false, reason: status >= 400 && status < 500 ? 'invalid' : 'error' };
    }
    const body = data as Partial<SpendingAnswer> | null;
    if (!body || typeof body.answer !== 'string' || !Array.isArray(body.facts)) {
      return { ok: false, reason: 'error' };
    }
    return { ok: true, answer: body as SpendingAnswer };
  } catch {
    return { ok: false, reason: 'error' };
  }
}
