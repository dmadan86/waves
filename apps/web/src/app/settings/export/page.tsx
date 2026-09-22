'use client';

/**
 * The whole ledger, out of the browser, in one of three shapes (ADR-012).
 *
 * The browser could already export *one* group, from that group's own page, and
 * the delete screen offered a single JSON of everything on the way out. Neither
 * is the thing the phone has: an account-wide export where you pick the format
 * and pick the scope. Somebody who keeps their books in a spreadsheet had to
 * download a file per group and join them by hand.
 *
 * Nothing about the file is decided here. `export-data` builds it server-side so
 * the phone and the browser produce the same bytes for the same data — two
 * clients inventing their own CSV dialect is how "the export" quietly becomes
 * two different exports. This screen picks a format and a scope, and turns what
 * comes back into a download (`lib/download`, which knows that a PDF arrives
 * base64 and the other two do not).
 *
 * The free badge is not decoration. ADR-011 says the ledger leaves in full on
 * the free tier, for ever, and a page that offers to hand back your own records
 * should say so before you wonder what it will cost.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Download } from 'lucide-react';

import type { GroupRow } from '@waves/api-client';

import { AppFrame } from '@/components/AppFrame';
import { Section } from '@/components/Shell';
import { useStrings } from '@/i18n-context';
import { saveFile } from '@/lib/download';
import { friendlyError } from '@/lib/errors';
import { waves } from '@/lib/waves';

type Format = 'json' | 'csv' | 'pdf';

/** The scope chip that means "every group I am in" — the server's no-group-id case. */
const EVERYTHING = 'all';

export default function ExportPage() {
  return <AppFrame current={Section.Settings}>{() => <ExportEverything />}</AppFrame>;
}

function ExportEverything() {
  const { t } = useStrings();

  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [format, setFormat] = useState<Format>('json');
  const [scope, setScope] = useState<string>(EVERYTHING);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const rows = await waves.myGroups();
        if (active) setGroups(rows);
      } catch {
        // The scope chips are a convenience. Without them "all my groups" is
        // still the default and still works, so a failed list is not a reason
        // to refuse somebody their own data.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const run = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const file = await waves.exportData({
        format,
        groupId: scope === EVERYTHING ? undefined : scope,
      });
      saveFile(file);
      setDone(file.filename);
    } catch (caught) {
      setError(
        friendlyError(caught, 'web.export.all', {
          fallback: t.exportData.failed,
          offline: t.errors.offline,
        }),
      );
    } finally {
      setBusy(false);
    }
  };

  const formats: { id: Format; label: string }[] = [
    { id: 'json', label: t.exportData.formatJson },
    { id: 'csv', label: t.exportData.formatCsv },
    { id: 'pdf', label: t.exportData.formatPdf },
  ];

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{t.exportData.accountTitle}</h1>
          <div className="sub">{t.exportData.everythingFree}</div>
        </div>
      </div>

      <section className="panel">
        <p className="faint">{t.exportData.explain}</p>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>{t.exportData.format}</h2>
        </div>
        <div className="lang-list" role="radiogroup" aria-label={t.exportData.format}>
          {formats.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={format === option.id}
              className={format === option.id ? 'lang-option on' : 'lang-option'}
              disabled={busy}
              onClick={() => setFormat(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>{t.exportData.whatToExport}</h2>
        </div>
        <div className="lang-list" role="radiogroup" aria-label={t.exportData.whatToExport}>
          <button
            type="button"
            role="radio"
            aria-checked={scope === EVERYTHING}
            className={scope === EVERYTHING ? 'lang-option on' : 'lang-option'}
            disabled={busy}
            onClick={() => setScope(EVERYTHING)}
          >
            {t.exportData.allMyGroups}
          </button>
          {groups.map((group) => (
            <button
              key={group.id}
              type="button"
              role="radio"
              aria-checked={scope === group.id}
              className={scope === group.id ? 'lang-option on' : 'lang-option'}
              disabled={busy}
              onClick={() => setScope(group.id)}
            >
              {group.name?.trim() || t.join.aGroup}
            </button>
          ))}
        </div>
      </section>

      <section className="panel">
        <button type="button" className="btn" disabled={busy} onClick={() => void run()}>
          <Download size={16} strokeWidth={1.75} aria-hidden />{' '}
          {busy ? t.exportData.preparing : t.exportData.action}
        </button>
        {done ? (
          <p className="meta">
            {t.exportData.ready} · {done}
          </p>
        ) : null}
        {error ? <p className="error">{error}</p> : null}
      </section>

      <p className="faint">
        <Link className="plain-link" href="/settings">
          {t.settings.title}
        </Link>
      </p>
    </div>
  );
}
