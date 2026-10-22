/**
 * WAV-07 / WAV-08: the callback's `timestamp` was never checked, so a genuine
 * callback could be kept and replayed on a day the account qualified; and the
 * reward fields were read from the whole URL while only the part before
 * `&signature=` is signed, so a field missing from the signed part could be
 * appended after the signature.
 *
 * Now the fields come from the signed prefix only (a repeated field refuses),
 * and the signed timestamp must be within the last hour (5 minutes of skew).
 */

import { describe, expect, it, vi } from 'vitest';

import {
  handleAdmobSsv,
  MAX_CALLBACK_AGE_MS,
  MAX_CALLBACK_SKEW_MS,
  signedParams,
  type Deps,
} from '../../admob-ssv/handler.ts';
import { VerifierKeys } from '../../admob-ssv/verify.ts';

const ME = '6f1c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f';
const AT = 1_790_000_000_000;

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

async function setup(now = AT + 5_000) {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
  const fetchFn = vi.fn(
    async () => new Response(JSON.stringify({ keys: [{ keyId: 77, base64: b64(spki) }] })),
  ) as unknown as typeof fetch;
  const rpc = vi.fn(async () => ({ data: { outcome: 'granted' }, error: null }));
  const deps: Deps = {
    env: (name) => ({ ADMOB_AD_UNIT_IDS: '1234567890' })[name],
    keys: new VerifierKeys(fetchFn),
    service: { rpc },
    now: () => now,
  };
  /** Signs `signed`; `trailing` is appended AFTER the signature and key id (unsigned). */
  const callback = async (signed: Record<string, string>, trailing = '') => {
    const message = new URLSearchParams(signed).toString();
    const raw = new Uint8Array(
      await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        pair.privateKey,
        new TextEncoder().encode(message),
      ),
    );
    const query = `${message}&signature=${b64(der(raw), true)}&key_id=77${trailing}`;
    return new Request(`https://x.supabase.co/functions/v1/admob-ssv?${query}`);
  };
  return { deps, rpc, callback };
}

const good = (over: Record<string, string> = {}) => ({
  ad_network: '5450213213286189855',
  ad_unit: '1234567890',
  custom_data: 'voice',
  reward_amount: '1',
  reward_item: 'Reward',
  timestamp: String(AT),
  transaction_id: 'TX-1',
  user_id: ME,
  ...over,
});

const outcome = async (p: Promise<Response>) => (await p).json();

describe('WAV-07 freshness', () => {
  it('rewards a callback whose signed timestamp is recent', async () => {
    const { deps, rpc, callback } = await setup();
    expect(await outcome(handleAdmobSsv(await callback(good()), deps))).toEqual({
      ok: true,
      outcome: 'granted',
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('ignores a genuine callback held back for more than an hour, or from the future', async () => {
    const { deps, rpc, callback } = await setup();
    for (const timestamp of [
      String(AT - MAX_CALLBACK_AGE_MS - 1),
      String(AT + MAX_CALLBACK_SKEW_MS + 60_000),
      '',
      'yesterday',
    ]) {
      expect(await outcome(handleAdmobSsv(await callback(good({ timestamp })), deps))).toEqual({
        ok: true,
        outcome: 'ignored',
        reason: 'timestamp',
      });
    }
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('WAV-08 only the signed prefix is read', () => {
  it('a user_id appended after the signature is not Google’s word', async () => {
    const { deps, rpc, callback } = await setup();
    const { user_id: _dropped, ...withoutUser } = good();
    const request = await callback(withoutUser, `&user_id=${ME}`);
    expect(await outcome(handleAdmobSsv(request, deps))).toEqual({
      ok: true,
      outcome: 'ignored',
      reason: 'user_id',
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('custom_data appended after the signature is ignored too', async () => {
    const { deps, rpc, callback } = await setup();
    const { custom_data: _dropped, ...withoutKind } = good();
    expect(
      await outcome(handleAdmobSsv(await callback(withoutKind, '&custom_data=scan'), deps)),
    ).toMatchObject({ outcome: 'ignored', reason: 'custom_data' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('a field that appears twice in the signed part refuses the callback', async () => {
    const { deps, rpc } = await setup();
    const query = `user_id=${ME}&user_id=${ME}&signature=x&key_id=77`;
    expect(signedParams(query)).toBeNull();
    const request = new Request(`https://x.supabase.co/functions/v1/admob-ssv?${query}`);
    // The signature is bad anyway (403) — the parser alone is what this pins.
    await handleAdmobSsv(request, deps).catch(() => null);
    expect(rpc).not.toHaveBeenCalled();
  });
});
