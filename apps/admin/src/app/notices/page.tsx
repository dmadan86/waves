import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { CsrfField } from '@/components/CsrfField';
import { Icon } from '@/components/icons';
import {
  Badge,
  Card,
  Check,
  Empty,
  Field,
  Lede,
  Outcome,
  PageHeader,
  TableScroll,
} from '@/components/ui';
import { guardMutation } from '@/lib/csrf';
import {
  appNotices,
  createAppNotice,
  endAppNotice,
  NOTICE_LANGUAGES,
  type AppNoticeRow,
} from '@/lib/data';

export const dynamic = 'force-dynamic';

/**
 * Saying something to every running copy of the app.
 *
 * Three kinds, and the difference between them is only what the app already
 * knows how to word:
 *
 *   * **Maintenance** — a start and an end. The app composes the whole sentence
 *     out of those two timestamps, in English, Tamil, Hindi and Arabic, in the
 *     reader's own time. Text is optional and usually unnecessary.
 *   * **Incident** — something is broken now. Same deal, minus the window.
 *   * **Announcement** — nothing but words, so words are required.
 *
 * ## The thing this page cannot do
 *
 * It cannot stop anybody using Waves. There is no field here that could, and
 * the table it writes to has no column for one. A maintenance banner leaves the
 * app exactly as usable as a train tunnel does: expenses are saved on the phone
 * and sync themselves when the servers come back. That is not a nicety to
 * preserve, it is the premise of the product, and the console should not be
 * able to break it by accident at 2am.
 *
 * The one control that *can* gate the app is the minimum version, it lives on
 * Releases, and it asks you to type the number twice.
 *
 * ## Why there is no edit button
 *
 * Ending a notice is the only change offered. A notice is a short-lived
 * statement made to people who have already read it; rewriting one in place
 * would leave everybody who saw the first wording with no way to tell it had
 * changed. End it and post the correction — the old row stays in this list,
 * which is also the only way to answer "what did we tell people" afterwards.
 */
export default async function Notices({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { error, saved } = await searchParams;
  const rows = await appNotices();

  async function post(formData: FormData) {
    'use server';

    let failure: string | null = null;
    try {
      await guardMutation(formData);
      const body: Record<string, string> = {};
      for (const language of NOTICE_LANGUAGES) {
        body[language] = String(formData.get(`body_${language}`) ?? '');
      }
      await createAppNotice({
        kind: String(formData.get('kind') ?? ''),
        startsAt: String(formData.get('starts_at') ?? ''),
        endsAt: String(formData.get('ends_at') ?? ''),
        visibleFrom: String(formData.get('visible_from') ?? ''),
        visibleUntil: String(formData.get('visible_until') ?? ''),
        platforms: formData.getAll('platform').map(String),
        countries: String(formData.get('countries') ?? '')
          .split(',')
          .map((entry) => entry.trim().toUpperCase()),
        body,
        note: String(formData.get('note') ?? ''),
      });
    } catch (caught) {
      failure = caught instanceof Error ? caught.message : String(caught);
    }

    if (failure) redirect(`/notices?error=${encodeURIComponent(failure)}`);
    revalidatePath('/notices');
    redirect('/notices?saved=1');
  }

  async function end(formData: FormData) {
    'use server';

    let failure: string | null = null;
    try {
      await guardMutation(formData);
      await endAppNotice(String(formData.get('id') ?? ''));
    } catch (caught) {
      failure = caught instanceof Error ? caught.message : String(caught);
    }

    if (failure) redirect(`/notices?error=${encodeURIComponent(failure)}`);
    revalidatePath('/notices');
    redirect('/notices?saved=1');
  }

  return (
    <main className="page">
      <PageHeader eyebrow="Configuration" title="Status messages" />
      <Outcome error={error} done={saved ? 'Saved.' : undefined} />

      <Lede>
        What every running copy of the app is currently being told — a maintenance window, an
        incident, an announcement. Takes effect on the next launch or the next time somebody brings
        the app back to the front; there is nothing to deploy.{' '}
        <strong>None of this stops anybody using Waves.</strong> Expenses are saved on the phone and
        sync themselves when the servers are back, so a maintenance banner is a courtesy, not a
        door. The only control that locks the app is the minimum version, on{' '}
        <a href="/releases">Releases</a>.
      </Lede>

      <Card title="Say something new">
        <form action={post} className="form">
          <CsrfField />

          <Field label="Kind" hint="what the app words it as">
            <select name="kind" defaultValue="maintenance" aria-label="Kind of notice">
              <option value="maintenance">Maintenance — a planned pause, with a window</option>
              <option value="incident">Incident — something is broken now</option>
              <option value="notice">Announcement — words, nothing else</option>
            </select>
          </Field>

          <Field label="Window starts" hint="maintenance only; your own time zone">
            <input type="datetime-local" name="starts_at" aria-label="When the window starts" />
          </Field>

          <Field label="Window ends" hint="the app stops saying it after this">
            <input type="datetime-local" name="ends_at" aria-label="When the window ends" />
          </Field>

          <Field label="Start showing" hint="blank means straight away">
            <input
              type="datetime-local"
              name="visible_from"
              aria-label="When to start showing it"
            />
          </Field>

          <Field label="Stop showing" hint="blank means until the window ends">
            <input
              type="datetime-local"
              name="visible_until"
              aria-label="When to stop showing it"
            />
          </Field>

          {/* Nothing ticked means everybody, which is the safe direction: a
              notice that reaches more people than intended is noise, one that
              reaches nobody because a box was missed is an outage we told
              nobody about. */}
          <Field label="Platforms" hint="none ticked means all of them" full>
            <div className="row">
              <Check name="platform" value="ios" label="iOS" plain />
              <Check name="platform" value="android" label="Android" plain />
              <Check name="platform" value="web" label="Web" plain />
            </div>
          </Field>

          <Field
            label="Countries"
            hint="two-letter codes, comma separated; blank means everywhere"
            full
          >
            <input
              type="text"
              name="countries"
              placeholder="IN, AE"
              pattern="[A-Za-z ,]*"
              aria-label="Countries this notice is for"
            />
          </Field>

          {/* The app writes the maintenance and incident sentences itself, in
              all four languages, from the kind and the window. These boxes are
              for the cases where there is genuinely more to say — and English
              is required as soon as any of them is used, because it is what
              every other language falls back to. */}
          {NOTICE_LANGUAGES.map((language) => (
            <Field
              key={language}
              label={LANGUAGE_LABEL[language]}
              hint={
                language === 'en'
                  ? 'optional for maintenance and incidents; required if you write any language'
                  : 'optional — untranslated readers are shown English and told so'
              }
              full
            >
              <textarea
                name={`body_${language}`}
                rows={2}
                maxLength={500}
                aria-label={`Notice text in ${LANGUAGE_LABEL[language]}`}
              />
            </Field>
          ))}

          <Field label="Internal note" hint="never shown in the app" full>
            <input
              type="text"
              name="note"
              maxLength={500}
              placeholder="Postgres upgrade, ticket #412"
              aria-label="Internal note"
            />
          </Field>

          <button type="submit" className="btn">
            {Icon.send}
            <span>Post it</span>
          </button>
        </form>
      </Card>

      {rows.length === 0 ? (
        <Card bare>
          <Empty title="Nothing said" migration="20260912180000_app_notices">
            Nothing in <code>app_notices</code>. The app is showing no status message at all, which
            is the correct state almost all of the time.
          </Empty>
        </Card>
      ) : (
        <Card bare>
          <TableScroll>
            <table>
              <caption className="sr-only">Status messages, newest first</caption>
              <thead>
                <tr>
                  <th scope="col">Kind</th>
                  <th scope="col">Showing</th>
                  <th scope="col">Window</th>
                  <th scope="col">Who</th>
                  <th scope="col">Says</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <NoticeRow key={row.id} row={row} end={end} />
                ))}
              </tbody>
            </table>
          </TableScroll>
        </Card>
      )}
    </main>
  );
}

const LANGUAGE_LABEL: Record<(typeof NOTICE_LANGUAGES)[number], string> = {
  en: 'English',
  ta: 'Tamil',
  hi: 'Hindi',
  ar: 'Arabic',
};

const KIND_LABEL: Record<string, string> = {
  maintenance: 'Maintenance',
  incident: 'Incident',
  notice: 'Announcement',
};

const when = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

function NoticeRow({
  row,
  end,
}: {
  row: AppNoticeRow;
  end: (formData: FormData) => Promise<void>;
}) {
  // `live` and `started` are settled in the data layer: a component may not read
  // a clock, and the answer belongs beside the query anyway.
  const { live, started } = row;

  const scope = [
    row.platforms?.length ? row.platforms.join(', ') : 'all platforms',
    row.countries?.length ? row.countries.join(', ') : 'everywhere',
  ].join(' · ');

  // Rendered as text, never as markup — React escapes it, and @waves/core has
  // already stripped angle brackets and control characters before it ever
  // reaches a phone. Nothing here links it or parses it.
  const languages = Object.keys(row.body);
  const says = row.body.en ?? (languages[0] ? row.body[languages[0]] : '');

  return (
    <tr>
      <th scope="row">
        {KIND_LABEL[row.kind] ?? row.kind}
        {row.note ? <div className="muted small wrap">{row.note}</div> : null}
      </th>
      <td>
        {live ? (
          <Badge tone="ok">Live</Badge>
        ) : started ? (
          <Badge>Over</Badge>
        ) : (
          <Badge>Queued</Badge>
        )}
        <div className="muted small">
          {when(row.visible_from)} → {row.visible_until ? when(row.visible_until) : 'no stop date'}
        </div>
      </td>
      <td className="muted small">
        {row.starts_at || row.ends_at ? `${when(row.starts_at)} → ${when(row.ends_at)}` : '—'}
      </td>
      <td className="muted small">{scope}</td>
      <td className="wrap">
        {says ? (
          <>
            {says}
            {languages.length > 0 ? (
              <div className="muted small">in {languages.join(', ')}</div>
            ) : null}
          </>
        ) : (
          <span className="muted">The app words this one itself.</span>
        )}
      </td>
      <td>
        {live ? (
          <form action={end}>
            <CsrfField />
            <input type="hidden" name="id" value={row.id} />
            <button type="submit" className="btn btn-sm">
              <span>Stop saying it</span>
            </button>
          </form>
        ) : null}
      </td>
    </tr>
  );
}
