'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

import { buildReimbursementPreview, MutationKind } from '@waves/core';

import { CompanyFrame } from '@/components/CompanyFrame';
import { EntryRow, ErrorLine, Page, useAction, useMoney } from '@/components/company/Bits';
import { fill } from '@/i18n';
import { useStrings } from '@/i18n-context';
import { employeeDue } from '@/lib/company/employee';
import { memberName, todayIso, useCompanyView } from '@/lib/company/view';
import { useSync } from '@/lib/sync';

export default function CompanyPaymentsPage() {
  const { groupId } = useParams<{ groupId: string }>();
  return (
    <CompanyFrame groupId={groupId}>
      <Payments groupId={groupId} />
    </CompanyFrame>
  );
}

function Payments({ groupId }: { groupId: string }) {
  const { t } = useStrings();
  const p = t.company.payments;
  const view = useCompanyView(groupId);
  const fmt = useMoney(view.currency);
  const { mutate } = useSync();
  const action = useAction('web.company.reimburse');
  const [all, setAll] = useState(false);

  if (!view.isAdmin) return <Page title={p.title}>{null}</Page>;

  const teamIds = new Set(view.members.filter((m) => m.id !== view.me?.id).map((m) => m.id));
  const payments = view.entries.filter(
    (e) =>
      (e.kind === 'wage_payment' ||
        e.kind === 'wages' ||
        e.kind === 'advance' ||
        e.kind === 'reimbursement') &&
      (view.isOwner || teamIds.has(e.memberId)),
  );
  const owed = view.members
    .filter((m) => view.manageableIds.has(m.id))
    .map((m) => ({ member: m, ...employeeDue(view.entries, m.id) }))
    .filter((row) => row.due.length > 0);

  const reimburse = (memberId: string): Promise<boolean> =>
    action.run(async () => {
      const preview = buildReimbursementPreview(view.entries, {
        memberId,
        ids: employeeDue(view.entries, memberId).due.map((e) => e.id),
      });
      if (preview.claims.length === 0 || preview.payoutMinor < 0n) return;
      const versioned = (rows: readonly { id: string; version: number }[]) =>
        rows.map((e) => ({ entryId: e.id, expectedVersion: e.version }));
      await mutate(MutationKind.CompanyReimburse, groupId, {
        reimbursementId: crypto.randomUUID(),
        memberId,
        claims: versioned(preview.claims),
        adjustments: versioned(preview.adjustments),
        cutoff: preview.cutoff,
        paidOn: todayIso(),
        expectedAmountMinor: preview.payoutMinor.toString(),
        note: null,
      });
    });

  const shown = all ? payments : payments.slice(0, 5);
  return (
    <Page title={p.title}>
      <section className="panel">
        <h2>{p.record}</h2>
        <p className="faint">{p.recordBody}</p>
        {view.suspended ? (
          <p>{t.company.common.suspended}</p>
        ) : (
          <div style={{ display: 'flex', gap: 8 }}>
            <Link className="btn" href={`/c/${groupId}/wages`}>
              {p.payWages}
            </Link>
            <Link className="btn" href={`/c/${groupId}/entry/new?kind=advance`}>
              {p.gaveMoney}
            </Link>
          </div>
        )}
      </section>

      <section className="panel">
        <h2>{p.reimburse}</h2>
        <ErrorLine message={action.error} />
        {owed.length === 0 ? <p className="faint">{p.noClaims}</p> : null}
        {owed.map(({ member, total }) => (
          <div key={member.id} className="item">
            <span className="grow">
              <span className="title">{memberName(member, t.company.common.someone)}</span>
              <span className="meta">{fill(p.reimburseTotal, { amount: fmt(total) })}</span>
            </span>
            {view.suspended ? null : (
              <button
                type="button"
                className="btn brand"
                disabled={action.busy || total <= 0n}
                onClick={() => void reimburse(member.id)}
              >
                {p.reimburseConfirm}
              </button>
            )}
          </div>
        ))}
      </section>

      <section className="panel">
        <div className="page-head">
          <h2>{p.recent}</h2>
          {!all && payments.length > 5 ? (
            <button type="button" className="btn soft" onClick={() => setAll(true)}>
              {t.company.home.viewAll}
            </button>
          ) : null}
        </div>
        {payments.length === 0 ? (
          <>
            <strong>{p.none}</strong>
            <p className="faint">{p.noneBody}</p>
          </>
        ) : null}
        {shown.map((entry) => (
          <EntryRow key={entry.id} view={view} entry={entry} groupId={groupId} />
        ))}
      </section>
    </Page>
  );
}
