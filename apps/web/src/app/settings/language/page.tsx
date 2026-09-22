'use client';

/**
 * Which of the four languages the app speaks to you in.
 *
 * A page rather than a panel wedged into the settings list, because that is
 * where the phone keeps it and because it is the one setting somebody may have
 * to reach *before* they can read the rows around it. A row that names the
 * current language in its own script is findable by somebody who cannot read
 * the rest of the screen; a panel three scrolls down is not.
 *
 * The picker itself is unchanged — `LanguagePicker` writes the cookie the
 * server reads on the next request, writes the profile so the choice follows
 * this person to another browser and their mail arrives in the same language as
 * their screen, and then reloads, because `<html lang>` and `dir` are decided
 * on the server and half a turned page is worse than one honest reload.
 *
 * The phone's restart banner has no counterpart here on purpose: `dir` is a DOM
 * attribute and the reload applies it, so there is nothing to warn about.
 */

import Link from 'next/link';

import { AppFrame } from '@/components/AppFrame';
import { LanguagePicker } from '@/components/LanguagePicker';
import { Section } from '@/components/Shell';
import { useStrings } from '@/i18n-context';
import { waves } from '@/lib/waves';

export default function LanguagePage() {
  return <AppFrame current={Section.Settings}>{() => <ChooseLanguage />}</AppFrame>;
}

function ChooseLanguage() {
  const { t } = useStrings();

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{t.settings.language}</h1>
        </div>
      </div>

      <LanguagePicker
        onPersist={(next) =>
          // The region is the browser's business, not this picker's: somebody
          // reading in Hindi from Dubai keeps their Dubai formatting, so only
          // the language subtag is written.
          waves.updateProfile({ locale: next })
        }
      />

      <p className="faint">{t.settings.languageFootnote}</p>

      <p className="faint">
        <Link className="plain-link" href="/settings">
          {t.settings.title}
        </Link>
      </p>
    </div>
  );
}
