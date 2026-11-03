'use client';

/** A payment's receipt; "Print / save as PDF" uses the browser's print dialog. */
import Link from 'next/link';
import { useParams } from 'next/navigation';

import { buildReceipt, receiptLabel, receiptStatus } from '@waves/core';

import { CompanyFrame } from '@/components/CompanyFrame';
import { useStrings } from '@/i18n-context';
import { fill } from '@/i18n';
import { useVendorsData } from '@/lib/company/useVendors';
import { printHtml, renderReceiptHtml } from '@/lib/company/vendorPrint';
import { whatsappUrl } from '@/lib/company/vendors';
import { BackLink, labelsOf, Page, Pill, useVendorFormat } from '../../../_components/parts';

export default function VendorReceiptPage() {
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
  const d = useVendorsData(groupId);
  const f = useVendorFormat(d.vendors.currency);
  const back = `/c/${groupId}/vendors/${vendorId}`;
  const line = d.vendors.lines.find((l) => l.id === entryId && l.kind === 'payment');
  const vendor = line ? d.vendors.vendors.find((v) => v.id === line.vendorId) : undefined;
  if (!line || !vendor)
    return (
      <Page title={s.receiptTitle}>
        <BackLink href={back}>{s.vendorTitle}</BackLink>
        <p className="faint">{s.notFound}</p>
      </Page>
    );
  const r = buildReceipt(
    line,
    vendor,
    d.vendors.lines.filter((l) => l.vendorId === vendor.id),
  );
  const status = { pending: s.waitingSync, received: s.received, recorded: s.waitingVendor }[
    receiptStatus(r)
  ];
  const rows: [string, string][] = [
    [s.companyLabel, d.access.name],
    [s.vendorLabel, vendor.name],
    [s.dateLabel, f.date(r.date)],
    ...(r.method ? [[s.method, f.methods[r.method] ?? r.method] as [string, string]] : []),
    ...(r.reference ? [[s.reference, r.reference] as [string, string]] : []),
    [
      s.balanceAfter,
      r.balanceAfter < 0n ? `${f.money(-r.balanceAfter)} ${s.advance}` : f.money(r.balanceAfter),
    ],
  ];
  const wa = whatsappUrl(
    vendor.phone,
    `${s.receiptTitle} ${receiptLabel(r.receiptNo)}: ${f.money(r.amount)} · ${d.access.name}`,
  );
  return (
    <Page title={s.receiptTitle}>
      <BackLink href={back}>{fill(s.openInVendor, { name: vendor.name })}</BackLink>
      <div className="panel">
        <p className="faint">
          {s.receipt} {receiptLabel(r.receiptNo)}
        </p>
        <p style={{ fontSize: 30, fontWeight: 800 }}>{f.money(r.amount)}</p>
        <p className="faint">{fill(s.paidTo, { name: vendor.name })}</p>
        <Pill tone={r.received ? 'good' : undefined}>{status}</Pill>
        {rows.map(([k, v]) => (
          <p key={k}>
            <span className="faint">{k}</span> {v}
          </p>
        ))}
        <p className="faint">{s.receiptFooter}</p>
      </div>
      <p>
        <Link className="btn soft" href={`${back}/entry/${line.id}`}>
          {s.entryDetails}
        </Link>{' '}
        <button
          type="button"
          className="btn brand"
          onClick={() => printHtml(renderReceiptHtml(r, d.access.name, labelsOf(s), f.methods, f))}
        >
          {s.downloadPdf}
        </button>{' '}
        {wa ? (
          <a className="btn soft" href={wa} target="_blank" rel="noreferrer">
            {s.shareWhatsapp}
          </a>
        ) : null}
      </p>
    </Page>
  );
}
