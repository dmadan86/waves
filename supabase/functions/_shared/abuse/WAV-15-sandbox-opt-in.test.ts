/**
 * WAV-15 / H3: sandbox and Test Store purchases became real Pro rows unless an
 * optional variable (REVENUECAT_IGNORE_SANDBOX=true) was set. A TestFlight or
 * Play-internal build makes those purchases for free.
 *
 * Now sandbox is dropped by default; exactly REVENUECAT_ALLOW_SANDBOX=true
 * opts a deployment in, and the old variable is not read at all.
 */

import { describe, expect, it, vi } from 'vitest';

import { allowSandbox, handleRevenueCatWebhook } from '../../revenuecat-webhook/handler.ts';

const SECRET = 's3cret';
const ME = '6f1c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f';

function run(env: Record<string, string | undefined>, over: Record<string, unknown>) {
  const rpc = vi.fn(async (_n: string, args: Record<string, unknown>) => ({
    data: (args.p_action as { kind: string }).kind === 'ignore' ? 'ignored' : 'applied',
    error: null,
  }));
  const request = new Request('https://x/revenuecat-webhook', {
    method: 'POST',
    headers: { Authorization: SECRET, 'content-type': 'application/json' },
    body: JSON.stringify({
      event: {
        id: 'evt-1',
        type: 'INITIAL_PURCHASE',
        app_user_id: ME,
        product_id: 'waves_pro_monthly',
        entitlement_ids: ['pro'],
        purchased_at_ms: 1_790_000_000_000,
        expiration_at_ms: 1_792_600_000_000,
        event_timestamp_ms: 1_790_000_000_000,
        store: 'APP_STORE',
        environment: 'SANDBOX',
        transaction_id: '1',
        original_transaction_id: '1',
        ...over,
      },
    }),
  });
  return handleRevenueCatWebhook(request, {
    env: (n) => ({ REVENUECAT_WEBHOOK_SECRET: SECRET, ...env })[n],
    service: { rpc },
  }).then(async (r) => (await r.json()).outcome as string);
}

describe('WAV-15 sandbox is opt-in', () => {
  it('drops a sandbox purchase and a Test Store purchase with nothing set', async () => {
    expect(await run({}, {})).toBe('ignored');
    expect(await run({}, { store: 'TEST_STORE', environment: 'PRODUCTION' })).toBe('ignored');
  });

  it('the retired opt-out variable has no effect either way', async () => {
    expect(await run({ REVENUECAT_IGNORE_SANDBOX: 'false' }, {})).toBe('ignored');
    expect(await run({ REVENUECAT_IGNORE_SANDBOX: 'true' }, {})).toBe('ignored');
  });

  it('exactly REVENUECAT_ALLOW_SANDBOX=true lets sandbox through', async () => {
    expect(await run({ REVENUECAT_ALLOW_SANDBOX: 'true' }, {})).toBe('applied');
    for (const value of ['TRUE', '1', 'yes', '']) {
      expect(await run({ REVENUECAT_ALLOW_SANDBOX: value }, {}), value).toBe('ignored');
    }
    expect(allowSandbox(() => 'true')).toBe(true);
    expect(allowSandbox(() => undefined)).toBe(false);
  });

  it('a production purchase is written regardless', async () => {
    expect(await run({}, { environment: 'PRODUCTION' })).toBe('applied');
  });
});
