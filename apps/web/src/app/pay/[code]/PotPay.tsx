'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import type { PotPayInfo } from '@waves/api-client';

import { fill } from '@/i18n';
import { useStrings } from '@/i18n-context';
import { waves } from '@/lib/waves';
import { money } from '@/lib/money';
import { friendlyError } from '@/lib/errors';
import { potPayUri, potReportInput } from '@/lib/potPay';

export function PotPay({ code }: { code: string }) {
  const { t } = useStrings();
  const [info, setInfo] = useState<PotPayInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payerName, setPayerName] = useState('');
  const [utr, setUtr] = useState('');
  const [saving, setSaving] = useState(false);
  const [sent, setSent] = useState(false);
  const submitting = useRef(false);

  useEffect(() => {
    let active = true;
    void waves
      .potPayLookup(code)
      .then(
        (data) => {
          if (active) setInfo(data);
        },
        (caught) => {
          if (active)
            setError(
              friendlyError(caught, 'web.potPay.lookup', {
                fallback: t.errors.couldNotLoad,
                offline: t.errors.offline,
                tooMany: t.errors.tooMany,
              }),
            );
        },
      )
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [code, t.errors]);

  async function report(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || sent) return;
    const input = potReportInput(payerName, utr);
    if (input.error) {
      setError(t.potPay[input.error]);
      return;
    }
    submitting.current = true;
    setSaving(true);
    setError(null);
    try {
      const accepted = await waves.potPaySelfReport(code, input.name, input.reference);
      // False includes closed links, unmatched names and silent rate limiting.
      // Never infer receipt, or expose which of these happened.
      if (accepted) setSent(true);
      else setError(`${t.potPay.notSent} ${t.errors.tooMany}`);
    } catch (caught) {
      setError(
        friendlyError(caught, 'web.potPay.report', {
          fallback: t.potPay.notSent,
          offline: t.errors.offline,
          tooMany: t.errors.tooMany,
        }),
      );
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  return (
    <main style={{ maxWidth: 480, margin: '40px auto', padding: 20 }}>
      <section className="panel">
        <h1>{t.potPay.title}</h1>
        {loading ? (
          <p role="status">{t.potPay.loading}</p>
        ) : !info ? (
          <p>{t.potPay.notFound}</p>
        ) : (
          <>
            <PotPaymentDetails info={info} code={code} />
            {sent ? (
              <p role="status">{fill(t.potPay.sent, { payee: info.payeeName })}</p>
            ) : (
              <form className="settle-form" onSubmit={report}>
                <label style={{ display: 'block', marginBottom: 12 }}>
                  <span className="k">{t.potPay.payerName}</span>
                  <input
                    className="split-input"
                    style={{ width: '100%' }}
                    value={payerName}
                    onChange={(event) => setPayerName(event.target.value)}
                    required
                    maxLength={100}
                    autoComplete="name"
                    disabled={saving}
                  />
                </label>
                <label style={{ display: 'block', marginBottom: 12 }}>
                  <span className="k">{t.potPay.utr}</span>
                  <input
                    className="split-input"
                    style={{ width: '100%' }}
                    value={utr}
                    onChange={(event) => setUtr(event.target.value)}
                    maxLength={64}
                    autoCapitalize="characters"
                    spellCheck={false}
                    disabled={saving}
                  />
                </label>
                <button className="btn" type="submit" disabled={saving}>
                  {saving ? t.potPay.sending : t.potPay.paid}
                </button>
              </form>
            )}
          </>
        )}
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
      </section>
    </main>
  );
}

export function PotPaymentDetails({ info, code }: { info: PotPayInfo; code: string }) {
  const { t, locale } = useStrings();
  const uri = potPayUri(info, code);
  return (
    <>
      <h2>{info.potName}</h2>
      {info.groupName ? <p className="muted">{info.groupName}</p> : null}
      <div className="detail-field">
        <span className="k">{t.potPay.perHead}</span>
        <span className="v amount">{money(BigInt(info.perHeadMinor), info.currency, locale)}</span>
      </div>
      <p>{fill(t.potPay.payee, { name: info.payeeName })}</p>
      {uri ? (
        <>
          <div
            style={{ background: '#fff', padding: 16, width: 'fit-content', margin: '16px auto' }}
          >
            <QRCodeSVG value={uri} size={224} title={t.potPay.openUpi} />
          </div>
          <a className="btn soft block" href={uri}>
            {t.potPay.openUpi}
          </a>
        </>
      ) : (
        <p className="muted">{t.potPay.noUpi}</p>
      )}
    </>
  );
}
