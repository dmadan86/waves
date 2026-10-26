/**
 * The callback end to end with a stubbed database and a generated key pair: the
 * signature is checked first, then the ad unit, user and kind, and the grant is
 * handed to waves_ads_grant (which is idempotent on the transaction id).
 */

import { describe, expect, it, vi } from 'vitest';

import { allowedUnits, handleAdmobSsv, unitId, type Deps } from './handler.ts';
import { VerifierKeys } from './verify.ts';

const ME = '6f1c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f';

function b64(bytes: Uint8Array, urlSafe = false): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  const std = btoa(s);
  return urlSafe ? std.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : std;
}

function der(raw: Uint8Array): Uint8Array {
  const int = (bytes: Uint8Array): number[] => {
    let b = Array.from(bytes);
    while (b.length > 1 && b[0] === 0) b = b.slice(1);
    if ((b[0] ?? 0) >= 0x80) b = [0, ...b];
    return [0x02, b.length, ...b];
  };
  const body = [...int(raw.slice(0, 32)), ...int(raw.slice(32))];
  return Uint8Array.from([0x30, body.length, ...body]);
}

async function setup(
  env: Record<string, string | undefined> = { ADMOB_AD_UNIT_IDS: '1234567890' },
) {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
  const fetchFn = vi.fn(
    async () => new Response(JSON.stringify({ keys: [{ keyId: 77, base64: b64(spki) }] })),
  ) as unknown as typeof fetch;
  const seen = new Set<string>();
  const rpc = vi.fn(async (_name: string, args: Record<string, unknown>) => {
    const tx = args.p_transaction_id as string;
    if (seen.has(tx)) return { data: { outcome: 'duplicate' }, error: null };
    seen.add(tx);
    return { data: { outcome: 'granted', kind: args.p_kind, amount: 2 }, error: null };
  });
  // The callbacks below carry timestamp 1790000000000; the clock sits just after.
  const deps: Deps = {
    env: (name) => env[name],
    keys: new VerifierKeys(fetchFn),
    service: { rpc },
    now: () => 1_790_000_000_000 + 5_000,
  };
  const callback = async (
    params: Record<string, string> = {},
    over: { tamper?: (q: string) => string; keyId?: string } = {},
  ) => {
    const base = new URLSearchParams({
      ad_network: '5450213213286189855',
      ad_unit: '1234567890',
      custom_data: 'voice',
      reward_amount: '1',
      reward_item: 'Reward',
      timestamp: '1790000000000',
      transaction_id: 'TX-1',
      user_id: ME,
      ...params,
    });
    const message = base.toString();
    const raw = new Uint8Array(
      await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        pair.privateKey,
        new TextEncoder().encode(decodeURIComponent(message)),
      ),
    );
    let query = `${message}&signature=${b64(der(raw), true)}&key_id=${over.keyId ?? '77'}`;
    if (over.tamper) query = over.tamper(query);
    return new Request(`https://x.supabase.co/functions/v1/admob-ssv?${query}`);
  };
  return { deps, rpc, callback, fetchFn };
}

async function status(promise: Promise<Response>): Promise<number> {
  try {
    return (await promise).status;
  } catch (error) {
    return (error as { status: number }).status;
  }
}

describe('admob-ssv', () => {
  it('grants a verified voice reward to the user_id in the signed query', async () => {
    const { deps, rpc, callback } = await setup();
    const response = await handleAdmobSsv(await callback(), deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, outcome: 'granted' });
    expect(rpc).toHaveBeenCalledWith('waves_ads_grant', {
      p_profile: ME,
      p_kind: 'voice',
      p_transaction_id: 'TX-1',
      p_ad_unit: '1234567890',
    });
  });

  it('grants a scan reward when custom_data says scan', async () => {
    const { deps, rpc, callback } = await setup();
    await handleAdmobSsv(await callback({ custom_data: 'scan' }), deps);
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_kind: 'scan' });
  });

  it.each(['credit', 'credit:voluntary', 'credit:voice', 'credit:offer', 'credit:gate'])(
    'passes signed %s unchanged to the grant RPC',
    async (kind) => {
      const { deps, rpc, callback } = await setup();
      const response = await handleAdmobSsv(await callback({ custom_data: kind }), deps);
      expect(response.status).toBe(200);
      expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_kind: kind });
    },
  );

  it.each(['capped', 'ineligible'])(
    'acknowledges a verified credit callback refused as %s',
    async (outcome) => {
      const { deps, callback } = await setup();
      deps.service.rpc = vi.fn(async () => ({
        data: { outcome, reason: 'daily_cap' },
        error: null,
      }));
      const response = await handleAdmobSsv(
        await callback({ custom_data: 'credit:voluntary' }),
        deps,
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true, outcome });
    },
  );

  it('is idempotent: a replayed callback answers 200 duplicate and the database decides', async () => {
    const { deps, callback } = await setup();
    await handleAdmobSsv(await callback(), deps);
    const again = await handleAdmobSsv(await callback(), deps);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ ok: true, outcome: 'duplicate' });
  });

  it('refuses a bad or missing signature with 403 and grants nothing', async () => {
    const { deps, rpc, callback } = await setup();
    expect(
      await status(
        handleAdmobSsv(
          await callback({}, { tamper: (q) => q.replace(ME.slice(0, 4), '0000') }),
          deps,
        ),
      ),
    ).toBe(403);
    expect(await status(handleAdmobSsv(await callback({}, { keyId: '999' }), deps))).toBe(403);
    const unsigned = new Request(
      `https://x.supabase.co/functions/v1/admob-ssv?user_id=${ME}&custom_data=voice&transaction_id=T&ad_unit=1234567890`,
    );
    expect(await status(handleAdmobSsv(unsigned, deps))).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('answers the console ping (no query) with 200 and does nothing', async () => {
    const { deps, rpc } = await setup();
    const response = await handleAdmobSsv(
      new Request('https://x.supabase.co/functions/v1/admob-ssv'),
      deps,
    );
    expect(response.status).toBe(200);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('ignores (200) a verified callback for another ad unit, a bad user or a bad kind', async () => {
    const { deps, rpc, callback } = await setup();
    for (const over of [
      { ad_unit: '555' },
      { user_id: 'not-a-uuid' },
      { custom_data: 'banner' },
      { custom_data: 'credit:scan' },
      { custom_data: 'credit:' },
      { custom_data: 'credit:gate:voice' },
      { custom_data: 'Credit' },
      { custom_data: '' },
      { transaction_id: '' },
    ]) {
      const response = await handleAdmobSsv(await callback(over), deps);
      expect(response.status).toBe(200);
      expect((await response.json()).outcome).toBe('ignored');
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it('accepts the full ca-app-pub unit path in the secret', async () => {
    const { deps, rpc, callback } = await setup({
      ADMOB_AD_UNIT_IDS: 'ca-app-pub-111~222/1234567890, ca-app-pub-111/999',
    });
    await handleAdmobSsv(await callback(), deps);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('is refused (503) when no ad units are configured, and rewards nothing', async () => {
    const { deps, rpc, callback } = await setup({});
    expect(await status(handleAdmobSsv(await callback(), deps))).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('answers 503 when Google keys cannot be read, so AdMob retries', async () => {
    const { deps, callback } = await setup();
    const broken: Deps = {
      ...deps,
      keys: new VerifierKeys(
        vi.fn(async () => new Response('no', { status: 500 })) as unknown as typeof fetch,
      ),
    };
    expect(await status(handleAdmobSsv(await callback(), broken))).toBe(503);
  });

  it('answers 500 when the grant cannot be written, so AdMob retries', async () => {
    const { deps, callback } = await setup();
    const failing: Deps = {
      ...deps,
      service: { rpc: async () => ({ data: null, error: { message: 'down' } }) },
    };
    expect(await status(handleAdmobSsv(await callback(), failing))).toBe(500);
  });

  it('only accepts GET', async () => {
    const { deps } = await setup();
    expect(
      await status(
        handleAdmobSsv(
          new Request('https://x.supabase.co/functions/v1/admob-ssv', {
            method: 'POST',
            body: '{}',
          }),
          deps,
        ),
      ),
    ).toBe(405);
  });
});

describe('unit ids', () => {
  it('compares the id after the last slash', () => {
    expect(unitId('ca-app-pub-1~2/3')).toBe('3');
    expect(unitId(' 3 ')).toBe('3');
    expect([...allowedUnits((n) => (n === 'ADMOB_AD_UNIT_IDS' ? 'a/1, 2 ,,' : undefined))]).toEqual(
      ['1', '2'],
    );
  });
});
