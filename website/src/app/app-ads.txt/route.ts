/**
 * /app-ads.txt — the IAB file that tells ad buyers which seller IDs may sell
 * this app's inventory. It sits at the site root, outside the `[locale]`
 * segment, and the dot in its name keeps `proxy.ts` from redirecting it.
 *
 * The publisher ID comes from NEXT_PUBLIC_ADMOB_PUBLISHER_ID, with or without
 * a leading `pub-`. Anything that is not digits afterwards is treated as unset
 * and the route answers 404 rather than publishing a malformed line.
 */

export const dynamic = 'force-static';

function publisherLine(raw: string | undefined): string | null {
  const id = (raw ?? '').trim().replace(/^pub-/i, '');
  if (!/^\d+$/.test(id)) return null;
  return `google.com, pub-${id}, DIRECT, f08c47fec0942fa0\n`;
}

export function GET() {
  const line = publisherLine(process.env.NEXT_PUBLIC_ADMOB_PUBLISHER_ID);
  if (!line) return new Response('Not found', { status: 404 });
  return new Response(line, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
