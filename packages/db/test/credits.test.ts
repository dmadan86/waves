/** Server wallet contract. Requires an explicitly prepared test DB; never applies migrations. */
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it } from 'vitest';
import { connect } from './helpers';

let client: Client;
let me: string;
beforeAll(async () => {
  client = await connect();
});
afterAll(async () => {
  await client?.end();
});
// Roll back fixtures, knobs and usage together, preserving the existing database state.
beforeEach(async () => {
  await client.query('BEGIN');
  await client.query(
    `UPDATE feature_flags SET enabled=true,rollout_percent=100 WHERE key='ads_gates'`,
  );
  await client.query(
    `UPDATE feature_flags SET enabled=false WHERE key IN ('voice_agent','ads_rewarded')`,
  );
  await client.query(`UPDATE ad_reward_settings SET credits_per_ad=6,wallet_cap=30,voice_cost=1,
    scan_cost=2,export_cost=6,group_cost=6,rewarded_daily_cap=5,rewarded_hourly_cap=2,
    rewarded_gap_seconds=60,voluntary_daily_cap=3,voluntary_weekly_cap=10`);
  me = randomUUID();
  await client.query(
    `INSERT INTO profiles(id,display_name,default_currency) VALUES($1,'Credits','INR')`,
    [me],
  );
});
afterEach(async () => {
  await client.query('ROLLBACK');
});

async function rpc(name: string, args: unknown[] = []) {
  return (
    await client.query(
      `SELECT public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) AS value`,
      args,
    )
  ).rows[0].value;
}
async function mine(name: string, args: unknown[] = []) {
  // Unlike asRole(), keep this suite's outer fixture transaction intact.
  await client.query(`SELECT set_config('request.jwt.claims',$1,true)`, [
    JSON.stringify({ sub: me, role: 'authenticated' }),
  ]);
  await client.query('SET LOCAL ROLE authenticated');
  try {
    return await rpc(name, args);
  } finally {
    await client.query('RESET ROLE');
  }
}
const grant = (kind = 'credit', tx = randomUUID()) =>
  rpc('waves_ads_grant', [me, kind, tx, 'unit']);
const spend = (kind = 'voice', event = randomUUID()) => mine('waves_spend_credits', [kind, event]);
const status = () => mine('waves_my_credits');
const balance = () => rpc('waves_credit_balance', [me]);
async function fund(amount: number) {
  await client.query(`INSERT INTO credit_ledger(profile_id,delta,reason) VALUES($1,$2,'ad_gate')`, [
    me,
    amount,
  ]);
}
async function paid(store = 'play') {
  await client.query(
    `INSERT INTO subscriptions(profile_id,tier,period,status,current_period_end,store,store_txn_id)
    VALUES($1,'pro','monthly','active',now()+interval '20 days',$2,$3)`,
    [me, store, randomUUID()],
  );
}
async function rewardRows(n: number, age: string, source = 'gate', kind = 'credit') {
  await client.query(
    `INSERT INTO ad_rewards(profile_id,kind,source,amount,transaction_id,ad_unit,created_at)
    SELECT $1,$5,$4,6,gen_random_uuid()::text,'unit',now()-$3::interval
    FROM generate_series(1,$2::int)`,
    [me, n, age, source, kind],
  );
}

describe('credit grants and wallet status', () => {
  it('grants six without account-age or ads_rewarded gates; duplicate wins over gap', async () => {
    const tx = randomUUID();
    expect(await grant('credit', tx)).toMatchObject({
      outcome: 'granted',
      kind: 'credit',
      amount: 6,
      credits: 6,
    });
    expect(await grant('credit', tx)).toMatchObject({ outcome: 'duplicate' });
    expect(await balance()).toBe(6);
    expect(await status()).toMatchObject({
      credits: 6,
      walletCap: 30,
      perAd: 6,
      canWatch: false,
      reason: 'gap',
      costs: { voice: 1, scan: 2, export: 6, group: 6 },
      rewardedToday: 1,
      voluntaryToday: 0,
    });
    expect(await mine('waves_my_ad_gate_status')).toMatchObject({
      credits: 6,
      walletCap: 30,
      perAd: 6,
      costs: { voice: 1, scan: 2, export: 6, group: 6 },
    });
    expect(
      (await client.query(`SELECT reason,ref FROM credit_ledger WHERE profile_id=$1`, [me])).rows,
    ).toEqual([{ reason: 'ad_gate', ref: tx }]);
  });
  it('clamps the last award then refuses a full wallet before gap', async () => {
    await fund(28);
    expect(await grant()).toMatchObject({ amount: 2, credits: 30 });
    expect(await grant()).toMatchObject({ outcome: 'capped', reason: 'wallet_full' });
  });
  it('credits never expire', async () => {
    await fund(12);
    await client.query(
      `UPDATE credit_ledger SET created_at=now()-interval '2 years' WHERE profile_id=$1`,
      [me],
    );
    expect(await balance()).toBe(12);
  });
  it.each(['gate', 'voice', 'offer', 'voluntary'])('records the %s source', async (source) => {
    expect(await grant(`credit:${source}`)).toMatchObject({ outcome: 'granted', amount: 6 });
    expect(
      (await client.query(`SELECT source FROM ad_rewards WHERE profile_id=$1`, [me])).rows[0]
        .source,
    ).toBe(source);
    expect(
      (await client.query(`SELECT reason FROM credit_ledger WHERE profile_id=$1`, [me])).rows[0]
        .reason,
    ).toBe(`ad_${source}`);
  });
  it.each(['pro', 'trial', 'guest'])('refuses %s before awarding credits', async (kind) => {
    if (kind === 'pro') await paid();
    if (kind === 'trial') {
      await paid('trial');
      await client.query(
        `INSERT INTO pro_trials(profile_id,outcome,granted_at,expires_at)
        VALUES($1,'granted',now(),now()+interval '15 days')`,
        [me],
      );
    }
    if (kind === 'guest') {
      // The local test harness may provide only the minimal auth.users stub.
      await client.query(`CREATE TABLE IF NOT EXISTS auth.users(id uuid PRIMARY KEY)`);
      await client.query(
        `ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS is_anonymous boolean NOT NULL DEFAULT false`,
      );
      await client.query(`INSERT INTO auth.users(id,is_anonymous) VALUES($1,true)`, [me]);
    }
    expect(await grant()).toMatchObject({ outcome: 'ineligible', reason: 'ineligible' });
    expect(await status()).toMatchObject({ credits: 0, canWatch: false, reason: 'ineligible' });
  });
  it('respects the master gate switch, including allowlisted users', async () => {
    await client.query(`UPDATE feature_flags SET enabled=false WHERE key='ads_gates'`);
    await client.query(`INSERT INTO ads_allowlist(profile_id) VALUES($1)`, [me]);
    const tx = randomUUID();
    expect(await grant('credit', tx)).toMatchObject({ outcome: 'ineligible' });
    await client.query(`UPDATE feature_flags SET enabled=true WHERE key='ads_gates'`);
    expect(await grant('credit', tx)).toMatchObject({ outcome: 'duplicate' });
  });
});

describe('reward pacing', () => {
  it.each([
    ['gap', 1, '10 seconds', 60, 2, 5],
    ['hourly_cap', 2, '2 minutes', 0, 2, 5],
    ['daily_cap', 5, '0 seconds', 0, 100, 5],
  ] as const)('enforces %s across old rewards too', async (reason, n, age, gap, hourly, daily) => {
    await client.query(
      `UPDATE ad_reward_settings SET rewarded_gap_seconds=$1,rewarded_hourly_cap=$2,rewarded_daily_cap=$3`,
      [gap, hourly, daily],
    );
    await rewardRows(n, age, 'gate', 'voice');
    expect(await grant()).toMatchObject({ outcome: 'capped', reason });
    expect(await status()).toMatchObject({ canWatch: false, reason });
    expect((await status()).nextAt).toBeTruthy();
  });
  it('includes completed on-the-spot group/export ads in the shared count', async () => {
    await client.query(
      `INSERT INTO ad_events(profile_id,placement,outcome,created_at)
      VALUES($1,'group_create_rewarded','completed',now()-interval '2 minutes'),
      ($1,'export_rewarded','completed',now()-interval '2 minutes')`,
      [me],
    );
    expect(await grant()).toMatchObject({ reason: 'hourly_cap' });
  });
  it.each([
    ['voluntary_daily', 3, 3, 10],
    ['voluntary_weekly', 10, 100, 10],
  ] as const)('enforces %s only for voluntary ads', async (reason, n, daily, weekly) => {
    await client.query(
      `UPDATE ad_reward_settings SET rewarded_hourly_cap=100,rewarded_daily_cap=100,
        rewarded_gap_seconds=0,voluntary_daily_cap=$1,voluntary_weekly_cap=$2`,
      [daily, weekly],
    );
    await rewardRows(n, '0 seconds', 'voluntary');
    expect(await grant('credit:voluntary')).toMatchObject({ outcome: 'capped', reason });
    expect(await status()).toMatchObject({ canWatch: false, reason });
    expect(await grant('credit:offer')).toMatchObject({ outcome: 'granted' });
  });
});

describe('spending and quotas', () => {
  it('refuses insufficient funds and debits once per event', async () => {
    expect(await spend()).toEqual({ ok: false, reason: 'insufficient', credits: 0 });
    await fund(6);
    const event = randomUUID();
    expect(await spend('export', event)).toEqual({ ok: true, spent: 6, credits: 0 });
    expect(await spend('export', event)).toEqual({ ok: true, spent: 0, duplicate: true });
    expect(await balance()).toBe(0);
  });
  it.each([
    ['voice', 1],
    ['scan', 2],
    ['export', 6],
    ['group', 6],
  ] as const)('charges %s at its configured price', async (kind, cost) => {
    await fund(12);
    expect(await spend(kind)).toEqual({ ok: true, spent: cost, credits: 12 - cost });
  });
  it('bypasses Pro without spending', async () => {
    await fund(6);
    await paid();
    expect(await spend('group')).toEqual({ ok: true, spent: 0, bypass: true });
    expect(await balance()).toBe(6);
  });
  it('uses legacy voice bonuses before the wallet', async () => {
    await fund(1);
    await client.query(
      `INSERT INTO ad_rewards(profile_id,kind,amount,transaction_id,ad_unit)
      VALUES($1,'voice',2,$2,'unit')`,
      [me, randomUUID()],
    );
    for (let i = 0; i < 12; i++)
      expect(await rpc('waves_voice_agent_quota', [me])).toMatchObject({ allowed: true });
    expect(await balance()).toBe(1);
    expect(await rpc('waves_voice_agent_quota', [me])).toMatchObject({
      allowed: true,
      credit: true,
    });
    expect(await balance()).toBe(0);
  });
  it('returns only the current profile balance', async () => {
    const other = randomUUID();
    await client.query(
      `INSERT INTO profiles(id,display_name,default_currency) VALUES($1,'Other','INR')`,
      [other],
    );
    await client.query(
      `INSERT INTO credit_ledger(profile_id,delta,reason) VALUES($1,24,'ad_gate')`,
      [other],
    );
    await fund(2);
    expect(await status()).toMatchObject({ credits: 2 });
    await spend();
    expect(await rpc('waves_credit_balance', [other])).toBe(24);
  });
  it('draws voice credits only after the free allowance', async () => {
    await fund(2);
    for (let i = 0; i < 10; i++)
      expect(await rpc('waves_voice_agent_quota', [me])).toMatchObject({ allowed: true });
    expect(await balance()).toBe(2);
    expect(await rpc('waves_voice_agent_quota', [me])).toMatchObject({
      allowed: true,
      credit: true,
      used: 11,
    });
    expect(await rpc('waves_voice_agent_quota', [me])).toMatchObject({
      allowed: true,
      credit: true,
      used: 12,
    });
    expect(await rpc('waves_voice_agent_quota', [me])).toMatchObject({ allowed: false });
    expect(await balance()).toBe(0);
  });
  it('adds one scan slot per purchase, with unused slots lapsing at UTC month end', async () => {
    await fund(6);
    expect(await mine('waves_receipt_scan_quota')).toMatchObject({ limit: 20 });
    await spend('scan');
    expect(await mine('waves_receipt_scan_quota')).toMatchObject({ limit: 21, bonus: 1 });
    await client.query(
      `UPDATE credit_ledger SET created_at=(date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') - interval '1 second'
      WHERE profile_id=$1 AND reason='spend_scan'`,
      [me],
    );
    expect(await mine('waves_receipt_scan_quota')).toMatchObject({ limit: 20, bonus: 0 });
    expect(await balance()).toBe(4);
  });
});

describe('admin and privileges', () => {
  it('sums absolute credits by reason and preserves absent admin settings', async () => {
    await grant();
    await spend('scan');
    const rows = (await client.query(`SELECT * FROM waves_admin_credit_stats(30)`)).rows;
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: 'ad_gate', events: '1', credits: '6' }),
        expect.objectContaining({ reason: 'spend_scan', events: '1', credits: '2' }),
      ]),
    );
    await rpc('waves_admin_save_ad_settings', [
      { voice_cost: 3, interstitial_video_enabled: true },
    ]);
    expect(
      (
        await client.query(
          `SELECT voice_cost,scan_cost,gap_min,interstitial_video_enabled FROM ad_reward_settings`,
        )
      ).rows[0],
    ).toMatchObject({ voice_cost: 3, scan_cost: 2, interstitial_video_enabled: true });
  });
  it('exposes only self read/spend plus the existing gate and scan RPCs to authenticated', async () => {
    const fns: Record<string, boolean> = {
      'waves_credit_balance(uuid)': false,
      'waves_credit_status(uuid,text)': false,
      'waves_ads_grant(uuid,text,text,text)': false,
      'waves_admin_credit_stats(integer)': false,
      'waves_admin_save_ad_settings(jsonb)': false,
      'waves_voice_agent_quota(uuid,integer,integer,integer,integer)': false,
      'waves_my_credits()': true,
      'waves_spend_credits(text,uuid)': true,
      'waves_my_ad_gate_status()': true,
      'waves_receipt_scan_quota()': true,
    };
    for (const [fn, allowed] of Object.entries(fns)) {
      for (const role of ['anon', 'authenticated']) {
        expect(
          (
            await client.query(`SELECT has_function_privilege($1,$2,'EXECUTE') AS ok`, [
              role,
              `public.${fn}`,
            ])
          ).rows[0].ok,
          `${role}: ${fn}`,
        ).toBe(role === 'authenticated' && allowed);
      }
      if (!allowed)
        expect(
          (
            await client.query(`SELECT has_function_privilege('service_role',$1,'EXECUTE') AS ok`, [
              `public.${fn}`,
            ])
          ).rows[0].ok,
        ).toBe(true);
    }
  });
});
