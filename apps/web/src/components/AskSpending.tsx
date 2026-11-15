'use client';

/**
 * "Ask about my spending": one question about one month, answered by the
 * `spending-ask` function (Pro). Shown only when the feature flag is on for this
 * account and the server says the plan is Pro, the same two checks the phone
 * uses. The answer is text and figures to read; nothing here writes anything (ADR-008).
 */

import { useState } from 'react';
import Link from 'next/link';

import { useStrings } from '@/i18n-context';
import { useFlagEnabled } from '@/lib/flags';
import { monthBounds } from '@/lib/me';
import { askSpending, type SpendingAnswer } from '@/lib/meCloud';
import { money } from '@/lib/money';
import { usePlan } from '@/lib/plan';

export const SPENDING_ASK_FLAG = 'spending_ask';

export function AskSpending({ month, currency }: { month: string; currency: string }) {
  const { t, locale } = useStrings();
  const flagOn = useFlagEnabled(SPENDING_ASK_FLAG);
  const { isPaid, loading } = usePlan();
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<SpendingAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!flagOn || loading) return null;
  const a = t.me.ask;
  if (!isPaid) {
    return (
      <section className="panel">
        <div className="panel-head">
          <h2>{a.title}</h2>
        </div>
        <p className="meta">{a.proOnly}</p>
        <Link className="btn soft" href="/settings/plan">
          {t.me.importPage.upgrade}
        </Link>
      </section>
    );
  }

  async function submit() {
    const text = question.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    setAnswer(null);
    const result = await askSpending({
      question: text.slice(0, 500),
      ...monthBounds(month),
      currency,
    });
    setBusy(false);
    if (result.ok) setAnswer(result.answer);
    else
      setError(
        result.reason === 'paid'
          ? a.proOnly
          : result.reason === 'rate'
            ? a.rate
            : result.reason === 'invalid'
              ? a.invalid
              : a.error,
      );
  }

  return (
    <section className="panel" aria-label={a.title}>
      <div className="panel-head">
        <h2>{a.title}</h2>
      </div>
      <p className="meta">{a.hint}</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label>
          <span className="meta">{a.label}</span>
          <input
            value={question}
            maxLength={500}
            placeholder={a.placeholder}
            onChange={(event) => setQuestion(event.target.value)}
          />
        </label>
        <button type="submit" className="btn brand" disabled={busy || !question.trim()}>
          {busy ? a.asking : a.submit}
        </button>
      </form>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {answer ? (
        <div aria-live="polite" data-testid="ask-answer">
          <p style={{ overflowWrap: 'anywhere' }}>{answer.answer}</p>
          <ul className="list">
            {answer.facts.map((fact) => (
              <li key={`${fact.label}:${fact.amountMinor}`} className="row">
                <span className="grow">{fact.label}</span>
                <strong>{money(BigInt(fact.amountMinor), fact.currency, locale)}</strong>
              </li>
            ))}
          </ul>
          {answer.subscriptions?.length ? (
            <>
              <h3>{a.subscriptions}</h3>
              <ul className="list">
                {answer.subscriptions.map((s) => (
                  <li key={`${s.merchant}:${s.cadence}`} className="row">
                    <span className="grow">
                      {s.merchant} <span className="meta">{a.cadence[s.cadence]}</span>
                    </span>
                    <strong>{money(BigInt(s.amountMinor), s.currency, locale)}</strong>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
