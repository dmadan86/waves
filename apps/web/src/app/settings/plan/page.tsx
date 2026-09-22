'use client';

/**
 * What this account is on, and what it would ever cost.
 *
 * "Plan", not "Upgrade": the page sells nothing, so a label promising a
 * purchase would be a label the product cannot keep. It exists because the
 * question is real — somebody looking through settings for what they are paying
 * deserves an answer, and no row at all reads as an answer being avoided.
 *
 * The wording is the phone's, section for section, because a person who has
 * read this on their phone and then reads it in a browser should find the same
 * promise rather than a second, vaguer one. Two things would ever cost money
 * and one thing never will, and the ledger is the one that never will: groups,
 * expenses, splits, balances, settling up, and getting every bit of it back out
 * again. A ledger you can only half read is not a ledger (ADR-011).
 *
 * Redeeming a code lives at the foot of this page rather than at the top level
 * of settings, which is where the phone files it and the only place it makes
 * sense: a code is a thing that changes your plan.
 */

import Link from 'next/link';
import { ChevronRight, CloudDownload, LockOpen, ScanLine } from 'lucide-react';

import { AppFrame } from '@/components/AppFrame';
import { Section } from '@/components/Shell';
import { useStrings } from '@/i18n-context';
import { fill } from '@/i18n';

export default function PlanPage() {
  return <AppFrame current={Section.Settings}>{() => <Plan />}</AppFrame>;
}

function Plan() {
  const { t } = useStrings();

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{t.billing.title}</h1>
          <div className="sub">{t.billing.nothingToBuy}</div>
        </div>
      </div>

      <section className="panel">
        <p className="meta">{t.billing.nothingToBuyBody}</p>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>{t.billing.whatWouldCost}</h2>
        </div>
        <div className="list">
          <div className="device-row">
            <ScanLine size={18} strokeWidth={1.75} aria-hidden />
            <span className="grow">
              <span className="title">{t.billing.moreScans}</span>
              <span className="meta">{t.billing.moreScansBody}</span>
            </span>
          </div>
          <div className="device-row">
            <CloudDownload size={18} strokeWidth={1.75} aria-hidden />
            <span className="grow">
              <span className="title">{t.billing.biggerTransfers}</span>
              <span className="meta">{t.billing.biggerTransfersBody}</span>
            </span>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>
            <LockOpen size={16} strokeWidth={2} aria-hidden /> {t.billing.whatNeverWill}
          </h2>
        </div>
        <p className="meta">
          {fill(t.billing.whatNeverWillBody, { free: t.billing.freeForever.toLowerCase() })}
        </p>
      </section>

      <section className="panel">
        <Link className="item" href="/settings/redeem">
          <span className="grow">
            <span className="title">{t.promo.row}</span>
            <span className="meta">{t.promo.rowHint}</span>
          </span>
          <ChevronRight size={16} strokeWidth={1.75} aria-hidden />
        </Link>
      </section>

      <p className="faint">
        <Link className="plain-link" href="/settings">
          {t.settings.title}
        </Link>
      </p>
    </div>
  );
}
