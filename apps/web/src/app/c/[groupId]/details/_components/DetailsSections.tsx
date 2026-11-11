'use client';

/** Company details top: hero, key facts, team and setup shortcuts (mirrors mobile). The full card stays below. */
import type { CSSProperties, ReactNode } from 'react';
import Link from 'next/link';
import { Building2, Check, ChevronRight, Pencil } from 'lucide-react';

import { maskValue, type DetailsCard } from '@waves/core';

import { fill } from '@/i18n';
import { useStrings } from '@/i18n-context';

const GREEN = '#17703C';
const row: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  minHeight: 44,
  padding: '6px 0',
  borderBottom: '1px solid var(--w-border)',
  color: 'inherit',
  textDecoration: 'none',
};

function Row({
  title,
  value,
  sub,
  onClick,
  href,
}: {
  title: string;
  value?: string;
  sub?: string;
  onClick?: () => void;
  href?: string;
}) {
  const body: ReactNode = (
    <>
      <span style={{ fontWeight: sub ? 700 : undefined }}>{title}</span>
      <span className="faint" style={{ flex: 1, textAlign: 'end' }}>
        {value ?? sub ?? ''}
      </span>
      {onClick || href ? <ChevronRight size={16} aria-hidden /> : null}
    </>
  );
  if (href)
    return (
      <Link href={href} style={row}>
        {body}
      </Link>
    );
  if (onClick)
    return (
      <button
        type="button"
        onClick={onClick}
        style={{
          ...row,
          width: '100%',
          background: 'none',
          border: 0,
          borderBottom: row.borderBottom,
          font: 'inherit',
          cursor: 'pointer',
        }}
      >
        {body}
      </button>
    );
  return <div style={row}>{body}</div>;
}

export function DetailsSections({
  groupId,
  name,
  memberCount,
  card,
  canEdit,
  onEdit,
}: {
  groupId: string;
  name: string;
  memberCount: number;
  card: DetailsCard | null;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const { t } = useStrings();
  const s = t.company.vendors.details;
  const v = card?.values;
  const edit = canEdit ? onEdit : undefined;
  const base = `/c/${groupId}`;
  const head: CSSProperties = {
    fontSize: 'var(--w-font-body)',
    fontWeight: 700,
    margin: '14px 0 6px',
  };
  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <p className="faint" style={{ marginBottom: 10 }}>
        {s.subtitle}
      </p>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: 14,
          borderRadius: 'var(--w-radius-md)',
          background: 'linear-gradient(135deg, var(--w-brand-soft), var(--w-surface))',
          border: '1px solid var(--w-border)',
        }}
      >
        <span
          style={{
            display: 'grid',
            placeItems: 'center',
            width: 52,
            height: 52,
            borderRadius: 14,
            background: 'var(--w-brand-soft)',
            color: 'var(--w-brand)',
          }}
        >
          <Building2 size={26} aria-hidden />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ fontSize: 'var(--w-font-subheading)', fontWeight: 700 }}>{name}</h2>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              marginTop: 4,
              padding: '2px 8px',
              borderRadius: 999,
              background: '#DDF3E4',
              color: GREEN,
              fontSize: 'var(--w-font-caption)',
              fontWeight: 600,
            }}
          >
            <Check size={14} aria-hidden /> {s.active}
          </span>
        </div>
        {canEdit ? (
          <button
            type="button"
            aria-label={s.edit}
            onClick={onEdit}
            style={{
              display: 'grid',
              placeItems: 'center',
              width: 40,
              height: 40,
              borderRadius: '50%',
              border: 0,
              background: 'var(--w-surface)',
              color: 'var(--w-brand)',
              cursor: 'pointer',
            }}
          >
            <Pencil size={18} aria-hidden />
          </button>
        ) : null}
      </div>

      <h3 style={head}>{s.companyInfo}</h3>
      <div className="panel" style={{ marginBottom: 0 }}>
        <Row title={s.legalName} value={name} />
        <Row title={s.pan} value={v?.pan ? maskValue(v.pan) : undefined} onClick={edit} />
        <Row title={s.gstin} value={v?.gstin ?? undefined} onClick={edit} />
        <Row title={s.address} value={v?.address ?? undefined} onClick={edit} />
        {canEdit ? (
          <button
            type="button"
            className="btn soft"
            onClick={onEdit}
            style={{
              width: '100%',
              marginTop: 8,
              color: 'var(--w-brand)',
              background: 'var(--w-brand-soft)',
            }}
          >
            + {s.addMore}
          </button>
        ) : null}
      </div>

      <h3 style={head}>{s.peopleAccess}</h3>
      <div className="panel" style={{ marginBottom: 0 }}>
        <Row
          title={s.teamMembers}
          sub={fill(s.members, { n: String(memberCount) })}
          href={`${base}/team`}
        />
      </div>

      <h3 style={head}>{s.businessSetup}</h3>
      <div className="panel" style={{ marginBottom: 18 }}>
        <Row title={s.billing} sub={s.billingSub} href={`${base}/payments`} />
        <Row title={s.preferences} sub={s.preferencesSub} href={`${base}/settings`} />
      </div>
    </div>
  );
}
