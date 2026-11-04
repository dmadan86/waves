'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  buildReimbursementPreview,
  companyStatement,
  reimbursementOutcome,
  type CompanyEntry,
} from '@waves/core';

import { CompanyEmployeePanel } from '@/components/CompanyEmployeePanel';
import { CompanyFrame } from '@/components/CompanyFrame';
import { SegmentedTabs } from '@/components/SegmentedTabs';
import { SkeletonRows } from '@/components/Skeleton';
import { useEntryActions } from '@/lib/company/entryActions';
import { employeeDue } from '@/lib/company/employee';
import {
  kindLabel,
  periodRange,
  saveText,
  statementCsv,
  statementText,
  type StatementPeriod,
} from '@/lib/company/statementData';
import { memberName, todayIso, useCompanyView } from '@/lib/company/view';
import { fillText, wagesStrings as s } from '@/lib/company/wagesStrings';
import { money } from '@/lib/money';

const GIVEN = new Set(['advance', 'wages', 'wage_payment', 'allocation']);

export default function CompanyStatementPage() {
  const { groupId, memberId } = useParams<{ groupId: string; memberId: string }>();
  const view = useCompanyView(groupId);
  const actions = useEntryActions(groupId);
  const [period, setPeriod] = useState<StatementPeriod>('all');
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [through, setThrough] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [lastPay, setLastPay] = useState<{ reimbursementId: string; claimIds: string[] } | null>(
    null,
  );

  // The member list only holds who this viewer may read, so a guessed id finds nothing.
  const member = view.members.find((m) => m.id === memberId) ?? null;
  const mine = !!member && view.me?.id === member.id;
  const who = memberName(member ?? undefined, 'Someone');
  const fmt = (minor: bigint): string => money(minor, view.currency);

  const statement = useMemo(() => {
    const { from, to } = periodRange(period, todayIso());
    return companyStatement(view.entries, { memberId, from, to });
  }, [view.entries, memberId, period]);

  const { due } = view.isAdmin
    ? employeeDue(view.entries, memberId)
    : { due: [] as CompanyEntry[] };
  const preview = buildReimbursementPreview(view.entries, {
    memberId,
    ids: [...picked],
    ...(through ? { through } : {}),
  });
  const canPay = preview.claims.length > 0 && preview.payoutMinor >= 0n && !busy;

  const abs = statement.closing < 0n ? -statement.closing : statement.closing;
  const sideText =
    statement.side === 'settled'
      ? s.settled
      : statement.side === 'company_owes'
        ? mine
          ? s.companyOwesYou
          : fillText(s.youOweName, { name: who, amount: fmt(abs) })
        : mine
          ? fillText(s.youHaveOfCompany, { amount: fmt(abs) })
          : fillText(s.hasOfYours, { name: who, amount: fmt(abs) });

  const toggle = (id: string): void => {
    setThrough('');
    setPicked((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  };
  const pickThrough = (date: string): void => {
    setThrough(date);
    setPicked(new Set(due.filter((e) => e.occurredOn <= date).map((e) => e.id)));
  };

  const pay = async (): Promise<void> => {
    setError(null);
    setBusy(true);
    const versioned = (rows: readonly CompanyEntry[]) =>
      rows.map((e) => ({ entryId: e.id, expectedVersion: e.version }));
    try {
      const reimbursementId = crypto.randomUUID();
      await actions.reimburse({
        reimbursementId,
        memberId,
        claims: versioned(preview.claims),
        adjustments: versioned(preview.adjustments),
        cutoff: preview.cutoff,
        paidOn: todayIso(),
        expectedAmountMinor: preview.payoutMinor.toString(),
        note: null,
      });
      setLastPay({ reimbursementId, claimIds: preview.claims.map((e) => e.id) });
      setSelecting(false);
      setPicked(new Set());
      setThrough('');
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : s.couldNotSave);
    } finally {
      setBusy(false);
    }
  };

  // The server pays what is still due; claims another admin paid first read as a calm note.
  const alreadyPaid = useMemo(() => {
    const outcome = lastPay ? reimbursementOutcome(view.entries, lastPay) : null;
    return (outcome?.alreadyPaid ?? [])
      .filter((a) => a.by)
      .map((a) => {
        const payer = memberName(
          view.members.find((m) => m.id === a.by),
          'Someone',
        );
        return a.count === 1
          ? fillText(s.payAlreadyOne, { name: payer })
          : fillText(s.payAlreadyMany, { count: a.count, name: payer });
      });
  }, [lastPay, view.entries, view.members]);

  const bubbles = [...statement.rows.map(({ entry }) => entry), ...statement.pending].sort(
    (a, b) =>
      a.occurredOn === b.occurredOn
        ? a.createdAt.localeCompare(b.createdAt)
        : a.occurredOn.localeCompare(b.occurredOn),
  );

  const text = (): string => statementText(statement, view.name, who, fmt);
  const share = async (): Promise<void> => {
    try {
      if (navigator.share) await navigator.share({ text: text() });
      else {
        await navigator.clipboard.writeText(text());
        setNote(s.copied);
      }
    } catch {
      // A dismissed share sheet is not an error.
    }
  };
  const slug = who.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-');

  return (
    <CompanyFrame groupId={groupId}>
      <div className="app-body">
        <div className="app-main">
          <div className="page-head">
            <h1>{mine ? s.myStatement : `${s.statementTitle}: ${who}`}</h1>
          </div>
          {!view.ready ? (
            <SkeletonRows />
          ) : !member ? (
            <p>{s.noPerson}</p>
          ) : (
            <>
              <div className="card">
                <p>{s.balance}</p>
                <h2>{fmt(abs)}</h2>
                <p>{sideText}</p>
              </div>
              <SegmentedTabs
                label={s.statementTitle}
                value={period}
                onChange={setPeriod}
                tabs={[
                  { value: 'month', label: s.periodMonth },
                  { value: 'last', label: s.periodLast },
                  { value: 'all', label: s.periodAll },
                ]}
              />
              {error ? <p role="alert">{error}</p> : null}
              {note ? <p role="status">{note}</p> : null}
              {alreadyPaid.map((line) => (
                <p key={line}>{line}</p>
              ))}

              {view.isAdmin && due.length > 0 ? (
                <div className="card">
                  <h3>{s.pendingForPayment}</h3>
                  <button
                    type="button"
                    className="btn soft"
                    onClick={() => {
                      setSelecting((on) => !on);
                      setPicked(new Set());
                      setThrough('');
                    }}
                  >
                    {selecting ? s.cancel : s.selectClaims}
                  </button>
                  {selecting ? (
                    <>
                      <button
                        type="button"
                        className="btn soft"
                        onClick={() => {
                          setThrough('');
                          setPicked(
                            picked.size === due.length ? new Set() : new Set(due.map((e) => e.id)),
                          );
                        }}
                      >
                        {s.selectAll}
                      </button>
                      <label>
                        {s.selectThrough}{' '}
                        <input
                          type="date"
                          value={through}
                          onChange={(e) => e.target.value && pickThrough(e.target.value)}
                        />
                      </label>
                    </>
                  ) : null}
                  <ul>
                    {due.map((e) => (
                      <li key={e.id}>
                        {selecting ? (
                          <input
                            type="checkbox"
                            checked={picked.has(e.id)}
                            onChange={() => toggle(e.id)}
                            aria-label={kindLabel(e)}
                          />
                        ) : null}{' '}
                        <Link href={`/c/${groupId}/entry/${e.id}`}>
                          {kindLabel(e)} · {e.occurredOn} · {fmt(e.amount)}
                          {view.receiptEntryIds.has(e.id) ? ` · ${s.receipt}` : ''}
                        </Link>
                      </li>
                    ))}
                  </ul>
                  {selecting && picked.size > 0 ? (
                    <>
                      <p>
                        {[
                          fillText(s.payCount, { count: preview.claims.length }),
                          preview.creditsMinor !== 0n
                            ? fillText(s.payCredits, { amount: fmt(preview.creditsMinor) })
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                      {preview.payoutMinor < 0n ? <p role="alert">{s.payNeedMore}</p> : null}
                      <button
                        type="button"
                        className="btn brand"
                        disabled={!canPay}
                        onClick={() => void pay()}
                      >
                        {fillText(s.recordPaymentTotal, {
                          amount: fmt(preview.payoutMinor < 0n ? 0n : preview.payoutMinor),
                        })}
                      </button>
                      <p>{s.payExternal}</p>
                    </>
                  ) : null}
                </div>
              ) : null}

              {bubbles.length === 0 ? (
                <p>{s.threadEmpty}</p>
              ) : (
                <ul>
                  {bubbles.map((e) => {
                    const gave =
                      GIVEN.has(e.kind) ||
                      (e.kind === 'reimbursement' && e.direction !== 'employee_to_company');
                    const wage = e.kind === 'wages' || e.kind === 'wage_payment';
                    const waiting = e.status === 'submitted' || e.status === 'rejected';
                    const formula =
                      e.kind === 'wage_payment' && (e.recoveryMinor ?? 0n) > 0n
                        ? fillText(s.wageFormula, {
                            gross: fmt(e.grossMinor ?? e.amount),
                            cut: fmt(e.recoveryMinor ?? 0n),
                            net: fmt(e.amount),
                          })
                        : e.calcMode === 'days_rate' && e.days && e.rateMinor !== null
                          ? fillText(s.daysAt, { days: e.days, rate: fmt(e.rateMinor) })
                          : null;
                    return (
                      <li key={e.id} style={{ opacity: waiting ? 0.7 : 1 }}>
                        <Link href={`/c/${groupId}/entry/${e.id}`}>
                          {fmt(e.amount)} · {wage ? s.paidWages : gave ? s.gaveMoney : kindLabel(e)}
                          {formula ? ` · ${formula}` : ''}
                          {e.note ? ` · ${e.note}` : ''} · {e.occurredOn}
                          {waiting ? ` · ${e.status === 'rejected' ? s.rejected : s.awaiting}` : ''}
                          {view.receiptEntryIds.has(e.id) ? ` · ${s.receipt}` : ''}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}

              {statement.rows.length > 0 ? (
                <div>
                  <button type="button" className="btn soft" onClick={() => void share()}>
                    {s.shareSystem}
                  </button>{' '}
                  <button
                    type="button"
                    className="btn soft"
                    onClick={() => saveText(`statement-${slug}.txt`, 'text/plain', text())}
                  >
                    {s.shareText}
                  </button>{' '}
                  <button
                    type="button"
                    className="btn soft"
                    onClick={() =>
                      saveText(
                        `statement-${slug}.csv`,
                        'text/csv',
                        statementCsv(statement, view.currency),
                      )
                    }
                  >
                    {s.downloadCsv}
                  </button>{' '}
                  <button type="button" className="btn soft" onClick={() => window.print()}>
                    {s.print}
                  </button>
                </div>
              ) : null}
              <p>{view.isAdmin ? s.privacyAdmin : s.privacyEmployee}</p>
            </>
          )}
          <CompanyEmployeePanel groupId={groupId} memberId={memberId} />
        </div>
      </div>
    </CompanyFrame>
  );
}
