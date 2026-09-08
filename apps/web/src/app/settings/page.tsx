'use client';

/**
 * The account, which the browser had no way to touch.
 *
 * Two things live here and they are read from the same row. The **profile** is
 * how you appear to everybody you split with — your name on every expense, and
 * the handle somebody pays when they settle up with you. The **notifications**
 * are what Waves is allowed to interrupt you about; they are stored as JSON on
 * the profile rather than as columns, because the list of things worth being
 * told about changes with the product and a migration per switch would be a
 * migration per idea.
 *
 * The language is not a setting here on purpose: the web client follows the
 * browser's own `Accept-Language`, so a second place to choose would be a
 * second answer to the same question.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  DEFAULT_NOTIFICATION_PREFS,
  type NotificationPrefs,
  type ProfileRow,
} from '@waves/api-client';
import { defaultRailFor, railsFor } from '@waves/core';

import { AppFrame } from '@/components/AppFrame';
import { Section } from '@/components/Shell';
import { SkeletonRows } from '@/components/Skeleton';
import { waves } from '@/lib/waves';
import { useAuth } from '@/lib/auth';
import { useStrings } from '@/i18n-context';
import { friendlyError } from '@/lib/errors';

const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD', 'CAD', 'JPY'] as const;

export default function SettingsPage() {
  return <AppFrame current={Section.Settings}>{() => <Settings />}</AppFrame>;
}

function Settings() {
  const { t } = useStrings();
  const { isGuest, signOut, signInWithGoogle } = useAuth();

  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('INR');
  const [country, setCountry] = useState('');
  const [handle, setHandle] = useState('');
  // Saved beside the handle, never left behind it. Web used to write
  // `payment_handle` alone, and a handle with no rail is not a way to be paid:
  // `payableFor` refuses to guess UPI over what might be a Pix key, so every
  // handle set from a browser was invisible to both settle screens.
  const [rail, setRail] = useState('');
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_NOTIFICATION_PREFS);
  // The rails this country actually uses, plus the universal ones. Never empty:
  // `railsFor` always ends with bank, cash and other, so an unknown country
  // still offers something rather than an empty select.
  const rails = useMemo(() => railsFor(country), [country]);
  // What is shown when the account has no rail yet, and what is saved if the
  // person never touches the picker. Recomputed as the country changes, so
  // typing "BR" lands on Pix rather than on whatever India suggested.
  const effectiveRail = useMemo(
    () => rails.find((entry) => entry.id === rail)?.id ?? defaultRailFor(country),
    [rails, rail, country],
  );
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const row = await waves.myProfile();
    if (!row) return;
    setProfile(row);
    setName(row.display_name ?? '');
    setCurrency(row.default_currency ?? 'INR');
    setCountry(row.country_code ?? '');
    // The rail pair is what a modern row carries; `default_vpa` is the older
    // UPI-shaped field, still read so an account written before the pair
    // existed does not look like it has no handle at all.
    setHandle(row.payment_handle ?? row.default_vpa ?? '');
    // A row written before rails existed can only have held a UPI id.
    setRail(row.payment_rail ?? (row.default_vpa ? 'upi' : ''));
    setPrefs({ ...DEFAULT_NOTIFICATION_PREFS, ...(row.notification_prefs ?? {}) });
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        await load();
      } catch (caught) {
        if (active)
          setError(
            friendlyError(caught, 'web.settings.load', {
              fallback: t.errors.couldNotLoad,
              offline: t.errors.offline,
            }),
          );
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [load, t.errors.couldNotLoad, t.errors.offline]);

  const save = async (patch: Partial<ProfileRow>) => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await waves.updateProfile(patch);
      setSaved(true);
    } catch (caught) {
      setError(
        friendlyError(caught, 'web.settings.save', {
          fallback: t.errors.couldNotSave,
          offline: t.errors.offline,
        }),
      );
    } finally {
      setBusy(false);
    }
  };

  /** A switch saves as it is flipped: there is no half-set preference to submit. */
  const toggle = (key: keyof NotificationPrefs) => (value: boolean) => {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    void save({ notification_prefs: next });
  };

  const switches: { key: keyof NotificationPrefs; label: string }[] = [
    { key: 'involvesMe', label: t.settings.notifyInvolvesMe },
    { key: 'groupActivityDigest', label: t.settings.notifyDigest },
    { key: 'settlementRequests', label: t.settings.notifySettlements },
    { key: 'nudges', label: t.settings.notifyNudges },
    // The master switch on the email door. The SQL has read this key since M4
    // and neither client could set it.
    { key: 'email', label: t.settings.notifyEmail },
    { key: 'weeklyEmail', label: t.settings.notifyWeekly },
  ];

  return (
    <div className="app-body">
      <div className="app-main">
        <div className="page-head">
          <h1>{t.settings.title}</h1>
        </div>

        {isGuest ? (
          <section className="panel">
            <h2>{t.settings.guestTitle}</h2>
            <p className="faint">{t.settings.guestBody}</p>
            <button type="button" className="btn" onClick={() => void signInWithGoogle()}>
              {t.dash.guestCta}
            </button>
          </section>
        ) : null}

        <section className="panel">
          <h2>{t.settings.profile}</h2>
          {loading ? (
            <SkeletonRows rows={3} />
          ) : (
            <>
              <label className="field">
                <span className="field-label">{t.settings.displayName}</span>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="name"
                />
              </label>

              <label className="field">
                <span className="field-label">{t.settings.currency}</span>
                <select value={currency} onChange={(event) => setCurrency(event.target.value)}>
                  {CURRENCIES.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span className="field-label">{t.settings.country}</span>
                <input
                  value={country}
                  onChange={(event) => setCountry(event.target.value.toUpperCase().slice(0, 2))}
                  placeholder="IN"
                  autoComplete="country"
                  maxLength={2}
                />
              </label>

              <label className="field">
                <span className="field-label">{t.settings.paymentRail}</span>
                <select value={effectiveRail} onChange={(event) => setRail(event.target.value)}>
                  {rails.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span className="field-label">{t.settings.paymentHandle}</span>
                <input
                  value={handle}
                  onChange={(event) => setHandle(event.target.value)}
                  placeholder="you@bank"
                  autoComplete="off"
                />
                <span className="faint">{t.settings.paymentHandleBody}</span>
              </label>

              <button
                type="button"
                className="btn"
                disabled={busy || !profile}
                onClick={() =>
                  void save({
                    display_name: name.trim() || t.dash.guestLabel,
                    default_currency: currency,
                    country_code: country.trim() || null,
                    payment_handle: handle.trim() || null,
                    // Cleared together: a rail with nobody to pay is noise, and
                    // a handle with no rail is unusable.
                    payment_rail: handle.trim() ? effectiveRail : null,
                  })
                }
              >
                {saved ? t.settings.saved : t.settings.save}
              </button>
            </>
          )}
        </section>

        <section className="panel">
          <h2>{t.settings.notifications}</h2>
          {switches.map((row) => (
            <label key={row.key} className="field row-field">
              <input
                type="checkbox"
                checked={prefs[row.key]}
                disabled={busy || loading}
                onChange={(event) => toggle(row.key)(event.target.checked)}
              />
              <span>{row.label}</span>
            </label>
          ))}
        </section>

        {error ? <p className="error">{error}</p> : null}

        <section className="panel">
          <h2>{t.settings.language}</h2>
          <p className="faint">{t.settings.languageBody}</p>
        </section>

        <section className="panel">
          <h2>{t.settings.onlyInApp}</h2>
          <p className="faint">{t.settings.onlyInAppBody}</p>
        </section>

        <section className="panel">
          <button type="button" className="btn soft" onClick={() => void signOut()}>
            {t.settings.signOut}
          </button>
        </section>
      </div>
      <aside className="detail" />
    </div>
  );
}
