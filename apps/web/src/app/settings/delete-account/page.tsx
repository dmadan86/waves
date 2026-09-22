'use client';

/**
 * Leaving, with the consequence in view before the button.
 *
 * The screen leads with what does **not** go, because that is the part people
 * do not expect: an expense in a shared group is also other people's record of
 * what happened, and removing it would silently change somebody else's balance
 * to settle a debt nobody paid. Saying so first is the difference between a
 * promise the app can keep and one it cannot.
 *
 * Export sits above the confirmation on purpose. Somebody who has decided to
 * leave should be offered their data on the way out, not reminded of it
 * afterwards — and with no group id the export is every group they are in.
 *
 * The wording is the phone's, word for word. This is the one screen where a
 * difference between the two clients would read as one of them hiding
 * something.
 *
 * Two halves of the erasure need two different keys, so it goes through the
 * `account-delete` edge function rather than the RPC: the function anonymises
 * every membership as the caller, then removes the auth identity with the
 * service key, which no client holds. Signing out happens last, and only once
 * the data is gone.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';

import type { ErasurePreview } from '@waves/api-client';

import { AppFrame } from '@/components/AppFrame';
import { Section } from '@/components/Shell';
import { SkeletonRows } from '@/components/Skeleton';
import { useStrings } from '@/i18n-context';
import { fill, plural } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { saveFile } from '@/lib/download';
import { friendlyError } from '@/lib/errors';
import { waves } from '@/lib/waves';

export default function DeleteAccountPage() {
  return <AppFrame current={Section.Settings}>{() => <DeleteAccount />}</AppFrame>;
}

function DeleteAccount() {
  const { t, locale } = useStrings();
  const { signOut } = useAuth();

  const [preview, setPreview] = useState<ErasurePreview | null>(null);
  const [ready, setReady] = useState(false);
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const rows = await waves.erasurePreview();
        if (active) setPreview(rows);
      } catch {
        // The counts are context, not a gate. Failing to fetch them is not a
        // reason to refuse somebody their own deletion.
      } finally {
        if (active) setReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const exportAll = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      // No group id: every group this person is in.
      saveFile(await waves.exportData({ format: 'json' }));
    } catch (caught) {
      setError(
        friendlyError(caught, 'web.deleteAccount.export', {
          fallback: t.errors.couldNotLoad,
          offline: t.errors.offline,
        }),
      );
    } finally {
      setBusy(false);
    }
  };

  const confirmed = typed.trim().toUpperCase() === t.privacy.deleteConfirmWord.toUpperCase();

  const erase = async (): Promise<void> => {
    if (!confirmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await waves.deleteMyAccount(reason.trim() || null);
      setDone(result.memberships_anonymised ?? 0);
    } catch (caught) {
      setError(
        friendlyError(caught, 'web.deleteAccount.delete', { fallback: t.errors.couldNotSave }),
      );
      setBusy(false);
      return;
    }
    // Last, and only now: the account is gone, so the session is a key to
    // nothing. Signing out first would have left no way to report a failure.
    try {
      await signOut();
    } catch {
      // Already erased. The stale session opens nothing.
    } finally {
      setBusy(false);
    }
  };

  if (!ready) return <SkeletonRows rows={5} />;

  if (done !== null) {
    return (
      <section className="panel">
        <h2>{t.privacy.deleteDone}</h2>
        <p className="meta">{plural(locale, done, t.privacy.deleteSummary)}</p>
      </section>
    );
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{t.privacy.deleteTitle}</h1>
          <div className="sub">{t.privacy.deleteIntro}</div>
        </div>
      </div>

      {/* What stays, first. It is the half nobody expects, and reading it after
          the button would be reading it too late. */}
      <section className="panel">
        <div className="panel-head">
          <h2>{t.privacy.deleteStaysTitle}</h2>
        </div>
        <p className="meta">{t.privacy.deleteStaysBody}</p>
        {preview ? (
          <ul className="erasure-counts">
            <li>{plural(locale, preview.groups_count, t.privacy.previewGroups)}</li>
            <li>{plural(locale, preview.expenses_authored, t.privacy.previewExpenses)}</li>
            <li>{plural(locale, preview.settlements_involved, t.privacy.previewSettlements)}</li>
            {preview.outstanding_currencies.length > 0 ? (
              // An unsettled balance is not a reason to refuse, but somebody
              // owed money by a person about to become unnamed should know.
              <li className="tone-negative">
                {fill(t.privacy.previewOutstanding, {
                  list: preview.outstanding_currencies.join(', '),
                })}
              </li>
            ) : null}
          </ul>
        ) : null}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>{t.privacy.deleteGoesTitle}</h2>
        </div>
        <p className="meta">{t.privacy.deleteGoesBody}</p>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>{t.privacy.deleteExportFirst}</h2>
        </div>
        <button type="button" className="btn soft" disabled={busy} onClick={() => void exportAll()}>
          {t.exportData.json}
        </button>
      </section>

      <section className="panel danger">
        <div className="panel-head">
          <h2>
            <AlertTriangle size={16} strokeWidth={2} aria-hidden /> {t.privacy.deleteTitle}
          </h2>
        </div>

        <label className="field">
          <span className="field-label">{t.privacy.deleteWhyLabel}</span>
          <textarea
            className="textarea"
            value={reason}
            rows={3}
            maxLength={500}
            placeholder={t.privacy.deleteWhyPlaceholder}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>

        {/* Typing the word, not a second button. A confirmation somebody can
            hit twice by reflex is not a confirmation. */}
        <label className="field">
          <span className="field-label">{t.privacy.deleteConfirmLabel}</span>
          <input
            className="split-input"
            value={typed}
            autoComplete="off"
            spellCheck={false}
            placeholder={t.privacy.deleteConfirmWord}
            onChange={(event) => setTyped(event.target.value)}
          />
        </label>

        {error ? <p className="error">{error}</p> : null}

        <button
          type="button"
          className="btn danger"
          disabled={!confirmed || busy}
          onClick={() => void erase()}
        >
          {busy ? t.privacy.deleteWorking : t.privacy.deleteButton}
        </button>
      </section>

      <p className="faint">
        <Link className="plain-link" href="/settings">
          {t.settings.title}
        </Link>
      </p>
    </div>
  );
}
