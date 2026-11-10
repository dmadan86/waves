import { describe, expect, it } from 'vitest';

import { HttpError, type SupabaseClient } from '../_shared/auth.ts';
import { handleCompanyFile } from './companyFile.ts';

const GROUP = '11111111-1111-4111-8111-111111111111';
const FILE = '22222222-2222-4222-8222-222222222222';
const PATH = `cf/${GROUP}/${FILE}`;

const deps = {
  objectUrl: (_b: string, p: string) => `https://r2.test/${p}`,
  r2: () => ({
    client: {
      sign: async (r: Request) => ({ url: r.url }),
      fetch: async () => new Response(null),
    },
  }),
};
const rpcResult = (data: unknown) =>
  ({ rpc: async () => ({ data, error: null }) }) as unknown as SupabaseClient;
const status = async (run: Promise<unknown>) => {
  try {
    await run;
  } catch (e) {
    return (e as HttpError).status;
  }
  return 200;
};

describe('company file byte door', () => {
  it('refuses a key that is not cf/<group>/<file> or whose subject is another id', async () => {
    const body = {
      action: 'put',
      subjectId: FILE,
      contentType: 'application/pdf',
      contentLength: 5,
    };
    expect(
      await status(
        handleCompanyFile(deps, rpcResult(true), rpcResult(null), 'u', body, `cf/${GROUP}/x`),
      ),
    ).toBe(400);
    expect(
      await status(
        handleCompanyFile(
          deps,
          rpcResult(true),
          rpcResult(null),
          'u',
          { ...body, subjectId: GROUP },
          PATH,
        ),
      ),
    ).toBe(400);
  });

  it('refuses html, svg and oversize uploads before reserving anything', async () => {
    const base = { action: 'put', subjectId: FILE, contentLength: 5 };
    for (const contentType of ['text/html', 'image/svg+xml', 'application/javascript']) {
      expect(
        await status(
          handleCompanyFile(
            deps,
            rpcResult(true),
            rpcResult(null),
            'u',
            { ...base, contentType },
            PATH,
          ),
        ),
      ).toBe(415);
    }
    const big = { ...base, contentType: 'application/pdf', contentLength: 26 * 1024 * 1024 };
    expect(
      await status(handleCompanyFile(deps, rpcResult(true), rpcResult(null), 'u', big, PATH)),
    ).toBe(413);
  });

  it('signs a read only when the caller may see the file', async () => {
    const body = { action: 'get', subjectId: FILE };
    expect(
      await status(handleCompanyFile(deps, rpcResult(false), rpcResult(null), 'u', body, PATH)),
    ).toBe(403);
  });
});
