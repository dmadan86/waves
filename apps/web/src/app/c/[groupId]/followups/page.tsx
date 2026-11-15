'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

import { fill } from '@/i18n';
import { useStrings } from '@/i18n-context';
import { daysAgo } from '@/lib/company/clientRows';
import type { FollowUpScope } from '@/lib/company/clients';
import { CompanyPage, DoneFollowUp, whatsappUrl } from '@/lib/company/ClientParts';
import { useCompanyClients, useFollowUps } from '@/lib/company/useClients';

export default function FollowUpsPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const { t } = useStrings();
  const s = t.company.clients;
  const clients = useCompanyClients(groupId);
  const [scope, setScope] = useState<FollowUpScope>('all');
  const { groups, today } = useFollowUps(groupId, scope);
  const [doing, setDoing] = useState<string | null>(null);
  const byId = new Map(clients.clients.map((c) => [c.id, c]));
  const sections = [
    { key: 'overdue', label: s.gOverdue, rows: groups.overdue },
    { key: 'today', label: s.gToday, rows: groups.today },
    { key: 'week', label: s.gWeek, rows: groups.week },
    { key: 'later', label: s.gLater, rows: groups.later },
  ].map((g) => ({ ...g, rows: g.rows.filter((r) => byId.has(r.clientId ?? '')) }));
  const empty = sections.every((g) => g.rows.length === 0);
  const canWrite = clients.canAdd && !clients.company.suspended;
  return (
    <CompanyPage
      groupId={groupId}
      title={s.fuTitle}
      back={{ href: `/c/${groupId}/clients`, label: s.allClients }}
      actions={
        clients.canManage ? (
          <button className="btn soft" onClick={() => setScope(scope === 'mine' ? 'all' : 'mine')}>
            {scope === 'mine' ? s.mine : s.everyone}
          </button>
        ) : undefined
      }
    >
      {!clients.company.ready ? (
        <p className="faint">{t.company.common.loading}</p>
      ) : empty ? (
        <p className="faint">{s.fuEmpty}</p>
      ) : (
        sections.map((g) =>
          g.rows.length ? (
            <section key={g.key}>
              <h2>{`${g.label} · ${g.rows.length}`}</h2>
              <div className="list">
                {g.rows.map((task) => {
                  const client = byId.get(task.clientId ?? '')!;
                  return (
                    <div key={task.id}>
                      <div className="item">
                        <Link className="grow" href={`/c/${groupId}/clients/${client.id}`}>
                          <strong>{client.name}</strong>
                          <br />
                          <span className="faint">{task.title}</span>
                        </Link>
                        <span>
                          {g.key === 'overdue'
                            ? fill(s.fuOverdueDays, { n: daysAgo(task.day, today) })
                            : `${task.day}${task.dueTime ? ` ${task.dueTime}` : ''}`}
                        </span>{' '}
                        {client.phone ? <a href={`tel:${client.phone}`}>{s.call}</a> : null}{' '}
                        {client.phone ? (
                          <a href={whatsappUrl(client.phone)} target="_blank" rel="noreferrer">
                            {s.whatsapp}
                          </a>
                        ) : null}{' '}
                        {canWrite ? (
                          <button className="btn soft" onClick={() => setDoing(task.id)}>
                            {s.done}
                          </button>
                        ) : null}
                      </div>
                      {doing === task.id ? (
                        <DoneFollowUp
                          groupId={groupId}
                          task={task}
                          view={clients}
                          onDone={() => setDoing(null)}
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null,
        )
      )}
    </CompanyPage>
  );
}
