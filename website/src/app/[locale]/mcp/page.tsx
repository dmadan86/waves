import type { Metadata } from 'next';
import Link from 'next/link';
import { Fragment } from 'react';
import { notFound } from 'next/navigation';

import Image from 'next/image';

import { ClientMark, clientOrder } from '@/components/client-icons';
import { CopyCode } from '@/components/copy-code';
import { ArrowRight, Check, Lock, Plug } from '@/components/icons';
import { Wordmark } from '@/components/logo';
import { McpSetup, type SetupTab } from '@/components/mcp-setup';
import {
  AddressVisual,
  ApproveVisual,
  Ban,
  ChatVisual,
  FlowArrow,
  Gear,
  HeroArt,
  Shield,
} from '@/components/mcp-visuals';
import { Container, Kicker } from '@/components/ui';
import { htmlLang, isLocale, locales } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { mcpEndpoint, mcpMetadataUrl, mcpTools } from '@/lib/mcp-tools';
import { absoluteUrl, site } from '@/lib/site';

/**
 * How somebody points their own AI agent at their own Waves ledger.
 *
 * This is a help page, not a pitch, and the thing it has to get right is the
 * part people cannot check for themselves: what an agent connected this way can
 * reach, and what it can never do. Somebody deciding whether to hand an
 * assistant their money records is owed that in plain words, before any of the
 * setup.
 *
 * It is written to be *current* rather than aspirational. It once said the
 * sign-in flow was not switched on, because it was not; the OAuth server was
 * enabled on 2026-09-19 and that section was rewritten in the same change. If
 * the flow is ever turned off again, this page is part of turning it off.
 *
 * The tool list is the real one, read from `apps/agent-mcp/src/tools.ts` and
 * mirrored in `lib/mcp-tools.ts`. If a tool is added or removed there, it
 * changes here — a stale list on a page about what software may touch is a
 * promise we are not keeping.
 *
 * The page follows the design in "Waves AI Assistant Guide". Where the mock-up
 * said something the code does not do ("your data stays private", "nothing is
 * spent without approval"), the words here are the ones that are true. The
 * disconnect steps describe the Connected apps screen in the app and on the
 * web (Supabase Auth's OAuth grants), so they stay in step with it.
 *
 * The page is translated like the rest of the site (`mcpPage` in the
 * dictionaries). Code, tool names and the endpoint are never translated.
 */

/** When the content last changed. Bump it with any edit to the claims. */
const UPDATED = new Date('2026-10-15T00:00:00Z');

/** Where the server answers. One string, used in prose and in the snippets. */
const ENDPOINT = mcpEndpoint(site.appUrl);

/** The public source of the server, and the part of its README on running it. */
const SELF_HOST_URL = 'https://github.com/dmadan86/waves/tree/main/apps/agent-mcp#self-hosting';

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = await getDictionary(locale);
  return {
    title: t.mcpPage.metaTitle,
    description: t.mcpPage.metaDescription,
    alternates: { canonical: absoluteUrl(`/${locale}/mcp`) },
  };
}

/** Config snippets are code: identical in every language. */
const snippets = {
  claude: `claude mcp add --transport http waves ${ENDPOINT}`,
  cursor: JSON.stringify({ mcpServers: { waves: { url: ENDPOINT } } }, null, 2),
  vscode: JSON.stringify({ servers: { waves: { type: 'http', url: ENDPOINT } } }, null, 2),
  other: `curl -i -X POST ${ENDPOINT} \\\n  -H 'content-type: application/json' -d '{}'`,
};

const h2 = 'text-[1.35rem] font-bold tracking-[-0.025em] text-ink sm:text-[1.6rem]';
const lead = 'mt-1.5 max-w-3xl text-[0.9rem] leading-[1.6] text-ink-2';
const card = 'rounded-2xl bg-surface shadow-[var(--w-shadow-card)]';

const navLinks = [
  ['features', '#features'],
  ['how', '#how'],
  ['agents', ''],
  ['pricing', '#pricing'],
  ['faq', '#faq'],
] as const;

export default async function McpPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = await getDictionary(locale);
  const m = t.mcpPage;

  const updated = new Intl.DateTimeFormat(htmlLang[locale], {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(UPDATED);

  const tabs: SetupTab[] = m.tabs.map((tab) => {
    const base: SetupTab = { id: tab.id, name: tab.name, steps: tab.steps };
    const snippetLabel = 'snippetLabel' in tab ? tab.snippetLabel : undefined;
    const after = 'after' in tab ? tab.after : undefined;
    const snippet = (snippets as Record<string, string | undefined>)[tab.id];
    return {
      ...base,
      snippet,
      snippetLabel,
      after,
      ...(tab.id === 'other'
        ? {
            extra: {
              label: ('metaLabel' in tab ? tab.metaLabel : undefined) ?? '',
              code: mcpMetadataUrl(site.appUrl),
            },
          }
        : {}),
    };
  });

  const copyProps = { copyLabel: m.copyLabel, copy: m.copy, copied: m.copied };
  const rows = [
    ...mcpTools.filter((tool) => tool.kind === 'read'),
    ...mcpTools.filter((tool) => tool.kind === 'write'),
  ];
  const featureIcons = ['/mcp/f1.webp', '/mcp/f2.webp', '/mcp/f3.webp'];
  const revokeIcons = [Gear, Shield, Ban];

  return (
    <>
      <header className="border-b border-line/70">
        <Container className="flex h-14 items-center justify-between gap-4">
          <Link href={`/${locale}`} aria-label={site.name} className="shrink-0">
            <Wordmark />
          </Link>
          <nav aria-label="Primary" className="hidden items-center gap-1 lg:flex">
            {navLinks.map(([key, hash]) =>
              hash === '' ? (
                <span
                  key={key}
                  aria-current="page"
                  className="inline-flex h-9 items-center rounded-lg bg-accent-wash px-3 text-[0.84rem] font-semibold whitespace-nowrap text-accent"
                >
                  {t.nav[key]}
                </span>
              ) : (
                <Link
                  key={key}
                  href={`/${locale}${hash}`}
                  className="inline-flex h-9 items-center rounded-lg px-3 text-[0.84rem] whitespace-nowrap text-ink-2 transition-colors hover:bg-chip hover:text-ink"
                >
                  {t.nav[key]}
                </Link>
              ),
            )}
          </nav>
          <div className="flex items-center gap-3">
            <span
              aria-current="page"
              className="hidden h-8 items-center rounded-lg bg-accent-wash px-2.5 text-[0.8rem] font-semibold whitespace-nowrap text-accent sm:inline-flex lg:hidden"
            >
              {t.nav.agents}
            </span>
            <Link
              href={`/${locale}#download`}
              className="inline-flex h-9 items-center rounded-full bg-accent px-4 text-[0.84rem] font-semibold whitespace-nowrap text-accent-ink shadow-[0_8px_20px_rgb(122_90_248_/_0.3)]"
            >
              {t.nav.download}
            </Link>
          </div>
        </Container>
      </header>

      <main id="main" tabIndex={-1} className="pb-16">
        {/* Hero */}
        <section className="agents-card border-b border-line/60 py-8 sm:py-10">
          <Container className="grid items-center gap-8 lg:grid-cols-[1.15fr_1fr]">
            <div className="min-w-0">
              <Kicker className="inline-flex items-center gap-1.5">
                <Plug className="h-3.5 w-3.5" />
                {m.eyebrow}
              </Kicker>
              <h1 className="mt-2.5 text-balance text-[2rem] leading-[1.08] font-bold tracking-[-0.035em] text-ink sm:text-[2.6rem]">
                {m.titleStart} <span className="text-accent">{m.titleAccent}</span>
              </h1>
              <p className="mt-3 max-w-xl text-pretty text-[0.95rem] leading-[1.6] text-ink-2">
                {m.subtitle}
              </p>
              <div className="mt-5 max-w-xl rounded-2xl bg-surface p-3 shadow-[var(--w-shadow-card)]">
                <CopyCode code={ENDPOINT} label={m.endpointLabel} inline compact {...copyProps} />
              </div>
              <ul className="mt-4 flex flex-wrap items-center gap-2">
                <li className="me-1 text-[0.78rem] text-ink-3">{m.clientsLabel}</li>
                {m.clients.map((name, i) => (
                  <li
                    key={name}
                    className="inline-flex h-8 items-center gap-1.5 rounded-full bg-surface px-3 text-[0.78rem] font-medium text-ink shadow-[var(--w-shadow-sm)]"
                  >
                    <ClientMark id={clientOrder[i]} className="h-3.5 w-3.5" />
                    {name}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[0.75rem] text-ink-3">
                {m.updated} · {updated}
              </p>
            </div>
            <HeroArt card={m.heroCard as [string, string, string]} />
          </Container>
        </section>

        <Container className="space-y-10 pt-9 sm:space-y-12 sm:pt-11">
          {/* What it is */}
          <section
            aria-labelledby="what"
            className="grid items-center gap-4 lg:grid-cols-[1fr_20rem]"
          >
            <div className="flex items-center gap-4">
              <Image
                src="/mcp/brain.webp"
                alt=""
                width={82}
                height={82}
                className="h-16 w-16 shrink-0 rounded-2xl sm:h-20 sm:w-20"
              />
              <div>
                <h2 id="what" className={h2}>
                  {m.whatTitle}
                </h2>
                <p className="mt-1.5 text-[0.85rem] leading-[1.6] text-ink-2">{m.what}</p>
              </div>
            </div>
            <ul
              className={`${card} grid grid-cols-3 divide-x divide-line/70 rtl:divide-x-reverse px-1 py-3`}
            >
              {m.features.map((label, i) => (
                <li key={label} className="flex flex-col items-center gap-1.5 px-2 text-center">
                  <Image
                    src={featureIcons[i]}
                    alt=""
                    width={44}
                    height={40}
                    className="h-10 w-11"
                  />
                  <span className="text-[0.72rem] leading-[1.3] font-medium text-ink-2">
                    {label}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {/* Sign in */}
          <section aria-labelledby="signin">
            <h2 id="signin" className={h2}>
              {m.signinTitle}
            </h2>
            <p className={lead}>{m.signinIntro}</p>
            <ol className="mt-4 grid gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr] md:items-stretch">
              {m.signin.map(([title, body], i) => (
                <Fragment key={title}>
                  <li className={`${card} min-w-0 p-4`}>
                    <div className="flex items-start gap-3">
                      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-[0.8rem] font-bold text-accent-ink">
                        {i + 1}
                      </span>
                      <div>
                        <h3 className="text-[0.95rem] font-semibold text-ink">{title}</h3>
                        <p className="mt-1 text-[0.82rem] leading-[1.5] text-ink-2">{body}</p>
                      </div>
                    </div>
                    {i === 0 ? <AddressVisual address={ENDPOINT} /> : null}
                    {i === 1 ? <ApproveVisual approve={m.signinVisual.approve} /> : null}
                    {i === 2 ? (
                      <ChatVisual
                        ask={m.signinVisual.ask}
                        done={m.signinVisual.done}
                        doneSub={m.signinVisual.doneSub}
                      />
                    ) : null}
                  </li>
                  {i < 2 ? (
                    <li aria-hidden="true" className="hidden items-center md:flex">
                      <FlowArrow />
                    </li>
                  ) : null}
                </Fragment>
              ))}
            </ol>
            <p className="mt-3 flex max-w-3xl items-start gap-2 text-[0.8rem] leading-[1.55] text-ink-2">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
              {m.signinNote}
            </p>
          </section>

          {/* Setup */}
          <section aria-labelledby="setup">
            <h2 id="setup" className={h2}>
              {m.setupTitle}
            </h2>
            <p className={lead}>{m.setupIntro}</p>
            <div className={`${card} mt-4 p-4 sm:p-5`}>
              <McpSetup
                tabs={tabs}
                endpoint={ENDPOINT}
                endpointLabel={m.endpointLabel}
                label={m.setupTitle}
                {...copyProps}
              />
            </div>
          </section>

          {/* Tools */}
          <section aria-labelledby="tools">
            <h2 id="tools" className={h2}>
              {m.toolsTitle}
            </h2>
            <p className={lead}>{m.toolsIntro}</p>
            <div className="mt-4 grid items-start gap-4 lg:grid-cols-[1fr_15.5rem]">
              <div className={`${card} overflow-hidden`}>
                <div
                  aria-hidden="true"
                  className="hidden grid-cols-[11.5rem_1fr_3.75rem] gap-3 bg-chip px-4 py-2 text-[0.68rem] font-semibold tracking-[0.06em] text-ink-3 uppercase sm:grid rtl:tracking-normal"
                >
                  <span>{m.colTool}</span>
                  <span>{m.colDoes}</span>
                  <span>{m.colKind}</span>
                </div>
                <ul>
                  {rows.map((tool) => (
                    <li
                      key={tool.name}
                      className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-0.5 border-t border-line/60 px-4 py-2 first:border-t-0 sm:grid-cols-[11.5rem_1fr_3.75rem] sm:first:border-t"
                    >
                      <code
                        dir="ltr"
                        className="text-start font-mono text-[0.74rem] font-medium text-ink"
                      >
                        {tool.name}
                      </code>
                      <span
                        className={`inline-flex h-5 w-fit items-center justify-self-end rounded-md px-2 text-[0.68rem] font-semibold sm:order-3 sm:justify-self-start ${
                          tool.kind === 'read'
                            ? 'bg-blue/10 text-blue'
                            : 'bg-accent-wash text-accent'
                        }`}
                      >
                        {tool.kind === 'read' ? m.read : m.write}
                      </span>
                      <span className="col-span-2 text-[0.78rem] leading-[1.4] text-ink-2 sm:order-2 sm:col-span-1">
                        {m.toolDoes[tool.name]}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <aside className="agents-card flex flex-col items-center rounded-2xl p-5 text-center shadow-[var(--w-shadow-card)] lg:sticky lg:top-4">
                <Image
                  src="/mcp/tools.webp"
                  alt=""
                  width={165}
                  height={128}
                  className="h-auto w-40"
                />
                <h3 className="mt-2 text-[1rem] leading-[1.3] font-bold text-ink">
                  {m.toolsCardTitle}
                </h3>
                <p className="mt-1.5 text-[0.78rem] leading-[1.5] text-ink-2">{m.toolsCardBody}</p>
              </aside>
            </div>
            <p className="mt-2.5 text-[0.78rem] text-ink-3">{m.toolsNote}</p>
          </section>

          {/* Never */}
          <section aria-labelledby="never">
            <h2 id="never" className={h2}>
              {m.neverTitle}
            </h2>
            <ul className="mt-4 grid gap-3 md:grid-cols-2">
              {m.never.map(([title, body]) => (
                <li key={title} className={`${card} flex items-start gap-3.5 p-4`}>
                  <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-down/10 text-down">
                    <Ban className="h-6 w-6" />
                  </span>
                  <div>
                    <h3 className="text-[0.95rem] font-semibold text-ink">{title}</h3>
                    <p className="mt-1 text-[0.8rem] leading-[1.55] text-ink-2">{body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {/* Disconnect */}
          <section aria-labelledby="revoke">
            <h2 id="revoke" className={h2}>
              {m.revokeTitle}
            </h2>
            <p className={lead}>{m.revokeIntro}</p>
            <div className="mt-4 grid items-center gap-4 lg:grid-cols-[1fr_11rem]">
              <ol
                className={`${card} grid gap-3 p-4 md:grid-cols-[1fr_auto_1fr_auto_1fr] md:items-center`}
              >
                {m.revokeSteps.map(([title, body], i) => {
                  const Icon = revokeIcons[i];
                  return (
                    <Fragment key={title}>
                      <li className="flex items-start gap-3">
                        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-wash text-accent">
                          <Icon className="h-5 w-5" />
                        </span>
                        <div>
                          <h3 className="text-[0.88rem] font-semibold text-ink">
                            {i + 1}. {title}
                          </h3>
                          <p className="mt-0.5 text-[0.76rem] leading-[1.45] text-ink-2">{body}</p>
                        </div>
                      </li>
                      {i < 2 ? (
                        <li aria-hidden="true" className="hidden md:block">
                          <FlowArrow />
                        </li>
                      ) : null}
                    </Fragment>
                  );
                })}
              </ol>
              <Image
                src="/mcp/plug.webp"
                alt=""
                width={130}
                height={90}
                className="mx-auto hidden h-auto w-40 lg:block"
              />
            </div>
            <p className="mt-2.5 max-w-3xl text-[0.78rem] leading-[1.55] text-ink-3">
              {m.revokeNote}
            </p>
          </section>

          {/* Self-hosted */}
          <section
            aria-labelledby="self"
            className="grid items-center gap-5 lg:grid-cols-[1fr_1.1fr]"
          >
            <div>
              <h2 id="self" className={h2}>
                {m.selfTitle}
              </h2>
              <p className="mt-2 text-[0.88rem] leading-[1.6] text-ink-2">{m.selfBody}</p>
              <a
                href={SELF_HOST_URL}
                target="_blank"
                rel="noreferrer"
                className="group mt-3 inline-flex items-center gap-1.5 rounded-xs text-[0.88rem] font-semibold text-accent"
              >
                {m.selfLink}
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5" />
              </a>
            </div>
            <div className="agents-card flex items-center gap-4 rounded-2xl p-4 shadow-[var(--w-shadow-card)]">
              <Image
                src="/mcp/server.webp"
                alt=""
                width={140}
                height={95}
                className="h-auto w-32 shrink-0"
              />
              <ul className="space-y-2">
                {m.selfChecks.map((c) => (
                  <li key={c} className="flex items-center gap-2 text-[0.8rem] text-ink">
                    <Check className="h-4 w-4 shrink-0 text-accent" />
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {/* FAQ */}
          <section aria-labelledby="faq">
            <div className="flex items-baseline justify-between gap-4">
              <h2 id="faq" className={h2}>
                {m.faqTitle}
              </h2>
              <Link
                href={`/${locale}#faq`}
                className="group inline-flex items-center gap-1 text-[0.84rem] font-semibold whitespace-nowrap text-accent"
              >
                {m.faqAll}
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5" />
              </Link>
            </div>
            <div className="mt-4 grid items-start gap-2.5 md:grid-cols-2">
              {m.faq.map(([q, a]) => (
                <details key={q} className={`group ${card}`}>
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 text-start text-[0.88rem] font-medium text-ink [&::-webkit-details-marker]:hidden">
                    {q}
                    <span
                      aria-hidden="true"
                      className="text-lg leading-none text-accent transition-transform group-open:rotate-45"
                    >
                      +
                    </span>
                  </summary>
                  <p className="px-4 pb-3.5 text-[0.82rem] leading-[1.6] text-ink-2">{a}</p>
                </details>
              ))}
            </div>
          </section>

          <p className="text-[0.88rem] text-ink-2">
            {m.contact}{' '}
            <a
              className="rounded-xs text-ink underline decoration-line-strong underline-offset-4 transition-colors hover:decoration-accent"
              href={`mailto:${site.supportEmail}`}
            >
              {site.supportEmail}
            </a>
          </p>
        </Container>
      </main>
    </>
  );
}
