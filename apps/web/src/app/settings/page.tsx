'use client';

/**
 * Settings: everything you can change, and the two things you can end.
 *
 * This used to be a page *and* an index — your name, your currency, your
 * payment handle and six notification switches in one column, with a loose list
 * of links underneath. It worked, and it bore no resemblance to the same screen
 * on the phone, which is the complaint that produced this file: somebody who
 * sets something up on their phone and then goes looking for it in a browser
 * should recognise where they are.
 *
 * So it is now what the phone's is: a list of rows in five named groups, in the
 * phone's order, with the same names — Account, Preferences, Data & privacy,
 * Security, Help — and then the two irreversible acts, each alone at the foot.
 * The grouping is the phone's argument, and it is worth restating because it
 * decides where every future row goes:
 *
 *   Account is what you edit about *yourself*. Preferences are how the app
 *   looks and speaks to you. Data & privacy is your records and who can reach
 *   them. Security is where this account is open. Help is not settings at all.
 *
 * Every row that carries state says it in the subtitle — the language in its
 * own script, the appearance as it currently resolves — so the list answers
 * "what is this set to" without being opened.
 *
 * Two rows moved rather than being dropped, both to where the phone keeps them
 * and for the phone's reason: a second door to the same screen is not a
 * shortcut, it is a fork, and the two halves fall out of step. Redeeming a code
 * is a thing that changes your plan, so it is on the Plan page. Discovery is a
 * privacy control, so it is on the Privacy page, which is also the only place
 * that explains what discovery is deciding.
 *
 * What stays here verbatim is the honest list of what a browser cannot do. It
 * is not an apology; it is the difference between a feature somebody cannot
 * find and a feature that is not here.
 */

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

import { AppFrame } from '@/components/AppFrame';
import { ENDONYM } from '@/components/LanguagePicker';
import { Section } from '@/components/Shell';
import { useStrings } from '@/i18n-context';
import { useAuth } from '@/lib/auth';
import { useTheme } from '@/lib/theme';

interface RowLink {
  href: string;
  title: string;
  hint?: string;
}

export default function SettingsPage() {
  return <AppFrame current={Section.Settings}>{() => <Settings />}</AppFrame>;
}

function Settings() {
  const { t, language } = useStrings();
  const { isGuest, signOut, signInWithGoogle } = useAuth();
  const { choice } = useTheme();

  const appearance =
    choice === 'dark' ? t.theme.dark : choice === 'light' ? t.theme.light : t.theme.system;

  const groups: { title: string; rows: RowLink[] }[] = [
    {
      title: t.settings.sectionAccount,
      rows: [
        {
          href: '/settings/account',
          title: t.account.yourAccount,
          hint: t.account.yourAccountHint,
        },
        {
          href: '/settings/paying',
          title: t.account.payingTitle,
          hint: t.account.howPeoplePayYou,
        },
        { href: '/settings/plan', title: t.billing.row, hint: t.billing.rowHint },
      ],
    },
    {
      // Language leads: it is the one setting somebody may have to reach
      // *before* they can read the rows below it, so it cannot sit under them.
      title: t.settings.sectionPreferences,
      rows: [
        { href: '/settings/language', title: t.settings.language, hint: ENDONYM[language] },
        { href: '/settings/theme', title: t.theme.label, hint: appearance },
        {
          href: '/settings/notifications',
          title: t.notifications.title,
          hint: t.notifications.rowHint,
        },
      ],
    },
    {
      title: t.settings.sectionData,
      rows: [
        { href: '/settings/categories', title: t.tags.settingsRow, hint: t.tags.subtitle },
        { href: '/settings/export', title: t.exportData.row, hint: t.exportData.rowHint },
        { href: '/settings/privacy', title: t.privacy.row, hint: t.privacy.rowHint },
      ],
    },
    {
      title: t.settings.sectionSecurity,
      rows: [{ href: '/settings/devices', title: t.devices.row, hint: t.devices.rowHint }],
    },
    {
      title: t.settings.sectionHelp,
      rows: [
        { href: '/settings/feedback', title: t.feedback.row, hint: t.feedback.rowHint },
        // No hint under this one: the row says what it is, and the page's own
        // first line is a paragraph rather than a caption.
        { href: '/settings/licenses', title: t.licenses.row },
      ],
    },
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

        {groups.map((group) => (
          <section key={group.title} className="panel">
            <div className="panel-head">
              <h2>{group.title}</h2>
            </div>
            <div className="list">
              {group.rows.map((row) => (
                <Link key={row.href} className="item" href={row.href}>
                  <span className="grow">
                    <span className="title">{row.title}</span>
                    {row.hint ? <span className="meta">{row.hint}</span> : null}
                  </span>
                  <ChevronRight size={16} strokeWidth={1.75} aria-hidden />
                </Link>
              ))}
            </div>
          </section>
        ))}

        <section className="panel">
          <div className="panel-head">
            <h2>{t.settings.onlyInApp}</h2>
          </div>
          <p className="faint">{t.settings.onlyInAppBody}</p>
        </section>

        {/* Ending the session, and ending the account. Each alone on its own
            card at the very bottom, split from every group and from each other,
            because burying an irreversible act in a list is how it gets clicked
            by reflex. Deletion is offered to guests on the same terms as
            anybody else: an automatically created account is still an account
            somebody may want gone. */}
        <section className="panel">
          <button type="button" className="btn soft" onClick={() => void signOut()}>
            {t.settings.signOut}
          </button>
        </section>

        <section className="panel">
          <Link className="item" href="/settings/delete-account">
            <span className="grow">
              <span className="title">{t.privacy.deleteRow}</span>
              <span className="meta">{t.privacy.deleteRowHint}</span>
            </span>
            <ChevronRight size={16} strokeWidth={1.75} aria-hidden />
          </Link>
        </section>
      </div>
      <aside className="detail" />
    </div>
  );
}
