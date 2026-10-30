import Link from 'next/link';
import { CsrfField } from '@/components/CsrfField';
import { Icon } from '@/components/icons';
import { Badge, Card, Empty, Field, Lede, PageHeader, TableScroll } from '@/components/ui';
import { listCompanies } from '@/lib/data';
import { companyMoney, companyWhen } from '@/lib/company-format';

export const dynamic = 'force-dynamic';
const PAGE = 25;

function pageLink(search: string, filter: string, offset: number): string {
  const query = new URLSearchParams();
  if (search) query.set('search', search);
  if (filter) query.set('filter', filter);
  if (offset) query.set('offset', String(offset));
  return `/companies${query.size ? `?${query}` : ''}`;
}

export default async function Companies({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; filter?: string; offset?: string }>;
}) {
  const sp = await searchParams;
  const search = (sp.search ?? '').trim();
  const filter = sp.filter === 'blocked' || sp.filter === 'complaints' ? sp.filter : null;
  const rawOffset = Number(sp.offset ?? 0);
  const offset = Number.isSafeInteger(rawOffset) && rawOffset > 0 ? rawOffset : 0;
  const { total, rows } = await listCompanies({ search, filter, limit: PAGE, offset });
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE, total);
  return (
    <main className="page">
      <PageHeader
        eyebrow="People"
        title="Companies"
        actions={<span className="small muted">{total.toLocaleString('en-IN')} companies</span>}
      />
      <Lede>
        Monitoring shows metadata only. Companies with open complaints come first. Records require a
        written, logged investigation reason.
      </Lede>
      <Card bare>
        <form method="get" action="/companies" className="form card-body" role="search">
          {/* Navigation only: do not put a session token in the query string. */}
          <fieldset disabled hidden>
            <CsrfField />
          </fieldset>
          <Field label="Company or owner">
            <input
              type="search"
              name="search"
              defaultValue={search}
              placeholder="Name, email or phone"
            />
          </Field>
          <Field label="Show">
            <select name="filter" defaultValue={filter ?? ''}>
              <option value="">All</option>
              <option value="blocked">Blocked</option>
              <option value="complaints">Has complaints</option>
            </select>
          </Field>
          <button className="btn" type="submit">
            {Icon.search}
            <span>Filter</span>
          </button>
          {search || filter ? (
            <Link className="btn btn-quiet" href="/companies">
              Clear
            </Link>
          ) : null}
        </form>
      </Card>
      <div className="stack-gap" style={{ marginTop: '1rem' }}>
        <Card bare>
          {rows.length === 0 ? (
            <Empty title="No companies found">Try another search, or clear the filter.</Empty>
          ) : (
            <TableScroll>
              <table>
                <caption className="sr-only">
                  Companies {from}–{to} of {total}
                </caption>
                <thead>
                  <tr>
                    {[
                      'Company',
                      'Created',
                      'Owner',
                      'O / M / E / V',
                      'Last activity',
                      'Entries · 30 days',
                      'Total · 30 days',
                      'Open complaints',
                      'Status',
                    ].map((label) => (
                      <th scope="col" key={label}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <th scope="row">
                        <a href={`/companies/${row.id}`}>{row.name}</a>
                      </th>
                      <td>{companyWhen(row.created_at)}</td>
                      <td>
                        {row.owner_name ?? '—'}
                        <div className="muted small">{row.owner_email ?? '—'}</div>
                        <div className="muted small">{row.owner_phone ?? '—'}</div>
                      </td>
                      <td>
                        <span aria-label="Owners / Managers / Employees / Vendors">
                          {row.owners} / {row.managers} / {row.employees} / {row.vendors}
                        </span>
                      </td>
                      <td>{companyWhen(row.last_activity)}</td>
                      <td className="n">{row.entries_30d}</td>
                      <td className="n">{companyMoney(row.total_30d, row.currency)}</td>
                      <td className="n">{row.open_complaints}</td>
                      <td>
                        <Badge tone={row.suspended_at ? 'danger' : 'ok'}>
                          {row.suspended_at ? 'Blocked' : 'Active'}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )}
        </Card>
      </div>
      <nav className="row spread" style={{ marginTop: '1rem' }} aria-label="Pages of companies">
        <span className="small muted">
          {from}–{to} of {total.toLocaleString('en-IN')}
        </span>
        <span className="row" style={{ gap: '0.5rem' }}>
          {offset > 0 ? (
            <a
              className="btn btn-quiet btn-sm"
              href={pageLink(search, filter ?? '', Math.max(0, offset - PAGE))}
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
            <a
              className="btn btn-quiet btn-sm"
              href={pageLink(search, filter ?? '', offset + PAGE)}
            >
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
