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

import { useStrings } from '@/i18n-context';

/** Same alphabet as the database's `referral_codes_shape` (no 0, O, 1, I, L). */
const CODE_SHAPE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/;

const PLAY_URL = 'https://play.google.com/store/apps/details?id=app.waves.mobile';
const APP_STORE_URL = 'https://apps.apple.com/app/id6813446645';

export default function ReferralLandingPage() {
  const { t } = useStrings();
  const params = useParams<{ code: string }>();
  const code = (params.code ?? '').toUpperCase();

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
          <p style={{ fontSize: 22, fontWeight: 700, letterSpacing: 2 }}>{code}</p>
        </div>

        <a className="btn block lg" href={`waves://r/${code}`}>
          {t.referral.openApp}
        </a>
        <a className="btn soft block" href={PLAY_URL} rel="noopener noreferrer">
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
