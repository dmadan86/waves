/**
 * WAV-11 / L7, the edge half: parse-statement asks the database to count each
 * request of an import id (waves_statement_import_chunk) before anything is
 * reserved, and refuses with 429 when the import has had its share.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  handleParseStatement,
  MAX_CHUNKS_PER_IMPORT,
  type Deps,
} from '../../parse-statement/handler.ts';
import { STATEMENT_MAX_CHUNKS } from '../../_shared/core.js';

const ME = '6f1c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f';

function makeDeps(sessionAllowed: boolean) {
  const rpc = vi.fn(async (name: string) => {
    if (name === 'waves_statement_import_enabled') return { data: true, error: null };
    if (name === 'waves_statement_import_chunk') {
      return { data: { chunks: 3, limit: 24, allowed: sessionAllowed }, error: null };
    }
    if (name === 'waves_statement_import_quota') {
      return { data: { used: 1, limit: 30, allowed: true, month: '2026-10' }, error: null };
    }
    if (name === 'waves_ai_usage_reserve') {
      return { data: { used: 1, limit: 720, allowed: true, month: '2026-10' }, error: null };
    }
    return { data: 0, error: null };
  });
  const fetchMock = vi.fn(async () =>
    Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              currency: 'INR',
              openingBalance: null,
              rows: [],
              warnings: [],
            }),
          },
        },
      ],
    }),
  );
  const deps = {
    env: (n: string) => ({ OPENROUTER_API_KEY: 'key', SUPABASE_SERVICE_ROLE_KEY: 's' })[n],
    caller: { auth: { getUser: async () => ({ data: { user: { id: ME } }, error: null }) } },
    service: { rpc },
    fetch: fetchMock,
    now: () => 1_790_000_000_000,
    rateLimit: async () => undefined,
  } as unknown as Deps;
  return { deps, rpc, fetchMock };
}

const body = () =>
  JSON.stringify({
    importId: 'import-0001-abcd',
    pages: [{ kind: 'text', page: 1, text: '01/10/26 UPI-X 450.00 49,550.00' }],
    hints: { currency: 'INR', today: '2026-10-12', locale: 'en-IN', country: 'IN' },
  });
const req = () => new Request('https://x/parse-statement', { method: 'POST', body: body() });

describe('WAV-11 one import id is a bounded number of requests', () => {
  it('asks the session counter first, with the ceiling', async () => {
    const { deps, rpc } = makeDeps(true);
    expect((await handleParseStatement(req(), deps)).status).toBe(200);
    const names = rpc.mock.calls.map(([n]) => n);
    expect(names.indexOf('waves_statement_import_chunk')).toBeLessThan(
      names.indexOf('waves_statement_import_quota'),
    );
    expect(rpc).toHaveBeenCalledWith('waves_statement_import_chunk', {
      p_profile: ME,
      p_import_id: 'import-0001-abcd',
      p_max_chunks: MAX_CHUNKS_PER_IMPORT,
    });
    expect(MAX_CHUNKS_PER_IMPORT).toBe(STATEMENT_MAX_CHUNKS * 2);
  });

  it('refuses the import with 429 once its requests are spent: no reservation, no model', async () => {
    const { deps, rpc, fetchMock } = makeDeps(false);
    await expect(handleParseStatement(req(), deps)).rejects.toMatchObject({
      status: 429,
      code: 'STATEMENT_IMPORT_TOO_MANY_CHUNKS',
    });
    const names = rpc.mock.calls.map(([n]) => n);
    expect(names).not.toContain('waves_statement_import_quota');
    expect(names).not.toContain('waves_ai_usage_reserve');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
