'use client';

/**
 * Saying something back, from the browser.
 *
 * The RPC writes into a table no client can read. That asymmetry is the point:
 * feedback is somebody's to send and somebody else's to read, so this screen
 * has a send and no list, and nothing here ever shows another person's words.
 *
 * Three things the phone screen got right and this one keeps. The rating is
 * offered, never demanded — the label says "optional" and choosing the same
 * star again clears it. The kind is not decoration: it is which queue a message
 * lands in, and "something is broken" is read differently from "an idea". And
 * what rides along with the message is said before it is sent, because a person
 * wondering what else went with it is a person who writes less.
 */

import { useState } from 'react';
import { Check, Star } from 'lucide-react';

import type { FeedbackInput, FeedbackRating } from '@waves/api-client';

import { AppFrame } from '@/components/AppFrame';
import { Section } from '@/components/Shell';
import { useStrings } from '@/i18n-context';
import { plural } from '@/i18n';
import { friendlyError } from '@/lib/errors';
import { waves } from '@/lib/waves';

/** What the column accepts, and what the server truncates to anyway. */
const MAX = 4000;

const KINDS = ['general', 'bug', 'idea'] as const;
type Kind = (typeof KINDS)[number];

/**
 * Which build this is.
 *
 * Vercel exposes the deployed commit to the browser bundle; a self-hosted or
 * local build has no such thing, and null is the honest answer there. An
 * invented version would be worse than none: it would place a bug report on a
 * build that never existed.
 */
const BUILD = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null;

export default function FeedbackPage() {
  return <AppFrame current={Section.Settings}>{() => <Feedback />}</AppFrame>;
}

function Feedback() {
  const { t, locale } = useStrings();

  const [kind, setKind] = useState<Kind>('general');
  const [rating, setRating] = useState<FeedbackRating | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const usable = message.trim().length > 0;

  const send = async (): Promise<void> => {
    if (!usable || busy) return;
    setBusy(true);
    setError(null);
    try {
      const input: FeedbackInput = {
        message: message.trim(),
        kind,
        rating,
        appVersion: BUILD,
        // Not the user agent. "Web" is what separates this report from a phone
        // one; the rest of a browser string is a fingerprint nobody agreed to
        // hand over in order to say "it did not work".
        platform: 'web',
      };
      await waves.submitFeedback(input);
      setSent(true);
    } catch (caught) {
      setError(friendlyError(caught, 'web.feedback.submit', { fallback: t.feedback.couldNotSend }));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Back to an empty form, not the one just sent.
   *
   * A second thought is a new message: its kind is theirs to choose again, and
   * the rating is the one thing that would be a lie twice over.
   */
  const another = (): void => {
    setSent(false);
    setMessage('');
    setRating(null);
    setKind('general');
  };

  if (sent) {
    return (
      <div>
        <div className="page-head">
          <div>
            <h1>{t.feedback.title}</h1>
          </div>
        </div>
        <section className="panel sent-panel">
          {/* Brand, not the money colours: a tick borrowing the "you are owed"
              blue on a screen with no money in it says something it does not
              mean. */}
          <span className="sent-mark" aria-hidden>
            <Check size={28} strokeWidth={2} />
          </span>
          <h2>{t.feedback.thanks}</h2>
          <p className="faint">{t.feedback.thanksBody}</p>
          <button type="button" className="btn brand" onClick={another}>
            {t.feedback.another}
          </button>
        </section>
      </div>
    );
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{t.feedback.title}</h1>
          <div className="sub">{t.feedback.hint}</div>
        </div>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <section className="panel">
          <div className="panel-head">
            <h2>{t.feedback.rating}</h2>
            <span className="faint">{t.feedback.ratingHint}</span>
          </div>
          <div className="stars" role="group" aria-label={t.feedback.rating}>
            {([1, 2, 3, 4, 5] as const).map((n) => {
              // `filled` draws the row — every star up to the choice is solid.
              // `aria-pressed` names the one star this control stands for, so a
              // screen reader announces the rating rather than the fill.
              const filled = rating !== null && n <= rating;
              const isChoice = n === rating;
              return (
                <button
                  key={n}
                  type="button"
                  className={filled ? 'star on' : 'star'}
                  aria-label={plural(locale, n, t.feedback.starLabel)}
                  aria-pressed={isChoice}
                  title={isChoice ? t.feedback.starClearHint : undefined}
                  disabled={busy}
                  onClick={() => setRating((current) => (current === n ? null : n))}
                >
                  <Star size={24} strokeWidth={1.75} fill={filled ? 'currentColor' : 'none'} />
                </button>
              );
            })}
          </div>
        </section>

        <section className="panel">
          {/* Which queue this lands in, chosen before the words rather than
              guessed from them afterwards. */}
          <div className="lang-list" role="radiogroup" aria-label={t.feedback.title}>
            {KINDS.map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={kind === option}
                className={kind === option ? 'lang-option on' : 'lang-option'}
                disabled={busy}
                onClick={() => setKind(option)}
              >
                {option === 'bug'
                  ? t.feedback.kindBug
                  : option === 'idea'
                    ? t.feedback.kindIdea
                    : t.feedback.kindGeneral}
              </button>
            ))}
          </div>

          {/* Labelled, not captioned: a visible "Send feedback" over the box
              would repeat the heading two lines above it, so the name a screen
              reader needs rides on the control itself. */}
          <div className="field">
            <textarea
              className="textarea"
              value={message}
              maxLength={MAX}
              rows={6}
              autoFocus
              disabled={busy}
              aria-label={t.feedback.title}
              placeholder={t.feedback.placeholder}
              onChange={(event) => setMessage(event.target.value)}
            />
          </div>
          {/* A counter on an empty box is a demand for length nobody made. */}
          {message.length > 0 ? <p className="faint count">{`${message.length}/${MAX}`}</p> : null}

          <p className="faint">{t.feedback.attachNote}</p>

          {error ? <p className="error">{error}</p> : null}

          <button type="submit" className="btn brand" disabled={!usable || busy}>
            {t.feedback.send}
          </button>
        </section>
      </form>
    </div>
  );
}
