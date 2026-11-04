'use client';

import { Suspense, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';

import { defaultDueAt, TICKET_PRIORITIES, type TicketPriority } from '@waves/core';

import { fill } from '@/i18n';
import { useStrings } from '@/i18n-context';
import { CompanyPage } from '@/lib/company/ClientParts';
import { useTicketText } from '@/lib/company/TicketParts';
import { ticketKinds, ticketSetPayload } from '@/lib/company/tickets';
import { useCompanyClients, useCompanyTickets, useCompanyWrite } from '@/lib/company/useClients';

const H = 3_600_000;
const DUE_CHOICES = [4 * H, 24 * H, 72 * H, 168 * H, 336 * H];

export default function NewTicketPage() {
  return (
    <Suspense fallback={null}>
      <Form />
    </Suspense>
  );
}

function Form() {
  const { groupId } = useParams<{ groupId: string }>();
  const params = useSearchParams();
  const edit = params.get('edit');
  const router = useRouter();
  const { t } = useStrings();
  const s = t.company.clients.tk;
  const view = useCompanyTickets(groupId);
  const clients = useCompanyClients(groupId);
  const text = useTicketText();
  const { run, busy, error } = useCompanyWrite(groupId);
  const existing = edit ? view.tickets.find((x) => x.id === edit) : undefined;
  const [clientId, setClientId] = useState<string | null>(params.get('clientId'));
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [priority, setPriority] = useState<TicketPriority>('normal');
  const [assignee, setAssignee] = useState<string | null | undefined>(undefined);
  const [customDue, setCustomDue] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  const [loaded, setLoaded] = useState<string | null>(null);
  if (existing && loaded !== existing.id) {
    setLoaded(existing.id);
    setClientId(existing.clientId);
    setTitle(existing.title);
    setDetails(existing.details ?? '');
    setPriority(existing.priority);
    setAssignee(existing.assigneeMemberId);
  }
  const assigneeId = assignee === undefined ? view.myMemberId : assignee;
  const dueAt =
    customDue ??
    (existing && existing.priority === priority ? existing.dueAt : defaultDueAt(priority, now));
  const submit = async () => {
    if (busy || !title.trim() || !assigneeId) return;
    const saved = ticketSetPayload({
      ticketId: existing?.id,
      clientId,
      title,
      details,
      priority,
      assigneeMemberId: assigneeId,
      dueAt,
    });
    if (await run(ticketKinds.set, saved.payload))
      router.replace(`/c/${groupId}/tickets/${saved.ticketId}`);
  };
  const co = clients.company;
  return (
    <CompanyPage
      groupId={groupId}
      title={existing ? s.editComplaint : s.newComplaint}
      back={{ href: `/c/${groupId}/tickets`, label: t.company.common.back }}
    >
      {co.suspended || !view.canAdd ? (
        <p>{co.suspended ? t.company.common.suspended : t.company.clients.noAccess}</p>
      ) : (
        <div className="card">
          <label className="field">
            <span className="field-label">{s.clientLabel}</span>
            <select value={clientId ?? ''} onChange={(e) => setClientId(e.target.value || null)}>
              <option value="">{s.noClient}</option>
              {clients.clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">{s.titlePh}</span>
            <input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">{s.detailsPh}</span>
            <textarea
              value={details}
              maxLength={1000}
              onChange={(e) => setDetails(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">{s.priority}</span>
            <select
              value={priority}
              onChange={(e) => {
                setPriority(e.target.value as TicketPriority);
                setCustomDue(null);
              }}
            >
              {TICKET_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {text.priority(p)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">{s.assignedTo}</span>
            <select value={assigneeId ?? ''} onChange={(e) => setAssignee(e.target.value || null)}>
              {view.people.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id === view.myMemberId ? s.you : m.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">
              {fill(s.dueIn, { t: text.span(Math.max(0, new Date(dueAt).getTime() - now)) })}
            </span>
            <select
              value=""
              onChange={(e) =>
                e.target.value &&
                setCustomDue(new Date(Date.now() + Number(e.target.value)).toISOString())
              }
            >
              <option value="">{s.priority}…</option>
              {DUE_CHOICES.map((ms) => (
                <option key={ms} value={ms}>
                  {fill(s.dueIn, { t: text.span(ms) })}
                </option>
              ))}
            </select>
          </label>
          {error ? <p role="alert">{error}</p> : null}
          <button
            className="btn brand"
            disabled={busy || !title.trim() || !assigneeId}
            onClick={() => void submit()}
          >
            {existing ? s.save : s.log}
          </button>
        </div>
      )}
    </CompanyPage>
  );
}
