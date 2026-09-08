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
import { assertSameOrigin, guardMutation } from '@/lib/csrf';
import { confirmUserEmail, listUsers, upgradeUser, type AdminUserListRow } from '@/lib/data';

export const dynamic = 'force-dynamic';

const PAGE = 25;

function when(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function kind(u: AdminUserListRow): { label: string; tone: Tone } {
  if (u.is_anonymous) return { label: 'guest', tone: 'neutral' };
  if (u.is_plus) return { label: 'plus', tone: 'accent' };
  return { label: 'free', tone: 'ok' };
}

/** Carry the current filter + page through an action's redirect. */
function backTo(name: string, country: string, offset: number): string {
  const p = new URLSearchParams();
  if (name) p.set('name', name);
  if (country) p.set('country', country);
  if (offset) p.set('offset', String(offset));
  const qs = p.toString();
  return qs ? `/users?${qs}` : '/users';
}

export default async function Users({
  searchParams,
}: {
  searchParams: Promise<{
    name?: string;
    country?: string;
    offset?: string;
    error?: string;
    done?: string;
  }>;
}) {
  const sp = await searchParams;
  const name = (sp.name ?? '').trim();
  const country = (sp.country ?? '').trim();
  const rawOffset = Number(sp.offset ?? 0);
  const offset = Number.isSafeInteger(rawOffset) && rawOffset > 0 ? rawOffset : 0;

  const { total, rows } = await listUsers({ limit: PAGE, offset, namePrefix: name, country });
  const back = backTo(name, country, offset);
  const filtered = Boolean(name || country);

  async function filter(formData: FormData) {
    'use server';
    // Navigation only, so no CSRF token — but still refuse a cross-site POST.
    await assertSameOrigin();
    const p = new URLSearchParams();
    const n = String(formData.get('name') ?? '').trim();
    const c = String(formData.get('country') ?? '')
      .trim()
      .toUpperCase();
    if (n) p.set('name', n);
    if (c) p.set('country', c);
    const qs = p.toString();
    redirect(qs ? `/users?${qs}` : '/users');
  }

  async function confirm(formData: FormData) {
    'use server';
    const id = String(formData.get('id') ?? '');
    const to = String(formData.get('back') ?? '/users');
    let failure: string | null = null;
    try {
      await guardMutation(formData);
      await confirmUserEmail(id);
    } catch (caught) {
      failure = caught instanceof Error ? caught.message : String(caught);
    }
    const sep = to.includes('?') ? '&' : '?';
    if (failure) redirect(`${to}${sep}error=${encodeURIComponent(failure)}`);
    revalidatePath('/users');
    redirect(`${to}${sep}done=${encodeURIComponent('Email confirmed.')}`);
  }

  async function upgrade(formData: FormData) {
    'use server';
    const id = String(formData.get('id') ?? '');
    const days = Number(formData.get('days') ?? 365);
    const to = String(formData.get('back') ?? '/users');
    let message: string | null = null;
    let failure: string | null = null;
    try {
      await guardMutation(formData);
      message = await upgradeUser(id, days);
    } catch (caught) {
      failure = caught instanceof Error ? caught.message : String(caught);
    }
    const sep = to.includes('?') ? '&' : '?';
    if (failure) redirect(`${to}${sep}error=${encodeURIComponent(failure)}`);
    revalidatePath('/users');
    redirect(`${to}${sep}done=${encodeURIComponent(message ?? 'Upgraded.')}`);
  }

  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE, total);

  return (
    <main className="page">
      <PageHeader
        eyebrow="People"
        title="Users"
        actions={<span className="small muted">{total.toLocaleString('en-IN')} signups</span>}
      />
      <Outcome error={sp.error} done={sp.done} />

      <Lede>
        Sorted newest first. Type, devices and app version come from the account, its subscription
        and the devices it has registered — the device columns fill in once the device-session
        feature is live on this project.
      </Lede>

      <Card bare>
        <form action={filter} className="form card-body" role="search">
          <Field label="Name or email" hint="starts with">
            <input type="text" name="name" defaultValue={name} placeholder="asha" />
          </Field>
          <Field label="Country" hint="two letters">
            <input
              type="text"
              name="country"
              defaultValue={country}
              placeholder="IN"
              maxLength={2}
              size={4}
            />
          </Field>
          <button type="submit" className="btn">
            {Icon.search}
            <span>Filter</span>
          </button>
          {filtered ? (
            <a className="btn btn-quiet" href="/users">
              Clear
            </a>
          ) : null}
        </form>
      </Card>

      <div className="stack-gap" style={{ marginTop: '1rem' }}>
        <Card bare>
          {rows.length === 0 ? (
            <Empty title={filtered ? 'Nothing matches that filter' : 'No signups yet'}>
              {filtered
                ? 'Try a shorter prefix, or clear the filter to see everybody.'
                : 'Nobody has created an account on this project.'}
            </Empty>
          ) : (
            <TableScroll>
              <table>
                <caption className="sr-only">
                  Signups {from}–{to} of {total}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">User</th>
                    <th scope="col">Type</th>
                    <th scope="col">Country</th>
                    <th scope="col" className="n">
                      Devices
                    </th>
                    <th scope="col">App</th>
                    <th scope="col">Joined</th>
                    <th scope="col">Last seen</th>
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((u) => {
                    const k = kind(u);
                    return (
                      <tr key={u.id}>
                        <th scope="row" style={{ maxWidth: '17rem' }}>
                          <span className="row-title">{u.display_name ?? '—'}</span>
                          <span className="row-sub">
                            {u.email ?? u.phone ?? '(no contact)'}
                            {u.email && !u.email_confirmed ? ' · unconfirmed' : ''}
                          </span>
                        </th>
                        <td>
                          <Badge tone={k.tone}>{k.label}</Badge>
                        </td>
                        <td>{u.country_code ?? <span className="muted">—</span>}</td>
                        <td className="n">
                          {u.device_count > 0 ? u.device_count : <span className="muted">0</span>}
                        </td>
                        <td>
                          {u.app_version ? (
                            <>
                              {u.app_version}
                              {u.platform ? <span className="row-sub">{u.platform}</span> : null}
                            </>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td>{when(u.created_at)}</td>
                        <td>{when(u.last_sign_in_at)}</td>
                        <td>
                          <div className="row-actions">
                            {u.email_confirmed || !u.email ? null : (
                              <form action={confirm}>
                                <CsrfField />
                                <input type="hidden" name="id" value={u.id} />
                                <input type="hidden" name="back" value={back} />
                                <button
                                  type="submit"
                                  className="btn btn-quiet btn-sm"
                                  title="Confirm this email by hand"
                                >
                                  Confirm
                                </button>
                              </form>
                            )}
                            <form action={upgrade} className="row" style={{ gap: '0.25rem' }}>
                              <CsrfField />
                              <input type="hidden" name="id" value={u.id} />
                              <input type="hidden" name="back" value={back} />
                              <input
                                type="number"
                                name="days"
                                min={1}
                                max={3650}
                                defaultValue={365}
                                aria-label={`Days of Plus to grant ${u.display_name ?? u.id}`}
                                style={{ width: '4.5rem' }}
                              />
                              <button
                                type="submit"
                                className="btn btn-outline btn-sm"
                                title="Comp a paid grant"
                              >
                                Upgrade
                              </button>
                            </form>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableScroll>
          )}
        </Card>
      </div>

      {/* A real nav landmark: this is the only pagination in the console and
          it is worth being able to jump to. */}
      <nav className="row spread" style={{ marginTop: '1rem' }} aria-label="Pages of signups">
        <span className="small muted">
          {from}–{to} of {total.toLocaleString('en-IN')}
        </span>
        <span className="row" style={{ gap: '0.5rem' }}>
          {offset > 0 ? (
            <a
              className="btn btn-quiet btn-sm"
              href={backTo(name, country, Math.max(0, offset - PAGE))}
            >
              {Icon.arrowLeft}
              <span>Previous</span>
            </a>
          ) : (
            <span className="btn btn-quiet btn-sm" aria-disabled="true">
              {Icon.arrowLeft}
              <span>Previous</span>
            </span>
          )}
          {offset + PAGE < total ? (
            <a className="btn btn-quiet btn-sm" href={backTo(name, country, offset + PAGE)}>
              <span>Next</span>
              {Icon.arrowRight}
            </a>
          ) : (
            <span className="btn btn-quiet btn-sm" aria-disabled="true">
              <span>Next</span>
              {Icon.arrowRight}
            </span>
          )}
        </span>
      </nav>
    </main>
  );
}
