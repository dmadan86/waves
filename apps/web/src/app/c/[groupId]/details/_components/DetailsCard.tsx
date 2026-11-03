'use client';

/** A details card: bank + contact rows, bank/UPI/PAN masked until revealed (10 s), copy on click, share as text, inline edit. */
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  cleanDetails,
  detailsToShareText,
  hasAnyDetail,
  invalidDetailKeys,
  maskValue,
  MASKED_KEYS,
  type DetailKey,
  type DetailsCard as Card,
  type DetailsValues,
} from '@waves/core';

import { useStrings } from '@/i18n-context';
import { fill } from '@/i18n';
import { friendlyError } from '@/lib/errors';

/** Display order of the card (mobile's). */
export const ROWS: readonly DetailKey[] = [
  'bankName',
  'bankAccount',
  'ifsc',
  'upi',
  'address',
  'phone',
  'email',
  'gstin',
  'pan',
  'note',
];

/** "Noted" is remembered on this browser only, keyed by card + change time; nothing is synced. */
export function useNoted(key: string | null) {
  const [local, setLocal] = useState<string | null>(null);
  // Read at render: the page only renders after the client-side sync, so there is no server pass to mismatch.
  let stored = false;
  try {
    stored = key !== null && window.localStorage.getItem(key) === '1';
  } catch {
    // storage blocked: show the notice
  }
  const noted = key === null || stored || local === key;
  const markNoted = useCallback(() => {
    if (!key) return;
    setLocal(key);
    try {
      window.localStorage.setItem(key, '1');
    } catch {
      // ignore
    }
  }, [key]);
  return { noted, markNoted };
}

export function BankNotice({ at, onNoted }: { at: string; onNoted: () => void }) {
  const { t, locale } = useStrings();
  const date = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(
    new Date(at),
  );
  return (
    <div className="panel" role="alert" style={{ background: '#FFF3E3' }}>
      <p>{fill(t.company.vendors.details.bankChanged, { date })}</p>
      <button type="button" className="btn soft" onClick={onNoted}>
        {t.company.vendors.details.noted}
      </button>
    </div>
  );
}

function when(locale: string, iso: string): string {
  const seconds = Math.round((Date.parse(iso) - Date.now()) / 1000);
  const abs = Math.abs(seconds);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (abs < 60) return rtf.format(seconds, 'second');
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(seconds / 3600), 'hour');
  return rtf.format(Math.round(seconds / 86400), 'day');
}

export function DetailsCardView({
  title,
  card,
  canEdit,
  notice,
  onSave,
}: {
  title: string;
  card: Card | null;
  canEdit: boolean;
  notice: { at: string | null; show: boolean; onNoted: () => void };
  onSave: (values: DetailsValues) => Promise<unknown>;
}) {
  const { t, locale } = useStrings();
  const s = t.company.vendors.details;
  const labels: Record<DetailKey, string> = {
    bankName: s.accountName,
    bankAccount: s.accountNumber,
    ifsc: s.ifsc,
    upi: s.upi,
    address: s.address,
    phone: s.phone,
    email: s.email,
    gstin: s.gstin,
    pan: s.pan,
    note: s.note,
  };
  const [revealed, setRevealed] = useState<Partial<Record<DetailKey, boolean>>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const [notes, setNotes] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const values = card?.values;
  const filled = values ? hasAnyDetail(values) : false;

  const reveal = (key: DetailKey) => {
    if (revealed[key]) return setRevealed((v) => ({ ...v, [key]: false }));
    setRevealed((v) => ({ ...v, [key]: true }));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setRevealed({}), 10_000);
  };
  const copy = (text: string, done: string) =>
    void navigator.clipboard
      .writeText(text)
      .then(() => setNotes(done))
      .catch(() => undefined);

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>{title}</h2>
        {filled ? (
          <button
            type="button"
            className="btn soft"
            onClick={() => values && copy(detailsToShareText(title, values, labels), s.copied)}
          >
            {s.shareAsText}
          </button>
        ) : null}
        {canEdit && !editing ? (
          <button type="button" className="btn soft" onClick={() => setEditing(true)}>
            {s.edit}
          </button>
        ) : null}
      </div>
      {notice.show && notice.at ? <BankNotice at={notice.at} onNoted={notice.onNoted} /> : null}
      {notes ? <p className="faint">{notes}</p> : null}
      {editing ? (
        <DetailsForm
          title={title}
          initial={values}
          onClose={() => setEditing(false)}
          onSave={onSave}
        />
      ) : filled && values ? (
        ROWS.map((key) => {
          const value = values[key];
          if (!value) return null;
          const masked = MASKED_KEYS.includes(key);
          return (
            <div key={key} className="item">
              <span className="faint">{labels[key]}</span>
              <p>
                <button
                  type="button"
                  className="btn soft"
                  title={s.copied}
                  onClick={() => copy(value, s.copied)}
                >
                  {masked && !revealed[key] ? maskValue(value) : value}
                </button>
                {masked ? (
                  <button type="button" className="btn soft" onClick={() => reveal(key)}>
                    {revealed[key] ? s.hide : s.reveal}
                  </button>
                ) : null}
              </p>
            </div>
          );
        })
      ) : canEdit ? (
        <button type="button" className="btn brand" onClick={() => setEditing(true)}>
          {s.addDetails}
        </button>
      ) : (
        <p className="faint">{s.empty}</p>
      )}
      {card?.updatedAt && filled ? (
        <p className="faint">
          {fill(s.updatedAgo, {
            when: when(locale, card.updatedAt),
            name: card.updatedByName
              ? locale.startsWith('en')
                ? ` by ${card.updatedByName}`
                : card.updatedByName
              : '',
          })}
        </p>
      ) : null}
    </div>
  );
}

const FIELD_MAX: Partial<Record<DetailKey, number>> = { address: 300, note: 500 };

function DetailsForm({
  title,
  initial,
  onClose,
  onSave,
}: {
  title: string;
  initial: DetailsValues | undefined;
  onClose: () => void;
  onSave: (values: DetailsValues) => Promise<unknown>;
}) {
  const { t } = useStrings();
  const s = t.company.vendors.details;
  const labels: Record<DetailKey, string> = {
    bankName: s.accountName,
    bankAccount: s.accountNumber,
    ifsc: s.ifsc,
    upi: s.upi,
    address: s.address,
    phone: s.phone,
    email: s.email,
    gstin: s.gstin,
    pan: s.pan,
    note: s.note,
  };
  const [draft, setDraft] = useState<Record<string, string>>(
    Object.fromEntries(ROWS.map((k) => [k, initial?.[k] ?? ''])),
  );
  const [bad, setBad] = useState<DetailKey[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    const values = cleanDetails(draft as unknown as DetailsValues);
    const invalid = invalidDetailKeys(values);
    setBad(invalid);
    if (invalid.length || saving) return;
    setSaving(true);
    setError(null);
    onSave(values)
      .then(onClose)
      .catch((caught: unknown) =>
        setError(friendlyError(caught, 'web.company.details.save', { fallback: s.saveFailed })),
      )
      .finally(() => setSaving(false));
  };

  const field = (key: DetailKey) => (
    <label key={key} className="field">
      <span className="field-label">{labels[key]}</span>
      {key === 'note' ? (
        <textarea
          className="textarea"
          value={draft[key]}
          maxLength={FIELD_MAX[key]}
          onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
        />
      ) : (
        <input
          value={draft[key]}
          maxLength={FIELD_MAX[key] ?? 120}
          inputMode={key === 'bankAccount' ? 'numeric' : key === 'phone' ? 'tel' : undefined}
          type={key === 'email' ? 'email' : 'text'}
          onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
        />
      )}
      {bad.includes(key) ? (
        <span className="error">{fill(s.invalidField, { field: labels[key] })}</span>
      ) : null}
    </label>
  );

  return (
    <div>
      <h3>{title}</h3>
      <h4>{s.bank}</h4>
      {ROWS.slice(0, 4).map(field)}
      <h4>{s.contact}</h4>
      {ROWS.slice(4).map(field)}
      {error ? <p className="error">{error}</p> : null}
      <div className="row-field">
        <button type="button" className="btn brand" disabled={saving} onClick={save}>
          {s.save}
        </button>
        <button type="button" className="btn soft" onClick={onClose}>
          {t.company.vendors.close}
        </button>
      </div>
    </div>
  );
}
