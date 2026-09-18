'use client';

/**
 * Where this account is signed in, and how to end it everywhere else.
 *
 * Only the phone app registers as a device, so this list is the phones — and
 * that makes the browser the useful place to read it from. It is where somebody
 * goes when the phone is the thing they have lost, which is exactly when they
 * cannot open the app to revoke it.
 *
 * Signing out everywhere else is two halves, and both are needed: the RPC marks
 * the device rows revoked, which is what this list reads, and Supabase's
 * `signOut({ scope: 'others' })` ends the sessions themselves. One without the
 * other leaves either a signed-in phone the list calls revoked, or a revoked
 * phone the list still shows as live.
 *
 * The browser has no device id to exclude, so it passes a sentinel that matches
 * none and revokes all of them. Not a loophole: the RPC is scoped to the
 * caller's own profile and cannot reach anybody else's rows.
 */

import { useEffect, useState } from 'react';
import { Laptop, Smartphone } from 'lucide-react';

import type { DeviceSession } from '@waves/core';

import { AppFrame } from '@/components/AppFrame';
import { EmptyState } from '@/components/EmptyState';
import { Section } from '@/components/Shell';
import { SkeletonRows } from '@/components/Skeleton';
import { useStrings } from '@/i18n-context';
import { fill, plural } from '@/i18n';
import { friendlyError } from '@/lib/errors';
import { waves } from '@/lib/waves';

/**
 * A device id no device has.
 *
 * `waves_sign_out_other_devices` revokes everything that is not the id it is
 * given. The browser is not registered, so there is nothing to keep — and a
 * value that cannot collide with a real device id is how "keep nothing" is
 * said in the shape the RPC accepts.
 */
const NOT_A_DEVICE = 'web-browser-not-a-registered-device';

export default function DevicesPage() {
  return <AppFrame current={Section.Settings}>{() => <Devices />}</AppFrame>;
}

function Devices() {
  const { t, locale } = useStrings();

  const [devices, setDevices] = useState<DeviceSession[]>([]);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [signedOut, setSignedOut] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const rows = await waves.devices();
        if (active) setDevices(rows);
      } catch (caught) {
        if (active)
          setFailed(
            friendlyError(caught, 'web.devices.load', {
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

  const signOutAll = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      setSignedOut(await waves.signOutOtherDevices(NOT_A_DEVICE));
    } catch (caught) {
      setError(
        friendlyError(caught, 'web.devices.signOut', { fallback: t.devices.couldNotSignOut }),
      );
      setBusy(false);
      return;
    }
    try {
      setDevices(await waves.devices());
    } catch {
      // Revoked. The list is behind, not wrong.
    } finally {
      setBusy(false);
    }
  };

  if (!ready) return <SkeletonRows rows={4} />;
  if (failed) return <p className="error">{failed}</p>;

  const live = devices.filter((device) => !device.revokedAt);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{t.devices.title}</h1>
          <div className="sub">{t.devices.intro}</div>
        </div>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {signedOut !== null ? (
        <p className="meta">{plural(locale, signedOut, t.devices.signedOutAll)}</p>
      ) : null}

      <section className="panel">
        {devices.length === 0 ? (
          <EmptyState Icon={Laptop} title={t.devices.title} body={t.devices.none} />
        ) : (
          <div className="list">
            {devices.map((device) => (
              <div key={device.deviceId} className="device-row">
                <Smartphone size={18} strokeWidth={1.75} aria-hidden />
                <span className="grow">
                  <span className="title">{device.label}</span>
                  <span className="meta">
                    {device.platform}
                    {device.appVersion ? ` · ${device.appVersion}` : ''}
                    {' · '}
                    {fill(t.devices.lastActive, { when: when(device.lastSeenAt, locale) })}
                  </span>
                </span>
                {/* A revoked device stays listed for the three-month window, so
                    the state has to be said — an unlabelled row here reads as
                    still signed in. */}
                {device.revokedAt ? (
                  <span className="budget-badge">{t.devices.signedOut}</span>
                ) : null}
              </div>
            ))}
          </div>
        )}
        <p className="faint">{t.devices.historyNote}</p>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>{t.devices.signOutAll}</h2>
        </div>
        <p className="meta">{t.devices.signOutAllHint}</p>
        <button
          type="button"
          className="btn soft"
          disabled={busy || live.length === 0}
          onClick={() => void signOutAll()}
        >
          {t.devices.signOutAll}
        </button>
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
