import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { COUNTRIES, countryFlag, dialingCodeForCountry } from '@waves/core';

import { CsrfField } from '@/components/CsrfField';
import { Icon } from '@/components/icons';
import { Card, Lede, Outcome, PageHeader } from '@/components/ui';
import { guardMutation } from '@/lib/csrf';
import { countrySettings, saveCountrySettings } from '@/lib/data';

export const dynamic = 'force-dynamic';

/**
 * The countries the phone-number sign-in offers. The app ships a fixed market
 * set; this turns which of them the dial-code picker actually shows, without a
 * deploy. Denylist — everything is on unless it is unticked here — so a fresh
 * project offers every market and nothing has to be switched on to work.
 */
const DIALABLE = COUNTRIES.filter((country) => dialingCodeForCountry(country.code));

export default async function Countries({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { error, saved } = await searchParams;
  const rows = await countrySettings();
  const disabled = new Set(rows.filter((row) => !row.enabled).map((row) => row.code));
  // Counted over the boxes actually on screen. `country_settings` can hold a
  // row for a country this build has no dial code for — one dropped from
  // `COUNTRIES`, or one switched off before it was — and subtracting the
  // table's size from the list's would report a number that disagreed with
  // the ticks underneath it.
  const enabledCount = DIALABLE.filter((country) => !disabled.has(country.code)).length;

  async function save(formData: FormData) {
    'use server';

    let failure: string | null = null;
    try {
      await guardMutation(formData);
      // An unticked box submits nothing, so its absence is "off". Every country
      // is written, so the table always mirrors the console's last full choice.
      await saveCountrySettings(
        DIALABLE.map((country) => ({
          code: country.code,
          enabled: formData.get(country.code) === 'on',
        })),
      );
    } catch (caught) {
      failure = caught instanceof Error ? caught.message : String(caught);
    }

    if (failure) redirect(`/countries?error=${encodeURIComponent(failure)}`);
    revalidatePath('/countries');
    redirect('/countries?saved=1');
  }

  return (
    <main className="page">
      <PageHeader
        eyebrow="Configuration"
        title="Countries"
        actions={
          <span className="small muted">
            {enabledCount} of {DIALABLE.length} offered
          </span>
        }
      />
      <Outcome error={error} done={saved ? 'Saved.' : undefined} />

      <Lede>
        Which countries the phone sign-in offers. Untick one to hide it from the dial-code picker —
        a market we are not live in, or one we have paused. A country with no setting is offered, so
        an empty table shows everything.
      </Lede>

      <Card bare>
        <form action={save}>
          <CsrfField />
          {/* A fieldset with a legend, because a hundred and ninety loose
              checkboxes with no group name is a hundred and ninety questions
              with no question. */}
          <fieldset className="card-body">
            <legend className="sr-only">Countries offered at sign-in</legend>
            <div className="check-grid">
              {DIALABLE.map((country) => (
                <label key={country.code} className="check plain">
                  <input
                    type="checkbox"
                    name={country.code}
                    defaultChecked={!disabled.has(country.code)}
                  />
                  <span>
                    <span aria-hidden>{countryFlag(country.code)}</span> {country.name}{' '}
                    <span className="muted small">{dialingCodeForCountry(country.code)}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="card-body" style={{ paddingTop: 0 }}>
            <button type="submit" className="btn">
              {Icon.save}
              <span>Save countries</span>
            </button>
          </div>
        </form>
      </Card>
    </main>
  );
}
