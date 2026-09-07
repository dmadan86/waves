/**
 * Carrying MCP over a single HTTP request and reply.
 *
 * The SDK ships a transport that speaks Web `Request` and `Response` directly
 * (`WebStandardStreamableHTTPServerTransport`), which is exactly what a Next
 * route handler holds — so this is thin on purpose. The Node-shaped transport
 * beside it is a wrapper around this same one for `IncomingMessage`/
 * `ServerResponse`; using that here would mean hand-writing a fake `res`, and a
 * hand-written `res` is a thing that silently misses whatever method the SDK
 * calls next.
 *
 * **Stateless on purpose.** A fresh transport per request, `sessionIdGenerator`
 * undefined, nothing kept between calls. MCP sessions would mean holding state
 * in a serverless function that may not be the same instance next time — the
 * 2026-07-28 spec made the protocol core stateless for exactly this reason, and
 * a stateless exchange has nothing to stream back either: one request, one
 * reply, no SSE connection to hold open past the end of an invocation.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';

/**
 * Run one JSON-RPC exchange against a server and answer with its reply.
 *
 * The server is connected, used and closed inside this call: left open, a
 * serverless instance accumulates one server and one transport per request
 * until it is recycled.
 */
export async function serveMcpOverHttp(server: McpServer, request: Request): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    // One message per exchange, so answer with JSON rather than an SSE frame a
    // client would have to unwrap `data:` lines from.
    enableJsonResponse: true,
  });

  try {
    await server.connect(transport);
    return await transport.handleRequest(request);
  } finally {
    await transport.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
}
