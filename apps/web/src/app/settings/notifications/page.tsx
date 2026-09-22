'use client';

/**
 * What Waves is allowed to interrupt you about.
 *
 * Six booleans on the profile row, not six columns: the list of things worth
 * being told about changes with the product, and a migration per switch would
 * be a migration per idea. The SQL reads these keys directly — the push claim
 * function maps a notification kind to one of them, the email claim function
 * treats `email` as a master door — so a switch here is the enforcement, not a
 * filter the client applies to something it was sent anyway.
 *
 * The browser had all six, crowded at the foot of the settings page under one
 * heading and with no explanation of what any of them meant. The phone gives
 * them a screen, groups them by the thing that carries them, and says under
 * each one what it will and will not do. The same six, then, in the same order,
 * in the same two groups — because somebody who set these up on their phone
 * should recognise the page in a browser rather than have to work it out again.
 *
 * What this page does **not** have is the phone's permission card. A browser is
 * not a registered device: nothing here can receive a push, and a switch that
 * cannot be obeyed is worse than an absent one. The note says where the push
 * actually arrives instead of implying it arrives here.
 *
 * Every switch saves as it is flipped and rolls back if the save is refused.
 * There is no half-set preference to submit, and a switch showing one state
 * while the server holds another is a setting that lies.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';

import { DEFAULT_NOTIFICATION_PREFS, type NotificationPrefs } from '@waves/api-client';

import { AppFrame } from '@/components/AppFrame';
import { Section } from '@/components/Shell';
import { SkeletonRows } from '@/components/Skeleton';
import { useStrings } from '@/i18n-context';
import { friendlyError } from '@/lib/errors';
import { waves } from '@/lib/waves';

export default function NotificationsPage() {
  return <AppFrame current={Section.Settings}>{() => <Notifications />}</AppFrame>;
}

function Notifications() {
  const { t } = useStrings();

  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_NOTIFICATION_PREFS);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const row = await waves.myProfile();
        if (active && row)
          setPrefs({ ...DEFAULT_NOTIFICATION_PREFS, ...(row.notification_prefs ?? {}) });
      } catch (caught) {
        if (active)
          setFailed(
            friendlyError(caught, 'web.notifications.load', {
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

  const toggle = async (key: keyof NotificationPrefs, value: boolean): Promise<void> => {
    const previous = prefs;
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    setStatus(null);
    setBusy(true);
    try {
      await waves.updateProfile({ notification_prefs: next });
    } catch (caught) {
      setPrefs(previous);
      setStatus(
        friendlyError(caught, 'web.notifications.save', { fallback: t.errors.couldNotSave }),
      );
    } finally {
      setBusy(false);
    }
  };

  const push: { key: keyof NotificationPrefs; title: string; body: string }[] = [
    {
      key: 'involvesMe',
      title: t.notifications.involvesMe,
      body: t.notifications.involvesMeBody,
    },
    {
      key: 'settlementRequests',
      title: t.notifications.settlementRequests,
      body: t.notifications.settlementRequestsBody,
    },
    { key: 'nudges', title: t.notifications.nudges, body: t.notifications.nudgesBody },
    {
      key: 'groupActivityDigest',
      title: t.notifications.digest,
      body: t.notifications.digestBody,
    },
  ];

  // The master door first, then what comes through it. Reversed, the weekly
  // switch reads as the only email there is.
  const email: { key: keyof NotificationPrefs; title: string; body: string }[] = [
    { key: 'email', title: t.notifications.emailAll, body: t.notifications.emailAllBody },
    {
      key: 'weeklyEmail',
      title: t.notifications.weeklyEmail,
      body: t.notifications.weeklyEmailBody,
    },
  ];

  const row = (entry: { key: keyof NotificationPrefs; title: string; body: string }) => (
    <label key={entry.key} className="field row-field">
      <input
        type="checkbox"
        checked={prefs[entry.key]}
        disabled={busy || !ready}
        onChange={(event) => void toggle(entry.key, event.target.checked)}
      />
      <span className="grow">
        <span className="title">{entry.title}</span>
        <span className="meta">{entry.body}</span>
      </span>
    </label>
  );

  if (!ready) return <SkeletonRows rows={6} />;
  if (failed) return <p className="error">{failed}</p>;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{t.notifications.title}</h1>
          <div className="sub">{t.notifications.neverSpam}</div>
        </div>
      </div>

      {status ? <p className="error">{status}</p> : null}

      <section className="panel">
        <div className="panel-head">
          <h2>{t.notifications.pushSection}</h2>
        </div>
        {/* Said once, plainly: these four decide what the phone sends. Nothing
            on this page can make a browser ring. */}
        <p className="meta">{t.notifications.pushOnWeb}</p>
        {push.map(row)}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>{t.notifications.emailSection}</h2>
        </div>
        {email.map(row)}
      </section>

      <p className="faint">{t.notifications.footnote}</p>

      <p className="faint">
        <Link className="plain-link" href="/settings">
          {t.settings.title}
        </Link>
      </p>
    </div>
  );
}
