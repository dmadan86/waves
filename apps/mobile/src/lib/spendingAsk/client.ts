/**
 * The call to `spending-ask`. The request is the question and a date range; the
 * server reads the person's own ledger and sends a digest to the model. The reply
 * is checked here before anything is drawn: the app does not trust an amount
 * because the server sent it.
 */

import { backend } from '@/lib/backend';

export interface AskFact {
  label: string;
  amountMinor: string;
  currency: string;
}
export interface AskSubscription {
  merchant: string;
  amountMinor: string;
  currency: string;
  cadence: 'monthly' | 'weekly' | 'yearly';
  lastDate: string;
}
export interface AskAnswer {
  answer: string;
  facts: AskFact[];
  subscriptions: AskSubscription[];
}
export type AskResult =
  | { kind: 'ok'; answer: AskAnswer }
  | { kind: 'paid' }
  | { kind: 'quota'; used: number; limit: number }
  | { kind: 'rate' }
  | { kind: 'unavailable' }
  | { kind: 'error' };

const MINOR = /^-?\d{1,18}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const CODE = /^[A-Z]{3}$/;

/** Keeps only well-formed rows; null when the reply is not an answer at all. */
export function parseAskAnswer(data: unknown): AskAnswer | null {
  const d = data as { answer?: unknown; facts?: unknown; subscriptions?: unknown } | null;
  if (!d || typeof d.answer !== 'string' || d.answer.trim() === '') return null;
  const facts = (Array.isArray(d.facts) ? d.facts : []).flatMap((f): AskFact[] => {
    const r = f as Partial<AskFact>;
    return typeof r.label === 'string' &&
      typeof r.amountMinor === 'string' &&
      MINOR.test(r.amountMinor) &&
      typeof r.currency === 'string' &&
      CODE.test(r.currency)
      ? [{ label: r.label, amountMinor: r.amountMinor, currency: r.currency }]
      : [];
  });
  const subscriptions = (Array.isArray(d.subscriptions) ? d.subscriptions : []).flatMap(
    (s): AskSubscription[] => {
      const r = s as Partial<AskSubscription>;
      return typeof r.merchant === 'string' &&
        typeof r.amountMinor === 'string' &&
        /^\d{1,18}$/.test(r.amountMinor) &&
        typeof r.currency === 'string' &&
        CODE.test(r.currency) &&
        (r.cadence === 'monthly' || r.cadence === 'weekly' || r.cadence === 'yearly') &&
        typeof r.lastDate === 'string' &&
        DAY.test(r.lastDate)
        ? [
            {
              merchant: r.merchant,
              amountMinor: r.amountMinor,
              currency: r.currency,
              cadence: r.cadence,
              lastDate: r.lastDate,
            },
          ]
        : [];
    },
  );
  return { answer: d.answer.trim(), facts, subscriptions };
}

/** Reads a refusal by its status and code only; the body is never logged. */
export async function askRefusal(error: unknown): Promise<AskResult> {
  const response = (error as { context?: unknown })?.context;
  if (typeof Response !== 'undefined' && response instanceof Response) {
    const body = (await response
      .clone()
      .json()
      .catch(() => null)) as { code?: unknown; used?: unknown; limit?: unknown } | null;
    const code = typeof body?.code === 'string' ? body.code : '';
    if (response.status === 402 || code === 'SPENDING_ASK_PAID') return { kind: 'paid' };
    if (code === 'SPENDING_ASK_QUOTA_REACHED') {
      return { kind: 'quota', used: Number(body?.used ?? 0), limit: Number(body?.limit ?? 0) };
    }
    if (response.status === 429) return { kind: 'rate' };
    if (response.status === 503) return { kind: 'unavailable' };
  }
  return { kind: 'error' };
}

export async function callSpendingAsk(request: {
  question: string;
  from: string;
  to: string;
  currency?: string;
}): Promise<AskResult> {
  try {
    const { data, error } = await backend.functions.invoke('spending-ask', {
      body: request,
      timeout: 60_000,
    });
    if (error) return await askRefusal(error);
    const answer = parseAskAnswer(data);
    return answer ? { kind: 'ok', answer } : { kind: 'error' };
  } catch {
    return { kind: 'error' };
  }
}
