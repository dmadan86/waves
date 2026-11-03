'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

import {
  docNumberLabel,
  inquiryAmount,
  inquiryDocs,
  inquiryLabel,
  inquiryStatus,
} from '@waves/core';

import { fill } from '@/i18n';
import { useStrings } from '@/i18n-context';
import { money } from '@/lib/money';
import { clientKinds, inquiryRejectPayload } from '@/lib/company/clients';
import { CompanyPage, InquiryForm } from '@/lib/company/ClientParts';
import { useClientDocs, useCompanyClients, useCompanyWrite } from '@/lib/company/useClients';

export default function InquiryPage() {
  const { groupId, inquiryId } = useParams<{ groupId: string; inquiryId: string }>();
  const { t, locale } = useStrings();
  const s = t.company.clients;
  const router = useRouter();
  const view = useCompanyClients(groupId);
  const docsAll = useClientDocs(groupId);
  const { run, busy, error } = useCompanyWrite(groupId);
  const [panel, setPanel] = useState<null | 'edit' | 'reject'>(null);
  const co = view.company;
  const inquiry = view.inquiries.find((i) => i.id === inquiryId);
  const client = view.clients.find((c) => c.id === inquiry?.clientId);
  const back = {
    href: client ? `/c/${groupId}/clients/${client.id}` : `/c/${groupId}/clients`,
    label: t.company.common.back,
  };
  if (!co.ready)
    return (
      <CompanyPage groupId={groupId} title={s.inqTitle} back={back}>
        <p className="faint">{t.company.common.loading}</p>
      </CompanyPage>
    );
  if (!inquiry)
    return (
      <CompanyPage groupId={groupId} title={s.inqTitle} back={back}>
        <p>{s.inqNotFound}</p>
      </CompanyPage>
    );
  const canWrite = view.canAdd && !co.suspended && client?.stage !== 'lost';
  const fmt = (m: bigint) => money(m, co.currency, locale);
  const docs = inquiryDocs(inquiry.id, docsAll);
  const status = inquiryStatus(inquiry, docsAll);
  const amount = inquiryAmount(inquiry, docsAll);
  const reject = async (reason: string | null) => {
    if (
      await run(
        clientKinds.inquiryReject,
        inquiryRejectPayload({ inquiryId, rejected: true, reason }),
      )
    )
      setPanel(null);
  };
  return (
    <CompanyPage groupId={groupId} title={inquiryLabel(inquiry.number)} back={back}>
      <div className="card">
        <h2>{inquiry.title}</h2>
        <p className="faint">
          {[client?.name, inquiry.inquiryDate, status].filter(Boolean).join(' · ')}
        </p>
        {amount != null ? (
          <p>
            {s.inqAmount}: {fmt(amount)}
          </p>
        ) : null}
        {status === 'rejected' && inquiry.rejectReason ? (
          <p>{fill(s.inqRejectedFor, { reason: inquiry.rejectReason })}</p>
        ) : null}
        {inquiry.details ? <p>{inquiry.details}</p> : null}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {canWrite ? (
            <button className="btn soft" onClick={() => setPanel('edit')}>
              {s.inqEdit}
            </button>
          ) : null}
          {canWrite && status !== 'rejected' ? (
            <button className="btn soft" disabled={busy} onClick={() => setPanel('reject')}>
              {s.inqReject}
            </button>
          ) : null}
          {canWrite && status === 'rejected' ? (
            <button
              className="btn soft"
              disabled={busy}
              onClick={() =>
                void run(
                  clientKinds.inquiryReject,
                  inquiryRejectPayload({ inquiryId, rejected: false }),
                )
              }
            >
              {s.inqReopen}
            </button>
          ) : null}
          {view.canManage && !co.suspended ? (
            <button
              className="btn soft"
              disabled={busy}
              onClick={async () => {
                if (
                  window.confirm(s.inqRemoveConfirm) &&
                  (await run(clientKinds.inquiryRemove, { inquiryId }))
                )
                  router.replace(back.href);
              }}
            >
              {s.inqRemove}
            </button>
          ) : null}
        </div>
        {error ? <p role="alert">{error}</p> : null}
      </div>
      {panel === 'reject' ? (
        <div className="card">
          <h3>{s.inqRejectWhy}</h3>
          {[s.lostPrice, s.lostOther, s.lostSilent].map((r) => (
            <button key={r} className="btn soft" disabled={busy} onClick={() => void reject(r)}>
              {r}
            </button>
          ))}
          <button className="btn soft" disabled={busy} onClick={() => void reject(null)}>
            {s.lostSkip}
          </button>{' '}
          <button className="btn soft" onClick={() => setPanel(null)}>
            {s.cancel}
          </button>
        </div>
      ) : null}
      {panel === 'edit' && client ? (
        <InquiryForm
          groupId={groupId}
          clientId={client.id}
          inquiry={inquiry}
          currency={co.currency}
          onDone={() => setPanel(null)}
        />
      ) : null}
      {co.isAdmin || docs.length > 0 ? (
        <>
          <h3>{s.inqDocs}</h3>
          {docs.length === 0 ? (
            <p className="faint">{s.inqNoDocs}</p>
          ) : (
            docs.map((d) => (
              <p key={d.id}>
                {docNumberLabel(d.docType, d.number)} · {d.status} · {d.docDate} ·{' '}
                {fmt(d.totalMinor)}
              </p>
            ))
          )}
        </>
      ) : null}
    </CompanyPage>
  );
}
