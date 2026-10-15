import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { CopyCode } from '@/components/copy-code';
import { ArrowRight, Check, Lock, Plug } from '@/components/icons';
import { Wordmark } from '@/components/logo';
import { McpSetup, type SetupTab } from '@/components/mcp-setup';
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
 * The page is translated like the rest of the site (`mcpPage` in the
 * dictionaries). Code, tool names and the endpoint are never translated.
 */

/** When the content last changed. Bump it with any edit to the claims. */
const UPDATED = new Date('2026-10-15T00:00:00Z');

/** Where the server answers. One string, used in prose and in the snippets. */
const ENDPOINT = mcpEndpoint(site.appUrl);

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

const h2 = 'text-[1.5rem] font-bold tracking-[-0.025em] text-ink sm:text-[1.85rem]';
const card = 'rounded-2xl bg-surface p-5 shadow-[var(--w-shadow-card)]';

export default async function McpPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = await getDictionary(locale);
  const m = t.mcpPage;

  const updated = new Intl.DateTimeFormat(htmlLang[locale], {
    dateStyle: 'long',
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
  const reads = mcpTools.filter((tool) => tool.kind === 'read');
  const writes = mcpTools.filter((tool) => tool.kind === 'write');

  return (
    <>
      <header className="border-b border-line/70">
        <Container className="flex h-16 items-center justify-between">
          <Link href={`/${locale}`} aria-label={site.name}>
            <Wordmark />
          </Link>
          <Link
            href={`/${locale}`}
            className="group inline-flex items-center gap-2 rounded-xs text-sm text-ink-2 transition-colors hover:text-ink"
          >
            {t.legal.backHome}
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5" />
          </Link>
        </Container>
      </header>

      <main id="main" tabIndex={-1} className="pb-20">
        {/* Hero */}
        <section className="agents-card border-b border-line/60 py-12 sm:py-16">
          <Container>
            <div className="max-w-3xl">
              <Kicker className="inline-flex items-center gap-2">
                <Plug className="h-4 w-4" />
                {m.eyebrow}
              </Kicker>
              <h1 className="mt-3 text-balance text-[2.1rem] leading-[1.08] font-bold tracking-[-0.035em] text-ink sm:text-[3rem]">
                {m.title}
              </h1>
              <p className="mt-4 text-pretty text-[1.02rem] leading-[1.65] text-ink-2">
                {m.subtitle}
              </p>
            </div>
            <div className="mt-8 max-w-3xl">
              <CopyCode code={ENDPOINT} label={m.endpointLabel} inline {...copyProps} />
            </div>
            <ul className="mt-5 flex flex-wrap items-center gap-2">
              <li className="me-1 text-[0.75rem] font-semibold tracking-[0.1em] text-ink-3 uppercase">
                {m.clientsLabel}
              </li>
              {m.clients.map((name) => (
                <li
                  key={name}
                  className="inline-flex h-9 items-center rounded-full bg-surface px-3.5 text-[0.84rem] font-medium text-ink shadow-[var(--w-shadow-sm)]"
                >
                  {name}
                </li>
              ))}
            </ul>
            <p className="mt-6 font-mono text-[0.72rem] tracking-[0.08em] text-ink-3 uppercase">
              {m.updated} · {updated}
            </p>
          </Container>
        </section>

        <Container className="space-y-14 pt-12 sm:space-y-16 sm:pt-14">
          {/* What it is */}
          <section aria-labelledby="what" className="max-w-3xl">
            <h2 id="what" className={h2}>
              {m.whatTitle}
            </h2>
            <div className="mt-4 space-y-3">
              {m.what.map((p) => (
                <p key={p} className="text-[0.98rem] leading-[1.7] text-ink-2">
                  {p}
                </p>
              ))}
            </div>
          </section>

          {/* Sign in */}
          <section aria-labelledby="signin">
            <h2 id="signin" className={h2}>
              {m.signinTitle}
            </h2>
            <p className="mt-2 max-w-3xl text-[0.98rem] leading-[1.65] text-ink-2">
              {m.signinIntro}
            </p>
            <ol className="mt-6 grid gap-4 md:grid-cols-3">
              {m.signin.map(([title, body], i) => (
                <li key={title} className={card}>
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-ink">
                    {i + 1}
                  </span>
                  <h3 className="mt-3 text-[1.02rem] font-semibold text-ink">{title}</h3>
                  <p className="mt-1.5 text-[0.9rem] leading-[1.6] text-ink-2">{body}</p>
                </li>
              ))}
            </ol>
            <p className="mt-4 flex max-w-3xl items-start gap-2 text-[0.88rem] leading-[1.6] text-ink-2">
              <Lock className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
              {m.signinNote}
            </p>
          </section>

          {/* Setup */}
          <section aria-labelledby="setup">
            <h2 id="setup" className={h2}>
              {m.setupTitle}
            </h2>
            <p className="mt-2 max-w-3xl text-[0.98rem] leading-[1.65] text-ink-2">
              {m.setupIntro}
            </p>
            <div className="mt-6 rounded-3xl bg-paper p-4 shadow-[var(--w-shadow-card)] sm:p-6">
              <McpSetup tabs={tabs} label={m.setupTitle} {...copyProps} />
            </div>
          </section>

          {/* Tools */}
          <section aria-labelledby="tools">
            <h2 id="tools" className={h2}>
              {m.toolsTitle}
            </h2>
            <p className="mt-2 max-w-3xl text-[0.98rem] leading-[1.65] text-ink-2">
              {m.toolsIntro}
            </p>
            <div className="mt-6 overflow-hidden rounded-2xl bg-surface shadow-[var(--w-shadow-card)]">
              <div
                aria-hidden="true"
                className="hidden grid-cols-[15rem_1fr_5rem] gap-4 bg-chip px-4 py-3 text-[0.72rem] font-semibold tracking-[0.08em] text-ink-3 uppercase sm:grid"
              >
                <span>{m.colTool}</span>
                <span>{m.colDoes}</span>
                <span>{m.colKind}</span>
              </div>
              <ul>
                {[...reads, ...writes].map((tool) => (
                  <li
                    key={tool.name}
                    className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 border-t border-line/60 px-4 py-3 first:border-t-0 sm:grid-cols-[15rem_1fr_5rem] sm:items-start sm:border-t sm:first:border-t"
                  >
                    <code
                      dir="ltr"
                      className="text-start font-mono text-[0.8rem] font-medium text-ink"
                    >
                      {tool.name}
                    </code>
                    <span
                      className={`inline-flex h-6 w-fit items-center justify-self-end rounded-full px-2.5 text-[0.72rem] font-semibold sm:order-3 sm:justify-self-start ${
                        tool.kind === 'read' ? 'bg-chip text-ink-2' : 'bg-accent-wash text-accent'
                      }`}
                    >
                      {tool.kind === 'read' ? m.read : m.write}
                    </span>
                    <span className="col-span-2 text-[0.88rem] leading-[1.55] text-ink-2 sm:order-2 sm:col-span-1">
                      {m.toolDoes[tool.name]}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <p className="mt-3 text-[0.85rem] text-ink-3">{m.toolsNote}</p>
          </section>

          {/* Never */}
          <section aria-labelledby="never">
            <h2 id="never" className={h2}>
              {m.neverTitle}
            </h2>
            <ul className="mt-6 grid gap-4 md:grid-cols-2">
              {m.never.map(([title, body]) => (
                <li key={title} className={card}>
                  <h3 className="flex items-center gap-2 text-[1.02rem] font-semibold text-ink">
                    <Check className="h-4 w-4 shrink-0 text-accent" />
                    {title}
                  </h3>
                  <p className="mt-2 text-[0.9rem] leading-[1.65] text-ink-2">{body}</p>
                </li>
              ))}
            </ul>
          </section>

          {/* Disconnect */}
          <section aria-labelledby="revoke" className="max-w-3xl">
            <h2 id="revoke" className={h2}>
              {m.revokeTitle}
            </h2>
            <ul className="mt-4 space-y-3">
              {m.revoke.map((p) => (
                <li key={p} className="text-[0.98rem] leading-[1.7] text-ink-2">
                  {p}
                </li>
              ))}
            </ul>
          </section>

          {/* Self-hosted */}
          <section aria-labelledby="self" className="max-w-3xl">
            <h2 id="self" className={h2}>
              {m.selfTitle}
            </h2>
            <div className="mt-4 space-y-3">
              {m.self.map((p) => (
                <p key={p} className="text-[0.98rem] leading-[1.7] text-ink-2">
                  {p}
                </p>
              ))}
            </div>
          </section>

          {/* FAQ */}
          <section aria-labelledby="faq">
            <h2 id="faq" className={h2}>
              {m.faqTitle}
            </h2>
            <div className="mt-6 grid items-start gap-3 md:grid-cols-2">
              {m.faq.map(([q, a]) => (
                <details
                  key={q}
                  className="group rounded-2xl bg-surface shadow-[var(--w-shadow-card)]"
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-3.5 text-start text-[0.95rem] font-medium text-ink [&::-webkit-details-marker]:hidden">
                    {q}
                    <span
                      aria-hidden="true"
                      className="text-lg leading-none text-ink-3 transition-transform group-open:rotate-45"
                    >
                      +
                    </span>
                  </summary>
                  <p className="px-5 pb-4 text-[0.9rem] leading-[1.65] text-ink-2">{a}</p>
                </details>
              ))}
            </div>
          </section>

          <p className="text-[0.95rem] text-ink-2">
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
