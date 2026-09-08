import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { CsrfField } from '@/components/CsrfField';
import { Icon } from '@/components/icons';
import { Card, Empty, Lede, Outcome, PageHeader, TableScroll } from '@/components/ui';
import { guardMutation } from '@/lib/csrf';
import { appConfig, saveAppConfig } from '@/lib/data';

export const dynamic = 'force-dynamic';

/**
 * The numeric knobs, whichever ones exist.
 *
 * Nothing here names a key. `appConfig()` selects the whole table and this
 * renders a row per result, so a knob added by a migration — the receipt cap,
 * the storage cap, the device caps, and `person_lookup_daily_cap` when the
 * person-lookup branch lands — turns up on this page with no change to the
 * console at all. The one thing the console cannot do is *create* a knob: the
 * save is an UPDATE, because a key that no code reads is a number with no
 * effect, and the migration that reads it is the right place to define it.
 */
export default async function Config({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { error, saved } = await searchParams;
  const rows = await appConfig();

  async function save(formData: FormData) {
    'use server';

    let failure: string | null = null;
    try {
      await guardMutation(formData);
      const rawValue = String(formData.get('value') ?? '').trim();
      if (rawValue === '') {
        throw new Error('A limit is a whole number, zero or more.');
      }
      await saveAppConfig({
        key: String(formData.get('key') ?? '').trim(),
        value: Number(rawValue),
      });
    } catch (caught) {
      failure = caught instanceof Error ? caught.message : String(caught);
    }

    if (failure) redirect(`/config?error=${encodeURIComponent(failure)}`);
    revalidatePath('/config');
    redirect('/config?saved=1');
  }

  return (
    <main className="page">
      <PageHeader eyebrow="Configuration" title="Limits" />
      <Outcome error={error} done={saved ? 'Saved.' : undefined} />

      <Lede>
        Numeric knobs the app reads at runtime. They live in the database so they can change without
        a deploy, and the database enforces them, so lowering one is real rather than cosmetic. This
        list is whatever <code>app_config</code> holds — a knob a migration adds appears here on its
        own, and a knob no migration created cannot be invented here.
      </Lede>

      {rows.length === 0 ? (
        <Card bare>
          <Empty title="No knobs yet" migration="20260818160000_receipt_cap">
            Nothing in <code>app_config</code> to turn.
          </Empty>
        </Card>
      ) : (
        <Card bare>
          <TableScroll>
            <table>
              <caption className="sr-only">Runtime numeric limits</caption>
              <thead>
                <tr>
                  <th scope="col">Knob</th>
                  <th scope="col">What it does</th>
                  <th scope="col">Changed</th>
                  <th scope="col" className="n">
                    Value
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key}>
                    <th scope="row">
                      <code>{row.key}</code>
                    </th>
                    <td className="wrap">
                      {row.description || <span className="muted">No description recorded.</span>}
                    </td>
                    <td className="muted small">
                      {new Date(row.updated_at).toLocaleDateString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </td>
                    <td>
                      <form action={save} className="row" style={{ justifyContent: 'flex-end' }}>
                        <CsrfField />
                        <input type="hidden" name="key" value={row.key} />
                        {/* The column header already says "Value"; a visible
                            label per row would be that word ten times down
                            the page. The name each input actually needs is
                            the knob's, and that is what a screen reader gets. */}
                        <input
                          type="number"
                          className="wide"
                          name="value"
                          min={0}
                          step={1}
                          defaultValue={row.value}
                          required
                          aria-label={`Value for ${row.key}`}
                        />
                        <button type="submit" className="btn btn-sm">
                          {Icon.save}
                          <span>Save</span>
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </Card>
      )}
    </main>
  );
}
