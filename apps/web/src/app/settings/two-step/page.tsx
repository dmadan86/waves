'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';

import { AppFrame } from '@/components/AppFrame';
import { Section } from '@/components/Shell';
import { useStrings } from '@/i18n-context';
import { invokeErrorCode } from '@/lib/twoStep';
import { supabase } from '@/lib/waves';

export default function TwoStepSetupPage() {
  return <AppFrame current={Section.Settings}>{() => <Setup />}</AppFrame>;
}

function Setup() {
  const { t } = useStrings();
  const s = t.company.twoStep;
  const router = useRouter();
  const [start, setStart] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState('');
  const [needProof, setNeedProof] = useState(false);
  const [proof, setProof] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [copied, setCopied] = useState(false);

  async function call(body: object) {
    const { data, error: failure } = await supabase.functions.invoke('two-step-authenticator', {
      body,
    });
    if (!failure) return data as { secret?: string; uri?: string };
    const known = await invokeErrorCode(failure);
    if (known === 'TWO_STEP_REQUIRED') {
      router.replace('/auth/two-step?next=/settings/two-step');
    } else {
      if (known === 'NO_PENDING') setStart(null);
      if (known === 'CODE_REQUIRED') setNeedProof(true);
      else
        setError(
          known === 'BAD_CODE' ? s.badCode : known === 'NO_PENDING' ? s.noPending : s.failed,
        );
    }
    return null;
  }

  async function run(body: object, then: (data: { secret?: string; uri?: string }) => void) {
    setBusy(true);
    setError(null);
    const data = await call(body);
    if (data) then(data);
    setBusy(false);
  }

  return (
    <div className="app-body">
      <div className="app-main">
        <div className="page-head">
          <h1>{s.row}</h1>
          <div className="sub">{s.setupIntro}</div>
        </div>
        <section className="panel">
          {done ? (
            <p>{s.done}</p>
          ) : !start ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void run({ action: 'start', ...(needProof ? { code: proof } : {}) }, (d) =>
                  setStart({ secret: d.secret ?? '', uri: d.uri ?? '' }),
                );
              }}
            >
              {needProof ? (
                <>
                  <p>{s.proveIntro}</p>
                  <input
                    aria-label={s.codeLabel}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={proof}
                    onChange={(event) => setProof(event.target.value.replace(/\D/g, ''))}
                  />
                </>
              ) : null}
              <button
                type="submit"
                className="btn"
                disabled={busy || (needProof && proof.length !== 6)}
              >
                {s.start}
              </button>
            </form>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void run({ action: 'confirm', code }, () => setDone(true));
              }}
            >
              <QRCodeSVG value={start.uri} size={168} />
              <p className="meta">{s.key}</p>
              <code>{start.secret}</code>{' '}
              <button
                type="button"
                className="btn soft"
                onClick={() => {
                  void navigator.clipboard
                    ?.writeText(start.secret)
                    .then(() => setCopied(true))
                    .catch(() => undefined);
                }}
              >
                {copied ? s.copied : s.copy}
              </button>
              <input
                aria-label={s.codeLabel}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
              />
              <button type="submit" className="btn" disabled={busy || code.length !== 6}>
                {s.confirm}
              </button>
            </form>
          )}
          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : null}
        </section>
      </div>
      <aside className="detail" />
    </div>
  );
}
