import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { packs, savePack, setPackStatus } from '@/lib/data';
import { guardMutation } from '@/lib/csrf';
import { CsrfField } from '@/components/CsrfField';

export const dynamic = 'force-dynamic';

/**
 * The shelf, from behind.
 *
 * A pack is a set of categories or income sources somebody can install — data,
 * never code, so there is nothing here to sandbox. What there is instead is one
 * gate: `savePack` runs `parsePack`, the same function the app runs on what it
 * fetches, so a pack that a phone would silently drop cannot be saved at all.
 * The refusal arrives while the person who wrote it is still looking at it.
 *
 * The entries are edited as JSON rather than through a row-by-row form. That is
 * a deliberate trade for a staff tool used by a handful of people: a form would
 * be a week of work to save an operator from matching braces, and the validator
 * catches every mistake a form would have prevented. If somebody outside the
 * team ever authors a pack, this is the first thing to replace.
 */
export default async function Packs({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { error, saved } = await searchParams;
  const all = await packs();

  async function save(formData: FormData) {
    'use server';

    let failure: string | null = null;
    try {
      await guardMutation(formData);
      const id = String(formData.get('id') ?? '').trim();
      await savePack({
        id: id === '' ? undefined : id,
        slug: String(formData.get('slug') ?? ''),
        title: String(formData.get('title') ?? ''),
        summary: String(formData.get('summary') ?? ''),
        entriesJson: String(formData.get('entries') ?? '[]'),
        status: String(formData.get('status') ?? 'draft'),
      });
    } catch (caught) {
      failure = caught instanceof Error ? caught.message : String(caught);
    }

    if (failure) redirect(`/packs?error=${encodeURIComponent(failure)}`);
    revalidatePath('/packs');
    redirect('/packs?saved=1');
  }

  async function publish(formData: FormData) {
    'use server';

    let failure: string | null = null;
    try {
      await guardMutation(formData);
      await setPackStatus(
        String(formData.get('id') ?? ''),
        String(formData.get('status') ?? 'draft'),
      );
    } catch (caught) {
      failure = caught instanceof Error ? caught.message : String(caught);
    }

    if (failure) redirect(`/packs?error=${encodeURIComponent(failure)}`);
    revalidatePath('/packs');
    redirect('/packs?saved=1');
  }

  return (
    <main>
      <header className="top">
        <h1>Packs</h1>{' '}
      </header>

      {error ? <p className="error">{error}</p> : null}
      {saved ? <p className="faint">Saved.</p> : null}

      <p className="note" style={{ padding: 0 }}>
        Sets of categories and income sources people can add to their own list. Only a{' '}
        <strong>published</strong> pack is visible in the app at all — a draft is ours alone, and
        unlisting one stops it spreading without touching anybody who already installed it. Their
        categories are their own by then.
      </p>

      {all.length === 0 ? (
        <p className="note">
          None yet. If you expected some, the <code>20260906120000_category_packs</code> migration
          may not be deployed to this project.
        </p>
      ) : (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Pack</th>
                <th>Entries</th>
                <th>Installs</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {all.map((pack) => {
                const entries = Array.isArray(pack.entries) ? pack.entries.length : 0;
                return (
                  <tr key={pack.id}>
                    <td>
                      <strong>{pack.title}</strong>
                      <br />
                      <span className="faint">{pack.slug}</span>
                    </td>
                    <td>{entries}</td>
                    <td>{pack.install_count}</td>
                    <td>{pack.status}</td>
                    <td>
                      <form action={publish}>
                        <CsrfField />
                        <input type="hidden" name="id" value={pack.id} />
                        <input
                          type="hidden"
                          name="status"
                          value={pack.status === 'published' ? 'unlisted' : 'published'}
                        />
                        <button type="submit">
                          {pack.status === 'published' ? 'Unlist' : 'Publish'}
                        </button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <h2>Add or edit a pack</h2>
      <form action={save} className="flag">
        <CsrfField />
        <label>
          Id <span className="faint">(blank to create)</span>
          <input name="id" placeholder="" />
        </label>
        <label>
          Slug
          <input
            name="slug"
            required
            placeholder="india-everyday"
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
          />
        </label>
        <label>
          Title
          <input name="title" required placeholder="India · everyday" maxLength={60} />
        </label>
        <label>
          Summary
          <input name="summary" required maxLength={200} />
        </label>
        <label>
          Status
          <select name="status" defaultValue="draft">
            <option value="draft">draft</option>
            <option value="published">published</option>
            <option value="unlisted">unlisted</option>
          </select>
        </label>
        <label>
          Entries
          <textarea
            name="entries"
            required
            rows={10}
            defaultValue={
              '[\n  {"key":"kirana","label":"Kirana","icon":"storefront-outline","tint":"mint","axis":"expense"}\n]'
            }
          />
        </label>
        <button type="submit">Save pack</button>
      </form>

      <p className="note">
        Each entry needs a <code>key</code> (lowercase, unique in the pack), a <code>label</code> of
        40 characters or fewer, an <code>icon</code> from the curated Ionicons set, a{' '}
        <code>tint</code> of lilac / pink / mint / peach / sky / coral, and an <code>axis</code> of{' '}
        <code>expense</code> or <code>income</code>. Anything else is refused here rather than
        rendering as a blank box on somebody&rsquo;s phone.
      </p>
    </main>
  );
}
