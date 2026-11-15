'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';

import { CompanyFrame } from '@/components/CompanyFrame';
import { Page } from '@/components/company/Bits';
import { useStrings } from '@/i18n-context';
import { useCompanyView } from '@/lib/company/view';

export default function CompanyMorePage() {
  const { groupId } = useParams<{ groupId: string }>();
  return (
    <CompanyFrame groupId={groupId}>
      <More groupId={groupId} />
    </CompanyFrame>
  );
}

/** The launcher for every company screen. Later slices fill in the targets. */
function More({ groupId }: { groupId: string }) {
  const { t } = useStrings();
  const m = t.company.more;
  const view = useCompanyView(groupId);
  const base = `/c/${groupId}`;
  const owner = view.isOwner;
  const admin = view.isAdmin;

  const sections: { title: string; links: { label: string; path: string; show: boolean }[] }[] = [
    {
      title: m.people,
      links: [
        { label: m.team, path: 'team', show: admin },
        { label: m.hierarchy, path: 'team/hierarchy', show: owner },
        { label: m.activity, path: 'activity', show: true },
      ],
    },
    {
      title: m.money,
      links: [
        { label: m.entry, path: 'entry/new', show: !view.suspended },
        { label: m.wages, path: 'wages', show: admin },
        { label: m.work, path: 'work', show: true },
        { label: m.calendar, path: 'calendar', show: true },
      ],
    },
    {
      title: m.sales,
      links: [
        { label: m.clients, path: 'clients', show: admin },
        { label: m.inquiries, path: 'inquiries', show: admin },
        { label: m.followups, path: 'followups', show: admin },
        { label: m.tickets, path: 'tickets', show: admin },
        { label: m.vendors, path: 'vendors', show: admin },
        { label: m.bills, path: 'bills', show: admin },
        { label: m.details, path: 'details', show: owner },
      ],
    },
    {
      title: m.data,
      links: [
        { label: m.importData, path: 'import', show: owner },
        { label: m.exportData, path: 'export', show: admin },
        { label: m.storage, path: 'storage', show: owner },
        { label: m.settings, path: 'settings', show: owner },
      ],
    },
  ];

  return (
    <Page title={m.title}>
      {sections.map((section) => {
        const links = section.links.filter((l) => l.show);
        return links.length === 0 ? null : (
          <section key={section.title} className="panel">
            <h2>{section.title}</h2>
            {links.map((l) => (
              <Link key={l.path} href={`${base}/${l.path}`} className="item">
                <span className="grow">
                  <span className="title">{l.label}</span>
                </span>
              </Link>
            ))}
          </section>
        );
      })}
    </Page>
  );
}
