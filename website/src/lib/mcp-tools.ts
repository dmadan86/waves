/**
 * The tools the Waves MCP server offers, in the order the app registers them.
 *
 * Source of truth: `apps/agent-mcp/src/tools.ts` (every `registerTool` call).
 * `payment_link` is the one read-only-mode tool that builds a link rather than
 * reading data; it moves no money, so it is listed as a read. If a tool is
 * added, removed or renamed there, change this list in the same commit — the
 * dictionary's `mcpPage.toolDoes` is keyed by these names and the type checker
 * will point at any translation that falls behind.
 */
export const mcpTools = [
  { name: 'whoami', kind: 'read' },
  { name: 'list_groups', kind: 'read' },
  { name: 'list_members', kind: 'read' },
  { name: 'get_balances', kind: 'read' },
  { name: 'settlement_plan', kind: 'read' },
  { name: 'list_settlements', kind: 'read' },
  { name: 'list_expenses', kind: 'read' },
  { name: 'list_agent_writes', kind: 'read' },
  { name: 'payment_link', kind: 'read' },
  { name: 'create_group', kind: 'write' },
  { name: 'add_expense', kind: 'write' },
  { name: 'add_expense_with_person', kind: 'write' },
  { name: 'edit_expense', kind: 'write' },
  { name: 'delete_expense', kind: 'write' },
  { name: 'record_settlement', kind: 'write' },
  { name: 'add_people', kind: 'write' },
  { name: 'invite_link', kind: 'write' },
] as const;

export type McpToolName = (typeof mcpTools)[number]['name'];

/** Where the server answers, and the document clients use to find sign-in. */
export const mcpEndpoint = (appUrl: string) => `${appUrl}/api/mcp`;
export const mcpMetadataUrl = (appUrl: string) =>
  `${appUrl}/.well-known/oauth-protected-resource/api/mcp`;
