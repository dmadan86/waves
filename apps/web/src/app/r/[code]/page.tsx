'use client';

/**
 * `/r/<CODE>` — a friend's personal link, for somebody who may not have Waves.
 *
 * Says what Waves is and where to get it, and offers to open the app. It is the
 * landing for a link shared from the invite screen in the app; where the app is
 * installed, the OS opens the app directly (the path is claimed in
 * `assetlinks.json` and the Apple site association) and this page is not seen.
 *
 * Nothing here is a reward for installing: the days follow real use of Waves,
 * which the perk line says, and nothing asks for a rating or a review. Group
 * invites and the guest flows are untouched — `/join` stays exactly as it was.
 */

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';

import { useStrings } from '@/i18n-context';
import { APP_STORE_URL, playStoreUrl } from '@/lib/storeLinks';

/** Same alphabet as the database's `referral_codes_shape` (no 0, O, 1, I, L). */
const CODE_SHAPE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/;

export default function ReferralLandingPage() {
  const { t } = useStrings();
  const params = useParams<{ code: string }>();
  const code = (params.code ?? '').toUpperCase();
  const [copied, setCopied] = useState(false);

  // iOS has no install referrer: the friend copies the code here and pastes it
  // into the app. Failure to copy is silent; the code is on screen to read.
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // The code is still on screen.
    }
  };

  if (!CODE_SHAPE.test(code)) {
    return (
      <main className="guest">
        <div className="card">
          <h1>{t.join.linkBroken}</h1>
          <p className="faint">{t.referral.linkBroken}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="guest">
      <div className="card" style={{ display: 'grid', gap: 14 }}>
        <h1>{t.referral.heading}</h1>
        <p className="muted">{t.referral.body}</p>
        <p>{t.referral.perk}</p>

        <div>
          <p className="faint">{t.referral.codeLabel}</p>
          <p
            style={{
              fontSize: 32,
              fontWeight: 700,
              letterSpacing: 4,
              lineHeight: 1.2,
              margin: '4px 0 12px',
            }}
          >
            {code}
          </p>
          <button type="button" className="btn soft" onClick={() => void copy()} aria-live="polite">
            {copied ? t.referral.codeCopied : t.referral.copyCode}
          </button>
        </div>

        <a className="btn block lg" href={`waves://r/${code}`}>
          {t.referral.openApp}
        </a>
        <a className="btn soft block" href={playStoreUrl(code)} rel="noopener noreferrer">
          {t.referral.googlePlay}
        </a>
        <a className="btn soft block" href={APP_STORE_URL} rel="noopener noreferrer">
          {t.referral.appStore}
        </a>
        <p className="faint">{t.referral.enterCode}</p>
        <Link href="/" className="faint">
          {t.referral.useOnWeb}
        </Link>
      </div>
    </main>
  );
}
