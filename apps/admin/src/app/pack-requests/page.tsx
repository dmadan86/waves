import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { decidePackRequest, packRequests } from '@/lib/data';
import { guardMutation } from '@/lib/csrf';
import { CsrfField } from '@/components/CsrfField';

export const dynamic = 'force-dynamic';

/**
 * What people have asked for.
 *
 * The other half of "we author them, others ask": there is no submission flow
 * and nothing anybody writes here reaches another user — a request is a sentence
 * in a queue. Which makes this the cheapest possible way to find out what the
 * shelf is missing, and the only one that carries no moderation burden at all.
 *
 * No requester is shown. Knowing *who* asked adds nothing to deciding whether
 * the pack is worth making, and this console deliberately keeps what it can see
 * about people to what it needs (see `data.ts`).
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
    <main>
      <header className="top">
        <h1>Pack requests</h1>{' '}
      </header>

      {error ? <p className="error">{error}</p> : null}
      {saved ? <p className="faint">Saved.</p> : null}

      <p className="note" style={{ padding: 0 }}>
        What people told us the app has no words for. Mark one <strong>done</strong> once a pack
        covering it is published, or <strong>declined</strong> if it is not something we will make.
        Nobody is notified either way.
      </p>

      {open.length === 0 ? (
        <p className="note">Nothing waiting.</p>
      ) : (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Asked for</th>
                <th>When</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {open.map((row) => (
                <tr key={row.id}>
                  <td>{row.body}</td>
                  <td className="faint">{new Date(row.created_at).toLocaleDateString()}</td>
                  <td>
                    <form action={decide} style={{ display: 'flex', gap: 8 }}>
                      <CsrfField />
                      <input type="hidden" name="id" value={row.id} />
                      <button type="submit" name="status" value="done">
                        Done
                      </button>
                      <button type="submit" name="status" value="declined">
                        Decline
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {decided.length > 0 ? (
        <>
          <h2>Decided</h2>
          <div className="scroll">
            <table>
              <tbody>
                {decided.slice(0, 50).map((row) => (
                  <tr key={row.id}>
                    <td>{row.body}</td>
                    <td className="faint">{row.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </main>
  );
}
