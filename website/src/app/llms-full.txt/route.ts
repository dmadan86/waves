import { getDictionary } from '@/i18n/dictionaries';
import { pageAsMarkdown } from '@/lib/markdown';
import { mcpEndpoint, mcpTools } from '@/lib/mcp-tools';
import { site } from '@/lib/site';

export const dynamic = 'force-static';

/**
 * `/llms-full.txt` — the English home page as prose plus the full MCP tool
 * list, in one fetch, for assistants that want everything at once. Built from
 * the same sources as the page, /llms.txt and /mcp, so it cannot drift.
 */
export async function GET() {
  const t = await getDictionary('en');
  const tools = mcpTools.map(
    (tool) => `- \`${tool.name}\` (${tool.kind}): ${t.mcpPage.toolDoes[tool.name]}`,
  );

  const body = [
    await pageAsMarkdown('en'),
    '',
    '## MCP tools',
    '',
    `Endpoint: ${mcpEndpoint(site.appUrl)} (streamable HTTP, OAuth sign-in). Every tool:`,
    '',
    ...tools,
    '',
  ].join('\n');

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
