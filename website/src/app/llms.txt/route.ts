import { locales } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { absoluteUrl, site } from '@/lib/site';

export const dynamic = 'force-static';

/**
 * `/llms.txt` — an index for anything reading the site as text rather than
 * looking at it. No search engine acts on this file, and we should not pretend
 * otherwise; what it buys is a clean answer when somebody pastes the domain
 * into an assistant, and it costs one route.
 */
export async function GET() {
  const t = await getDictionary('en');

  const body = [
    `# ${site.name}`,
    '',
    `> ${t.meta.description}`,
    '',
    `${t.custody.claim} ${t.custody.body}`,
    '',
    '## Pages',
    '',
    `- [Home, as Markdown](${absoluteUrl('/en/index.md')}): the full landing page in prose.`,
    `- [Privacy](${absoluteUrl('/en/privacy')}): what is held, what is not, and what this does not protect against.`,
    `- [Terms](${absoluteUrl('/en/terms')})`,
    `- [Web app](${site.appUrl})`,
    '',
    '## Languages',
    '',
    ...locales.map(
      (locale) =>
        `- ${locale}: ${absoluteUrl(`/${locale}`)} (${absoluteUrl(`/${locale}/index.md`)})`,
    ),
    '',
    '## Notes',
    '',
    '- Waves is not a bank and never holds, moves or touches money; settling hands off to the payment app the user already has.',
    '- Amounts are stored as integer minor units plus an ISO 4217 code, never as floating point.',
    '- The free tier is unlimited for groups, people, expenses, currencies, offline use and settling up.',
    '- There is no independent security audit yet, and the shared ledger is not end-to-end encrypted.',
    '',
  ].join('\n');

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
