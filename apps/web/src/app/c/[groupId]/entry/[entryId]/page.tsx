'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { advanceRecovered, flagsForEntry, materialiseCompanyProjects, reimbursedOn } from '@waves/core';

import { CompanyFrame } from '@/components/CompanyFrame';
import { useEntryActions } from '@/lib/company/entryActions';
import { CompanyEntryPhotos } from '@/lib/company/entryPhotos';
import { entryStrings as s } from '@/lib/company/entryStrings';
import { memberName, useCompanyView } from '@/lib/company/view';
import { money } from '@/lib/money';
import { NO_QUEUE, useSync } from '@/lib/sync';

function Inner({ groupId, entryId }: { groupId: string; entryId: string }) {
  const router = useRouter();
  const view = useCompanyView(groupId);
  const actions = useEntryActions(groupId);
  const { mirror } = useSync();
  const [rejecting, setRejecting] = useState(false);
  const [rejectNote, setRejectNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const entry = view.entries.find((e) => e.id === entryId && !e.deleted) ?? null;
  if (!entry) return <p>{view.ready ? s.none : s.loading}</p>;

  const owner = view.members.find((m) => m.id === entry.memberId);
  const fmt = (minor: bigint): string => money(minor, view.currency);
  const mine = entry.memberId === view.me?.id;
  const ownKind = entry.kind === 'expense' || entry.kind === 'allowance';
  const frozen =
    entry.status === 'reimbursed' ||
    entry.reimbursementId !== null ||
    entry.coversClaims ||
    entry.kind === 'wage_payment' ||
    advanceRecovered(view.entries, entry);
  const canWithdraw = !frozen && (view.isAdmin || (mine && ownKind && entry.createdBy === view.me?.id));
  const canEdit = !frozen && (view.isAdmin || (mine && ownKind));
  const paidOn = reimbursedOn(entry, view.entries);
  const flags = flagsForEntry(entry, view.entries, view.policies, view.receiptEntryIds);
  const blockFlag = flags.find((f) => f.effect === 'block');
  const ownerName = entry.paidByCompany ? s.companyPayer : memberName(owner, 'Someone');
  const status = entry.status === 'submitted' ? s.awaiting : entry.status === 'rejected' ? s.rejected : s.approved;

  const run = async (work: () => Promise<unknown>): Promise<boolean> => {
    setError(null);
    setBusy(true);
    try {
      await work();
      return true;
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : s.couldNotSave);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async (): Promise<void> => {
    if (!window.confirm(s.removeConfirm)) return;
    if (await run(() => actions.void({ entryId: entry.id }))) router.back();
  };

  const projectName =
    materialiseCompanyProjects(mirror, NO_QUEUE, { groupId }).find((p) => p.id === entry.projectId)?.name ?? null;
  const rows: [string, string | null][] = [
    [s.kind, entry.kind === 'expense' && entry.category ? `${s.kinds.expense} (${entry.category})` : (s.kinds[entry.kind] ?? entry.kind)],
    [s.amount, fmt(entry.amount)],
    [s.date, entry.occurredOn],
    [s.paidBy, entry.paidByCompany ? s.companyPayer : view.isAdmin ? ownerName : null],
    [s.site, projectName],
    [s.days, entry.calcMode === 'days_rate' && entry.days && entry.rateMinor !== null ? s.daysAt(entry.days, fmt(entry.rateMinor)) : null],
    [s.mileage, entry.calcMode === 'distance_rate' && entry.distanceKm && entry.rateMinor !== null ? s.mileageAt(entry.distanceKm, fmt(entry.rateMinor)) : null],
    [`${s.from} / ${s.to}`, entry.fromText || entry.toText ? `${entry.fromText ?? ''} - ${entry.toText ?? ''}` : null],
    [s.vendor, entry.vendor],
    [s.gstin, entry.gstin],
    [s.invoiceNo, entry.invoiceNo],
    [s.gstAmount, entry.gstAmount !== null ? `${s.gstBefore} ${fmt(entry.amount - entry.gstAmount)} · ${fmt(entry.gstAmount)}` : null],
    [s.note, entry.note],
    [s.reviewNote, entry.reviewNote],
  ];

  return (
    <div className="card">
      <h1>{s.entry}</h1>
      <dl>
        {rows.filter(([, v]) => v).map(([label, v]) => (
          <div key={label}>
            <dt className="faint">{label}</dt>
            <dd>{v}</dd>
          </div>
        ))}
        <div>
          <dt className="faint">{s.status}</dt>
          <dd>
            {status}
            {entry.status === 'submitted' ? ` - ${s.notCounted}` : ''}
            {paidOn ? ` - ${s.reimbursedOn(paidOn)}` : ''}
          </dd>
        </div>
      </dl>

      {view.isAdmin && flags.length > 0 ? (
        <div>
          <p>! {s.policyFlagged}</p>
          {flags.map((f) => (
            <p key={f.ruleId} className="faint">
              {f.code === 'RECEIPT'
                ? s.policyHintReceipt(fmt(f.limitMinor))
                : s.policyHintLimit(fmt(f.actualMinor), f.period === 'day' ? s.perDay : s.perMonth, fmt(f.limitMinor))}
            </p>
          ))}
        </div>
      ) : null}

      {entry.pending ? null : (
        <section>
          <h2>{s.photos}</h2>
          <CompanyEntryPhotos
            groupId={groupId}
            entryId={entry.id}
            canAdd={!frozen && (view.isAdmin || mine)}
            canRemove={(uploader) => !frozen && (view.isAdmin || uploader === view.me?.id)}
          />
        </section>
      )}

      {view.isAdmin && entry.status === 'submitted' && view.needsOtherOwner(entry) && !view.canApprove(entry) ? (
        <p className="faint">{s.needsOtherOwner}</p>
      ) : null}

      {view.isAdmin &&
      entry.status === 'submitted' &&
      view.canApprove(entry) &&
      (view.isOwner || entry.memberId !== view.me?.id) ? (
        rejecting ? (
          <div>
            <h2>{s.rejectTitle}</h2>
            <p className="faint">{s.rejectHint(ownerName)}</p>
            <textarea value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} />
            <button
              type="button"
              className="btn brand"
              disabled={busy || !rejectNote.trim()}
              onClick={() =>
                void run(() =>
                  actions.review({ entryId: entry.id, to: 'rejected', note: rejectNote.trim(), expectedVersion: entry.version }),
                ).then((ok) => ok && setRejecting(false))
              }
            >
              {s.rejectConfirm}
            </button>{' '}
            <button type="button" className="btn soft" onClick={() => setRejecting(false)}>{s.cancel}</button>
          </div>
        ) : (
          <div>
            <button
              type="button"
              className="btn brand"
              disabled={busy || !!entry.pending || !!blockFlag}
              onClick={() => void run(() => actions.review({ entryId: entry.id, to: 'approved', expectedVersion: entry.version }))}
            >
              {s.approve}
            </button>{' '}
            <button type="button" className="btn soft" disabled={busy || !!entry.pending} onClick={() => setRejecting(true)}>
              {s.reject}
            </button>
          </div>
        )
      ) : null}

      {blockFlag && view.isAdmin ? <p role="alert">{s.policyBlocked(fmt(blockFlag.limitMinor))}</p> : null}
      {error ? <p role="alert">{error}</p> : null}

      <div>
        {canEdit ? (
          <Link className="btn soft" href={`/c/${groupId}/entry/${entry.id}/edit`}>{s.edit}</Link>
        ) : null}{' '}
        {canWithdraw ? (
          <button type="button" className="btn soft" disabled={busy} onClick={() => void withdraw()}>{s.removeEntry}</button>
        ) : null}
      </div>
      <p className="faint">{view.isAdmin ? s.privacyAdmin : s.privacyEmployee}</p>
    </div>
  );
}

export default function CompanyEntryViewPage() {
  const { groupId, entryId } = useParams<{ groupId: string; entryId: string }>();
  return (
    <CompanyFrame groupId={groupId}>
      <div className="app-body">
        <div className="app-main">
          <Inner groupId={groupId} entryId={entryId} />
        </div>
      </div>
    </CompanyFrame>
  );
}
