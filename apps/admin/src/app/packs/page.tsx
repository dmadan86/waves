import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { CsrfField } from '@/components/CsrfField';
import { Icon } from '@/components/icons';
import {
  Badge,
  Card,
  Empty,
  Field,
  Lede,
  Outcome,
  PageHeader,
  TableScroll,
  type Tone,
} from '@/components/ui';
import { guardMutation } from '@/lib/csrf';
import { packs, savePack, setPackStatus } from '@/lib/data';

export const dynamic = 'force-dynamic';

const STATUS_TONE: Record<string, Tone> = {
  published: 'ok',
  draft: 'warn',
  unlisted: 'neutral',
};

/**
 * The shelf, from behind.
 *
 * A pack is a set of categories or income sources somebody can install — data,
 * never code, so there is nothing here to sandbox. What there is instead is
 * one gate: `savePack` runs `parsePack`, the same function the app runs on what
 * it fetches, so a pack that a phone would silently drop cannot be saved at
 * all. The refusal arrives while the person who wrote it is still looking at it.
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
  const live = all.filter((pack) => pack.status === 'published').length;

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
    <main className="page">
      <PageHeader
        eyebrow="Marketplace"
        title="Packs"
        actions={
          <span className="small muted">
            {live} published of {all.length}
          </span>
        }
      />
      <Outcome error={error} done={saved ? 'Saved.' : undefined} />

      <Lede>
        Sets of categories and income sources people can add to their own list. Only a{' '}
        <strong>published</strong> pack is visible in the app at all — a draft is ours alone, and
        unlisting one stops it spreading without touching anybody who already installed it. Their
        categories are their own by then.
      </Lede>

      <Card bare>
        {all.length === 0 ? (
          <Empty title="No packs yet" migration="20260906120000_category_packs">
            Nothing on the shelf.
          </Empty>
        ) : (
          <TableScroll>
            <table>
              <caption className="sr-only">Published and draft packs</caption>
              <thead>
                <tr>
                  <th scope="col">Pack</th>
                  <th scope="col" className="n">
                    Entries
                  </th>
                  <th scope="col" className="n">
                    Installs
                  </th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {all.map((pack) => {
                  const entries = Array.isArray(pack.entries) ? pack.entries.length : 0;
                  const publishing = pack.status !== 'published';
                  return (
                    <tr key={pack.id}>
                      <th scope="row">
                        <span className="row-title">{pack.title}</span>
                        <span className="row-sub">{pack.slug}</span>
                      </th>
                      <td className="n">{entries}</td>
                      <td className="n">{pack.install_count}</td>
                      <td>
                        <Badge tone={STATUS_TONE[pack.status] ?? 'neutral'}>{pack.status}</Badge>
                      </td>
                      <td>
                        <form action={publish} className="row-actions">
                          <CsrfField />
                          <input type="hidden" name="id" value={pack.id} />
                          <input
                            type="hidden"
                            name="status"
                            value={publishing ? 'published' : 'unlisted'}
                          />
                          <button
                            type="submit"
                            className={publishing ? 'btn btn-sm' : 'btn btn-quiet btn-sm'}
                            aria-label={`${publishing ? 'Publish' : 'Unlist'} ${pack.title}`}
                          >
                            {publishing ? 'Publish' : 'Unlist'}
                          </button>
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Card>

      <h2 className="section">Add or edit a pack</h2>
      <Card
        bare
        note={
          <>
            Each entry needs a <code>key</code> (lowercase, unique in the pack), a{' '}
            <code>label</code> of 40 characters or fewer, an <code>icon</code> from the curated
            Ionicons set, a <code>tint</code> of lilac / pink / mint / peach / sky / coral, and an{' '}
            <code>axis</code> of <code>expense</code> or <code>income</code>. Anything else is
            refused here rather than rendering as a blank box on somebody&rsquo;s phone.
          </>
        }
      >
        <form action={save} className="form card-body">
          <CsrfField />
          <Field label="Id" hint="blank to create">
            <input name="id" />
          </Field>
          <Field label="Slug">
            <input
              name="slug"
              required
              placeholder="india-everyday"
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
            />
          </Field>
          <Field label="Title">
            <input name="title" required placeholder="India · everyday" maxLength={60} />
          </Field>
          <Field label="Status">
            <select name="status" defaultValue="draft">
              <option value="draft">draft</option>
              <option value="published">published</option>
              <option value="unlisted">unlisted</option>
            </select>
          </Field>
          <Field label="Summary" full>
            <input name="summary" required maxLength={200} />
          </Field>
          <Field label="Entries" hint="JSON, validated with the app's own parser" full>
            <textarea
              name="entries"
              required
              rows={10}
              defaultValue={
                '[\n  {"key":"kirana","label":"Kirana","icon":"storefront-outline","tint":"mint","axis":"expense"}\n]'
              }
            />
          </Field>
          <button type="submit" className="btn">
            {Icon.save}
            <span>Save pack</span>
          </button>
        </form>
      </Card>
    </main>
  );
}
