import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { CsrfField } from '@/components/CsrfField';
import { Badge, Card, Empty, Field, Lede, Outcome, PageHeader, TableScroll } from '@/components/ui';
import { guardMutation } from '@/lib/csrf';
import {
  blockCompany,
  companyDetail,
  isCompanyId,
  openCompanyRecords,
  setCompanyComplaint,
  unblockCompany,
} from '@/lib/data';
import { companyMoney, companyWhen } from '@/lib/company-format';

export const dynamic = 'force-dynamic';

export default async function Company({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { id } = await params;
  if (!isCompanyId(id)) notFound();
  const detail = await companyDetail(id);
  if (!detail) notFound();
  const { facts, members, weeks, complaints, log } = detail;
  const { error, saved } = await searchParams;
  const back = `/companies/${id}`;

  async function moderate(formData: FormData) {
    'use server';
    let failure: string | null = null;
    try {
      await guardMutation(formData);
      const reason = String(formData.get('reason') ?? '');
      if (formData.get('operation') === 'unblock') await unblockCompany(id, reason);
      else await blockCompany(id, String(formData.get('category') ?? ''), reason);
    } catch (caught) {
      failure = caught instanceof Error ? caught.message : String(caught);
    }
    if (failure) redirect(`${back}?error=${encodeURIComponent(failure)}`);
    revalidatePath('/companies');
    revalidatePath(back);
    redirect(`${back}?saved=1`);
  }

  async function complaint(formData: FormData) {
    'use server';
    let failure: string | null = null;
    try {
      await guardMutation(formData);
      const complaintId = String(formData.get('complaint_id') ?? '');
      // Bind the submitted complaint to this company before updating it.
      const current = await companyDetail(id);
      if (!current?.complaints.some((row) => row.id === complaintId))
        throw new Error('Complaint not found for this company.');
      await setCompanyComplaint(
        complaintId,
        String(formData.get('status') ?? ''),
        String(formData.get('note') ?? ''),
      );
    } catch (caught) {
      failure = caught instanceof Error ? caught.message : String(caught);
    }
    if (failure) redirect(`${back}?error=${encodeURIComponent(failure)}`);
    revalidatePath('/companies');
    revalidatePath(back);
    redirect(`${back}?saved=1`);
  }

  async function openRecords(formData: FormData) {
    'use server';
    let failure: string | null = null;
    try {
      await guardMutation(formData);
      await openCompanyRecords(id, String(formData.get('reason') ?? ''));
    } catch (caught) {
      failure = caught instanceof Error ? caught.message : String(caught);
    }
    if (failure) redirect(`${back}?error=${encodeURIComponent(failure)}`);
    revalidatePath(back);
    redirect(`${back}/records?saved=1`);
  }

  return (
    <main className="page">
      <PageHeader
        eyebrow="People"
        title={facts.name}
        actions={
          <a className="btn btn-quiet" href="/companies">
            All companies
          </a>
        }
      />
      <Outcome error={error} done={saved ? 'Saved.' : undefined} />
      <Lede>
        Monitoring shows metadata only. Opening records, moderation changes and exports are logged.
      </Lede>
      <div className="stack-gap">
        <Card
          title="Company facts"
          actions={
            <Badge tone={facts.suspended_at ? 'danger' : 'ok'}>
              {facts.suspended_at ? 'Blocked' : 'Active'}
            </Badge>
          }
        >
          <dl>
            <dt>Company id</dt>
            <dd>{facts.id}</dd>
            <dt>Created</dt>
            <dd>{companyWhen(facts.created_at)}</dd>
            <dt>Owner</dt>
            <dd>
              {facts.owner_name ?? '—'} · {facts.owner_email ?? '—'} · {facts.owner_phone ?? '—'}
            </dd>
            <dt>Owners / Managers / Employees / Vendors</dt>
            <dd>
              {facts.owners} / {facts.managers} / {facts.employees} / {facts.vendors}
            </dd>
            <dt>Currency</dt>
            <dd>{facts.currency}</dd>
            <dt>Last activity</dt>
            <dd>{companyWhen(facts.last_activity)}</dd>
            <dt>Last 30 days</dt>
            <dd>
              {facts.entries_30d} entries · {companyMoney(facts.total_30d, facts.currency)}
            </dd>
            <dt>Open complaints</dt>
            <dd>{facts.open_complaints}</dd>
            {facts.suspended_at ? (
              <>
                <dt>Blocked since</dt>
                <dd>{companyWhen(facts.suspended_at)}</dd>
              </>
            ) : null}
          </dl>
        </Card>
        <Card title="Members" bare>
          {members.length ? (
            <TableScroll>
              <table>
                <caption className="sr-only">Member names and roles</caption>
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Role</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((member, index) => (
                    <tr key={index}>
                      <th scope="row">{member.name}</th>
                      <td>{member.role}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          ) : (
            <Empty title="No members" />
          )}
        </Card>
        <Card title="Activity per week" bare note="Entry counts over the last eight weeks.">
          {weeks.length ? (
            <TableScroll>
              <table>
                <caption className="sr-only">Weekly entry counts</caption>
                <thead>
                  <tr>
                    <th scope="col">Week of</th>
                    <th scope="col" className="n">
                      Entries
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {weeks.map((week) => (
                    <tr key={week.week}>
                      <th scope="row">{companyWhen(week.week)}</th>
                      <td className="n">{week.entries}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          ) : (
            <Empty title="No recent activity" />
          )}
        </Card>
        <Card title="Complaints">
          {complaints.length ? (
            complaints.map((row) => (
              <article key={row.id}>
                <h4>
                  {row.category} · {row.reporter_role}
                </h4>
                <p className="small muted">
                  {companyWhen(row.created_at)} · {row.id}
                </p>
                <p className="wrap" style={{ whiteSpace: 'pre-wrap' }}>
                  {row.body}
                </p>
                <form action={complaint} className="form">
                  <CsrfField />
                  <input type="hidden" name="complaint_id" value={row.id} />
                  <Field label="Status">
                    <select name="status" defaultValue={row.status}>
                      <option value="open">Open</option>
                      <option value="reviewing">Reviewing</option>
                      <option value="closed">Closed</option>
                    </select>
                  </Field>
                  <Field label="Admin note" full>
                    <textarea
                      name="note"
                      rows={3}
                      maxLength={2000}
                      defaultValue={row.admin_note ?? ''}
                    />
                  </Field>
                  <button type="submit" className="btn">
                    Save complaint
                  </button>
                </form>
              </article>
            ))
          ) : (
            <Empty title="No complaints" />
          )}
        </Card>
        <Card title="Moderation log" bare>
          {log.length ? (
            <TableScroll>
              <table>
                <caption className="sr-only">Moderation history, newest first</caption>
                <thead>
                  <tr>
                    {['Who', 'When', 'Action', 'Category', 'Reason'].map((label) => (
                      <th scope="col" key={label}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {log.map((row) => (
                    <tr key={row.id}>
                      <th scope="row">{row.actor}</th>
                      <td>{new Date(row.created_at).toLocaleString('en-IN')}</td>
                      <td>{row.action}</td>
                      <td>{row.category ?? '—'}</td>
                      <td className="wrap">{row.reason ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          ) : (
            <Empty title="No moderation actions" />
          )}
        </Card>
        <Card
          title={facts.suspended_at ? 'Unblock company' : 'Block company'}
          note="A blocked company is read-only for its members. Owners are notified of a change."
        >
          <form action={moderate} className="form">
            <CsrfField />
            <input
              type="hidden"
              name="operation"
              value={facts.suspended_at ? 'unblock' : 'block'}
            />
            {!facts.suspended_at ? (
              <Field label="Category">
                <select name="category" defaultValue="complaint">
                  <option value="complaint">Complaint</option>
                  <option value="fraud">Fraud</option>
                  <option value="spam">Spam</option>
                  <option value="other">Other</option>
                </select>
              </Field>
            ) : null}
            <Field label="Reason" hint="required; written to the moderation log" full>
              <textarea name="reason" rows={3} required maxLength={2000} />
            </Field>
            <button type="submit" className="btn">
              {facts.suspended_at ? 'Unblock company' : 'Block company'}
            </button>
          </form>
        </Card>
        <Card
          title="Open records for investigation"
          note="The reason is logged. Read access lasts one hour. Photos are never displayed."
        >
          <form action={openRecords} className="form">
            <CsrfField />
            <Field label="Investigation reason" hint="at least 5 characters" full>
              <textarea name="reason" rows={3} required minLength={5} maxLength={2000} />
            </Field>
            <button type="submit" className="btn">
              Open records for investigation
            </button>
          </form>
        </Card>
        <Card
          title="Export moderation file"
          note="The export is logged. Records are included if they have previously been opened with a reason."
        >
          <form method="post" action={`${back}/export`}>
            <CsrfField />
            <button type="submit" className="btn">
              Export moderation file (report to authorities)
            </button>
          </form>
        </Card>
      </div>
    </main>
  );
}
