'use client';

/**
 * How somebody hands you money back.
 *
 * Its own page for the reason the phone gives it one: this is the only part of
 * the profile that another person reads, on the one screen where they are about
 * to pay you, and it is the only part where a wrong value costs somebody a
 * transfer rather than a bad-looking name.
 *
 * Three rules the browser was getting wrong while this lived at the bottom of
 * the settings form.
 *
 * **A handle is only worth saving if it is a handle.** `isValidHandle` knows
 * what each rail accepts, and the phone refuses to save a value it rejects. The
 * browser saved whatever was typed, so a Pix key entered while the rail still
 * said UPI went to the server looking like a UPI id, and both settle screens
 * then offered a one-tap payment that could not work.
 *
 * **Changing country clears the handle.** A UPI id means nothing once the rail
 * is Aani. Keeping it and merely re-labelling it is how a stale handle survives
 * a move.
 *
 * **`default_vpa` is only ever a UPI id.** It is the older, UPI-shaped column
 * that the rail pair superseded, still read as a fallback by clients written
 * before the pair existed. Writing a Pix key into it would hand those clients a
 * UPI id that is not one. The phone has always had this rule; the browser never
 * wrote the column at all, which is the same bug seen from the other side.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

import type { ProfileRow } from '@waves/api-client';
import {
  COUNTRIES,
  countryFlag,
  defaultRailFor,
  HandleKind,
  isValidHandle,
  railById,
  railsFor,
  type RailId,
} from '@waves/core';

import { AppFrame } from '@/components/AppFrame';
import { Section } from '@/components/Shell';
import { SkeletonRows } from '@/components/Skeleton';
import { useStrings } from '@/i18n-context';
import { fill } from '@/i18n';
import { friendlyError } from '@/lib/errors';
import { waves } from '@/lib/waves';

export default function PayingPage() {
  return <AppFrame current={Section.Settings}>{() => <Paying />}</AppFrame>;
}

function Paying() {
  const { t } = useStrings();

  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [country, setCountry] = useState('');
  const [rail, setRail] = useState('');
  const [handle, setHandle] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const row = await waves.myProfile();
    if (!row) return;
    setProfile(row);
    setCountry(row.country_code ?? '');
    // A row written before rails existed can only have held a UPI id.
    setRail(row.payment_rail ?? (row.default_vpa ? 'upi' : ''));
    setHandle(row.payment_handle ?? row.default_vpa ?? '');
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        await load();
      } catch (caught) {
        if (active)
          setError(
            friendlyError(caught, 'web.paying.load', {
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

  // The rails this country actually uses, plus the universal ones. Never empty:
  // `railsFor` always ends with bank, cash and other.
  const rails = useMemo(() => railsFor(country), [country]);
  // What is shown when the account has no rail yet, and what is saved if the
  // picker is never touched. Recomputed as the country changes, so moving to
  // Brazil lands on Pix rather than on whatever India suggested.
  const chosen = useMemo(
    () => rails.find((entry) => entry.id === rail)?.id ?? defaultRailFor(country),
    [rails, rail, country],
  );
  const info = railById(chosen);
  const needsHandle = info?.handle !== HandleKind.None;
  const trimmed = handle.trim();
  // An empty handle is allowed and means "clear it" — only a value that is
  // present and wrong blocks the save.
  const valid = trimmed === '' || isValidHandle(chosen, trimmed);

  /** Moving country picks that country's first rail and drops the old handle. */
  const chooseCountry = (next: string) => {
    setCountry(next);
    setRail(defaultRailFor(next));
    setHandle('');
    setSaved(false);
  };

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const hasHandle = needsHandle && trimmed !== '';
      await waves.updateProfile({
        country_code: country.trim() || null,
        // A rail with nobody to pay is noise, and a handle with no rail is
        // unusable, so the pair is written and cleared together.
        payment_rail: needsHandle && trimmed === '' ? null : (chosen as RailId),
        payment_handle: hasHandle ? trimmed : null,
        default_vpa: chosen === 'upi' && hasHandle ? trimmed : null,
      });
      setSaved(true);
    } catch (caught) {
      setError(
        friendlyError(caught, 'web.paying.save', {
          fallback: t.errors.couldNotSave,
          offline: t.errors.offline,
        }),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{t.account.payingTitle}</h1>
          <div className="sub">{t.account.howPeoplePayYou}</div>
        </div>
      </div>

      {loading ? (
        <SkeletonRows rows={3} />
      ) : (
        <section className="panel">
          <label className="field">
            <span className="field-label">{t.settings.country}</span>
            <select
              value={country}
              onChange={(event) => chooseCountry(event.target.value)}
              autoComplete="country"
            >
              <option value="">{t.account.countryNotSet}</option>
              {COUNTRIES.map((entry) => (
                <option key={entry.code} value={entry.code}>
                  {countryFlag(entry.code) ?? ''} {entry.name}
                </option>
              ))}
            </select>
            <span className="faint">
              {fill(t.account.settlesWith, {
                rails: rails
                  .slice(0, 3)
                  .map((entry) => entry.label)
                  .join(', '),
              })}
            </span>
          </label>

          <label className="field">
            <span className="field-label">{t.settings.paymentRail}</span>
            <select
              value={chosen}
              onChange={(event) => {
                setRail(event.target.value);
                setSaved(false);
              }}
            >
              {rails.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>

          {needsHandle && info ? (
            <label className="field">
              <span className="field-label">{t.settings.paymentHandle}</span>
              <input
                value={handle}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                aria-invalid={!valid}
                placeholder={info.handleHint}
                onChange={(event) => {
                  setHandle(event.target.value);
                  setSaved(false);
                }}
              />
              {/* What is wrong beats what is reassuring: a rejected handle has to
                  say so where the eye already is, not under a note about how
                  payment works. */}
              {!valid ? (
                <span className="error">
                  {fill(t.account.handleWrong, { hint: info.handleHint.toLowerCase() })}
                </span>
              ) : (
                <span className="faint">
                  {info.link ? t.account.railLinkNote : t.account.railManualNote}
                </span>
              )}
            </label>
          ) : (
            <p className="faint">{t.account.nothingToAdd}</p>
          )}

          <button
            type="button"
            className="btn"
            disabled={busy || !valid || !profile}
            onClick={() => void save()}
          >
            {saved ? t.settings.saved : t.settings.save}
          </button>
          {error ? <p className="error">{error}</p> : null}
        </section>
      )}

      <p className="faint">
        <Link className="plain-link" href="/settings">
          {t.settings.title}
        </Link>
      </p>
    </div>
  );
}
