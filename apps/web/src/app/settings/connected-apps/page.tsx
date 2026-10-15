'use client';

/**
 * The AI assistants this account has authorised, and the button that ends one.
 *
 * Disconnecting revokes consent on Supabase's auth server, which also deletes
 * that assistant's sessions and refresh tokens, so a row only leaves the list
 * once the server has said yes.
 */

import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';

import { AppFrame } from '@/components/AppFrame';
import { EmptyState } from '@/components/EmptyState';
import { Section } from '@/components/Shell';
import { SkeletonRows } from '@/components/Skeleton';
import { useStrings } from '@/i18n-context';
import { fill } from '@/i18n';
import {
  CONNECT_GUIDE_URL,
  disconnectApp,
  listConnectedApps,
  withoutApp,
  type ConnectedApp,
} from '@/lib/connectedApps';
import { friendlyError } from '@/lib/errors';
import { supabase } from '@/lib/waves';

export default function ConnectedAppsPage() {
  return <AppFrame current={Section.Settings}>{() => <ConnectedApps />}</AppFrame>;
}

function ConnectedApps() {
  const { t, locale } = useStrings();

  const [apps, setApps] = useState<ConnectedApp[]>([]);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const rows = await listConnectedApps(supabase.auth.oauth);
        if (active) setApps(rows);
      } catch (caught) {
        if (active)
          setFailed(
            friendlyError(caught, 'web.connectedApps.load', {
              fallback: t.errors.couldNotLoad,
              offline: t.errors.offline,
            }),
          );
      } finally {
        if (active) setReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [t.errors.couldNotLoad, t.errors.offline]);

  const disconnect = async (app: ConnectedApp): Promise<void> => {
    const name = app.name || t.connectedApps.unnamed;
    if (
      !window.confirm(
        `${fill(t.connectedApps.confirmTitle, { name })}\n\n${t.connectedApps.confirmBody}`,
      )
    )
      return;
    setBusyId(app.clientId);
    setError(null);
    setNotice(null);
    try {
      await disconnectApp(supabase.auth.oauth, app.clientId);
      setApps((current) => withoutApp(current, app.clientId));
      setNotice(fill(t.connectedApps.disconnected, { name }));
    } catch (caught) {
      setError(
        friendlyError(caught, 'web.connectedApps.disconnect', {
          fallback: t.connectedApps.couldNotDisconnect,
        }),
      );
    } finally {
      setBusyId(null);
    }
  };

  if (!ready) return <SkeletonRows rows={3} />;
  if (failed) return <p className="error">{failed}</p>;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{t.connectedApps.title}</h1>
          <div className="sub">{t.connectedApps.intro}</div>
        </div>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="meta">{notice}</p> : null}

      <section className="panel">
        {apps.length === 0 ? (
          <EmptyState
            Icon={Sparkles}
            title={t.connectedApps.emptyTitle}
            body={t.connectedApps.emptyBody}
            action={{ label: t.connectedApps.emptyLink, href: CONNECT_GUIDE_URL }}
          />
        ) : (
          <div className="list">
            {apps.map((app) => (
              <div key={app.clientId} className="device-row">
                {app.logoUri ? (
                  // eslint-disable-next-line @next/next/no-img-element -- the client's own logo, any host
                  <img
                    src={app.logoUri}
                    alt=""
                    width={28}
                    height={28}
                    style={{ borderRadius: 6 }}
                  />
                ) : (
                  <Sparkles size={18} strokeWidth={1.75} aria-hidden />
                )}
                <span className="grow">
                  <span className="title">{app.name || t.connectedApps.unnamed}</span>
                  <span className="meta">
                    {app.scopes.length > 0 ? `${app.scopes.join(' · ')} · ` : ''}
                    {fill(t.connectedApps.connectedOn, { when: when(app.grantedAt, locale) })}
                  </span>
                </span>
                <button
                  type="button"
                  className="btn soft"
                  disabled={busyId === app.clientId}
                  onClick={() => void disconnect(app)}
                >
                  {t.connectedApps.disconnect}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/** An ISO timestamp as a date in the reader's locale, or the raw value. */
function when(iso: string, locale: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(at);
}
