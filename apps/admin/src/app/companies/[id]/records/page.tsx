import { notFound } from 'next/navigation';
import { Banner, Card, Empty, PageHeader, TableScroll } from '@/components/ui';
import { companyDetail, companyRecords, isCompanyId, type CompanyRecords } from '@/lib/data';
import { companyMoney, companyWhen } from '@/lib/company-format';

export const dynamic = 'force-dynamic';

export default async function Records({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isCompanyId(id)) notFound();
  let records: CompanyRecords | null = null;
  try {
    records = await companyRecords(id);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    if (!message.includes('REASON_REQUIRED')) throw caught;
  }
  const detail = await companyDetail(id);
  if (!detail) notFound();
  return (
    <main className="page">
      <PageHeader eyebrow="People" title={`${detail.facts.name} · Records`} actions={<a className="btn btn-quiet" href={`/companies/${id}`}>Back to company</a>} />
      {!records ? <Card bare><Empty title="A written reason is required">Open records with an investigation reason from the <a href={`/companies/${id}`}>company page</a>. Access lasts one hour.</Empty></Card> : <>
        <Banner tone="info">Read-only. Opened with a logged reason.</Banner>
        <div className="stack-gap">
          <Card title="Entries" bare note="Up to 500 recent entries. Photos are shown as counts only.">
            {records.entries.length ? <TableScroll><table>
              <caption className="sr-only">Company entries, read-only</caption>
              <thead><tr>{['Date', 'Person', 'Kind', 'Category', 'Amount', 'Vendor', 'Invoice', 'Paid by company', 'Status', 'Note', 'Photos', 'Deleted'].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
              <tbody>{records.entries.map(row => <tr key={row.id}>
                <th scope="row">{companyWhen(row.occurred_on)}</th><td>{row.person ?? '—'}</td><td>{row.kind}</td><td>{row.category}</td><td className="n">{companyMoney(row.amount, row.currency)}</td><td>{row.vendor ?? '—'}</td><td>{row.invoice_no ?? '—'}</td><td>{row.paid_by_company ? 'Yes' : 'No'}</td><td>{row.status}</td><td className="wrap">{row.note ?? '—'}</td><td className="n">{row.photos}</td><td>{row.deleted ? 'Yes' : 'No'}</td>
              </tr>)}</tbody>
            </table></TableScroll> : <Empty title="No entries" />}
          </Card>
          <Card title="Vendor entries" bare note="Up to 500 recent vendor entries.">
            {records.vendor_entries.length ? <TableScroll><table>
              <caption className="sr-only">Vendor entries, read-only</caption>
              <thead><tr>{['Date', 'Vendor', 'Kind', 'Amount', 'Status', 'Note', 'Deleted'].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
              <tbody>{records.vendor_entries.map(row => <tr key={row.id}><th scope="row">{companyWhen(row.occurred_on)}</th><td>{row.vendor ?? '—'}</td><td>{row.kind}</td><td className="n">{companyMoney(row.amount, detail.facts.currency)}</td><td>{row.status}</td><td className="wrap">{row.note ?? '—'}</td><td>{row.deleted ? 'Yes' : 'No'}</td></tr>)}</tbody>
            </table></TableScroll> : <Empty title="No vendor entries" />}
          </Card>
        </div>
      </>}
    </main>
  );
}
