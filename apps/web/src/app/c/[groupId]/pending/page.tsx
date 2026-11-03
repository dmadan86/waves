'use client';

import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';

import { flagsForEntry, materialiseCalendar, MutationKind, type CompanyEntry } from '@waves/core';

import { CompanyFrame } from '@/components/CompanyFrame';
import { EntryRow, ErrorLine, Page, useAction, useMoney } from '@/components/company/Bits';
import { useStrings } from '@/i18n-context';
import { awaitingApprovals, memberName, useCompanyView } from '@/lib/company/view';
import { NO_QUEUE, useSync } from '@/lib/sync';

export default function CompanyPendingPage() {
  const { groupId } = useParams<{ groupId: string }>();
  return (
    <CompanyFrame groupId={groupId}>
      <Pending groupId={groupId} />
    </CompanyFrame>
  );
}

function Pending({ groupId }: { groupId: string }) {
  const { t } = useStrings();
  const p = t.company.pending;
  const view = useCompanyView(groupId);
  const fmt = useMoney(view.currency);
  const { mirror, mutate } = useSync();
  const action = useAction('web.company.review');
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const leave = useMemo(
    () =>
      materialiseCalendar(mirror, NO_QUEUE, { groupId, meId: view.me?.id ?? null }).leave.filter(
        (l) => l.status === 'pending' && l.memberId !== view.me?.id,
      ),
    [mirror, groupId, view.me?.id],
  );

  if (!view.isAdmin) return <Page title={p.title}>{null}</Page>;

  const claims = awaitingApprovals(view);
  const requests = view.isOwner
    ? view.entries
        .filter((e) => e.kind === 'pool_request' && !e.deleted)
        .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn))
    : [];
  const live = view.members.filter((m) => !m.left_at);
  const name = (id: string): string =>
    memberName(
      live.find((m) => m.id === id),
      t.company.common.someone,
    );

  const review = (entry: CompanyEntry, to: 'approved' | 'rejected'): Promise<boolean> =>
    action.run(async () => {
      await mutate(MutationKind.CompanyEntryTransition, groupId, {
        entryId: entry.id,
        to,
        expectedVersion: entry.version,
        note: to === 'rejected' ? note.trim() : null,
      });
      setRejecting(null);
      setNote('');
    });

  const decide = (id: string, approve: boolean): Promise<boolean> =>
    action.run(() => mutate(MutationKind.CompanyLeaveDecide, groupId, { id, approve, note: null }));

  const empty = claims.length === 0 && requests.length === 0 && leave.length === 0;
  return (
    <Page title={p.title}>
      <ErrorLine message={action.error} />
      {claims.length > 0 ? (
        <section className="panel">
          <h2>{p.approvals}</h2>
          {claims.map((entry) => (
            <div key={entry.id}>
              <EntryRow
                view={view}
                entry={entry}
                groupId={groupId}
                extra={
                  flagsForEntry(entry, view.entries, view.policies, view.receiptEntryIds).length >
                  0 ? (
                    <span className="faint">! {p.flagged}</span>
                  ) : null
                }
              />
              {view.suspended ? null : rejecting === entry.id ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void review(entry, 'rejected');
                  }}
                >
                  <input
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder={p.rejectNote}
                    aria-label={p.rejectNote}
                    maxLength={500}
                  />{' '}
                  <button type="submit" className="btn" disabled={action.busy || !note.trim()}>
                    {p.rejectConfirm}
                  </button>{' '}
                  <button type="button" className="btn soft" onClick={() => setRejecting(null)}>
                    {t.company.common.cancel}
                  </button>
                </form>
              ) : (
                <div style={{ display: 'flex', gap: 8, padding: '4px 0 8px' }}>
                  <button
                    type="button"
                    className="btn brand"
                    disabled={action.busy}
                    onClick={() => void review(entry, 'approved')}
                  >
                    {p.approve}
                  </button>
                  <button
                    type="button"
                    className="btn soft"
                    disabled={action.busy}
                    onClick={() => setRejecting(entry.id)}
                  >
                    {p.reject}
                  </button>
                </div>
              )}
            </div>
          ))}
        </section>
      ) : null}

      {leave.length > 0 ? (
        <section className="panel">
          <h2>{p.leave}</h2>
          {leave.map((l) => (
            <div key={l.id} className="item">
              <span className="grow">
                <span className="title">{name(l.memberId)}</span>
                <span className="meta">
                  {l.startDay} – {l.endDay} · {l.kind}
                  {l.halfDay ? ` · ${p.halfDay}` : ''}
                </span>
              </span>
              {view.suspended ? null : (
                <>
                  <button
                    type="button"
                    className="btn brand"
                    disabled={action.busy}
                    onClick={() => void decide(l.id, true)}
                  >
                    {p.leaveApprove}
                  </button>
                  <button
                    type="button"
                    className="btn soft"
                    disabled={action.busy}
                    onClick={() => void decide(l.id, false)}
                  >
                    {p.leaveDecline}
                  </button>
                </>
              )}
            </div>
          ))}
        </section>
      ) : null}

      {requests.length > 0 ? (
        <section className="panel">
          <h2>{p.budgetRequests}</h2>
          {requests.map((r) => (
            <div key={r.id} className="item">
              <span className="grow">
                <span className="title">{name(r.memberId)}</span>
                {r.note ? <span className="meta">{r.note}</span> : null}
              </span>
              <span>{fmt(r.amount)}</span>
            </div>
          ))}
        </section>
      ) : null}

      {empty ? (
        <section className="panel">
          <strong>{p.none}</strong>
          <p className="faint">{p.noneBody}</p>
        </section>
      ) : null}
    </Page>
  );
}
