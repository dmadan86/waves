'use client';

/**
 * Typing in a promotion code.
 *
 * The grant is not written from here. `subscriptions` is not writable by a
 * client and `waves_redeem_promo` is SECURITY DEFINER for exactly that reason —
 * a paywall a client can insert its own row into is a paywall with a door in
 * the back. This screen collects a code and says what came back.
 *
 * Every refusal gets its own sentence. Expired, used up and mistyped send
 * somebody to check three different things, and one "that did not work" makes
 * them check all three. The RPC answers with a verdict rather than throwing for
 * the same reason; the only thing that raises is being signed out, which would
 * be a bug in the caller.
 */

import { useState } from 'react';
import { Gift } from 'lucide-react';

import type { PromoOutcome } from '@waves/api-client';

import { AppFrame } from '@/components/AppFrame';
import { Section } from '@/components/Shell';
import { useStrings } from '@/i18n-context';
import { fill } from '@/i18n';
import { friendlyError } from '@/lib/errors';
import { waves } from '@/lib/waves';

/** What the RPC accepts. Checked here so a typo does not cost a round trip. */
const MIN = 4;
const MAX = 24;

export default function RedeemPage() {
  return <AppFrame current={Section.Settings}>{() => <Redeem />}</AppFrame>;
}

function Redeem() {
  const { t, locale } = useStrings();

  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<PromoOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  const trimmed = code.trim();
  const usable = trimmed.length >= MIN && trimmed.length <= MAX;

  const submit = async (): Promise<void> => {
    if (!usable || busy) return;
    setBusy(true);
    setError(null);
    setOutcome(null);
    try {
      // Upper-cased on the way out: codes are handed out in capitals and
      // nobody should lose one to their keyboard.
      setOutcome(await waves.redeemPromo(trimmed.toUpperCase()));
    } catch (caught) {
      setError(friendlyError(caught, 'web.redeem', { fallback: t.promo.couldNotRedeem }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{t.promo.title}</h1>
          <div className="sub">{t.promo.intro}</div>
        </div>
      </div>

      <section className="panel">
        <form
          className="plan-add"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <input
            className="split-input code"
            value={code}
            autoFocus
            maxLength={MAX}
            autoComplete="off"
            spellCheck={false}
            aria-label={t.promo.title}
            placeholder={t.promo.placeholder}
            onChange={(event) => {
              setCode(event.target.value);
              setOutcome(null);
              setError(null);
            }}
          />
          <button type="submit" className="btn brand" disabled={!usable || busy}>
            {t.promo.redeem}
          </button>
        </form>

        {error ? <p className="error">{error}</p> : null}

        {outcome?.ok ? (
          <div className="promo-result">
            <Gift size={18} strokeWidth={1.75} aria-hidden />
            <span className="grow">
              <span className="title">{t.promo.granted}</span>
              <span className="meta">
                {fill(t.promo.grantedBody, { until: day(outcome.until, locale) })}
              </span>
            </span>
          </div>
        ) : null}

        {/* Each refusal is its own sentence, because each sends somebody to
            check a different thing. */}
        {outcome && !outcome.ok ? <p className="error">{refusal(outcome.reason, t)}</p> : null}
      </section>
    </div>
  );
}

function refusal(
  reason: 'UNKNOWN_CODE' | 'EXPIRED' | 'EXHAUSTED' | 'ALREADY_REDEEMED',
  t: ReturnType<typeof useStrings>['t'],
): string {
  switch (reason) {
    case 'EXPIRED':
      return t.promo.expired;
    case 'EXHAUSTED':
      return t.promo.exhausted;
    case 'ALREADY_REDEEMED':
      return t.promo.alreadyRedeemed;
    default:
      return t.promo.unknownCode;
  }
}

/** An ISO date as a date in the reader's locale, or the raw value. */
function day(iso: string, locale: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(at);
}
