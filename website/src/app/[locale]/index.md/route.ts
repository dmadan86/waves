import { isLocale, locales } from '@/i18n/config';
import { pageAsMarkdown } from '@/lib/markdown';

/** `/en/index.md`, `/ta/index.md`, and so on — one per language. */
export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export const dynamic = 'force-static';

export async function GET(_request: Request, { params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) return new Response('Not found', { status: 404 });

  return new Response(await pageAsMarkdown(locale), {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
