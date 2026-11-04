'use client';

/** One vendor bill or advance: its facts, photos, and the actions this viewer may take. */
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';

import { MutationKind } from '@waves/core';

import { CompanyFrame } from '@/components/CompanyFrame';
import { useStrings } from '@/i18n-context';
import { fill } from '@/i18n';
import { friendlyError } from '@/lib/errors';
import { useAction, useVendorsData } from '@/lib/company/useVendors';
import {
  vendorEntryReceivedPayload,
  vendorEntryReviewPayload,
  vendorEntryVoidPayload,
} from '@/lib/company/vendors';
import { BackLink, Page, Pill, VendorPhotos, useVendorFormat } from '../../../_components/parts';

export default function VendorEntryPage() {
  const { groupId, vendorId, entryId } = useParams<{
    groupId: string;
    vendorId: string;
    entryId: string;
  }>();
  return (
    <CompanyFrame groupId={groupId}>
      <Inner groupId={groupId} vendorId={vendorId} entryId={entryId} />
    </CompanyFrame>
  );
}

function Inner({
  groupId,
  vendorId,
  entryId,
}: {
  groupId: string;
  vendorId: string;
  entryId: string;
}) {
  const { t } = useStrings();
  const s = t.company.vendors;
  const router = useRouter();
  const d = useVendorsData(groupId);
  const f = useVendorFormat(d.vendors.currency);
  const action = useAction();
  const back = `/c/${groupId}/vendors/${vendorId}`;
  const line = d.vendors.lines.find((l) => l.id === entryId);
  const vendor = line ? d.vendors.vendors.find((v) => v.id === line.vendorId) : undefined;
  if (!line || !vendor)
    return (
      <Page title={s.bill}>
        <BackLink href={back}>{s.vendorTitle}</BackLink>
        <p className="faint">{s.notFound}</p>
      </Page>
    );
  const fail = (e: unknown) => friendlyError(e, 'web.vendors.entry', { fallback: s.failed });
  const vendorView = vendor.memberId === d.vendors.myMemberId;
  const pending = line.status === 'pending';
  const ownPendingBill =
    vendorView && line.kind === 'bill' && pending && line.createdBy === d.vendors.myMemberId;
  const canRemove =
    !d.company.suspended &&
    line.createdBy === d.vendors.myMemberId &&
    (vendorView ? line.kind === 'bill' && pending : d.vendors.canManage && !pending);
  const status =
    line.pending || pending
      ? s.pending
      : line.status === 'rejected'
        ? s.rejected
        : line.kind === 'bill'
          ? s.confirmed
          : line.receivedAt
            ? s.received
            : s.recorded;
  const rows = [
    [
      s.date,
      [f.date(line.occurredOn), line.dueOn ? fill(s.dueOn, { date: f.date(line.dueOn) }) : null]
        .filter(Boolean)
        .join(' · '),
    ],
    [s.method, line.method ? f.methods[line.method] : null],
    [s.reference, line.reference],
    [s.note, line.note],
    [s.rejected, line.status === 'rejected' ? line.reviewNote : null],
  ].filter((r): r is [string, string] => !!r[1]);
  const withdraw = vendorView && pending;
  const review = (to: 'approved' | 'rejected') =>
    void action
      .run(
        () =>
          d.mutate(
            MutationKind.CompanyVendorEntryReview,
            groupId,
            vendorEntryReviewPayload({ line, to }),
          ),
        fail,
      )
      .then((ok) => ok && router.push(back));
  return (
    <Page title={s[line.kind]}>
      <BackLink href={back}>{vendor.name}</BackLink>
      <div className="panel">
        <p className="faint">{vendor.name}</p>
        <p
          style={{ fontSize: 28, fontWeight: 800 }}
        >{`${line.kind === 'bill' ? '+' : '−'}${f.money(line.amount)}`}</p>
        <Pill tone={line.status === 'rejected' ? 'bad' : line.receivedAt ? 'good' : undefined}>
          {status}
        </Pill>
        {rows.map(([k, v]) => (
          <p key={k}>
            <span className="faint">{k}</span> {v}
          </p>
        ))}
        {line.kind === 'payment' ? (
          <p>
            <Link href={`${back}/receipt/${line.id}`}>{s.receipt}</Link>
          </p>
        ) : null}
      </div>
      <div className="panel">
        <VendorPhotos
          groupId={groupId}
          entryId={line.id}
          canAdd={d.canManage || ownPendingBill}
          canRemove={(uploader) =>
            d.canManage || (ownPendingBill && uploader === d.vendors.myMemberId)
          }
        />
      </div>
      {action.error ? <p className="error">{action.error}</p> : null}
      <p>
        {d.canManage && line.kind === 'bill' && pending ? (
          <>
            <button
              type="button"
              className="btn brand"
              disabled={action.busy}
              onClick={() => review('approved')}
            >
              {s.confirm}
            </button>{' '}
            <button
              type="button"
              className="btn soft"
              disabled={action.busy}
              onClick={() => review('rejected')}
            >
              {s.reject}
            </button>{' '}
          </>
        ) : null}
        {!line.receivedAt && vendorView && line.kind !== 'bill' && line.status === 'approved' ? (
          <button
            type="button"
            className="btn soft"
            disabled={action.busy}
            onClick={() =>
              void action.run(
                () =>
                  d.mutate(
                    MutationKind.CompanyVendorEntryReceived,
                    groupId,
                    vendorEntryReceivedPayload({ entryId: line.id, received: true }),
                  ),
                fail,
              )
            }
          >
            {s.markReceived}
          </button>
        ) : null}{' '}
        {canRemove ? (
          <button
            type="button"
            className="btn soft"
            disabled={action.busy}
            onClick={() => {
              if (!window.confirm(withdraw ? s.withdrawConfirm : s.removeConfirm)) return;
              void action
                .run(
                  () =>
                    d.mutate(
                      MutationKind.CompanyVendorEntryVoid,
                      groupId,
                      vendorEntryVoidPayload({ entryId: line.id }),
                    ),
                  fail,
                )
                .then((ok) => ok && router.push(back));
            }}
          >
            {withdraw ? s.withdraw : s.removeEntry}
          </button>
        ) : null}
      </p>
    </Page>
  );
}
