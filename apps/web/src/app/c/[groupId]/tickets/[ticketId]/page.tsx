'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';

import {
  ACTION_TARGET,
  escalatedTo,
  escalationLevel,
  isTicketOpen,
  ticketActions,
  ticketNumber,
  TICKET_WINDOW_MS,
  type TicketAction,
  type TicketEvent,
} from '@waves/core';

import { fill } from '@/i18n';
import { useStrings } from '@/i18n-context';
import { CompanyPage, whatsappUrl } from '@/lib/company/ClientParts';
import { useNow, useTicketText } from '@/lib/company/TicketParts';
import {
  ticketCommentPayload,
  ticketInput,
  ticketKinds,
  ticketSetPayload,
  ticketStatusPayload,
} from '@/lib/company/tickets';
import { useCompanyClients, useCompanyTickets, useCompanyWrite } from '@/lib/company/useClients';

export default function TicketPage() {
  const { groupId, ticketId } = useParams<{ groupId: string; ticketId: string }>();
  const { t, locale } = useStrings();
  const s = t.company.clients.tk;
  const router = useRouter();
  const view = useCompanyTickets(groupId);
  const clients = useCompanyClients(groupId);
  const text = useTicketText();
  const now = useNow();
  const { run, busy, error } = useCompanyWrite(groupId);
  const [comment, setComment] = useState('');
  const [resolving, setResolving] = useState(false);
  const [note, setNote] = useState('');
  const tk = view.tickets.find((x) => x.id === ticketId);
  const back = { href: `/c/${groupId}/tickets`, label: t.company.common.back };
  if (!clients.company.ready)
    return (
      <CompanyPage groupId={groupId} title={s.title} back={back}>
        <p className="faint">{t.company.common.loading}</p>
      </CompanyPage>
    );
  if (!tk)
    return (
      <CompanyPage groupId={groupId} title={s.title} back={back}>
        <p>{s.notFound}</p>
      </CompanyPage>
    );
  const canWrite = view.canAdd && !clients.company.suspended;
  const name = (id: string | null) => view.memberName(id) || s.someone;
  const stamp = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? ''
      : d.toLocaleString(locale, {
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        });
  };
  const act = async (a: TicketAction) => {
    if (a === 'resolve') return setResolving(true);
    await run(ticketKinds.status, ticketStatusPayload({ ticketId, status: ACTION_TARGET[a] }));
  };
  const describe = (e: TicketEvent) => {
    const by = fill(s.evBy, { name: name(e.createdBy) });
    if (e.kind === 'comment') return { title: name(e.createdBy), sub: e.body ?? '' };
    if (e.kind === 'created')
      return { title: fill(s.evCreated, { name: name(e.memberId) }), sub: by };
    if (e.kind === 'assigned')
      return { title: fill(s.evAssigned, { name: name(e.memberId) }), sub: by };
    const st = e.toStatus;
    return {
      title:
        st === 'in_progress'
          ? s.evStarted
          : st === 'resolved'
            ? s.stResolved
            : st === 'closed'
              ? s.stClosed
              : s.evReopened,
      sub: [e.body ? fill(s.solved, { note: e.body }) : null, by].filter(Boolean).join(' · '),
    };
  };
  // Escalations are not stored: they follow from the due time.
  const escalations: { at: string; title: string; sub: string }[] = [];
  if (isTicketOpen(tk)) {
    const level = escalationLevel(tk, now);
    const due = new Date(tk.dueAt).getTime();
    for (const l of [1, 2] as const)
      if (level >= l)
        escalations.push({
          at: new Date(due + (l - 1) * TICKET_WINDOW_MS[tk.priority]).toISOString(),
          title: fill(s.evEscalated, {
            name: name(escalatedTo(l, tk.assigneeMemberId, view.hierarchy)) || s.owner,
          }),
          sub: '',
        });
  }
  const timeline = [
    ...view.events
      .filter((e) => e.ticketId === tk.id)
      .map((e) => ({ at: e.createdAt, ...describe(e) })),
    ...escalations,
  ].sort((a, b) => b.at.localeCompare(a.at));
  const due = text.due(tk, now, view);
  const client = tk.clientId ? clients.clients.find((c) => c.id === tk.clientId) : undefined;
  const actLabel: Record<TicketAction, string> = {
    start: s.actStart,
    resolve: s.actResolve,
    reopen: s.actReopen,
    close: s.actClose,
  };
  return (
    <CompanyPage
      groupId={groupId}
      title={tk.number > 0 ? ticketNumber(tk.number) : s.title}
      back={back}
    >
      <div className="card">
        <p>
          {text.status(tk.status)} · {text.priority(tk.priority)}
        </p>
        {tk.clientName ? (
          <p>
            {client ? (
              <Link href={`/c/${groupId}/clients/${client.id}`}>{tk.clientName}</Link>
            ) : (
              tk.clientName
            )}
            {tk.clientPhone ? (
              <>
                {' '}
                {tk.clientPhone} <a href={`tel:${tk.clientPhone}`}>{s.call}</a>{' '}
                <a href={whatsappUrl(tk.clientPhone)} target="_blank" rel="noreferrer">
                  {s.whatsapp}
                </a>
              </>
            ) : null}
          </p>
        ) : null}
        <h2>{tk.title}</h2>
        {tk.details ? <p>{tk.details}</p> : null}
        {tk.resolution ? <p>{fill(s.solved, { note: tk.resolution })}</p> : null}
        <p className="faint">{due.text}</p>
        <p>
          {s.assignedTo} ·{' '}
          {tk.assigneeMemberId === view.myMemberId ? s.you : name(tk.assigneeMemberId)}
        </p>
        {canWrite && isTicketOpen(tk) && view.people.length > 1 ? (
          <label className="field">
            <span className="field-label">{s.reassign}</span>
            <select
              value=""
              disabled={busy}
              onChange={(e) => {
                if (e.target.value)
                  void run(
                    ticketKinds.set,
                    ticketSetPayload({ ...ticketInput(tk), assigneeMemberId: e.target.value })
                      .payload,
                  );
              }}
            >
              <option value="">{s.assignTo}</option>
              {view.people
                .filter((m) => m.id !== tk.assigneeMemberId)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id === view.myMemberId ? s.you : m.name}
                  </option>
                ))}
            </select>
          </label>
        ) : null}
        {canWrite && resolving ? (
          <div>
            <h3>{s.resolveTitle}</h3>
            <textarea
              aria-label={s.resolvePh}
              placeholder={s.resolvePh}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <button
              className="btn soft"
              onClick={() => {
                setResolving(false);
                setNote('');
              }}
            >
              {t.company.clients.cancel}
            </button>{' '}
            <button
              className="btn brand"
              disabled={busy || !note.trim()}
              onClick={async () => {
                if (
                  await run(
                    ticketKinds.status,
                    ticketStatusPayload({ ticketId, status: 'resolved', note }),
                  )
                ) {
                  setResolving(false);
                  setNote('');
                }
              }}
            >
              {s.actResolve}
            </button>
          </div>
        ) : canWrite ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {ticketActions(tk.status).map((a) => (
              <button key={a} className="btn soft" disabled={busy} onClick={() => void act(a)}>
                {actLabel[a]}
              </button>
            ))}
            <Link className="btn soft" href={`/c/${groupId}/tickets/new?edit=${tk.id}`}>
              {s.edit}
            </Link>
            {view.canRemove ? (
              <button
                className="btn soft"
                disabled={busy}
                onClick={async () => {
                  if (
                    window.confirm(s.removeConfirm) &&
                    (await run(ticketKinds.remove, { ticketId }))
                  )
                    router.replace(back.href);
                }}
              >
                {s.remove}
              </button>
            ) : null}
          </div>
        ) : null}
        {error ? <p role="alert">{error}</p> : null}
      </div>
      <h3>{s.timeline}</h3>
      {canWrite ? (
        <div className="card">
          <textarea
            aria-label={s.commentPh}
            placeholder={s.commentPh}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <button
            className="btn brand"
            disabled={busy || !comment.trim()}
            onClick={async () => {
              if (await run(ticketKinds.comment, ticketCommentPayload({ ticketId, body: comment })))
                setComment('');
            }}
          >
            {s.send}
          </button>
        </div>
      ) : null}
      {timeline.map((e, i) => (
        <p key={i}>
          <span className="faint">{stamp(e.at)}</span> <strong>{e.title}</strong>
          {e.sub ? ` · ${e.sub}` : ''}
        </p>
      ))}
    </CompanyPage>
  );
}
