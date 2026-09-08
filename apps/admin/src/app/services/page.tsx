import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { CsrfField } from '@/components/CsrfField';
import { Icon } from '@/components/icons';
import { Card, Empty, Lede, Outcome, PageHeader, TableScroll } from '@/components/ui';
import { guardMutation } from '@/lib/csrf';
import { saveServiceConfig, serviceConfig } from '@/lib/data';

export const dynamic = 'force-dynamic';

/**
 * The string knobs — `service_config`, the sibling of `app_config` that holds
 * settings whose value is a word rather than a number.
 *
 * Today that is which cloud provider and model the voice pipeline calls. It
 * was editable only by hand in a SQL console, which meant switching speech
 * providers during an outage was a database session rather than a text field.
 *
 * Deliberately generic, exactly like `/config`: no key appears in this file.
 * A migration that adds a setting gets a row here for free, and the row's own
 * `description` column is the help text — so the thing that knows what a
 * setting means is the migration that introduced it, not this page.
 */
export default async function Services({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { error, saved } = await searchParams;
  const rows = await serviceConfig();

  async function save(formData: FormData) {
    'use server';

    let failure: string | null = null;
    try {
      await guardMutation(formData);
      await saveServiceConfig({
        key: String(formData.get('key') ?? '').trim(),
        value: String(formData.get('value') ?? ''),
      });
    } catch (caught) {
      failure = caught instanceof Error ? caught.message : String(caught);
    }

    if (failure) redirect(`/services?error=${encodeURIComponent(failure)}`);
    revalidatePath('/services');
    redirect('/services?saved=1');
  }

  return (
    <main className="page">
      <PageHeader eyebrow="Configuration" title="Services" />
      <Outcome error={error} done={saved ? 'Saved.' : undefined} />

      <Lede>
        Which outside services the backend calls, and with which model. Read by the edge functions
        at call time, so a change takes effect on the next request rather than the next deploy —
        which is the point: switching speech providers during somebody else&rsquo;s outage should
        not need a release. An empty value means &ldquo;the provider&rsquo;s own default&rdquo;.
        Credentials are <strong>not</strong> here and never will be; those are Supabase function
        secrets, and this console cannot read them.
      </Lede>

      {rows.length === 0 ? (
        <Card bare>
          <Empty title="No service settings" migration="20260904000000_waves_baseline">
            Nothing in <code>service_config</code> to set.
          </Empty>
        </Card>
      ) : (
        <Card bare>
          <TableScroll>
            <table>
              <caption className="sr-only">Backend service settings</caption>
              <thead>
                <tr>
                  <th scope="col">Setting</th>
                  <th scope="col">What it does</th>
                  <th scope="col">Changed</th>
                  <th scope="col">Value</th>
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
                      <form action={save} className="row" style={{ flexWrap: 'nowrap' }}>
                        <CsrfField />
                        <input type="hidden" name="key" value={row.key} />
                        {/* The column heading is the visible label; a screen
                            reader needs to know *which* setting this box is. */}
                        <input
                          type="text"
                          name="value"
                          defaultValue={row.value ?? ''}
                          maxLength={200}
                          size={22}
                          placeholder="(provider default)"
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
