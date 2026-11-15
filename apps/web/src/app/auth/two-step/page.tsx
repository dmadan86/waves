'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { AppFrame } from '@/components/AppFrame';
import { Section } from '@/components/Shell';
import { useStrings } from '@/i18n-context';
import { invokeErrorCode, safeNext } from '@/lib/twoStep';
import { supabase } from '@/lib/waves';

export default function TwoStepPage() {
  return (
    <AppFrame current={Section.Companies}>
      {() => (
        <Suspense>
          <Verify />
        </Suspense>
      )}
    </AppFrame>
  );
}

function Verify() {
  const { t } = useStrings();
  const s = t.company.twoStep;
  const router = useRouter();
  const next = safeNext(useSearchParams().get('next'));
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    const { error: failure } = await supabase.functions.invoke('two-step-verify', {
      body: { code },
    });
    if (!failure) {
      router.replace(next);
      return;
    }
    const known = await invokeErrorCode(failure);
    setError(
      known === 'BAD_CODE'
        ? s.badCode
        : known === 'LOCKED'
          ? s.locked
          : known === 'RATE_LIMITED'
            ? s.rateLimited
            : known === 'NO_FACTOR'
              ? s.noFactor
              : s.failed,
    );
    setBusy(false);
  }

  return (
    <div className="app-body">
      <div className="app-main">
        <div className="page-head">
          <h1>{s.title}</h1>
          <div className="sub">{s.codeIntro}</div>
        </div>
        <form
          className="panel"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <input
            aria-label={s.codeLabel}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
          />
          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : null}
          <button type="submit" className="btn" disabled={busy || code.length !== 6}>
            {s.verify}
          </button>
        </form>
      </div>
      <aside className="detail" />
    </div>
  );
}
