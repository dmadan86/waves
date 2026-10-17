/**
 * The call to `parse-statement`. The request carries redacted page text or page
 * images and nothing else: no file name, no password, no account id. Nothing here
 * is logged; a refusal is read for its code only.
 */

import { validateStatementExtraction } from '@waves/core';

import { backend } from '@/lib/backend';

import type { ParseCallResult, ParseRequest } from './run';

const TIMEOUT_MS = 120_000;

async function refusal(error: unknown): Promise<ParseCallResult> {
  const response = (error as { context?: unknown })?.context;
  if (typeof Response !== 'undefined' && response instanceof Response) {
    const body = (await response
      .clone()
      .json()
      .catch(() => null)) as { code?: unknown; used?: unknown; limit?: unknown } | null;
    const code = typeof body?.code === 'string' ? body.code : '';
    if (response.status === 402 || code === 'STATEMENT_IMPORT_PAID') return { kind: 'paid' };
    if (code === 'STATEMENT_QUOTA_REACHED') {
      return { kind: 'quota', used: Number(body?.used ?? 0), limit: Number(body?.limit ?? 0) };
    }
    if (code === 'INVALID_CONTINUATION') return { kind: 'expired' };
    if (code === 'TOO_MANY_ROWS_IN_PAGES') return { kind: 'dense' };
    if (code === 'STATEMENT_SCAN_REFUSED') return { kind: 'refused' };
    if (response.status === 429) return { kind: 'rate' };
    if (response.status === 503) return { kind: 'unavailable' };
  }
  return { kind: 'error' };
}

export async function callParseStatement(request: ParseRequest): Promise<ParseCallResult> {
  try {
    const { data, error } = await backend.functions.invoke('parse-statement', {
      body: {
        importId: request.importId,
        ...(request.continuation ? { continuation: request.continuation } : {}),
        pages: request.pages,
        hints: request.hints,
      },
      timeout: TIMEOUT_MS,
    });
    if (error) return await refusal(error);
    const answer = data as {
      rows?: unknown;
      currency?: unknown;
      openingBalance?: unknown;
      warnings?: unknown;
      continuation?: unknown;
      quota?: { used?: unknown; limit?: unknown } | null;
    } | null;
    // Checked again here: the app does not trust a row because the server sent it.
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
