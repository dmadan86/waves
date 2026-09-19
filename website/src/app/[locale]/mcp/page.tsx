import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { LegalPage, type LegalSection } from '@/components/legal-page';
import { isLocale, locales } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
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
 * It is also written to be *current* rather than aspirational. The sign-in flow
 * for third-party clients is not switched on yet — Supabase's OAuth server is
 * still disabled on the project — so the page says so instead of documenting a
 * flow that would fail. Published instructions that do not work are worse than
 * an honest "not yet": they send people to debug our configuration for us.
 *
 * When that flips, the "Signing in" section is the only one that changes.
 *
 * The tool list is the real one, read from `apps/agent-mcp/src/tools.ts`. If a
 * tool is added or removed there, it changes here — a stale list on a page
 * about what software may touch is a promise we are not keeping.
 */

const UPDATED = '19 September 2026';

/** Where the server answers. One string, used in prose and in the metadata. */
const ENDPOINT = `${site.appUrl}/api/mcp`;

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
    title: t.legal.mcpTitle,
    description: `Connect an AI agent to your ${site.name} ledger over MCP: what it can do, what it can never do, and how to sign it in.`,
    alternates: { canonical: absoluteUrl(`/${locale}/mcp`) },
  };
}

const sections: LegalSection[] = [
  {
    heading: 'What this is',
    body: [
      'Waves speaks MCP — the Model Context Protocol, the way AI assistants talk to software that is not themselves. Connect one, and you can ask it things like "what do I owe from the Goa trip" or "split last night’s dinner four ways", and it will read and write the same ledger the app does.',
      'It connects to your account, not to Waves in general. An agent you sign in sees exactly what you see when you open the app: your groups, the people in them, and the money between you. It cannot see a group you are not in, and nobody else’s agent can see yours.',
      'This is optional and off until you set it up. Waves works the same whether or not you ever connect one.',
    ],
  },
  {
    heading: 'What an agent can do',
    body: [
      'Read: who you are, your groups, the members of each, the balances, and the expenses themselves.',
      'Write: add an expense, edit or delete one, create a group, add people to it, make an invite link, and record that a settlement happened.',
      'Get a payment link — the UPI or PayPal handoff for someone you owe. The link is produced for you to open. Nothing is paid by producing it.',
    ],
  },
  {
    heading: 'What it can never do',
    body: [
      'It cannot move money. There is no tool that pays anybody. Recording a settlement writes down that a payment happened; the paying itself stays something you do, in your own banking app, on purpose. An agent that could both decide a debt existed and settle it would be a bad idea no matter how good the agent was.',
      'It cannot reach past you. Every request runs under your own account with the same database rules that apply to the app, enforced by the database rather than by the agent being well behaved. There is no administrator key in this path and no way to ask it for raw data — the agent gets the same named operations the app gets, and nothing wider.',
      'It cannot spend without limit. A single expense and a single settlement each have a ceiling, and there is a further ceiling on the total an agent can write for you in a day. They exist so that a confused assistant — or a badly worded instruction — is a small mess rather than a large one.',
    ],
  },
  {
    heading: 'The endpoint',
    body: [
      `The server is at ${ENDPOINT}, over streamable HTTP. Any MCP client that supports remote servers and OAuth can point at it.`,
      'It advertises how to authenticate the standard way: an unauthenticated request comes back with a 401 and a pointer to the metadata document at /.well-known/oauth-protected-resource/api/mcp, which names the authorization server. A well-behaved client follows that on its own; you should not have to paste anything but the address.',
    ],
  },
  {
    heading: 'Signing in',
    body: [
      'This is the part that is not finished. The server publishes where to authenticate, and the consent screen — the page that asks you, by name, whether a particular application may act for you — is built and deployed. The authorization server it points at is not switched on yet, so a client that follows the discovery chain today reaches the end of it and stops.',
      'Until it is on, connecting requires supplying a Waves access token to your client yourself. If you are comfortable doing that, write to us and we will tell you how for your particular client rather than publishing a recipe that is easy to get subtly wrong.',
      'When it is on, this section will say so, and the flow will be the ordinary one: your client sends you to Waves, you read what the application is asking for, you approve or refuse, and the client is handed a token. You can refuse, and refusing is a normal outcome that the client is told about.',
    ],
  },
  {
    heading: 'If you are running it yourself',
    body: [
      'There is also a local server, for people working from the source repository, which runs on your own machine over stdio and signs in with a six-digit code sent to your email. It exists for development; the hosted endpoint above is the one to use otherwise.',
      'It has a read-only mode. Set WAVES_MCP_READONLY=1 and only the reading tools are registered at all — not refused when called, but absent, so an agent cannot attempt a write it was never offered. Worth using the first time you point something new at your own ledger.',
    ],
  },
  {
    heading: 'Turning it off',
    body: [
      'Remove the server from your client, and it stops. If you approved an application through the sign-in flow, you can withdraw that approval from your account, and any token it holds stops working.',
      `If something has gone wrong and you want it stopped now, write to ${site.supportEmail} and say so. Signing out of Waves everywhere also ends every session an agent is holding.`,
    ],
  },
];

export default async function McpPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = await getDictionary(locale);

  return (
    <LegalPage
      locale={locale}
      t={t.legal}
      title={t.legal.mcpTitle}
      updated={UPDATED}
      note="This guide is published in English."
      intro={`You can connect an AI assistant to ${site.name} and let it read your groups and add expenses for you. This page says what one can do once connected, what it can never do, and how to sign it in — including the part that is not switched on yet.`}
      sections={sections}
    />
  );
}
