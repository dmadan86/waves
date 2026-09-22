'use client';

/**
 * Who you are on this account, and the ways back into it.
 *
 * The browser used to answer both halves of "settings" on one page: your name
 * and your payment handle in the same form as the notification switches, with
 * no way at all to say where you live or to add a second way to sign in. The
 * phone has had `settings/account` and `settings/paying` as two screens since
 * the profile grew past a name, and it splits them on a real seam — this page
 * is about *you*, the paying page is about how somebody hands you money.
 *
 * Two things here the browser could not do before.
 *
 * **The country is a country, not two characters.** It used to be a text field
 * that accepted `XX`, and the currency was an unrelated dropdown beside it, so
 * the two could disagree and the phone would then disagree with both. Choosing
 * a country now seeds the currency the way the phone seeds it, and the list is
 * `COUNTRIES` from the shared package, so the browser cannot offer a country
 * the rest of the app has never heard of.
 *
 * **The address exists.** `profiles.address` has been in the schema, in the
 * export and on the phone's account screen all along; the web client simply
 * never selected the column. It is never posted to — it is there because the
 * portability promise (ADR-012) is that what you put in comes back out, and a
 * field only one client can fill is a field the other client silently loses.
 *
 * Signing in is the guest-upgrade seam (ADR-006), and the page is careful about
 * it: it says which ways in already exist and offers only the doors that
 * provably link to the account already signed in rather than minting a second
 * one. `planAuth` makes that decision inside the client — Google and Apple go
 * through `linkIdentity` for anybody with a session — and nothing here may work
 * around it. The magic link is not offered for the same reason, and the note
 * beside the provider rows says so: `signInWithOtp` signs into whichever account
 * owns the address, which for a guest is the wrong one, and the anonymous
 * session was the only way back to the right one.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Check, KeyRound, Mail } from 'lucide-react';

import type { ProfileRow } from '@waves/api-client';
import { COUNTRIES, countryFlag, currencyForCountry } from '@waves/core';

import { AppFrame } from '@/components/AppFrame';
import { Section } from '@/components/Shell';
import { SkeletonRows } from '@/components/Skeleton';
import { useStrings } from '@/i18n-context';
import { fill } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { friendlyError } from '@/lib/errors';
import { waves } from '@/lib/waves';

/**
 * The currencies the browser offers when a country does not decide one.
 *
 * Picking a country fills this in, which is what the phone does; the list stays
 * because somebody living in one country and keeping their books in another
 * currency is ordinary, and the phone's read-only field makes that impossible
 * rather than merely unusual.
 */
const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD', 'CAD', 'JPY'] as const;

export default function AccountPage() {
  return <AppFrame current={Section.Settings}>{() => <Account />}</AppFrame>;
}

function Account() {
  const { t } = useStrings();
  const { session, isGuest, signInWithGoogle, signInWithApple } = useAuth();

  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [name, setName] = useState('');
  const [country, setCountry] = useState('');
  const [currency, setCurrency] = useState('INR');
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [linkError, setLinkError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const row = await waves.myProfile();
    if (!row) return;
    setProfile(row);
    setName(row.display_name ?? '');
    setCountry(row.country_code ?? '');
    setCurrency(row.default_currency ?? 'INR');
    setAddress(row.address ?? '');
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        await load();
      } catch (caught) {
        if (active)
          setError(
            friendlyError(caught, 'web.account.load', {
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

  /**
   * Choosing a country answers the currency question too.
   *
   * Only when the country actually names one: `currencyForCountry` returns null
   * for the places it does not know, and overwriting a deliberate choice with
   * nothing would be worse than leaving it alone.
   */
  const chooseCountry = (next: string) => {
    setCountry(next);
    const suggested = currencyForCountry(next);
    if (suggested) setCurrency(suggested);
  };

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await waves.updateProfile({
        // An empty name is stored as the word for "you", not as an empty
        // string: every group this person is in renders this value, and a blank
        // line beside an expense reads as a bug rather than as a choice.
        display_name: name.trim() || t.account.you,
        country_code: country.trim() || null,
        default_currency: currency,
        // Cleared to null, never to '' — an empty string is a value somebody
        // typed, and this column's empty state is "not given".
        address: address.trim() || null,
      });
      setSaved(true);
    } catch (caught) {
      setError(
        friendlyError(caught, 'web.account.save', {
          fallback: t.errors.couldNotSave,
          offline: t.errors.offline,
        }),
      );
    } finally {
      setBusy(false);
    }
  };

  /** Which ways in this account already has, from the session rather than a guess. */
  const identities = useMemo(
    () => new Set((session?.user.identities ?? []).map((identity) => identity.provider)),
    [session],
  );
  const signedInAs = session?.user.email ?? session?.user.phone ?? null;

  const link = async (provider: 'google' | 'apple'): Promise<void> => {
    setLinkError(null);
    try {
      await (provider === 'google' ? signInWithGoogle() : signInWithApple());
    } catch (caught) {
      setLinkError(friendlyError(caught, 'web.account.link', { fallback: t.errors.couldNotSave }));
    }
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{t.account.title}</h1>
          {signedInAs ? <div className="sub">{signedInAs}</div> : null}
        </div>
      </div>

      {isGuest ? (
        <section className="panel">
          <div className="panel-head">
            <h2>{t.account.guestTitle}</h2>
          </div>
          <p className="meta">{t.account.guestBody}</p>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-head">
          <h2>{t.account.detailsTitle}</h2>
        </div>
        {loading ? (
          <SkeletonRows rows={4} />
        ) : (
          <>
            <label className="field">
              <span className="field-label">{t.settings.displayName}</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="name"
              />
              <span className="faint">{t.account.displayNameHint}</span>
            </label>

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
            </label>

            <label className="field">
              <span className="field-label">{t.settings.currency}</span>
              <select value={currency} onChange={(event) => setCurrency(event.target.value)}>
                {/* A profile written before this list, or from a phone in a
                    country none of these serve, keeps its own code rather than
                    being silently moved to the first option. */}
                {[...new Set([currency, ...CURRENCIES])].map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
              <span className="faint">{t.account.currencyFromCountry}</span>
            </label>

            <label className="field">
              <span className="field-label">{t.account.addressTitle}</span>
              <textarea
                className="textarea"
                value={address}
                rows={3}
                maxLength={500}
                placeholder={t.account.addressPlaceholder}
                onChange={(event) => setAddress(event.target.value)}
              />
              <span className="faint">{t.account.addressHint}</span>
            </label>

            <button
              type="button"
              className="btn"
              disabled={busy || !profile}
              onClick={() => void save()}
            >
              {saved ? t.settings.saved : t.settings.save}
            </button>
            {error ? <p className="error">{error}</p> : null}
          </>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>{t.account.signInMethodsTitle}</h2>
        </div>
        <p className="meta">{t.account.signInMethodsBody}</p>

        <div className="list">
          <div className="device-row">
            <Mail size={18} strokeWidth={1.75} aria-hidden />
            <span className="grow">
              <span className="title">{t.account.emailAddress}</span>
              <span className="meta">
                {session?.user.email
                  ? fill(t.account.alreadyAdded, { value: session.user.email })
                  : t.account.notAddedYet}
              </span>
            </span>
          </div>

          {(['google', 'apple'] as const).map((provider) => (
            <div key={provider} className="device-row">
              {/* No brand mark. The sign-in screen draws Google's and Apple's
                  own glyphs, which are trademarks with rules about size and
                  clear space; a second, smaller copy of each inside a settings
                  list is a second chance to get those rules wrong for no gain —
                  the row already says which provider it is. */}
              <KeyRound size={18} strokeWidth={1.75} aria-hidden />
              <span className="grow">
                <span className="title">{provider === 'apple' ? 'Apple' : 'Google'}</span>
              </span>
              {identities.has(provider) ? (
                <span className="budget-badge">
                  <Check size={14} strokeWidth={2} aria-hidden /> {t.account.linked}
                </span>
              ) : (
                <button
                  type="button"
                  className="btn soft"
                  aria-label={fill(t.account.linkProvider, {
                    provider: provider === 'apple' ? 'Apple' : 'Google',
                  })}
                  onClick={() => void link(provider)}
                >
                  {t.account.link}
                </button>
              )}
            </div>
          ))}
        </div>

        {/* There is deliberately no "add an email" field here, and it is worth
            saying why rather than leaving a gap somebody helpfully fills in.
            `signInWithEmail` is a plain `signInWithOtp`, which signs into
            whichever account owns that address — for a guest that is a
            *different* account, and the anonymous session was the only way back
            to the first one. That is the exact damage ADR-006 exists to prevent.
            Linking an address in place is `updateUser({ email })` plus its own
            confirmation, which the app has on the phone and the browser does not
            yet. Until it does, the two doors above are the ones that provably
            link rather than replace — `planAuth` decides that inside the client,
            and it answers `linkIdentity` for anybody already signed in. */}
        {linkError ? <p className="error">{linkError}</p> : null}
        <p className="faint">{t.account.signInFootnote}</p>
      </section>

      <p className="faint">
        <Link className="plain-link" href="/settings">
          {t.settings.title}
        </Link>
      </p>
    </div>
  );
}
