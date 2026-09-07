'use client';

/**
 * Taking a group's ledger away (ADR-012).
 *
 * Waves promises that what you put in comes back out, and until now that
 * promise was only keepable from the phone. The file is built by the same edge
 * function the app calls, not assembled here: two clients inventing their own
 * CSV dialect is how "the export" quietly becomes two different exports.
 *
 * The download is made from a blob rather than pointed at a URL, because the
 * function replies with the bytes to an authenticated call — there is no
 * address a browser could fetch on its own without carrying the session.
 */

import { useState } from 'react';
import { useParams } from 'next/navigation';

import { AppFrame } from '@/components/AppFrame';
import { Section } from '@/components/Shell';
import { waves } from '@/lib/waves';
import { useStrings } from '@/i18n-context';
import { friendlyError } from '@/lib/errors';

export default function ExportPage() {
  return <AppFrame current={Section.Groups}>{() => <ExportGroup />}</AppFrame>;
}

function ExportGroup() {
  const { t } = useStrings();
  const params = useParams<{ groupId: string }>();
  const groupId = params.groupId;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const download = async (format: 'csv' | 'json') => {
    setBusy(true);
    setError(null);
    try {
      const file = await waves.exportData({ groupId, format });
      // Text formats come back as text; the base64 case is the PDF, which this
      // page does not offer — decoding it here would be dead code pretending to
      // be a feature.
      const blob = new Blob([file.content], { type: file.contentType });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = file.filename;
      anchor.click();
      // Revoked on the next tick: revoking synchronously can beat the click in
      // some browsers and hand the person an empty file.
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (caught) {
      setError(
        friendlyError(caught, 'web.export.download', {
          fallback: t.errors.couldNotLoad,
          offline: t.errors.offline,
        }),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app-body">
      <div className="app-main">
        <div className="page-head">
          <h1>{t.exportData.title}</h1>
        </div>
        <section className="panel">
          <p className="faint">{t.exportData.body}</p>
          <div className="people">
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void download('csv')}
            >
              {busy ? t.exportData.working : t.exportData.csv}
            </button>
            <button
              type="button"
              className="btn soft"
              disabled={busy}
              onClick={() => void download('json')}
            >
              {t.exportData.json}
            </button>
          </div>
          {error ? <p className="error">{error}</p> : null}
        </section>
      </div>
      <aside className="detail" />
    </div>
  );
}
