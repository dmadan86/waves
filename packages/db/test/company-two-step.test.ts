import { randomUUID } from 'node:crypto';

import type { Client } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { connect } from './helpers';

/**
 * Company two-step login. A company that requires it is invisible and unwritable from a session that has not
 * verified (no mark in two_step_sessions), through every path: RLS on every company table, SECURITY DEFINER RPCs,
 * and the write guard. A verified session works; personal groups and companies that do not require it are untouched.
 *
 * People: 0 owner (admin), 1 manager, 2 member (reports to 1), 3 owner of a second, non-requiring company.
 */
let db: Client;
const p = [randomUUID(), randomUUID(), randomUUID(), randomUUID()] as const;
const m = [randomUUID(), randomUUID(), randomUUID()] as const;
const COMPANY = randomUUID();
const OPEN_MEMBER = randomUUID();
const OPEN_COMPANY = randomUUID();
const PERSONAL = randomUUID();
const VERIFIED = randomUUID();
const UNVERIFIED = randomUUID();
const day = new Date().toISOString().slice(0, 10);

type Claims = Record<string, unknown>;
const claims = (i: number, session: string | null | undefined, extra: Claims = {}): Claims => ({
  sub: p[i],
  role: 'authenticated',
  ...(session === undefined ? {} : { session_id: session }),
  ...extra,
});

/** Run as a caller inside a savepoint that is always rolled back. */
async function as<T>(c: Claims, run: () => Promise<T>, role = 'authenticated'): Promise<T> {
  await db.query('SAVEPOINT actor');
  try {
    await db.query("SELECT set_config('request.jwt.claims',$1,true)", [JSON.stringify(c)]);
    await db.query(`SET LOCAL ROLE ${role}`);
    return await run();
  } finally {
    await db.query('ROLLBACK TO SAVEPOINT actor');
    await db.query('RESET ROLE');
    await db.query("SELECT set_config('request.jwt.claims','',true)");
    await db.query('RELEASE SAVEPOINT actor');
  }
}

async function fails(run: () => Promise<unknown>): Promise<string> {
  await db.query('SAVEPOINT failing');
  try {
    await run();
  } catch (error) {
    await db.query('ROLLBACK TO SAVEPOINT failing');
    return (error as Error).message;
  }
  await db.query('RELEASE SAVEPOINT failing');
  throw new Error('expected a refusal');
}

/** Committed as the owner with a verified session, like the app would. */
async function asOwnerVerified(sql: string, params: unknown[]) {
  await db.query('BEGIN');
  try {
    await db.query("SELECT set_config('request.jwt.claims',$1,true)", [
      JSON.stringify(claims(0, VERIFIED)),
    ]);
    await db.query('SET LOCAL ROLE authenticated');
    await db.query(sql, params);
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}

/** Tables with RLS and a group_id: the company data a session reads through policies. */
let groupTables: string[] = [];

beforeAll(async () => {
  db = await connect();
  for (const [i, id] of p.entries()) {
    await db.query(
      `INSERT INTO profiles (id, display_name, default_currency) VALUES ($1, $2, 'INR')`,
      [id, `P${i}`],
    );
  }
  await db.query(
    "INSERT INTO groups(id,name,type,default_currency,country_code,created_by) VALUES($1,'Acme Works','company','INR','IN',$2)",
    [COMPANY, p[0]],
  );
  const roles = ['admin', 'manager', 'member'];
  for (let i = 0; i < 3; i += 1) {
    await db.query(
      'INSERT INTO group_members(id,group_id,profile_id,role,manager_id) VALUES($1,$2,$3,$4,$5)',
      [m[i], COMPANY, p[i], roles[i], i === 2 ? m[1] : null],
    );
  }
  await db.query(
    "INSERT INTO groups(id,name,type,default_currency,country_code,created_by) VALUES($1,'Open Co','company','INR','IN',$2)",
    [OPEN_COMPANY, p[0]],
  );
  await db.query("INSERT INTO group_members(group_id,profile_id,role) VALUES($1,$2,'admin')", [
    OPEN_COMPANY,
    p[0],
  ]);
  await db.query(
    "INSERT INTO group_members(id,group_id,profile_id,role) VALUES($1,$2,$3,'member')",
    [OPEN_MEMBER, OPEN_COMPANY, p[3]],
  );
  await db.query(
    "INSERT INTO groups(id,name,type,default_currency,created_by) VALUES($1,'Goa','trip','INR',$2)",
    [PERSONAL, p[0]],
  );
  await db.query(
    "INSERT INTO group_members(group_id,profile_id,role) VALUES($1,$2,'admin'),($1,$3,'member')",
    [PERSONAL, p[0], p[3]],
  );
  // The owner's phone is verified; sessions are written by the edge functions (service role) in real life.
  await db.query(
    "INSERT INTO two_step_sessions(session_id, profile_id, kind) VALUES ($1,$2,'phone'),($1,$3,'phone')",
    [VERIFIED, p[0], p[2]],
  );
  // Company data, written the normal way while two-step is still off.
  for (const [g, member] of [
    [COMPANY, m[2]],
    [OPEN_COMPANY, OPEN_MEMBER],
  ] as const) {
    await asOwnerVerified(
      "SELECT waves_company_work_set($1,$2,$3,$4,'Paint wall',NULL,'todo',NULL,NULL)",
      [g, randomUUID(), member, day],
    );
    await asOwnerVerified('SELECT waves_company_doc_save($1,$2,$3)', [
      g,
      randomUUID(),
      JSON.stringify({
        docType: 'estimate',
        customerName: 'Ravi',
        docDate: day,
        items: [{ description: 'Paint', qtyMilli: '1000', rateMinor: '100' }],
      }),
    ]);
  }
  await asOwnerVerified("SELECT waves_company_attendance_set($1,$2,$3,'present',NULL)", [
    COMPANY,
    m[2],
    day,
  ]);
  await db.query(
    "INSERT INTO activity_log(group_id, verb, object_type) VALUES ($1,'test','group'),($2,'test','group'),($3,'test','group')",
    [COMPANY, OPEN_COMPANY, PERSONAL],
  );
  await db.query(
    "INSERT INTO notifications(profile_id, group_id, kind, title, body) VALUES ($1,$2,'x','Salary paid 5000','b'),($1,NULL,'x','personal','b')",
    [p[2], COMPANY],
  );
  // Now the owner turns it on (the RPC is tested below; set directly here).
  await db.query('UPDATE groups SET require_two_step = true WHERE id = $1', [COMPANY]);

  const { rows } = await db.query<{ table_name: string }>(
    `SELECT DISTINCT c.table_name FROM information_schema.columns c JOIN pg_class k ON k.relname = c.table_name
      JOIN pg_namespace n ON n.oid = k.relnamespace AND n.nspname = 'public'
     WHERE c.table_schema = 'public' AND c.column_name = 'group_id' AND k.relkind = 'r' AND k.relrowsecurity
       AND has_table_privilege('authenticated', k.oid, 'SELECT')
     ORDER BY 1`,
  );
  groupTables = rows.map((r) => r.table_name);
});

afterAll(async () => {
  // Rows stay, like the other suites (activity_log is append-only); every id here is random.
  if (db) await db.end();
});

/** Each test in these blocks runs in a transaction that is rolled back. */
function rolledBack() {
  beforeEach(async () => {
    await db.query('BEGIN');
  });
  afterEach(async () => {
    await db.query('ROLLBACK');
  });
}

async function visible(c: Claims, table: string, group: string): Promise<number> {
  return as(c, async () => {
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM public.${table} WHERE group_id = $1`,
      [group],
    );
    return rows[0].n as number;
  });
}

describe('reads: every company table, through RLS', () => {
  rolledBack();
  it('found the company tables to check', () => {
    expect(groupTables.length).toBeGreaterThan(40);
    expect(groupTables).toEqual(
      expect.arrayContaining(['company_work_tasks', 'company_documents', 'group_members']),
    );
  });

  it('an unverified session sees nothing of a company that requires two-step, in any table', async () => {
    for (const session of [UNVERIFIED, null, 'not-a-uuid', undefined]) {
      for (const owner of [0, 2]) {
        const seen: Record<string, number> = {};
        for (const table of groupTables) {
          const n = await visible(claims(owner, session), table, COMPANY);
          if (n > 0) seen[table] = n;
        }
        expect(seen, `session ${String(session)}, person ${owner}`).toEqual({});
        const groups = await as(claims(owner, session), () =>
          db.query('SELECT id FROM groups WHERE id=$1', [COMPANY]),
        );
        expect(groups.rowCount).toBe(0);
      }
    }
  });

  it('a verified session sees the same company', async () => {
    const seen: string[] = [];
    for (const table of groupTables) {
      if ((await visible(claims(0, VERIFIED), table, COMPANY)) > 0) seen.push(table);
    }
    expect(seen).toEqual(
      expect.arrayContaining([
        'group_members',
        'company_work_tasks',
        'company_documents',
        'activity_log',
      ]),
    );
    expect(await visible(claims(2, VERIFIED), 'notifications', COMPANY)).toBe(1);
    expect(await visible(claims(2, VERIFIED), 'company_attendance', COMPANY)).toBeGreaterThan(0);
  });

  it('leaves personal groups and companies that do not require it alone', async () => {
    for (const session of [UNVERIFIED, undefined]) {
      expect(await visible(claims(0, session), 'group_members', PERSONAL)).toBe(2);
      expect(await visible(claims(0, session), 'activity_log', PERSONAL)).toBe(1);
      expect(await visible(claims(3, session), 'group_members', OPEN_COMPANY)).toBeGreaterThan(0);
      expect(await visible(claims(0, session), 'company_work_tasks', OPEN_COMPANY)).toBe(1);
      expect(await visible(claims(0, session), 'company_documents', OPEN_COMPANY)).toBe(1);
    }
  });

  it('hides company colleagues and company notices, not your own profile or personal notices', async () => {
    const ids = async (c: Claims) =>
      (await as(c, () => db.query('SELECT id FROM profiles WHERE id = ANY($1)', [p]))).rows.map(
        (r) => r.id as string,
      );
    // The owner shares only the two-step company with p1 and p2, and a personal group with p3.
    expect((await ids(claims(0, UNVERIFIED))).sort()).toEqual([p[0], p[3]].sort());
    expect((await ids(claims(0, VERIFIED))).sort()).toEqual([...p].sort());
    const notes = await as(claims(2, UNVERIFIED), () =>
      db.query('SELECT title FROM notifications WHERE profile_id = $1', [p[2]]),
    );
    expect(notes.rows.map((r) => r.title)).toEqual(['personal']);
  });
});

describe('writes: every company table and the RPCs', () => {
  rolledBack();
  it('an unverified session can update, delete or insert nothing in any company table', async () => {
    const problems: string[] = [];
    for (const table of groupTables) {
      const sample = await db.query(
        `SELECT to_jsonb(t) AS row FROM public.${table} t WHERE group_id = $1 LIMIT 1`,
        [COMPANY],
      );
      await as(claims(0, UNVERIFIED), async () => {
        for (const sql of [
          `UPDATE public.${table} SET group_id = group_id WHERE group_id = $1`,
          `DELETE FROM public.${table} WHERE group_id = $1`,
        ]) {
          await db.query('SAVEPOINT w');
          try {
            const r = await db.query(sql, [COMPANY]);
            if ((r.rowCount ?? 0) > 0) problems.push(`${sql} touched ${r.rowCount}`);
          } catch {
            /* refused: fine */
          } finally {
            await db.query('ROLLBACK TO SAVEPOINT w');
          }
        }
        if (sample.rowCount) {
          const row = {
            ...sample.rows[0].row,
            ...('id' in sample.rows[0].row ? { id: randomUUID() } : {}),
          };
          await db.query('SAVEPOINT w');
          try {
            await db.query(
              `INSERT INTO public.${table} SELECT * FROM jsonb_populate_record(NULL::public.${table}, $1)`,
              [JSON.stringify(row)],
            );
            problems.push(`insert into ${table} succeeded`);
          } catch (error) {
            const message = (error as Error).message;
            if (
              !/TWO_STEP_REQUIRED|row-level security|permission denied|FORBIDDEN_COLUMN/.test(
                message,
              )
            ) {
              problems.push(`insert into ${table}: ${message}`);
            }
          } finally {
            await db.query('ROLLBACK TO SAVEPOINT w');
          }
        }
      });
    }
    expect(problems).toEqual([]);
  });

  it('company RPCs refuse an unverified session and work for a verified one', async () => {
    const work = (c: Claims) =>
      as(c, () =>
        db.query("SELECT waves_company_work_set($1,$2,$3,$4,'Paint',NULL,'todo',NULL,NULL)", [
          COMPANY,
          randomUUID(),
          m[2],
          day,
        ]),
      );
    expect(await fails(() => work(claims(0, UNVERIFIED)))).toMatch(/TWO_STEP_REQUIRED/);
    expect(await fails(() => work(claims(0, undefined)))).toMatch(/TWO_STEP_REQUIRED/);
    await work(claims(0, VERIFIED));
    const actor = (c: Claims) =>
      as(c, () => db.query('SELECT waves_company_actor($1) AS id', [COMPANY]));
    expect(await fails(() => actor(claims(2, UNVERIFIED)))).toMatch(/TWO_STEP_REQUIRED/);
    expect((await actor(claims(2, VERIFIED))).rows[0].id).toBe(m[2]);
    const helpers = await as(claims(0, UNVERIFIED), () =>
      db.query(
        `SELECT is_group_member($1) a, is_group_admin($1) b, waves_my_member_id($1) c, waves_company_member_ok($1) d,
                waves_company_detail($1,$2) e, waves_company_card_role($1) f, waves_company_manager_ok($1,$3) g,
                waves_my_member_id_for($1,$4) h`,
        [COMPANY, m[2], m[1], p[0]],
      ),
    );
    expect(helpers.rows[0]).toEqual({
      a: false,
      b: false,
      c: null,
      d: false,
      e: false,
      f: null,
      g: false,
      h: null,
    });
    const past = await as(claims(0, UNVERIFIED), () =>
      db.query('SELECT * FROM waves_company_past_people($1)', [OPEN_COMPANY]),
    );
    expect(past.rows.filter((r) => r.source_group_id === COMPANY)).toEqual([]);
  });

  it('the write guard stops a definer RPC that checks membership itself', async () => {
    // waves_company_report finds the caller in group_members on its own; the guard on company_complaints refuses.
    const report = (session: string) =>
      as(claims(2, session), () =>
        db.query("SELECT waves_company_report($1,'other','The tap leaks') AS r", [COMPANY]),
      );
    expect(await fails(() => report(UNVERIFIED))).toMatch(/TWO_STEP_REQUIRED/);
    expect((await report(VERIFIED)).rows[0].r).toMatchObject({ ok: true });
    // A plain RLS update from an unverified session simply matches nothing.
    const update = await as(claims(0, UNVERIFIED), () =>
      db.query('UPDATE group_members SET payment_handle = payment_handle WHERE id = $1', [m[0]]),
    );
    expect(update.rowCount).toBe(0);
  });

  it('every SECURITY DEFINER function that finds the caller in group_members goes through the gate', async () => {
    const { rows } = await db.query<{ proname: string }>(
      `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.prosecdef AND p.prosrc ~ 'group_members'
          AND p.prosrc ~ '(waves_current_profile_id|auth\\.uid)'
          AND p.prosrc !~ '(waves_two_step|is_group_member|is_group_admin|waves_my_member_id|waves_company_actor|waves_company_detail|waves_company_member_ok|waves_company_team)'
        ORDER BY 1`,
    );
    // Each reviewed: they write only (the write guard refuses an unverified caller in a two-step company), or they
    // return nothing from a company beyond the caller's own requests and counts.
    const reviewed: Record<string, string> = {
      waves_can_add_receipt: 'boolean only; the receipt write itself is guarded',
      waves_cancel_member_link: 'writes member_link_requests (guarded)',
      waves_claim_member_as_me: 'writes group_members (guarded)',
      waves_company_report: 'writes company_complaints (guarded)',
      waves_create_group: 'creates a new group (never requires two-step yet)',
      waves_delete_my_account: 'erases the caller; anonymising own member rows is allowed',
      waves_find_person: 'returns a profile id by contact, no company data',
      waves_import_into_group: 'writes expenses (guarded)',
      waves_import_ledger: 'writes expenses (guarded)',
      waves_log_member_changes: 'trigger on a guarded write',
      waves_merge_ghosts: 'writes group_members / ghost_merges (guarded)',
      waves_merge_member_into: 'writes group_members (guarded)',
      waves_my_erasure_preview: 'counts only, for the caller',
      waves_my_member_claims: "the caller's own requests",
      waves_my_member_links: "the caller's own requests",
      waves_nudge_to_settle:
        'writes notifications with the group (guard on reminders/notice tables)',
      waves_person_profile: 'company branches use waves_company_detail (gated)',
      waves_remove_company_vendor_entry_image: 'writes company attachments (guarded)',
      waves_request_member_link: 'writes member_link_requests (guarded)',
      waves_shares_a_group_with: 'company branch uses waves_company_detail (gated)',
      waves_undo_import: 'writes expenses (guarded); uses waves_my_member_id_for (gated)',
      waves_decide_member_claim: 'writes group_members (guarded); uses waves_company_team (gated)',
      waves_decide_member_link: 'the target joining; writes group_members (guarded)',
      waves_add_ghost_member:
        'writes group_members (guarded); company path uses waves_company_actor',
      waves_can_upload_group_photo: 'boolean only; the photo write is guarded',
      waves_two_step_may_act_for:
        'rank check for reset/approval; callers demand a verified session first',
      waves_two_step_role: 'two-step RPCs look the role up ungated, then demand a verified session',
    };
    const unreviewed = rows.map((r) => r.proname).filter((name) => !(name in reviewed));
    expect(unreviewed).toEqual([]);
  });
});

describe('agents and API tokens (decision 5)', () => {
  rolledBack();
  it('an assistant reaches a two-step company only through a link made from a verified session', async () => {
    const client = 'claude-test';
    await db.query('UPDATE groups SET company_agents_enabled = true WHERE id = $1', [COMPANY]);
    const link = await db.query(
      'INSERT INTO company_agent_links(group_id, profile_id, client_id) VALUES ($1,$2,$3) RETURNING id',
      [COMPANY, p[0], client],
    );
    const agent = claims(0, undefined, { client_id: client });
    expect(await visible(agent, 'company_work_tasks', COMPANY)).toBe(0);
    await db.query('UPDATE company_agent_links SET two_step_verified_at = now() WHERE id = $1', [
      link.rows[0].id,
    ]);
    expect(await visible(agent, 'company_work_tasks', COMPANY)).toBeGreaterThan(0);
    await db.query('DELETE FROM company_agent_links WHERE id = $1', [link.rows[0].id]);
  });

  it('linking stamps the link only from a verified session', async () => {
    await db.query('UPDATE groups SET company_agents_enabled = true WHERE id = $1', [OPEN_COMPANY]);
    for (const [session, stamped] of [
      [UNVERIFIED, false],
      [VERIFIED, true],
    ] as const) {
      const row = await as(claims(0, session), async () => {
        await db.query("SELECT waves_company_agent_link($1, 'cli-x')", [OPEN_COMPANY]);
        await db.query('RESET ROLE');
        return db.query(
          "SELECT two_step_verified_at FROM company_agent_links WHERE client_id = 'cli-x'",
        );
      });
      expect(row.rows[0].two_step_verified_at !== null).toBe(stamped);
    }
  });

  it('a developer-API token needs a verified origin', async () => {
    const id = randomUUID();
    const hash = 'a'.repeat(64);
    await db.query(
      `INSERT INTO api_tokens(id, profile_id, kind, token_hash, token_prefix, scopes)
       VALUES ($1,$2,'personal',$3,'wavs_pat_abcd', (SELECT ARRAY[min(s)] FROM unnest(waves_api_known_scopes()) s))`,
      [id, p[0], hash],
    );
    const api = claims(0, undefined, { waves_token_id: id });
    const stamp = await db.query('SELECT two_step_verified_at FROM api_tokens WHERE id = $1', [id]);
    expect(stamp.rows[0].two_step_verified_at).toBeNull();
    expect(await visible(api, 'company_work_tasks', COMPANY)).toBe(0);
    expect(await visible(api, 'company_work_tasks', OPEN_COMPANY)).toBe(1);
    await db.query('UPDATE api_tokens SET two_step_verified_at = now() WHERE id = $1', [id]);
    expect(await visible(api, 'company_work_tasks', COMPANY)).toBeGreaterThan(0);
    await db.query('DELETE FROM api_tokens WHERE id = $1', [id]);
  });
});

describe('toggle, reset and new-phone approval', () => {
  rolledBack();
  const setFlag = (on: boolean) =>
    db.query('UPDATE feature_flags SET enabled = $1 WHERE key = $2', [on, 'company_two_step']);

  it('turning it on: owner or manager, verified, and only while the flag is on', async () => {
    const toggle = (i: number, s: string, on = true) =>
      as(claims(i, s), () =>
        db.query('SELECT waves_company_set_two_step($1,$2)', [OPEN_COMPANY, on]),
      );
    {
      await setFlag(false);
      expect(await fails(() => toggle(0, VERIFIED))).toMatch(/FEATURE_OFF/);
      await setFlag(true);
      expect(await fails(() => toggle(0, UNVERIFIED))).toMatch(/TWO_STEP_REQUIRED/);
      expect(await fails(() => toggle(3, VERIFIED))).toMatch(/NOT_ALLOWED/);
      await as(claims(0, VERIFIED), async () => {
        await db.query('SELECT waves_company_set_two_step($1,true)', [OPEN_COMPANY]);
        const { rows } = await db.query('SELECT require_two_step FROM groups WHERE id = $1', [
          OPEN_COMPANY,
        ]);
        expect(rows[0].require_two_step).toBe(true);
      });
      // Never by a direct write, even by the owner.
      expect(
        await fails(() =>
          as(claims(0, VERIFIED), () =>
            db.query('UPDATE groups SET require_two_step = false WHERE id = $1', [COMPANY]),
          ),
        ),
      ).toMatch(/FORBIDDEN_COLUMN/);
    }
  });

  it('a manager resets a member but never an owner; a member resets nobody', async () => {
    {
      await db.query(
        "INSERT INTO two_step_sessions(session_id, profile_id, kind) VALUES ($1,$2,'phone')",
        [VERIFIED, p[1]],
      );
      await db.query(
        "INSERT INTO two_step_secrets(profile_id, kind, secret_enc, active) VALUES ($1,'phone',repeat('x',40),true)",
        [p[2]],
      );
      const tokenId = randomUUID();
      await db.query(
        `INSERT INTO api_tokens(id, profile_id, kind, token_hash, token_prefix, scopes, two_step_verified_at)
         VALUES ($1,$2,'personal',$3,'wavs_pat_rset', (SELECT ARRAY[min(s)] FROM unnest(waves_api_known_scopes()) s), now())`,
        [tokenId, p[2], 'b'.repeat(64)],
      );
      const reset = (i: number, target: string) =>
        as(claims(i, VERIFIED), () =>
          db.query('SELECT waves_two_step_reset($1,$2)', [COMPANY, target]),
        );
      expect(await fails(() => reset(1, m[0]))).toMatch(/NOT_ALLOWED/);
      expect(await fails(() => reset(2, m[1]))).toMatch(/NOT_ALLOWED/);
      expect(
        await fails(() =>
          as(claims(1, UNVERIFIED), () =>
            db.query('SELECT waves_two_step_reset($1,$2)', [COMPANY, m[2]]),
          ),
        ),
      ).toMatch(/TWO_STEP_REQUIRED/);
      await as(claims(1, VERIFIED), async () => {
        await db.query('SELECT waves_two_step_reset($1,$2)', [COMPANY, m[2]]);
        await db.query('RESET ROLE');
        const left = await db.query(
          'SELECT count(*)::int n FROM two_step_secrets WHERE profile_id = $1',
          [p[2]],
        );
        expect(left.rows[0].n).toBe(0);
        const stamp = await db.query('SELECT two_step_verified_at FROM api_tokens WHERE id = $1', [
          tokenId,
        ]);
        expect(stamp.rows[0].two_step_verified_at).toBeNull();
        const marks = await db.query(
          'SELECT count(*)::int n FROM two_step_sessions WHERE profile_id = $1',
          [p[2]],
        );
        expect(marks.rows[0].n).toBe(0);
        const told = await db.query(
          "SELECT count(*)::int n FROM notifications WHERE kind = 'two_step_reset' AND profile_id = ANY($1)",
          [[p[0], p[2]]],
        );
        expect(told.rows[0].n).toBe(2);
      });
    }
  });

  it("new phones: approved by an owner, never by yourself, never an owner's by a manager", async () => {
    {
      await db.query(
        "INSERT INTO two_step_sessions(session_id, profile_id, kind) VALUES ($1,$2,'phone')",
        [VERIFIED, p[1]],
      );
      const memberReq = (
        await db.query('SELECT waves_two_step_request_device($1,$2,$3,$4) AS id', [
          p[2],
          randomUUID(),
          'new-phone',
          'android',
        ])
      ).rows[0].id;
      const ownerReq = (
        await db.query('SELECT waves_two_step_request_device($1,$2,$3,$4) AS id', [
          p[0],
          randomUUID(),
          'owner-new',
          'ios',
        ])
      ).rows[0].id;
      const decide = (i: number, req: string) =>
        as(claims(i, VERIFIED), () =>
          db.query('SELECT waves_two_step_decide_device($1,$2,true)', [req, COMPANY]),
        );
      expect(await fails(() => decide(1, ownerReq))).toMatch(/NOT_ALLOWED/);
      expect(await fails(() => decide(0, ownerReq))).toMatch(/NOT_ALLOWED/);
      const overview = await as(claims(1, VERIFIED), () =>
        db.query('SELECT waves_company_two_step_overview($1) AS o', [COMPANY]),
      );
      expect(
        overview.rows[0].o.pendingDevices.map((d: { requestId: string }) => d.requestId),
      ).toEqual([memberReq]);
      await as(claims(0, VERIFIED), async () => {
        await db.query('SELECT waves_two_step_decide_device($1,$2,true)', [memberReq, COMPANY]);
        await db.query('RESET ROLE');
        const { rows } = await db.query(
          'SELECT status FROM two_step_device_requests WHERE id = $1',
          [memberReq],
        );
        expect(rows[0].status).toBe('approved');
      });
    }
  });
});

describe('reset and approval reach every company the person is in', () => {
  rolledBack();
  // Company B also requires two-step. p2 (a plain member of COMPANY, managed by p1) owns B; p0 and p1 are not in B.
  const B = randomUUID();
  async function seedB() {
    await db.query(
      "INSERT INTO groups(id,name,type,default_currency,country_code,created_by,require_two_step) VALUES($1,'B Co','company','INR','IN',$2,true)",
      [B, p[2]],
    );
    await db.query("INSERT INTO group_members(group_id,profile_id,role) VALUES($1,$2,'admin')", [
      B,
      p[2],
    ]);
    await db.query(
      "INSERT INTO two_step_sessions(session_id, profile_id, kind) VALUES ($1,$2,'phone')",
      [VERIFIED, p[1]],
    );
  }
  const reset = (i: number, group: string, member: string) =>
    as(claims(i, VERIFIED), () => db.query('SELECT waves_two_step_reset($1,$2)', [group, member]));
  const approve = (i: number, request: string, group: string) =>
    as(claims(i, VERIFIED), () =>
      db.query('SELECT waves_two_step_decide_device($1,$2,true)', [request, group]),
    );
  const request = async (profile: string) =>
    (
      await db.query('SELECT waves_two_step_request_device($1,$2,$3,NULL) AS id', [
        profile,
        randomUUID(),
        `dev-${profile}`,
      ])
    ).rows[0].id as string;

  it('nobody outside company B can reset its owner from another company', async () => {
    await seedB();
    // Manager of p2 in COMPANY, and even COMPANY's owner: neither outranks p2 in B.
    expect(await fails(() => reset(1, COMPANY, m[2]))).toMatch(/NOT_ALLOWED/);
    expect(await fails(() => reset(0, COMPANY, m[2]))).toMatch(/NOT_ALLOWED/);
  });

  it('nobody outside company B can approve a new phone for its owner', async () => {
    await seedB();
    const req = await request(p[2]);
    expect(await fails(() => approve(1, req, COMPANY))).toMatch(/NOT_ALLOWED/);
    expect(await fails(() => approve(0, req, COMPANY))).toMatch(/NOT_ALLOWED/);
    const overview = await as(claims(0, VERIFIED), () =>
      db.query('SELECT waves_company_two_step_overview($1) AS o', [COMPANY]),
    );
    expect(overview.rows[0].o.pendingDevices).toEqual([]);
  });

  it('an owner of every company the person is in may act', async () => {
    await seedB();
    await db.query("INSERT INTO group_members(group_id,profile_id,role) VALUES($1,$2,'admin')", [
      B,
      p[0],
    ]);
    await reset(0, COMPANY, m[2]);
    const req = await request(p[2]);
    await approve(0, req, COMPANY);
  });

  it('only from a company that itself requires two-step', async () => {
    const member = (
      await db.query('SELECT id FROM group_members WHERE group_id=$1 AND profile_id=$2', [
        OPEN_COMPANY,
        p[3],
      ])
    ).rows[0].id as string;
    expect(await fails(() => reset(0, OPEN_COMPANY, member))).toMatch(/NOT_ALLOWED/);
    const openReq = await request(p[3]);
    expect(await fails(() => approve(0, openReq, OPEN_COMPANY))).toMatch(/NOT_ALLOWED/);
  });
});

describe('review fixes: phone takeover, dead sessions, pushes, the member flag', () => {
  rolledBack();

  it('a session mark or a reused code never moves the phone factor', async () => {
    const old = (
      await db.query(
        "INSERT INTO two_step_secrets(profile_id, kind, device_id, secret_enc, active) VALUES ($1,'phone','old-phone',repeat('o',40),true) RETURNING id",
        [p[3]],
      )
    ).rows[0].id as string;
    const thief = randomUUID();
    await db.query(
      "INSERT INTO two_step_sessions(session_id, profile_id, kind) VALUES ($1,$2,'phone')",
      [thief, p[3]],
    );
    const trust = (mode: string, step: number | null) =>
      db.query(
        "SELECT waves_two_step_trust_phone($1,$2,'thief-phone',repeat('t',40),$3,$4,$5) AS r",
        [p[3], thief, mode, step === null ? null : old, step],
      );
    // No 'code' without a fresh code, even on a marked session; no 'first' once a factor exists; no approval.
    expect((await trust('code', null)).rows[0].r).toMatchObject({ ok: false });
    expect((await trust('first', null)).rows[0].r).toMatchObject({
      ok: false,
      reason: 'HAS_FACTOR',
    });
    expect((await trust('approved', null)).rows[0].r).toMatchObject({
      ok: false,
      reason: 'NOT_APPROVED',
    });
    // A fresh code moves it once; the same step cannot move it again.
    expect((await trust('code', 9000)).rows[0].r).toMatchObject({ ok: true });
    const phones = await db.query(
      "SELECT device_id FROM two_step_secrets WHERE profile_id = $1 AND kind = 'phone'",
      [p[3]],
    );
    expect(phones.rows.map((r) => r.device_id)).toEqual(['thief-phone']);
    const told = await db.query(
      "SELECT count(*)::int n FROM notifications WHERE profile_id = $1 AND kind = 'two_step_new_phone'",
      [p[3]],
    );
    expect(told.rows[0].n).toBe(1);
  });

  it('a revoked GoTrue session stops passing the gate', async () => {
    await db.query('CREATE SCHEMA IF NOT EXISTS auth');
    await db.query('CREATE TABLE IF NOT EXISTS auth.sessions (id uuid PRIMARY KEY, user_id uuid)');
    await db.query('INSERT INTO auth.sessions(id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [
      VERIFIED,
      p[0],
    ]);
    expect(await visible(claims(0, VERIFIED), 'company_work_tasks', COMPANY)).toBeGreaterThan(0);
    await db.query('DELETE FROM auth.sessions WHERE id = $1', [VERIFIED]);
    expect(await visible(claims(0, VERIFIED), 'company_work_tasks', COMPANY)).toBe(0);
  });

  it('signing a device out, or signing out other devices, drops their marks', async () => {
    const other = randomUUID();
    await db.query(
      "INSERT INTO two_step_sessions(session_id, profile_id, kind, device_id) VALUES ($1,$2,'phone','dev-x'),($3,$2,'web',NULL)",
      [randomUUID(), p[1], other],
    );
    await db.query("INSERT INTO device_sessions(profile_id, device_id) VALUES ($1,'dev-x')", [
      p[1],
    ]);
    await db.query(
      "UPDATE device_sessions SET revoked_at = now() WHERE profile_id = $1 AND device_id = 'dev-x'",
      [p[1]],
    );
    const phone = await db.query(
      "SELECT count(*)::int n FROM two_step_sessions WHERE profile_id = $1 AND device_id = 'dev-x'",
      [p[1]],
    );
    expect(phone.rows[0].n).toBe(0);
    const mine = randomUUID();
    await db.query(
      "INSERT INTO two_step_sessions(session_id, profile_id, kind) VALUES ($1,$2,'phone')",
      [mine, p[1]],
    );
    // Not through as(): its savepoint would roll the sign-out back before we look.
    await db.query("SELECT set_config('request.jwt.claims',$1,true)", [
      JSON.stringify(claims(1, mine)),
    ]);
    await db.query('SET LOCAL ROLE authenticated');
    await db.query("SELECT waves_sign_out_other_devices('this-phone')");
    await db.query('RESET ROLE');
    const left = await db.query('SELECT session_id FROM two_step_sessions WHERE profile_id = $1', [
      p[1],
    ]);
    expect(left.rows.map((r) => r.session_id)).toEqual([mine]);
  });

  it('pushes about a two-step company carry no company detail', async () => {
    await db.query(
      'INSERT INTO push_tokens(profile_id, expo_push_token, platform) VALUES ($1,\'ExponentPushToken[x]\',(enum_range(NULL::"DevicePlatform"))[1])',
      [p[2]],
    );
    const ids = (
      await db.query(
        `INSERT INTO notifications(profile_id, group_id, kind, title, body, deep_link, payload) VALUES
          ($1,$2,'x','Salary paid 5000','to Ravi','/c/1','{"amount":5000}'),
          ($1,$3,'x','Dinner 300','Goa','/g/2','{"amount":300}') RETURNING id`,
        [p[2], COMPANY, PERSONAL],
      )
    ).rows.map((r) => r.id as string);
    const sent = await db.query(
      'SELECT * FROM waves_claim_push_notifications(1000) WHERE id = ANY($1)',
      [ids],
    );
    const byId = new Map(sent.rows.map((r) => [r.id as string, r]));
    expect(byId.get(ids[0]!)).toMatchObject({
      title: 'New activity in your company',
      body: 'Open Waves to see it.',
      deep_link: null,
      payload: {},
    });
    expect(byId.get(ids[1]!)).toMatchObject({
      title: 'Dinner 300',
      body: 'Goa',
      payload: { amount: 300 },
    });
  });

  it('every member row carries the company flag, and it cannot be set by hand', async () => {
    const flags = await db.query(
      'SELECT DISTINCT company_two_step FROM group_members WHERE group_id = $1',
      [COMPANY],
    );
    expect(flags.rows).toEqual([{ company_two_step: true }]);
    await db.query('UPDATE group_members SET company_two_step = false WHERE id = $1', [m[2]]);
    const still = await db.query('SELECT company_two_step FROM group_members WHERE id = $1', [
      m[2],
    ]);
    expect(still.rows[0].company_two_step).toBe(true);
    await db.query('UPDATE groups SET require_two_step = false WHERE id = $1', [COMPANY]);
    const off = await db.query(
      'SELECT DISTINCT company_two_step FROM group_members WHERE group_id = $1',
      [COMPANY],
    );
    expect(off.rows).toEqual([{ company_two_step: false }]);
  });
});

describe('code attempts are atomic', () => {
  it('two concurrent attempts with the same step: exactly one wins', async () => {
    const secret = (
      await db.query(
        "INSERT INTO two_step_secrets(profile_id, kind, secret_enc, active) VALUES ($1,'authenticator',repeat('y',40),true) RETURNING id",
        [p[1]],
      )
    ).rows[0].id;
    const other = await connect();
    try {
      const attempt = (c: Client, session: string) =>
        c.query("SELECT waves_two_step_attempt($1,$2,1000,$3,'web',NULL) AS r", [
          p[1],
          secret,
          session,
        ]);
      const results = await Promise.all([attempt(db, randomUUID()), attempt(other, randomUUID())]);
      expect(results.map((r) => r.rows[0].r.ok).sort()).toEqual([false, true]);
      // An older step is a replay too.
      expect((await attempt(db, randomUUID())).rows[0].r).toMatchObject({ ok: false });
    } finally {
      await other.end();
      await db.query('DELETE FROM two_step_secrets WHERE id = $1', [secret]);
      await db.query('DELETE FROM two_step_lockouts WHERE profile_id = $1', [p[1]]);
      await db.query("DELETE FROM two_step_sessions WHERE profile_id = $1 AND kind = 'web'", [
        p[1],
      ]);
    }
  });

  it('ten misses lock the person, and a right code is refused while locked', async () => {
    const secret = (
      await db.query(
        "INSERT INTO two_step_secrets(profile_id, kind, secret_enc, active) VALUES ($1,'authenticator',repeat('y',40),true) RETURNING id",
        [p[1]],
      )
    ).rows[0].id;
    try {
      const reasons: string[] = [];
      for (let i = 0; i < 10; i += 1) {
        const r = await db.query("SELECT waves_two_step_attempt($1,NULL,NULL,$2,'web',NULL) AS r", [
          p[1],
          randomUUID(),
        ]);
        reasons.push(r.rows[0].r.reason);
      }
      expect(reasons.at(-1)).toBe('LOCKED');
      const right = await db.query("SELECT waves_two_step_attempt($1,$2,5000,$3,'web',NULL) AS r", [
        p[1],
        secret,
        randomUUID(),
      ]);
      expect(right.rows[0].r).toMatchObject({ ok: false, reason: 'LOCKED' });
    } finally {
      await db.query('DELETE FROM two_step_secrets WHERE id = $1', [secret]);
      await db.query('DELETE FROM two_step_lockouts WHERE profile_id = $1', [p[1]]);
    }
  });

  it('first-phone trust is refused once a factor exists (no second first phone)', async () => {
    await db.query('BEGIN');
    try {
      await db.query(
        "INSERT INTO two_step_secrets(profile_id, kind, secret_enc, active) VALUES ($1,'phone',repeat('z',40),true)",
        [p[3]],
      );
      const r = await db.query(
        "SELECT waves_two_step_trust_phone($1,$2,'d2',repeat('q',40),'first') AS r",
        [p[3], randomUUID()],
      );
      expect(r.rows[0].r).toMatchObject({ ok: false, reason: 'HAS_FACTOR' });
    } finally {
      await db.query('ROLLBACK');
    }
  });

  it('the session lookup is indexed on (session_id, profile_id) and the tables are service-role only', async () => {
    const idx = await db.query(
      "SELECT indexdef FROM pg_indexes WHERE tablename = 'two_step_sessions' AND indexdef ~ '\\(session_id, profile_id\\)'",
    );
    expect(idx.rowCount).toBeGreaterThan(0);
    for (const t of [
      'two_step_secrets',
      'two_step_sessions',
      'two_step_lockouts',
      'two_step_device_requests',
    ]) {
      const g = await db.query("SELECT has_table_privilege('authenticated', $1, 'SELECT') a", [
        `public.${t}`,
      ]);
      expect(g.rows[0].a, t).toBe(false);
    }
    const f = await db.query(
      "SELECT has_function_privilege('authenticated', 'waves_two_step_attempt(uuid,uuid,bigint,uuid,text,text,boolean)', 'EXECUTE') a",
    );
    expect(f.rows[0].a).toBe(false);
  });

  it('defaults to off everywhere', async () => {
    const d = await db.query(
      "SELECT column_default FROM information_schema.columns WHERE table_name = 'groups' AND column_name = 'require_two_step'",
    );
    expect(d.rows[0].column_default).toBe('false');
    const flag = await db.query("SELECT enabled FROM feature_flags WHERE key = 'company_two_step'");
    expect(flag.rows[0].enabled).toBe(false);
  });
});
