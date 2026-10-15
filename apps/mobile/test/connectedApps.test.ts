/**
 * Listing and revoking the AI assistants authorised over OAuth, against a
 * mocked `supabase.auth.oauth`. The empty and error states are decided here
 * (an empty array vs. a thrown error), which is what the page keys off.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  disconnectApp,
  listConnectedApps,
  withoutApp,
  type OAuthGrantsApi,
  type RawGrant,
} from '@/lib/connectedApps';

const grant = (id: string, over: Partial<RawGrant['client']> = {}, at = '2026-10-01T00:00:00Z') =>
  ({
    client: { id, name: `App ${id}`, uri: null, logo_uri: null, ...over },
    scopes: ['openid', 'email'],
    granted_at: at,
  }) satisfies RawGrant;

const api = (over: Partial<OAuthGrantsApi> = {}): OAuthGrantsApi => ({
  listGrants: vi.fn(async () => ({ data: [], error: null })),
  revokeGrant: vi.fn(async () => ({ error: null })),
  ...over,
});

describe('listConnectedApps', () => {
  it('maps grants, newest first', async () => {
    const list = await listConnectedApps(
      api({
        listGrants: async () => ({
          data: [grant('a', {}, '2026-01-01T00:00:00Z'), grant('b', {}, '2026-09-01T00:00:00Z')],
          error: null,
        }),
      }),
    );
    expect(list.map((app) => app.clientId)).toEqual(['b', 'a']);
    expect(list[0]).toMatchObject({ name: 'App b', scopes: ['openid', 'email'], logoUri: null });
  });

  it('is empty for no grants, and for a null payload', async () => {
    expect(await listConnectedApps(api())).toEqual([]);
    expect(
      await listConnectedApps(api({ listGrants: async () => ({ data: null, error: null }) })),
    ).toEqual([]);
  });

  it('keeps only an https logo url', async () => {
    const list = await listConnectedApps(
      api({
        listGrants: async () => ({
          data: [
            grant('a', { logo_uri: 'https://x.example/l.png' }),
            grant('b', { logo_uri: 'javascript:alert(1)' }),
            grant('c', { logo_uri: 'not a url' }),
          ],
          error: null,
        }),
      }),
    );
    expect(list.map((app) => app.logoUri)).toEqual(['https://x.example/l.png', null, null]);
  });

  it('throws when the server errors, so the screen shows an error not an empty list', async () => {
    await expect(
      listConnectedApps(
        api({ listGrants: async () => ({ data: null, error: { message: 'nope' } }) }),
      ),
    ).rejects.toThrow('nope');
  });
});

describe('disconnectApp', () => {
  it('revokes by client id', async () => {
    const mock = api();
    await disconnectApp(mock, 'abc');
    expect(mock.revokeGrant).toHaveBeenCalledWith({ clientId: 'abc' });
  });

  it('throws on failure so the row stays', async () => {
    await expect(
      disconnectApp(api({ revokeGrant: async () => ({ error: { message: 'boom' } }) }), 'abc'),
    ).rejects.toThrow('boom');
  });

  it('withoutApp drops only that client', () => {
    const apps = [
      { clientId: 'a', name: '', logoUri: null, scopes: [], grantedAt: '' },
      { clientId: 'b', name: '', logoUri: null, scopes: [], grantedAt: '' },
    ];
    expect(withoutApp(apps, 'a').map((app) => app.clientId)).toEqual(['b']);
  });
});
