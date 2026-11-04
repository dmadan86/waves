'use client';

/** Small shared pieces of the clients pages: page shell, inquiry form, assignee picker, follow-up "done" flow. */

import { useState, type ReactNode } from 'react';
import Link from 'next/link';

import {
  nextFollowUpDay,
  parseMinorInput,
  type ClientSource,
  type CompanyInquiry,
  type NextFollowUp,
  type MirrorWorkTask,
} from '@waves/core';

import { CompanyFrame } from '@/components/CompanyFrame';
import { useStrings } from '@/i18n-context';
import {
  clientKinds,
  clientNotePayload,
  clientSetPayload,
  completeFollowUpPayloads,
  inquirySetPayload,
  stageChange,
  type ClientsView,
} from './clients';
import { useCompanyWrite } from './useClients';
import { todayIso } from './view';

export function CompanyPage({
  groupId,
  title,
  back,
  actions,
  children,
}: {
  groupId: string;
  title: string;
  back?: { href: string; label: string };
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <CompanyFrame groupId={groupId}>
      <div className="app-body">
        <div className="app-main">
          {back ? (
            <p>
              <Link href={back.href}>{back.label}</Link>
            </p>
          ) : null}
          <div className="page-head">
            <h1>{title}</h1>
            {actions}
          </div>
          {children}
        </div>
      </div>
    </CompanyFrame>
  );
}

export function useSourceLabel() {
  const s = useStrings().t.company.clients;
  const map: Record<ClientSource, string> = {
    walk_in: s.srcWalkIn,
    call: s.srcCall,
    whatsapp: s.srcWhatsapp,
    referral: s.srcReferral,
    other: s.srcOther,
  };
  return (src: ClientSource) => map[src] ?? s.srcOther;
}

export const whatsappUrl = (phone: string) => `https://wa.me/${phone.replace(/\D/g, '')}`;

export function minorFrom(text: string, currency: string): bigint {
  try {
    return text.trim() ? parseMinorInput(text, currency as never) : 0n;
  } catch {
    return 0n;
  }
}

/** Add or edit an inquiry of a client. */
export function InquiryForm({
  groupId,
  clientId,
  inquiry,
  currency,
  onDone,
}: {
  groupId: string;
  clientId: string;
  inquiry?: CompanyInquiry;
  currency: string;
  onDone: () => void;
}) {
  const s = useStrings().t.company.clients;
  const { run, busy, error } = useCompanyWrite(groupId);
  const [title, setTitle] = useState(inquiry?.title ?? '');
  const [details, setDetails] = useState(inquiry?.details ?? '');
  const [value, setValue] = useState(
    inquiry?.expectedValueMinor ? String(Number(inquiry.expectedValueMinor) / 100) : '',
  );
  const [date, setDate] = useState(inquiry?.inquiryDate ?? todayIso());
  const submit = async () => {
    if (busy || !title.trim()) return;
    const minor = minorFrom(value, currency);
    const { payload } = inquirySetPayload({
      inquiryId: inquiry?.id,
      clientId,
      title,
      details,
      expectedValueMinor: minor > 0n ? minor.toString() : null,
      inquiryDate: date,
    });
    if (await run(clientKinds.inquirySet, payload)) onDone();
  };
  return (
    <div className="card">
      <h3>{inquiry ? s.inqFormEdit : s.inqFormNew}</h3>
      <label className="field">
        <span className="field-label">{s.inqFieldTitle}</span>
        <input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field">
        <span className="field-label">{s.inqFieldDetails}</span>
        <textarea value={details ?? ''} onChange={(e) => setDetails(e.target.value)} />
      </label>
      <label className="field">
        <span className="field-label">{s.inqFieldValue}</span>
        <input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
      </label>
      <label className="field">
        <span className="field-label">{s.inqFieldDate}</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      {error ? <p role="alert">{error}</p> : null}
      <button className="btn brand" disabled={busy || !title.trim()} onClick={() => void submit()}>
        {s.inqSave}
      </button>{' '}
      <button className="btn soft" onClick={onDone}>
        {s.cancel}
      </button>
    </div>
  );
}

/** Replace the people assigned to a client (owner and manager). */
export function AssignForm({
  groupId,
  clientId,
  view,
  onDone,
}: {
  groupId: string;
  clientId: string;
  view: ClientsView;
  onDone: () => void;
}) {
  const s = useStrings().t.company.clients;
  const { run, busy, error } = useCompanyWrite(groupId);
  const [picked, setPicked] = useState<string[]>(view.assigneeIds(clientId));
  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  return (
    <div className="card">
      <h3>{s.assignTitle}</h3>
      <p className="faint">{s.assignHint}</p>
      {view.owners.map((m) => (
        <label key={m.id} style={{ display: 'flex', gap: 8, padding: '4px 0' }}>
          <input type="checkbox" checked={picked.includes(m.id)} onChange={() => toggle(m.id)} />
          {m.name}
        </label>
      ))}
      {error ? <p role="alert">{error}</p> : null}
      <button
        className="btn brand"
        disabled={busy}
        onClick={async () => {
          if (await run(clientKinds.assign, { clientId, memberIds: picked })) onDone();
        }}
      >
        {s.assignSave}
      </button>{' '}
      <button className="btn soft" onClick={onDone}>
        {s.cancel}
      </button>
    </div>
  );
}

/** "How did it go?" then "When next?" for a follow-up; Not interested moves the client to Lost. */
export function DoneFollowUp({
  groupId,
  task,
  view,
  onDone,
}: {
  groupId: string;
  task: MirrorWorkTask;
  view: ClientsView;
  onDone: () => void;
}) {
  const s = useStrings().t.company.clients;
  const { run, busy, error } = useCompanyWrite(groupId);
  const [outcome, setOutcome] = useState<'spoke' | 'no_answer' | 'not_interested' | null>(null);
  const finish = async (o: NonNullable<typeof outcome>, next: NextFollowUp) => {
    for (const p of completeFollowUpPayloads(task, next, todayIso()))
      if (!(await run(clientKinds.work, p as unknown as Record<string, unknown>))) return;
    if (!task.clientId) return onDone();
    const body =
      o === 'spoke' ? s.noteSpoke : o === 'no_answer' ? s.noteNoAnswer : s.noteNotInterested;
    if (!(await run(clientKinds.note, clientNotePayload({ clientId: task.clientId, body }))))
      return;
    const client = view.clients.find((c) => c.id === task.clientId);
    if (o === 'not_interested' && client) {
      const { payload } = clientSetPayload(stageChange(client, 'lost', s.outNotInterested));
      if (!(await run(clientKinds.set, payload))) return;
    }
    onDone();
  };
  const nexts: { id: NextFollowUp; label: string }[] = [
    { id: 'tomorrow', label: s.nextTomorrow },
    { id: 'three_days', label: s.fuThreeDays },
    { id: 'next_week', label: s.nextWeek },
    { id: 'none', label: s.nextNone },
  ];
  return (
    <div className="card">
      {outcome === null ? (
        <>
          <h3>{s.howWent}</h3>
          {(
            [
              ['spoke', s.outSpoke],
              ['no_answer', s.outNoAnswer],
              ['not_interested', s.outNotInterested],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              className="btn soft"
              disabled={busy}
              onClick={() => (id === 'not_interested' ? void finish(id, 'none') : setOutcome(id))}
            >
              {label}
            </button>
          ))}
        </>
      ) : (
        <>
          <h3>{s.whenNext}</h3>
          {nexts.map((n) => {
            const day = nextFollowUpDay(n.id, todayIso());
            return (
              <button
                key={n.id}
                className="btn soft"
                disabled={busy}
                onClick={() => void finish(outcome, n.id)}
              >
                {day ? `${n.label} · ${day}` : n.label}
              </button>
            );
          })}
        </>
      )}
      {error ? <p role="alert">{error}</p> : null}{' '}
      <button className="btn soft" onClick={onDone}>
        {s.cancel}
      </button>
    </div>
  );
}
