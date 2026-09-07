/**
 * The adapter between a Web request and the SDK's Node-shaped transport.
 *
 * Worth testing against the real transport rather than a mock: the whole risk
 * in it is that the hand-written `res` stand-in is missing something the SDK
 * calls, and a mock of the SDK would agree with whatever the adapter happens to
 * do. A real server with one trivial tool needs no network, no Supabase and no
 * credentials, and fails loudly if the shim is wrong.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { serveMcpOverHttp } from './http';

function testServer(): McpServer {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  server.registerTool(
    'echo',
    { description: 'Say it back', inputSchema: { text: z.string() } },
    async ({ text }) => ({ content: [{ type: 'text' as const, text }] }),
  );
  return server;
}

function post(body: unknown, accept = 'application/json, text/event-stream'): Request {
  return new Request('https://example.test/api/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: accept },
    body: JSON.stringify(body),
  });
}

const INITIALIZE = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test', version: '0' },
  },
};

describe('one exchange over HTTP', () => {
  it('answers an initialize with the server it is carrying', async () => {
    const response = await serveMcpOverHttp(testServer(), post(INITIALIZE));
    expect(response.status).toBe(200);

    const message = (await response.json()) as {
      result?: { serverInfo?: { name?: string }; protocolVersion?: string };
    };
    expect(message.result?.serverInfo?.name).toBe('test');
    expect(message.result?.protocolVersion).toBeTruthy();
  });

  it('hands back plain JSON, not SSE frames', async () => {
    // A stateless exchange carries exactly one message. A client that asked for
    // JSON should not have to parse `data:` lines out of it.
    const response = await serveMcpOverHttp(testServer(), post(INITIALIZE));
    const text = await response.text();
    expect(text.startsWith('event:')).toBe(false);
    expect(text.startsWith('data:')).toBe(false);
    expect(() => JSON.parse(text)).not.toThrow();
    expect(response.headers.get('Content-Type')).toContain('application/json');
  });

  it('refuses a malformed request rather than hanging', async () => {
    // The promise the adapter waits on resolves when the transport ends the
    // response; a shape it rejects must still end it, or the request never
    // returns at all.
    const response = await serveMcpOverHttp(testServer(), post({ not: 'jsonrpc' }));
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it('does not leave the server connected afterwards', async () => {
    const server = testServer();
    await serveMcpOverHttp(server, post(INITIALIZE));
    // A second exchange on a closed server must not silently half-work: it is
    // one server per request, which is what makes the endpoint stateless.
    expect(server.isConnected()).toBe(false);
  });
});
