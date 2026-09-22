'use client';

/**
 * Choosing which of the four languages the app speaks.
 *
 * Every other control in settings saves in place. This one reloads the page,
 * and the reason is worth stating: `<html lang>` and `dir` are decided on the
 * server, so switching to Arabic without a reload would leave a left-to-right
 * skeleton around right-to-left text — the nav on the wrong side, every icon
 * pointing the wrong way. The phone has the same constraint for the same
 * reason. Better one honest reload than a page that is half-turned.
 *
 * Each language names itself, in itself. Somebody looking for Tamil is looking
 * for "தமிழ்", not for the word "Tamil" written in a language they are trying
 * to leave.
 *
 * The choice is written twice: to a cookie, which is what the server reads on
 * the next request, and to the profile, so it follows this person to another
 * browser and their mail arrives in the same language as their screen. The
 * cookie is the one that must succeed — a profile write that fails leaves the
 * choice working here and nowhere else, which is worth telling them about but
 * not worth undoing.
 */

import { useState } from 'react';

import { Language, LANGUAGES } from '@/i18n';
import { useStrings } from '@/i18n-context';
import { rememberLanguage } from '@/lib/language';

/**
 * What each language calls itself. Never translated — that is the point.
 *
 * Exported because the settings row that leads to this picker has to say the
 * current language too, and it has to say it in that language's own script: the
 * person going looking for that row is the person who cannot read the rest of
 * the screen.
 */
export const ENDONYM: Record<Language, string> = {
  [Language.En]: 'English',
  [Language.Ta]: 'தமிழ்',
  [Language.Hi]: 'हिन्दी',
  [Language.Ar]: 'العربية',
};

export function LanguagePicker({
  onPersist,
}: {
  /** Store it on the profile too. Failure is reported, never fatal. */
  onPersist: (language: Language) => Promise<void>;
}) {
  const { t, language } = useStrings();
  const [busy, setBusy] = useState(false);

  const choose = async (next: Language): Promise<void> => {
    if (next === language || busy) return;
    setBusy(true);
    // The cookie first, and before anything that can fail: it is what the next
    // render reads, and the reload below depends on it being there.
    rememberLanguage(next);
    try {
      await onPersist(next);
    } catch {
      // Saved here, not saved to the account. The reload still shows the new
      // language, which is what was asked for; the rest is for another device.
    }
    window.location.reload();
  };

  return (
    <section className="panel">
      <h2>{t.settings.language}</h2>
      <p className="faint">{t.settings.languageBody}</p>
      <div className="lang-list" role="radiogroup" aria-label={t.settings.language}>
        {LANGUAGES.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={option === language}
            className={option === language ? 'lang-option on' : 'lang-option'}
            disabled={busy}
            // The document stays in the current language until the reload, so
            // this element is an island of another one; saying so keeps a
            // screen reader from reading Tamil with an English voice.
            lang={option}
            onClick={() => void choose(option)}
          >
            {ENDONYM[option]}
          </button>
        ))}
      </div>
    </section>
  );
}
