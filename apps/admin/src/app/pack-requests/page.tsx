import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { CsrfField } from '@/components/CsrfField';
import { Badge, Card, Empty, Lede, Outcome, PageHeader, TableScroll } from '@/components/ui';
import { guardMutation } from '@/lib/csrf';
import { decidePackRequest, packRequests } from '@/lib/data';

export const dynamic = 'force-dynamic';

/**
 * What people have asked for.
 *
 * The other half of "we author them, others ask": there is no submission flow
 * and nothing anybody writes here reaches another user — a request is a
 * sentence in a queue. Which makes this the cheapest possible way to find out
 * what the shelf is missing, and the only one that carries no moderation
 * burden at all.
 *
 * No requester is shown. Knowing *who* asked adds nothing to deciding whether
 * the pack is worth making, and this console deliberately keeps what it can
 * see about people to what it needs (see `data.ts`).
 */
export default async function PackRequests({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { error, saved } = await searchParams;
  const rows = await packRequests();
  const open = rows.filter((row) => row.status === 'open');
  const decided = rows.filter((row) => row.status !== 'open');

  async function decide(formData: FormData) {
    'use server';

    let failure: string | null = null;
    try {
      await guardMutation(formData);
      const status = String(formData.get('status') ?? '');
      if (status !== 'done' && status !== 'declined') throw new Error('Unknown decision.');
      await decidePackRequest(String(formData.get('id') ?? ''), status);
    } catch (caught) {
      failure = caught instanceof Error ? caught.message : String(caught);
    }

    if (failure) redirect(`/pack-requests?error=${encodeURIComponent(failure)}`);
    revalidatePath('/pack-requests');
    redirect('/pack-requests?saved=1');
  }

  return (
    <main className="page">
      <PageHeader
        eyebrow="Marketplace"
        title="Pack requests"
        actions={<span className="small muted">{open.length} waiting</span>}
      />
      <Outcome error={error} done={saved ? 'Saved.' : undefined} />

      <Lede>
        What people told us the app has no words for. Mark one <strong>done</strong> once a pack
        covering it is published, or <strong>declined</strong> if it is not something we will make.
        Nobody is notified either way.
      </Lede>

      <Card bare>
        {open.length === 0 ? (
          <Empty title="Nothing waiting">Every request has been decided.</Empty>
        ) : (
          <TableScroll>
            <table>
              <caption className="sr-only">Open pack requests</caption>
              <thead>
                <tr>
                  <th scope="col">Asked for</th>
                  <th scope="col">When</th>
                  <th scope="col">
                    <span className="sr-only">Decision</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {open.map((row) => (
                  <tr key={row.id}>
                    <td className="wrap">{row.body}</td>
                    <td className="muted">
                      <time dateTime={row.created_at}>
                        {new Date(row.created_at).toLocaleDateString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </time>
                    </td>
                    <td>
                      <form action={decide} className="row-actions">
                        <CsrfField />
                        <input type="hidden" name="id" value={row.id} />
                        <button
                          type="submit"
                          name="status"
                          value="done"
                          className="btn btn-sm"
                          aria-label={`Mark "${row.body}" done`}
                        >
                          Done
                        </button>
                        <button
                          type="submit"
                          name="status"
                          value="declined"
                          className="btn btn-danger btn-sm"
                          aria-label={`Decline "${row.body}"`}
                        >
                          Decline
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Card>

      {decided.length > 0 ? (
        <>
          <h2 className="section">Decided</h2>
          <Card bare>
            <TableScroll>
              <table>
                <caption className="sr-only">Requests already decided</caption>
                <thead>
                  <tr>
                    <th scope="col">Asked for</th>
                    <th scope="col">Decision</th>
                  </tr>
                </thead>
                <tbody>
                  {decided.slice(0, 50).map((row) => (
                    <tr key={row.id}>
                      <td className="wrap">{row.body}</td>
                      <td>
                        <Badge tone={row.status === 'done' ? 'ok' : 'neutral'}>{row.status}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          </Card>
        </>
      ) : null}
    </main>
  );
}
