'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';

import {
  clientInquiryStats,
  docNumberLabel,
  inquiryAmount,
  inquiryLabel,
  inquiryStatus,
  sortInquiries,
} from '@waves/core';
import { addDays } from '@waves/core';

import { fill } from '@/i18n';
import { useStrings } from '@/i18n-context';
import { money } from '@/lib/money';
import {
  addFollowUpPayload,
  clientKinds,
  clientNotePayload,
  clientSetPayload,
  stageChange,
} from '@/lib/company/clients';
import {
  AssignForm,
  CompanyPage,
  DoneFollowUp,
  InquiryForm,
  useSourceLabel,
  whatsappUrl,
} from '@/lib/company/ClientParts';
import {
  useClientDocs,
  useCompanyClients,
  useCompanyWrite,
  useFollowUps,
} from '@/lib/company/useClients';
import { todayIso } from '@/lib/company/view';

export default function ClientPage() {
  const { groupId, clientId } = useParams<{ groupId: string; clientId: string }>();
  const { t, locale } = useStrings();
  const s = t.company.clients;
  const router = useRouter();
  const view = useCompanyClients(groupId);
  const docsAll = useClientDocs(groupId);
  const followUps = useFollowUps(groupId);
  const sourceLabel = useSourceLabel();
  const { run, busy, error } = useCompanyWrite(groupId);
  const [note, setNote] = useState('');
  const [panel, setPanel] = useState<null | 'inquiry' | 'assign' | 'lost' | 'follow' | 'done'>(
    null,
  );
  const [tab, setTab] = useState<'activity' | 'bills'>('activity');
  const co = view.company;
  const client = view.clients.find((c) => c.id === clientId);
  const back = { href: `/c/${groupId}/clients`, label: s.allClients };
  if (!co.ready)
    return (
      <CompanyPage groupId={groupId} title={s.title} back={back}>
        <p className="faint">{t.company.common.loading}</p>
      </CompanyPage>
    );
  if (!client)
    return (
      <CompanyPage groupId={groupId} title={s.title} back={back}>
        <p>{s.clientNotFound}</p>
      </CompanyPage>
    );
  const today = todayIso();
  const edit = view.canManage && !co.suspended;
  const canWrite = view.canAdd && !co.suspended;
  const fmt = (m: bigint) => money(m, co.currency, locale);
  const docs = docsAll.filter((d) => d.clientId === clientId);
  const bills = docs.filter((d) => d.docType === 'bill');
  const owed = bills.reduce(
    (a, d) => a + (d.totalMinor - d.paidMinor > 0n ? d.totalMinor - d.paidMinor : 0n),
    0n,
  );
  const next = followUps.byClient(clientId)[0];
  const inquiries = sortInquiries(view.inquiries.filter((i) => i.clientId === clientId));
  const stats = clientInquiryStats(inquiries, docs);
  const assignees = view.owners.filter((m) => view.assigneeIds(clientId).includes(m.id));
  // Whoever follows up: the client's owner when this viewer can hand work to them, else the viewer.
  const assignee =
    client.ownerMemberId &&
    (co.isOwner ||
      co.manageableIds.has(client.ownerMemberId) ||
      client.ownerMemberId === view.myMemberId)
      ? client.ownerMemberId
      : view.myMemberId;

  const move = async (stage: 'inquiry' | 'lost', reason: string | null = null) => {
    const { payload } = clientSetPayload(stageChange(client, stage, reason));
    if (await run(clientKinds.set, payload)) setPanel(null);
  };
  const addFollow = async (days: number) => {
    if (!assignee) return;
    const p = addFollowUpPayload({
      clientId,
      memberId: assignee,
      day: addDays(today, days),
      title: fill(s.followTitle, { name: client.name }),
    });
    if (await run(clientKinds.work, p as unknown as Record<string, unknown>)) setPanel(null);
  };
  const remove = async () => {
    if (!window.confirm(s.removeConfirm)) return;
    if (await run(clientKinds.remove, { clientId })) router.replace(`/c/${groupId}/clients`);
  };
  const events = [
    { key: 'created', at: client.createdAt.slice(0, 10), title: s.evCreated, sub: '' },
    ...view.notes
      .filter((n) => n.clientId === clientId)
      .map((n) => ({ key: n.id, at: n.createdAt.slice(0, 10), title: s.evNote, sub: n.body })),
    ...followUps.all
      .filter((x) => x.clientId === clientId)
      .map((x) => ({ key: x.id, at: x.day, title: s.evFollowUp, sub: x.title })),
    ...docs.map((d) => ({
      key: d.id,
      at: d.docDate,
      title: docNumberLabel(d.docType, d.number),
      sub: fmt(d.totalMinor),
    })),
    ...docs.flatMap((d) =>
      d.payments.map((p) => ({
        key: p.id,
        at: p.paidOn,
        title: s.evReceipt,
        sub: fmt(p.amountMinor),
      })),
    ),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <CompanyPage groupId={groupId} title={client.name} back={back}>
      <div className="card">
        {client.need ? <p>{client.need}</p> : null}
        <p className="faint">
          {fill(s.viaSource, { source: sourceLabel(client.source) })}
          {assignees.length
            ? ` · ${fill(s.follows, { name: assignees.map((m) => m.name).join(', ') })}`
            : ''}
          {client.stage === 'lost'
            ? ` · ${s.stLost}${client.lostReason ? `: ${client.lostReason}` : ''}`
            : ''}
        </p>
        {client.phone ? (
          <p>
            {client.phone}{' '}
            <a className="btn soft" href={`tel:${client.phone}`}>
              {s.call}
            </a>{' '}
            <a
              className="btn soft"
              href={whatsappUrl(client.phone)}
              target="_blank"
              rel="noreferrer"
            >
              {s.whatsapp}
            </a>
          </p>
        ) : null}
        {client.address ? <p className="faint">{client.address}</p> : null}
        {owed > 0n ? <p>{fill(s.owes, { amount: fmt(owed) })}</p> : null}
        <p className="faint">
          {s.statInquiries}: {stats.total ?? inquiries.length} · {s.statWon}: {stats.won} ·{' '}
          {s.statRejected}: {stats.rejected}
          {stats.paidMinor > 0n ? ` · ${s.statPayments}: ${fmt(stats.paidMinor)}` : ''}
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {edit || (canWrite && client.stage === 'inquiry') ? (
            <Link className="btn soft" href={`/c/${groupId}/clients/new?edit=${clientId}`}>
              {s.editClient}
            </Link>
          ) : null}
          {edit ? (
            <button className="btn soft" onClick={() => setPanel('assign')}>
              {fill(s.assignedN, { n: assignees.length })}
            </button>
          ) : null}
          {edit && client.stage !== 'lost' ? (
            <button className="btn soft" onClick={() => setPanel('lost')}>
              {s.markLost}
            </button>
          ) : null}
          {edit && client.stage === 'lost' ? (
            <button className="btn soft" disabled={busy} onClick={() => void move('inquiry')}>
              {s.reopen}
            </button>
          ) : null}
          {edit ? (
            <button className="btn soft" disabled={busy} onClick={() => void remove()}>
              {s.remove}
            </button>
          ) : null}
        </div>
        {error ? <p role="alert">{error}</p> : null}
      </div>

      {panel === 'lost' ? (
        <div className="card">
          <h3>{s.lostWhy}</h3>
          {[s.lostPrice, s.lostOther, s.lostSilent].map((r) => (
            <button
              key={r}
              className="btn soft"
              disabled={busy}
              onClick={() => void move('lost', r)}
            >
              {r}
            </button>
          ))}
          <button className="btn soft" disabled={busy} onClick={() => void move('lost', null)}>
            {s.lostSkip}
          </button>{' '}
          <button className="btn soft" onClick={() => setPanel(null)}>
            {s.cancel}
          </button>
        </div>
      ) : null}
      {panel === 'assign' ? (
        <AssignForm
          groupId={groupId}
          clientId={clientId}
          view={view}
          onDone={() => setPanel(null)}
        />
      ) : null}

      <h2>{s.inqTitle}</h2>
      {inquiries.length === 0 ? (
        <p className="faint">{s.inqNone}</p>
      ) : (
        <div className="list">
          {inquiries.map((i) => (
            <Link key={i.id} className="item" href={`/c/${groupId}/inquiries/${i.id}`}>
              <span className="grow">
                <strong>{i.title}</strong>
                <br />
                <span className="faint">{inquiryLabel(i.number)}</span>
              </span>
              <span>{inquiryStatus(i, docsAll)}</span>{' '}
              <span>
                {(() => {
                  const a = inquiryAmount(i, docsAll);
                  return a == null ? '' : fmt(a);
                })()}
              </span>
            </Link>
          ))}
        </div>
      )}
      {canWrite && client.stage !== 'lost' && panel !== 'inquiry' ? (
        <p>
          <button className="btn soft" onClick={() => setPanel('inquiry')}>
            {s.inqNew}
          </button>
        </p>
      ) : null}
      {panel === 'inquiry' ? (
        <InquiryForm
          groupId={groupId}
          clientId={clientId}
          currency={co.currency}
          onDone={() => setPanel(null)}
        />
      ) : null}

      <h2>{s.followUp}</h2>
      {next ? (
        <div className="card">
          <p>
            {next.title} ·{' '}
            {next.day < today
              ? fill(s.overdueSince, { when: next.day })
              : fill(s.dueAt, { when: next.day })}
          </p>
          {canWrite ? (
            <button className="btn brand" onClick={() => setPanel('done')}>
              {s.done}
            </button>
          ) : null}
        </div>
      ) : (
        <p className="faint">{s.noFollowUp}</p>
      )}
      {panel === 'done' && next ? (
        <DoneFollowUp groupId={groupId} task={next} view={view} onDone={() => setPanel(null)} />
      ) : null}
      {canWrite && assignee && client.stage !== 'lost' ? (
        panel === 'follow' ? (
          <div className="card">
            <h3>{s.followUp}</h3>
            {(
              [
                [s.fuToday, 0],
                [s.fuTomorrow, 1],
                [s.fuThreeDays, 3],
                [s.nextWeek, 7],
              ] as const
            ).map(([label, d]) => (
              <button
                key={label}
                className="btn soft"
                disabled={busy}
                onClick={() => void addFollow(d)}
              >
                {label}
              </button>
            ))}
            <button className="btn soft" onClick={() => setPanel(null)}>
              {s.cancel}
            </button>
          </div>
        ) : (
          <p>
            <button className="btn soft" onClick={() => setPanel('follow')}>
              {s.btnFollowUp}
            </button>
          </p>
        )
      ) : null}

      <div style={{ display: 'flex', gap: 8, margin: '16px 0' }}>
        <button
          className="btn soft"
          aria-pressed={tab === 'activity'}
          onClick={() => setTab('activity')}
        >
          {s.tabActivity}
        </button>
        <button className="btn soft" aria-pressed={tab === 'bills'} onClick={() => setTab('bills')}>
          {s.tabBills}
        </button>
      </div>
      {tab === 'activity' ? (
        <>
          {canWrite ? (
            <div className="card">
              <textarea
                aria-label={s.notePh}
                placeholder={s.notePh}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <button
                className="btn brand"
                disabled={busy || !note.trim()}
                onClick={async () => {
                  if (await run(clientKinds.note, clientNotePayload({ clientId, body: note })))
                    setNote('');
                }}
              >
                {s.noteSave}
              </button>
            </div>
          ) : null}
          {events.map((e) => (
            <p key={e.key}>
              <span className="faint">{e.at}</span> <strong>{e.title}</strong>
              {e.sub ? ` · ${e.sub}` : ''}
            </p>
          ))}
        </>
      ) : bills.length === 0 && docs.length === 0 ? (
        <p className="faint">{s.billsEmpty}</p>
      ) : (
        docs.map((d) => (
          <p key={d.id}>
            {docNumberLabel(d.docType, d.number)} · {d.docDate} · {fmt(d.totalMinor)}
          </p>
        ))
      )}
    </CompanyPage>
  );
}
