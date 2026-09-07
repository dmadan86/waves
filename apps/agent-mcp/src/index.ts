#!/usr/bin/env node
/**
 * The stdio entry: one machine, one signed-in person, started by an MCP host.
 *
 * The tools are in `tools.ts`, shared with the HTTP entry. This file is only
 * the wiring that says where the session comes from — this machine's, via
 * `pnpm mcp:login` or the environment — and how the bytes move.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { currentUserId, makeClient, readEnv } from './supabase';
import { buildWavesServer } from './tools';

async function main(): Promise<void> {
  const env = readEnv();
  const supabase = await makeClient(env);
  const meId = await currentUserId(supabase);

  const server = buildWavesServer(supabase, meId, env.readOnly);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // A stdio server must not print to stdout — that is the protocol channel.
  process.stderr.write(`waves-agent MCP up as ${meId}${env.readOnly ? ' (read-only)' : ''}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `waves-agent MCP failed to start: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
