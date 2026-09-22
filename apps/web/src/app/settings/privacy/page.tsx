'use client';

/**
 * What is held about you, and who else can see it.
 *
 * The phone splits Settings and Privacy on a line worth keeping in both
 * clients: Settings is where you change how the app behaves and where you end
 * things; Privacy is where you find out what is held about you and decide who
 * else can reach it. The browser had the *controls* — discovery had its own
 * page, deletion had its own page — and none of the finding out. A settings
 * list that offers "who can find me" without ever saying what is stored is
 * asking somebody to make a privacy decision with the facts withheld.
 *
 * So this page is the phone's, with two deliberate differences, both because a
 * browser is not a phone and saying otherwise would be the one thing a privacy
 * page must not do:
 *
 *   * **There is no "on this device" section.** The phone keeps a sealed copy
 *     of the ledger and can describe the seal. This page keeps a session and
 *     nothing else, and inventing a paragraph about it would be inventing a
 *     protection.
 *   * **There is no screen-recording switch.** The phone can be recorded by
 *     Clarity if you turn it on; this site carries no analytics tag at all, and
 *     Sentry here is explicitly configured with no session replay. A switch
 *     that governs nothing is worse than an absent one — it implies there is
 *     something to turn off.
 *
 * Each section leads with its summary and opens to the full paragraph, the same
 * way round as the phone: somebody skimming gets six true sentences, and
 * somebody who wants the detail asks for it one section at a time rather than
 * being handed a policy.
 */

import { useState } from 'react';
import Link from 'next/link';
import {
  ChevronRight,
  Clock,
  Cloud,
  FileText,
  Hand,
  Lock,
  MessageSquare,
  type LucideIcon,
} from 'lucide-react';

import { AppFrame } from '@/components/AppFrame';
import { Section } from '@/components/Shell';
import { useStrings } from '@/i18n-context';
import { fill } from '@/i18n';

/**
 * When the words below last changed.
 *
 * A date somebody can check beats "we may update this from time to time". It is
 * a constant rather than a build stamp because a redeploy is not a policy
 * change, and a date that moves on its own teaches people to ignore it.
 */
const POLICY_UPDATED = '2026-09-22';

export default function PrivacyPage() {
  return <AppFrame current={Section.Settings}>{() => <Privacy />}</AppFrame>;
}

function Privacy() {
  const { t, locale } = useStrings();
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const sections: { id: string; Icon: LucideIcon; title: string; summary: string; body: string }[] =
    [
      {
        id: 'store',
        Icon: FileText,
        title: t.privacy.storeTitle,
        summary: t.privacy.storeSummary,
        body: t.privacy.storeBody,
      },
      {
        id: 'protect',
        Icon: Lock,
        title: t.privacy.protectTitle,
        summary: t.privacy.protectSummary,
        body: t.privacy.protectBody,
      },
      {
        id: 'services',
        Icon: Cloud,
        title: t.privacy.servicesTitle,
        summary: t.privacy.servicesSummary,
        body: t.privacy.servicesBody,
      },
      {
        id: 'retention',
        Icon: Clock,
        title: t.privacy.retentionTitle,
        summary: t.privacy.retentionSummary,
        body: t.privacy.retentionBody,
      },
      {
        id: 'choices',
        Icon: Hand,
        title: t.privacy.choicesTitle,
        summary: t.privacy.choicesSummary,
        body: t.privacy.choicesBody,
      },
    ];

  const controls: { href: string; title: string; hint: string }[] = [
    {
      href: '/settings/discovery',
      title: t.discovery.discoveryRow,
      hint: t.discovery.discoveryRowHint,
    },
    { href: '/settings/export', title: t.exportData.row, hint: t.exportData.rowHint },
    {
      href: '/settings/notifications',
      title: t.notifications.title,
      hint: t.notifications.rowHint,
    },
    { href: '/settings/delete-account', title: t.privacy.deleteRow, hint: t.privacy.deleteRowHint },
  ];

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{t.privacy.title}</h1>
          <div className="sub">{t.privacy.intro}</div>
        </div>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>{t.privacy.controlsSection}</h2>
        </div>
        <div className="list">
          {controls.map((control) => (
            <Link key={control.href} className="item" href={control.href}>
              <span className="grow">
                <span className="title">{control.title}</span>
                <span className="meta">{control.hint}</span>
              </span>
              <ChevronRight size={16} strokeWidth={1.75} aria-hidden />
            </Link>
          ))}
        </div>
      </section>

      {sections.map((section) => {
        const expanded = open[section.id] ?? false;
        return (
          <section key={section.id} className="panel">
            <div className="panel-head">
              <h2>
                <section.Icon size={16} strokeWidth={2} aria-hidden /> {section.title}
              </h2>
            </div>
            <p className="meta">{expanded ? section.body : section.summary}</p>
            <button
              type="button"
              className="linklike"
              aria-expanded={expanded}
              onClick={() => setOpen((was) => ({ ...was, [section.id]: !expanded }))}
            >
              {expanded ? t.privacy.collapseLabel : t.privacy.expandLabel}
            </button>
          </section>
        );
      })}

      <section className="panel">
        <Link className="item" href="/settings/feedback">
          <MessageSquare size={18} strokeWidth={1.75} aria-hidden />
          <span className="grow">
            <span className="title">{t.privacy.supportRow}</span>
            <span className="meta">{t.privacy.supportRowHint}</span>
          </span>
          <ChevronRight size={16} strokeWidth={1.75} aria-hidden />
        </Link>
      </section>

      <p className="faint">{fill(t.privacy.lastUpdated, { date: policyDate(locale) })}</p>

      <p className="faint">
        <Link className="plain-link" href="/settings">
          {t.settings.title}
        </Link>
      </p>
    </div>
  );
}

/**
 * The policy date in the reader's own calendar.
 *
 * Noon, not midnight: a date-only string is parsed as UTC, and midnight UTC is
 * the previous day west of Greenwich — which would print a policy as updated a
 * day before it was.
 */
function policyDate(locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${POLICY_UPDATED}T12:00:00`));
}
