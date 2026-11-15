/**
 * Company two-step login, phone side.
 *
 * The phone holds a secret in the keystore and proves itself with a 6-digit
 * code made from it (RFC 6238, the same code an authenticator app shows). The
 * server contract is `two-step-trust`; nothing here blocks the app starting and
 * every failure is quiet: the sync banner is what tells the person.
 */

import * as SecureStore from 'expo-secure-store';

import { base32Decode, totpNow, totpSecondsLeft } from '@waves/core';

import { limitedUseAppCheckToken } from '@/lib/appCheck';
import { backend } from '@/lib/backend';

export type TrustResult =
  | { status: 'trusted' }
  | { status: 'pending' }
  /** Typed code was wrong. */
  | { status: 'badCode' }
  | { status: 'locked' }
  | { status: 'rateLimited' }
  /** Old or unofficial build: needs an update. */
  | { status: 'update' }
  /** Offline, no App Check, anything else: try again later. */
  | { status: 'unavailable' };

const secretKey = (profileId: string) => `waves.twostep.secret.${profileId}`;
const KEY_OPTIONS = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export async function readSecret(profileId: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(secretKey(profileId), KEY_OPTIONS);
  } catch {
    return null;
  }
}

async function storeSecret(profileId: string, secret: string): Promise<void> {
  await SecureStore.setItemAsync(secretKey(profileId), secret, KEY_OPTIONS);
}

async function clearSecret(profileId: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(secretKey(profileId), KEY_OPTIONS);
  } catch {
    /* nothing stored */
  }
}

/** The code for a stored base32 secret, or null when it is not one. */
export function codeFor(secret: string | null, nowMs: number): string | null {
  const bytes = secret ? base32Decode(secret) : null;
  return bytes ? totpNow(bytes, nowMs) : null;
}

/** Body for authenticator `start`: the server wants a current code from an existing factor, which this phone can make. */
export async function authenticatorStartBody(
  profileId: string,
  nowMs: number = Date.now(),
): Promise<{ action: 'start'; code?: string }> {
  const code = codeFor(await readSecret(profileId), nowMs);
  return code ? { action: 'start', code } : { action: 'start' };
}

/** The `{ code }` of an edge-function error body, if it has one. */
export async function functionErrorCode(error: unknown): Promise<string | null> {
  const context = (error as { context?: Response }).context;
  if (!context || typeof context.json !== 'function') return null;
  try {
    return ((await context.json()) as { code?: string })?.code ?? null;
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Options {
  /** A code the person typed (other device / authenticator). */
  code?: string;
  /** Test seam. */
  now?: () => number;
  wait?: (ms: number) => Promise<unknown>;
}

/** Tell the server this phone is here and learn whether it is trusted. Never throws. */
export async function trustThisPhone(
  profileId: string,
  deviceId: string,
  options: Options = {},
): Promise<TrustResult> {
  const now = options.now ?? Date.now;
  const wait = options.wait ?? sleep;
  try {
    // At most: one revoked retry, one next-step retry.
    let allowRevokedRetry = true;
    let allowStepRetry = true;
    for (;;) {
      const token = await limitedUseAppCheckToken();
      if (!token) return { status: 'unavailable' };
      const stored = options.code ? null : await readSecret(profileId);
      const auto = codeFor(stored, now());
      const { data, error } = await backend.functions.invoke('two-step-trust', {
        headers: { 'X-Firebase-AppCheck': token },
        body: {
          deviceId,
          hasSecret: !!stored,
          ...(options.code || auto ? { code: options.code ?? auto } : {}),
        },
      });
      if (error) {
        const code = await functionErrorCode(error);
        if (code === 'BAD_CODE') {
          if (options.code) return { status: 'badCode' };
          if (allowStepRetry) {
            allowStepRetry = false;
            // The code can lapse between making it and the server checking it.
            await wait(totpSecondsLeft(now()) * 1000 + 500);
            continue;
          }
        }
        if (code === 'LOCKED') return { status: 'locked' };
        if (code === 'RATE_LIMITED') return { status: 'rateLimited' };
        if (code === 'APP_CHECK_FAILED') return { status: 'update' };
        return { status: 'unavailable' };
      }
      const body = (data ?? {}) as { status?: string; secret?: string };
      if (body.status === 'revoked') {
        await clearSecret(profileId);
        if (!allowRevokedRetry) return { status: 'unavailable' };
        allowRevokedRetry = false;
        continue;
      }
      if (body.status === 'trusted') {
        if (body.secret) await storeSecret(profileId, body.secret);
        return { status: 'trusted' };
      }
      if (body.status === 'pending') return { status: 'pending' };
      return { status: 'unavailable' };
    }
  } catch {
    return { status: 'unavailable' };
  }
}
