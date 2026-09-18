'use client';

/**
 * The open-source software this client stands on.
 *
 * A flat, honest list rather than a generated dump: every direct runtime
 * dependency in `apps/web/package.json`, the workspace `@waves/*` packages
 * excepted since they are the app itself. Each identifier is the SPDX string
 * from that package's own `package.json`, read from the installed tree — so the
 * screen can be checked against the manifest the same way the privacy copy can
 * be checked against the code.
 *
 * It is deliberately **not** the phone's list. A web page attributing Expo and
 * React Native would be crediting software this build does not ship, which is
 * the one thing an attribution notice must not do. Two here are ISC rather than
 * MIT, and the column carries each identifier rather than a blanket "MIT" so
 * that stays true as dependencies change.
 *
 * Names are proper nouns and stay in English across locales; only the
 * surrounding words translate. Full per-package license text is not bundled, so
 * this is an attribution notice rather than a copy of every LICENSE file.
 */

import { AppFrame } from '@/components/AppFrame';
import { Section } from '@/components/Shell';
import { useStrings } from '@/i18n-context';

const LICENSES: readonly { name: string; license: string }[] = [
  { name: 'React', license: 'MIT' },
  { name: 'React DOM', license: 'MIT' },
  { name: 'Next.js', license: 'MIT' },
  { name: 'Supabase JS', license: 'MIT' },
  { name: 'Sentry for Next.js', license: 'MIT' },
  { name: 'Model Context Protocol SDK', license: 'MIT' },
  { name: 'Lucide React', license: 'ISC' },
  { name: 'qrcode.react', license: 'ISC' },
];

export default function LicensesPage() {
  return <AppFrame current={Section.Settings}>{() => <Licenses />}</AppFrame>;
}

function Licenses() {
  const { t } = useStrings();

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{t.licenses.title}</h1>
          <div className="sub">{t.licenses.intro}</div>
        </div>
      </div>

      <section className="panel">
        {LICENSES.map((library) => (
          <div className="item" key={library.name}>
            <span className="grow">
              <span className="title">{library.name}</span>
            </span>
            {/* The identifier, not a badge: it is the fact somebody came here
                for, and it reads left-to-right in every locale. */}
            <span className="meta code">{library.license}</span>
          </div>
        ))}
      </section>

      <p className="faint">{t.licenses.note}</p>
    </div>
  );
}
