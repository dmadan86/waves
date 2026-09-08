/**
 * The developer API's database half (A65).
 *
 * Everything else in Waves is called by code we ship. This is the first caller
 * that is somebody else's program, holding a credential a person handed it, and
 * the argument for letting it in rests entirely on the database: a token is an
 * identity plus a ceiling, resolved as the person it names, and it can never
 * reach a row that person could not. That argument is only as good as the grants
 * and the guards it is made of, and both are the sort of thing a later migration
 * removes by accident — a REVOKE that misses `anon`, a policy that quietly turns
 * SELECT into ALL, a ceiling that reads a missing config row as "no limit".
 *
 * So these tests attempt the thing rather than reading the catalogue. A test
 * that asserts an ACL row proves the ACL row exists; a test that calls the
 * function as `anon` and is told no proves the boundary holds, which is the
 * claim actually being made.
 *
 * The one to read first is the rate limit. Every other refusal here is a locked
 * door, and a locked door is easy to reason about. The per-person budget is a
 * property instead: it says that minting a second token is not a way around the
 * first token's limit, which is the only reason the per-token limit means
 * anything at all. If that one ever goes green by accident, the ceiling on the
 * whole API is decorative.
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { asRole, connect, expectDenied } from './helpers.js';

let client: Client;

/** The developer who registers applications and holds a token of their own. */
let devProfile: string;
/** The person an application acts for — the one who sees a consent screen. */
let userProfile: string;
/** Somebody with no part in any of it. */
let otherProfile: string;

/** A public client: no secret, so PKCE is all it has. */
let publicAppId: string;
let publicClientId: string;
/** A confidential client, and the plaintext secret's hash the server would hold. */
let confidentialAppId: string;
let confidentialClientId: string;
const confidentialSecretHash = hex();
/**
 * A third client, registered for `expenses.write`, which the developer narrows
 * mid-test. It is separate from the other two so that narrowing it cannot
 * disturb the OAuth cases, which read the app row as registered.
 */
let writeAppId: string;
let writeClientId: string;
/** A committed token of the developer's, so cross-user RLS has something to miss. */
let devTokenId: string;

const REDIRECT = 'https://apps.example.com/callback';
const NATIVE_REDIRECT = 'com.example.app:/cb';
const APP_SCOPES = ['expenses.read', 'groups.read', 'offline_access'];

const auth = (sub: string) => ({ sub, role: 'authenticated' });

function hex(): string {
  return randomBytes(32).toString('hex');
}

function clientId(): string {
  return `wavs_app_${randomBytes(16).toString('hex')}`;
}

function prefix(kind: 'pat' | 'at' | 'rt'): string {
  return `wavs_${kind}_${randomBytes(4).toString('hex')}`;
}

/** S256 exactly as RFC 7636 defines it, so the SQL side has something to match. */
function challengeFor(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

async function seedApp(
  owner: string,
  secretHash: string | null,
  scopes: string[] = APP_SCOPES,
): Promise<[string, string]> {
  const id = randomUUID();
  const cid = clientId();
  await client.query(
    `INSERT INTO api_apps
       (id, owner_profile_id, name, description, website_url, client_id, client_secret_hash,
        redirect_uris, scopes)
     VALUES ($1, $2, $3, 'A test client', 'https://apps.example.com', $4, $5, $6::text[], $7::text[])`,
    [
      id,
      owner,
      secretHash === null ? 'Public client' : 'Confidential client',
      cid,
      secretHash,
      [REDIRECT, NATIVE_REDIRECT],
      scopes,
    ],
  );
  return [id, cid];
}

beforeAll(async () => {
  client = await connect();

  devProfile = randomUUID();
  userProfile = randomUUID();
  otherProfile = randomUUID();
  for (const [id, name] of [
    [devProfile, 'Developer'],
    [userProfile, 'Account holder'],
    [otherProfile, 'Stranger'],
  ] as const) {
    await client.query(
      `INSERT INTO profiles (id, display_name, default_currency) VALUES ($1, $2, 'INR')`,
      [id, name],
    );
  }

  [publicAppId, publicClientId] = await seedApp(devProfile, null);
  [confidentialAppId, confidentialClientId] = await seedApp(devProfile, confidentialSecretHash);
  [writeAppId, writeClientId] = await seedApp(devProfile, null, [
    'expenses.read',
    'expenses.write',
    'offline_access',
  ]);

  devTokenId = randomUUID();
  await client.query(
    `INSERT INTO api_tokens (id, profile_id, kind, name, token_hash, token_prefix, scopes)
     VALUES ($1, $2, 'personal', 'CI', $3, $4, $5::text[])`,
    [devTokenId, devProfile, hex(), prefix('pat'), ['groups.read']],
  );
});

afterAll(async () => {
  if (devProfile) {
    await client.query(`DELETE FROM profiles WHERE id = ANY($1::uuid[])`, [
      [devProfile, userProfile, otherProfile],
    ]);
  }
  await client?.end();
});

/**
 * A refusal from a plpgsql function aborts the transaction the caller is in, and
 * `asRole` keeps everything in one. The savepoint is what lets a single block
 * probe several refusals in a row, and it also rewinds whatever the failed call
 * managed to do before it raised.
 */
async function refused(run: () => Promise<unknown>): Promise<string> {
  await client.query('SAVEPOINT probe');
  const message = await expectDenied(run());
  await client.query('ROLLBACK TO SAVEPOINT probe');
  return message;
}

/**
 * Turn an `app_config` knob for the life of the surrounding rolled-back
 * transaction. `authenticated` has no write grant on the table — the console
 * edits it — so the update runs as the session's own superuser and the
 * impersonation is put back afterwards.
 */
async function setKnob(key: string, value: number): Promise<void> {
  await client.query('RESET ROLE');
  await client.query(`UPDATE app_config SET value = $2 WHERE key = $1`, [key, value]);
  await client.query('SET ROLE authenticated');
}

interface MintedToken {
  id: string;
  hash: string;
}

async function mintPersonalToken(scopes: string[], days: number | null = 30): Promise<MintedToken> {
  const id = randomUUID();
  const tokenHash = hex();
  await client.query(`SELECT waves_api_create_token($1, $2, $3, $4, $5::text[], $6)`, [
    id,
    'CI token',
    tokenHash,
    prefix('pat'),
    scopes,
    days,
  ]);
  return { id, hash: tokenHash };
}

interface Verdict {
  allowed: boolean;
  profileId: string;
  scopes: string[];
  limit: number;
  remaining: number;
  retryAfter: number;
}

async function authorize(token: MintedToken, scope: string | null): Promise<Verdict> {
  const { rows } = await client.query(`SELECT waves_api_authorize_call($1, $2, $3) AS verdict`, [
    token.id,
    token.hash,
    scope,
  ]);
  return rows[0].verdict;
}

interface AuthorizationCode {
  id: string;
  hash: string;
}

async function issueCode(
  cid: string,
  redirect: string,
  scopes: string[],
  challenge: string,
): Promise<AuthorizationCode> {
  const id = randomUUID();
  const codeHash = hex();
  await client.query(`SELECT waves_api_issue_code($1, $2, $3, $4, $5::text[], $6, $7)`, [
    id,
    codeHash,
    cid,
    redirect,
    scopes,
    challenge,
    300,
  ]);
  return { id, hash: codeHash };
}

interface OauthPair {
  ok: boolean;
  accessTokenId: string;
  refreshTokenId: string;
  scopes: string[];
}

/** The pair, plus the secrets the API server would keep to call and rotate with. */
interface GrantedPair extends OauthPair {
  accessHash: string;
  refreshHash: string;
}

async function consume(options: {
  code: AuthorizationCode;
  cid: string;
  secretHash: string | null;
  redirect: string;
  verifier: string;
}): Promise<GrantedPair> {
  const accessHash = hex();
  const refreshHash = hex();
  const { rows } = await client.query(
    `SELECT waves_api_consume_code($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 3600, 90) AS pair`,
    [
      options.code.id,
      options.code.hash,
      options.cid,
      options.secretHash,
      options.redirect,
      options.verifier,
      randomUUID(),
      accessHash,
      prefix('at'),
      randomUUID(),
      refreshHash,
      prefix('rt'),
    ],
  );
  return { ...(rows[0].pair as OauthPair), accessHash, refreshHash };
}

/**
 * The whole dance in one call, for the tests whose subject is what happens
 * *after* a grant rather than the grant itself.
 */
async function grant(cid: string, scopes: string[]): Promise<GrantedPair> {
  const verifier = randomBytes(32).toString('base64url');
  const code = await issueCode(cid, REDIRECT, scopes, challengeFor(verifier));
  return consume({ code, cid, secretHash: null, redirect: REDIRECT, verifier });
}

interface RotationResult {
  ok: boolean;
  error?: string;
  disconnected?: boolean;
  accessTokenId?: string;
  refreshTokenId?: string;
}

async function rotate(
  refresh: { id: string; hash: string },
  cid: string,
): Promise<{ result: RotationResult; accessTokenId: string; refreshTokenId: string }> {
  const accessTokenId = randomUUID();
  const refreshTokenId = randomUUID();
  const { rows } = await client.query(
    `SELECT waves_api_rotate_refresh($1, $2, $3, NULL::text, $4, $5, $6, $7, $8, $9, 3600, 90) AS result`,
    [
      refresh.id,
      refresh.hash,
      cid,
      accessTokenId,
      hex(),
      prefix('at'),
      refreshTokenId,
      hex(),
      prefix('rt'),
    ],
  );
  return { result: rows[0].result as RotationResult, accessTokenId, refreshTokenId };
}

/**
 * Speak as a signed-in person with NO surrounding transaction, so every
 * statement commits the way the API server's would.
 *
 * Nothing else in this file needs it — a rolled-back transaction is the right
 * default and keeps the suite re-runnable. But a function that writes and then
 * refuses can only be checked this way: inside a transaction, a failure and a
 * deliberate rollback look identical, and that is exactly the hiding place the
 * first version of the reuse detection was found in.
 */
async function asCommittedUser<T>(profileId: string, run: () => Promise<T>): Promise<T> {
  await client.query(`SELECT set_config('request.jwt.claims', $1, false)`, [
    JSON.stringify(auth(profileId)),
  ]);
  await client.query('SET ROLE authenticated');
  try {
    return await run();
  } finally {
    await client.query('RESET ROLE');
    await client.query(`SELECT set_config('request.jwt.claims', '', false)`);
  }
}

/** Swap which signed-in person the surrounding transaction is speaking as. */
async function becomes(profileId: string): Promise<void> {
  await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify(auth(profileId)),
  ]);
}

const SAMPLE_UUID = '00000000-0000-0000-0000-000000000000';
const SAMPLE_HASH = '0'.repeat(64);
const SAMPLE_CHALLENGE = 'a'.repeat(43);
const SAMPLE_CLIENT = 'wavs_app_00000000000000000000000000000000';

/** Every function the migration adds, called the way a caller would call it. */
const DEFINER_CALLS: ReadonlyArray<readonly [string, string]> = [
  ['waves_api_known_scopes', `SELECT waves_api_known_scopes()`],
  ['waves_api_scopes_ok', `SELECT waves_api_scopes_ok(ARRAY['groups.read'])`],
  ['waves_api_redirects_ok', `SELECT waves_api_redirects_ok(ARRAY['https://a.example.com/cb'])`],
  [
    'waves_api_register_app',
    `SELECT waves_api_register_app(NULL::uuid, 'App', '', NULL::text,
       ARRAY['https://a.example.com/cb'], ARRAY['groups.read'], '${SAMPLE_CLIENT}', NULL::text)`,
  ],
  [
    'waves_api_update_app',
    `SELECT waves_api_update_app('${SAMPLE_UUID}'::uuid, NULL::text, NULL::text, NULL::text,
       NULL::text[], NULL::text[], NULL::text, NULL::boolean)`,
  ],
  ['waves_api_delete_app', `SELECT waves_api_delete_app('${SAMPLE_UUID}'::uuid)`],
  [
    'waves_api_create_token',
    `SELECT waves_api_create_token('${SAMPLE_UUID}'::uuid, 'CI', '${SAMPLE_HASH}',
       'wavs_pat_abcdef', ARRAY['groups.read'], 30)`,
  ],
  ['waves_api_revoke_token', `SELECT waves_api_revoke_token('${SAMPLE_UUID}'::uuid)`],
  ['waves_api_revoke_app_access', `SELECT waves_api_revoke_app_access('${SAMPLE_UUID}'::uuid)`],
  [
    'waves_api_authorize_call',
    `SELECT waves_api_authorize_call('${SAMPLE_UUID}'::uuid, '${SAMPLE_HASH}', 'groups.read')`,
  ],
  [
    'waves_api_consent_preview',
    `SELECT waves_api_consent_preview('${SAMPLE_CLIENT}', 'https://a.example.com/cb',
       ARRAY['groups.read'])`,
  ],
  [
    'waves_api_issue_code',
    `SELECT waves_api_issue_code('${SAMPLE_UUID}'::uuid, '${SAMPLE_HASH}', '${SAMPLE_CLIENT}',
       'https://a.example.com/cb', ARRAY['groups.read'], '${SAMPLE_CHALLENGE}', 300)`,
  ],
  [
    'waves_api_consume_code',
    `SELECT waves_api_consume_code('${SAMPLE_UUID}'::uuid, '${SAMPLE_HASH}', '${SAMPLE_CLIENT}',
       NULL::text, 'https://a.example.com/cb', 'verifier', '${SAMPLE_UUID}'::uuid,
       '${SAMPLE_HASH}', 'wavs_at_abcdef', NULL::uuid, NULL::text, NULL::text, 3600, 90)`,
  ],
  [
    'waves_api_rotate_refresh',
    `SELECT waves_api_rotate_refresh('${SAMPLE_UUID}'::uuid, '${SAMPLE_HASH}', '${SAMPLE_CLIENT}',
       NULL::text, '${SAMPLE_UUID}'::uuid, '${SAMPLE_HASH}', 'wavs_at_abcdef',
       '${SAMPLE_UUID}'::uuid, '${SAMPLE_HASH}', 'wavs_rt_abcdef', 3600, 90)`,
  ],
  ['waves_api_connected_apps', `SELECT * FROM waves_api_connected_apps()`],
  ['waves_api_sweep', `SELECT waves_api_sweep()`],
];

describe('the grant is the boundary', () => {
  it('lets a signed-out caller reach none of the new functions', async () => {
    await asRole(client, 'anon', { role: 'anon' }, async () => {
      for (const [name, sql] of DEFINER_CALLS) {
        const message = await refused(() => client.query(sql));
        expect(message, name).toMatch(/permission denied/i);
      }
    });
  });

  it('leaves the three new tables unaddressable signed out', async () => {
    await asRole(client, 'anon', { role: 'anon' }, async () => {
      for (const table of ['api_apps', 'api_tokens', 'api_authorization_codes']) {
        const message = await refused(() => client.query(`SELECT 1 FROM ${table} LIMIT 1`));
        expect(message, table).toMatch(/permission denied/i);
      }
    });
  });

  it('keeps the code sweeper to the operator, not to whoever is signed in', async () => {
    await asRole(client, 'authenticated', auth(devProfile), async () => {
      const message = await refused(() => client.query(`SELECT waves_api_sweep()`));
      expect(message).toMatch(/permission denied/i);
    });

    await asRole(client, 'service_role', { role: 'service_role' }, async () => {
      const { rows } = await client.query(`SELECT waves_api_sweep() AS swept`);
      expect(Number(rows[0].swept)).toBeGreaterThanOrEqual(0);
    });
  });
});

describe('what a developer can see', () => {
  it('shows a developer their own applications and tokens', async () => {
    await asRole(client, 'authenticated', auth(devProfile), async () => {
      const apps = await client.query(`SELECT id FROM api_apps ORDER BY created_at`);
      expect(apps.rows.map((row) => row.id).sort()).toEqual(
        [publicAppId, confidentialAppId, writeAppId].sort(),
      );

      const tokens = await client.query(`SELECT id FROM api_tokens`);
      expect(tokens.rows.map((row) => row.id)).toEqual([devTokenId]);
    });
  });

  it('shows somebody else nothing at all, on the same tables', async () => {
    await asRole(client, 'authenticated', auth(otherProfile), async () => {
      const apps = await client.query(`SELECT id FROM api_apps`);
      const tokens = await client.query(`SELECT id FROM api_tokens`);
      expect(apps.rowCount).toBe(0);
      expect(tokens.rowCount).toBe(0);
    });
  });

  it('refuses a direct write to either table, because the rules live in the functions', async () => {
    await asRole(client, 'authenticated', auth(devProfile), async () => {
      const writes: [string, unknown[]][] = [
        [
          `INSERT INTO api_apps (owner_profile_id, name, client_id, redirect_uris, scopes)
             VALUES ($1, 'Sneaky', $2, ARRAY['https://a.example.com/cb'], ARRAY['groups.read'])`,
          [devProfile, clientId()],
        ],
        [`UPDATE api_apps SET scopes = ARRAY['expenses.write'] WHERE id = $1`, [publicAppId]],
        [`DELETE FROM api_apps WHERE id = $1`, [publicAppId]],
        [
          `INSERT INTO api_tokens (profile_id, kind, token_hash, token_prefix, scopes)
             VALUES ($1, 'personal', $2, $3, ARRAY['expenses.write'])`,
          [devProfile, hex(), prefix('pat')],
        ],
        [`UPDATE api_tokens SET revoked_at = NULL WHERE id = $1`, [devTokenId]],
        [`DELETE FROM api_tokens WHERE id = $1`, [devTokenId]],
      ];

      for (const [sql, params] of writes) {
        const message = await refused(() => client.query(sql, params));
        expect(message, sql).toMatch(/permission denied/i);
      }
    });
  });
});

describe('the scope catalogue', () => {
  it('takes only scopes it has heard of, exactly once each, and at least one', async () => {
    await asRole(client, 'authenticated', auth(devProfile), async () => {
      const ok = async (scopes: string[]) =>
        (await client.query(`SELECT waves_api_scopes_ok($1::text[]) AS ok`, [scopes])).rows[0].ok;

      expect(await ok(['expenses.read'])).toBe(true);
      expect(await ok(['expenses.read', 'nonsense.read'])).toBe(false);
      expect(await ok([])).toBe(false);
      expect(await ok(['expenses.read', 'expenses.read'])).toBe(false);
    });
  });

  it('refuses to register an application asking for a scope that does not exist', async () => {
    await asRole(client, 'authenticated', auth(devProfile), async () => {
      const message = await refused(() =>
        client.query(
          `SELECT waves_api_register_app(NULL::uuid, 'Invented', '', NULL::text,
             $1::text[], $2::text[], $3, NULL::text)`,
          [[REDIRECT], ['expenses.read', 'money.take_all'], clientId()],
        ),
      );
      expect(message).toMatch(/api_apps_scopes_ok/);
    });
  });
});

describe('the redirect grammar', () => {
  it('accepts https, loopback http and a reverse-DNS private scheme', async () => {
    await asRole(client, 'authenticated', auth(devProfile), async () => {
      const ok = async (uri: string) =>
        (await client.query(`SELECT waves_api_redirects_ok(ARRAY[$1]::text[]) AS ok`, [uri]))
          .rows[0].ok;

      expect(await ok('https://apps.example.com/callback')).toBe(true);
      expect(await ok('http://localhost:3000/cb')).toBe(true);
      expect(await ok('com.example.app:/cb')).toBe(true);
    });
  });

  it('rejects script schemes, wildcards, fragments and plain http off the loopback', async () => {
    await asRole(client, 'authenticated', auth(devProfile), async () => {
      const ok = async (uri: string) =>
        (await client.query(`SELECT waves_api_redirects_ok(ARRAY[$1]::text[]) AS ok`, [uri]))
          .rows[0].ok;

      expect(await ok('javascript:alert(1)')).toBe(false);
      expect(await ok('https://*.evil.com/cb')).toBe(false);
      expect(await ok('https://apps.example.com/cb#fragment')).toBe(false);
      expect(await ok('http://evil.com/cb')).toBe(false);
    });
  });

  it('refuses userinfo in the authority, which reads as the wrong domain', async () => {
    await asRole(client, 'authenticated', auth(devProfile), async () => {
      const ok = async (uri: string) =>
        (await client.query(`SELECT waves_api_redirects_ok(ARRAY[$1]::text[]) AS ok`, [uri]))
          .rows[0].ok;

      // Both go to evil.com. Whoever reviews the registration reads the part
      // before the `@`, which is the developer's own domain, and approves it.
      expect(await ok('https://apps.example.com@evil.com/cb')).toBe(false);
      expect(await ok('http://localhost@evil.com/cb')).toBe(false);

      // A `@` further along is only a path character and stays legal.
      expect(await ok('https://apps.example.com/cb@2')).toBe(true);
    });
  });
});

describe('registering an application', () => {
  const register = async (options: {
    appId?: string | null;
    website?: string | null;
    clientId?: string;
  }) =>
    client.query<{ id: string }>(
      `SELECT waves_api_register_app($1::uuid, 'Ledger buddy', 'Does sums', $2::text,
         $3::text[], $4::text[], $5, NULL::text) AS id`,
      [
        options.appId ?? null,
        options.website ?? null,
        [REDIRECT],
        ['expenses.read'],
        options.clientId ?? clientId(),
      ],
    );

  it('takes a website, which the shape check used to make impossible', async () => {
    await asRole(client, 'authenticated', auth(devProfile), async () => {
      const { rows } = await register({ website: 'https://ledgerbuddy.example.com/about' });
      expect(rows[0]!.id).toBeTruthy();

      const stored = await client.query(`SELECT website_url FROM api_apps WHERE id = $1`, [
        rows[0]!.id,
      ]);
      expect(stored.rows[0].website_url).toBe('https://ledgerbuddy.example.com/about');
    });
  });

  it('still refuses a website that is not https, or is longer than the column wants', async () => {
    await asRole(client, 'authenticated', auth(devProfile), async () => {
      expect(await refused(() => register({ website: 'http://ledgerbuddy.example.com' }))).toMatch(
        /api_apps_website_shape/,
      );
      expect(
        await refused(() => register({ website: `https://e.example.com/${'x'.repeat(300)}` })),
      ).toMatch(/api_apps_website_shape/);
    });
  });

  it('refuses a repeated application id outright rather than echoing the first one', async () => {
    await asRole(client, 'authenticated', auth(devProfile), async () => {
      const appId = randomUUID();
      const first = await register({ appId });
      expect(first.rows[0]!.id).toBe(appId);

      // Same owner, same id, different registration. Answering "fine" and
      // applying nothing would be a worse failure than refusing, because the
      // developer would go on believing the new redirect had taken.
      expect(await refused(() => register({ appId }))).toMatch(/APP_ID_TAKEN/);

      // And it is not a leak either: somebody else's id gets the same answer.
      await becomes(otherProfile);
      expect(await refused(() => register({ appId }))).toMatch(/APP_ID_TAKEN/);
    });
  });
});

describe('the ceilings', () => {
  it('stops minting tokens once the knob says enough', async () => {
    await asRole(client, 'authenticated', auth(userProfile), async () => {
      await setKnob('api_tokens_max_per_user', 1);

      await mintPersonalToken(['expenses.read']);
      const message = await refused(() => mintPersonalToken(['expenses.read']));
      expect(message).toMatch(/TOKEN_LIMIT/);
    });
  });

  it('will not give a token a longer life than the knob allows', async () => {
    await asRole(client, 'authenticated', auth(userProfile), async () => {
      await setKnob('api_token_max_days', 7);

      const message = await refused(() => mintPersonalToken(['expenses.read'], 8));
      expect(message).toMatch(/TOKEN_TTL/);

      // And an unasked-for expiry still lands under the ceiling rather than never.
      await mintPersonalToken(['expenses.read'], null);
      const { rows } = await client.query(
        `SELECT expires_at FROM api_tokens WHERE profile_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [userProfile],
      );
      expect(new Date(rows[0].expires_at).getTime()).toBeLessThan(
        Date.now() + 8 * 24 * 60 * 60 * 1000,
      );
    });
  });
});

describe('the hot path', () => {
  it('lets a live token through with the scope the route asked for', async () => {
    await asRole(client, 'authenticated', auth(userProfile), async () => {
      const token = await mintPersonalToken(['expenses.read', 'groups.read']);
      const verdict = await authorize(token, 'expenses.read');

      expect(verdict).toMatchObject({ allowed: true, profileId: userProfile });
      expect(verdict).toHaveProperty('scopes', ['expenses.read', 'groups.read']);
    });
  });

  it('will not take an id without the matching hash, nor anybody else’s token', async () => {
    // The developer's real token hash, read outside anybody's session, so the
    // second half below is a genuine theft rather than a guess.
    const stolenHash = (
      await client.query<{ token_hash: string }>(
        `SELECT token_hash FROM api_tokens WHERE id = $1`,
        [devTokenId],
      )
    ).rows[0]!.token_hash;

    await asRole(client, 'authenticated', auth(userProfile), async () => {
      const token = await mintPersonalToken(['expenses.read']);
      expect(await refused(() => authorize({ id: token.id, hash: hex() }, null))).toMatch(
        /INVALID_TOKEN/,
      );

      // Id and hash both correct, and still refused: the row is scoped to the
      // person the session names, which is what makes a leaked id worthless.
      expect(await refused(() => authorize({ id: devTokenId, hash: stolenHash }, null))).toMatch(
        /INVALID_TOKEN/,
      );
    });
  });

  it('refuses a token that has been revoked or has run out', async () => {
    await asRole(client, 'authenticated', auth(userProfile), async () => {
      const revoked = await mintPersonalToken(['expenses.read']);
      await client.query(`SELECT waves_api_revoke_token($1)`, [revoked.id]);
      expect(await refused(() => authorize(revoked, 'expenses.read'))).toMatch(/TOKEN_REVOKED/);

      const expired = await mintPersonalToken(['expenses.read']);
      await client.query('RESET ROLE');
      await client.query(
        `UPDATE api_tokens SET expires_at = now() - interval '1 hour' WHERE id = $1`,
        [expired.id],
      );
      await client.query('SET ROLE authenticated');
      expect(await refused(() => authorize(expired, 'expenses.read'))).toMatch(/TOKEN_EXPIRED/);
    });
  });

  it('will not let a refresh token be spent as an access token', async () => {
    await asRole(client, 'authenticated', auth(userProfile), async () => {
      const refresh = { id: randomUUID(), hash: hex() };
      await client.query('RESET ROLE');
      await client.query(
        `INSERT INTO api_tokens (id, profile_id, app_id, kind, token_hash, token_prefix, scopes, expires_at)
         VALUES ($1, $2, $3, 'refresh', $4, $5, ARRAY['expenses.read'], now() + interval '30 days')`,
        [refresh.id, userProfile, publicAppId, refresh.hash, prefix('rt')],
      );
      await client.query('SET ROLE authenticated');

      expect(await refused(() => authorize(refresh, 'expenses.read'))).toMatch(/WRONG_TOKEN_KIND/);
    });
  });

  it('reads the scope out of the row, not out of the token', async () => {
    await asRole(client, 'authenticated', auth(userProfile), async () => {
      const token = await mintPersonalToken(['groups.read']);
      const message = await refused(() => authorize(token, 'expenses.write'));
      expect(message).toMatch(/INSUFFICIENT_SCOPE/);
    });
  });
});

describe('the rate limit is on the person, not only on the key', () => {
  it('does not let a freshly minted token buy back a spent minute', async () => {
    await asRole(client, 'authenticated', auth(userProfile), async () => {
      // Generous per token, mean per person: this isolates the property under
      // test from the per-token bucket, which would otherwise refuse first.
      await setKnob('api_rate_limit_per_minute', 1000);
      await setKnob('api_rate_limit_per_minute_user', 2);

      const first = await mintPersonalToken(['expenses.read']);
      expect(await authorize(first, 'expenses.read')).toMatchObject({ allowed: true });
      expect(await authorize(first, 'expenses.read')).toMatchObject({ allowed: true });
      expect(await authorize(first, 'expenses.read')).toMatchObject({ allowed: false });

      // Rotation as an attack: a new key, a new token bucket, and no relief at
      // all — the person's minute is already spent.
      const second = await mintPersonalToken(['expenses.read']);
      expect(await authorize(second, 'expenses.read')).toMatchObject({ allowed: false });
    });
  });

  it('answers a refusal rather than raising it, so a caller can back off', async () => {
    await asRole(client, 'authenticated', auth(userProfile), async () => {
      await setKnob('api_rate_limit_per_minute_user', 1);
      const token = await mintPersonalToken(['expenses.read']);
      await authorize(token, 'expenses.read');

      const verdict = await authorize(token, 'expenses.read');
      expect(verdict).toMatchObject({ allowed: false, remaining: 0 });
      expect(Number(verdict.retryAfter)).toBeGreaterThan(0);
    });
  });
});

describe('the OAuth dance', () => {
  it('refuses a redirect the developer never registered, or a scope beyond the app', async () => {
    await asRole(client, 'authenticated', auth(userProfile), async () => {
      const challenge = challengeFor(randomBytes(32).toString('base64url'));

      const badRedirect = await refused(() =>
        issueCode(publicClientId, 'https://evil.example.com/cb', ['expenses.read'], challenge),
      );
      expect(badRedirect).toMatch(/BAD_REDIRECT/);

      const wideScope = await refused(() =>
        issueCode(publicClientId, REDIRECT, ['settlements.write'], challenge),
      );
      expect(wideScope).toMatch(/SCOPE_NOT_ALLOWED/);
    });
  });

  it('trades a code for a pair exactly once, and calls the replay an invalid grant', async () => {
    await asRole(client, 'authenticated', auth(userProfile), async () => {
      const verifier = randomBytes(32).toString('base64url');
      const code = await issueCode(
        publicClientId,
        REDIRECT,
        ['expenses.read', 'offline_access'],
        challengeFor(verifier),
      );

      const pair = await consume({
        code,
        cid: publicClientId,
        secretHash: null,
        redirect: REDIRECT,
        verifier,
      });
      expect(pair.accessTokenId).toBeTruthy();
      expect(pair.refreshTokenId).toBeTruthy();
      expect(pair.scopes).toEqual(['expenses.read', 'offline_access']);

      const replay = await refused(() =>
        consume({ code, cid: publicClientId, secretHash: null, redirect: REDIRECT, verifier }),
      );
      expect(replay).toMatch(/INVALID_GRANT/);

      // And the person now has one connected app, counted as an app rather than
      // as the two tokens it is made of.
      const connected = await client.query(`SELECT app_id FROM waves_api_connected_apps()`);
      expect(connected.rows.map((row) => row.app_id)).toEqual([publicAppId]);
    });
  });

  it('refuses a verifier that does not hash to the challenge', async () => {
    await asRole(client, 'authenticated', auth(userProfile), async () => {
      const verifier = randomBytes(32).toString('base64url');
      const code = await issueCode(
        publicClientId,
        REDIRECT,
        ['expenses.read'],
        challengeFor(verifier),
      );

      const message = await refused(() =>
        consume({
          code,
          cid: publicClientId,
          secretHash: null,
          redirect: REDIRECT,
          verifier: randomBytes(32).toString('base64url'),
        }),
      );
      expect(message).toMatch(/INVALID_GRANT/);
    });
  });

  it('makes a confidential client prove it is the one that was registered', async () => {
    await asRole(client, 'authenticated', auth(userProfile), async () => {
      const verifier = randomBytes(32).toString('base64url');
      const code = await issueCode(
        confidentialClientId,
        REDIRECT,
        ['expenses.read'],
        challengeFor(verifier),
      );

      const wrongSecret = await refused(() =>
        consume({
          code,
          cid: confidentialClientId,
          secretHash: hex(),
          redirect: REDIRECT,
          verifier,
        }),
      );
      expect(wrongSecret).toMatch(/BAD_CLIENT_SECRET/);

      const pair = await consume({
        code,
        cid: confidentialClientId,
        secretHash: confidentialSecretHash,
        redirect: REDIRECT,
        verifier,
      });
      expect(pair.accessTokenId).toBeTruthy();
    });
  });

  it('rotates a refresh token by killing the pair it replaces', async () => {
    await asRole(client, 'authenticated', auth(userProfile), async () => {
      const pair = await grant(publicClientId, ['expenses.read', 'offline_access']);
      const rotated = await rotate(
        { id: pair.refreshTokenId, hash: pair.refreshHash },
        publicClientId,
      );

      expect(rotated.result).toMatchObject({
        ok: true,
        accessTokenId: rotated.accessTokenId,
        refreshTokenId: rotated.refreshTokenId,
      });

      const states = await client.query(
        `SELECT id, revoked_at FROM api_tokens WHERE id = ANY($1::uuid[])`,
        [[pair.refreshTokenId, pair.accessTokenId, rotated.accessTokenId, rotated.refreshTokenId]],
      );
      const revoked = new Map(states.rows.map((row) => [row.id, row.revoked_at !== null]));
      expect(revoked.get(pair.refreshTokenId)).toBe(true);
      expect(revoked.get(pair.accessTokenId)).toBe(true);
      expect(revoked.get(rotated.accessTokenId)).toBe(false);
      expect(revoked.get(rotated.refreshTokenId)).toBe(false);
    });
  });

  it('takes the access token with it when a refresh token is revoked by hand', async () => {
    await asRole(client, 'authenticated', auth(userProfile), async () => {
      const verifier = randomBytes(32).toString('base64url');
      const code = await issueCode(
        publicClientId,
        REDIRECT,
        ['expenses.read', 'offline_access'],
        challengeFor(verifier),
      );
      const pair = await consume({
        code,
        cid: publicClientId,
        secretHash: null,
        redirect: REDIRECT,
        verifier,
      });

      const { rows } = await client.query(`SELECT waves_api_revoke_token($1) AS done`, [
        pair.refreshTokenId,
      ]);
      expect(rows[0].done).toBe(true);

      const access = await client.query(`SELECT revoked_at FROM api_tokens WHERE id = $1`, [
        pair.accessTokenId,
      ]);
      expect(access.rows[0].revoked_at).not.toBeNull();
    });
  });
});

/**
 * The claim: an application's *current* registration decides what its tokens
 * can do, not the grant they were issued under. Without this, "we removed that
 * permission from the app" is a sentence with a year of live tokens behind it,
 * and the only honest remedy would be revoking everybody — which is why the
 * second half of this test matters as much as the first.
 */
describe('narrowing an application', () => {
  it('takes a scope away from tokens already issued, without revoking them', async () => {
    await asRole(client, 'authenticated', auth(userProfile), async () => {
      const pair = await grant(writeClientId, [
        'expenses.read',
        'expenses.write',
        'offline_access',
      ]);
      const access = { id: pair.accessTokenId, hash: pair.accessHash };
      expect(await authorize(access, 'expenses.write')).toMatchObject({ allowed: true });

      // The developer decides their app no longer needs to write.
      await becomes(devProfile);
      await client.query(
        `SELECT waves_api_update_app($1, NULL::text, NULL::text, NULL::text, NULL::text[],
           $2::text[], NULL::text, NULL::boolean)`,
        [writeAppId, ['expenses.read']],
      );
      await becomes(userProfile);

      // Same token, same secret, same person — and no longer able to write.
      expect(await refused(() => authorize(access, 'expenses.write'))).toMatch(
        /INSUFFICIENT_SCOPE/,
      );

      // What is left still works, and the answer reports the intersection rather
      // than the grant, so a client can see what it has actually got.
      const verdict = await authorize(access, 'expenses.read');
      expect(verdict).toMatchObject({ allowed: true });
      expect(verdict.scopes).toEqual(['expenses.read']);

      // Nothing was revoked to achieve any of that. Narrowing a permission is
      // not the same act as disconnecting an app, and a user who did neither
      // should not be signed out of one by the other.
      const rows = await client.query(
        `SELECT revoked_at FROM api_tokens WHERE id = ANY($1::uuid[])`,
        [[pair.accessTokenId, pair.refreshTokenId]],
      );
      expect(rows.rows.every((row) => row.revoked_at === null)).toBe(true);
    });
  });

  it('stops the token authenticating at all once nothing is left of the grant', async () => {
    await asRole(client, 'authenticated', auth(userProfile), async () => {
      const pair = await grant(writeClientId, ['expenses.write', 'offline_access']);

      await becomes(devProfile);
      await client.query(
        `SELECT waves_api_update_app($1, NULL::text, NULL::text, NULL::text, NULL::text[],
           $2::text[], NULL::text, NULL::boolean)`,
        [writeAppId, ['expenses.read']],
      );
      await becomes(userProfile);

      // Not merely "every scoped route now fails". A route that asks for no
      // particular scope must fail too, or "we removed its access" would be a
      // sentence with an unmentioned exception attached.
      const message = await refused(() =>
        authorize({ id: pair.accessTokenId, hash: pair.accessHash }, null),
      );
      expect(message).toMatch(/INSUFFICIENT_SCOPE/);
      expect(message).toMatch(/no longer has any permission/);
    });
  });

  it('tells the connected-apps screen exactly what the hot path would allow', async () => {
    await asRole(client, 'authenticated', auth(userProfile), async () => {
      await grant(writeClientId, ['expenses.read', 'expenses.write', 'offline_access']);

      const listed = async () =>
        (
          await client.query<{ scopes: string[] | null }>(
            `SELECT scopes FROM waves_api_connected_apps() WHERE app_id = $1`,
            [writeAppId],
          )
        ).rows[0]?.scopes;

      expect(await listed()).toEqual(['expenses.read', 'expenses.write', 'offline_access']);

      await becomes(devProfile);
      await client.query(
        `SELECT waves_api_update_app($1, NULL::text, NULL::text, NULL::text, NULL::text[],
           $2::text[], NULL::text, NULL::boolean)`,
        [writeAppId, ['expenses.read']],
      );
      await becomes(userProfile);

      // The screen that exists to say what an application can do must not be the
      // one place that claims more than a request would actually be given.
      expect(await listed()).toEqual(['expenses.read']);
    });
  });

  it('keeps a dead application on the list, labelled and still removable', async () => {
    await asRole(client, 'authenticated', auth(userProfile), async () => {
      await grant(publicClientId, ['expenses.read', 'groups.read']);
      await grant(writeClientId, ['expenses.write', 'offline_access']);

      await becomes(devProfile);
      await client.query(
        `SELECT waves_api_update_app($1, NULL::text, NULL::text, NULL::text, NULL::text[],
           $2::text[], NULL::text, NULL::boolean)`,
        [writeAppId, ['expenses.read']],
      );
      await becomes(userProfile);

      const listed = async () => {
        const { rows } = await client.query<{
          app_id: string;
          scopes: string[] | null;
          active: boolean;
        }>(`SELECT app_id, scopes, active FROM waves_api_connected_apps()`);
        return new Map(rows.map((row) => [row.app_id, row]));
      };

      const before = await listed();
      expect(before.size).toBe(2);

      // The narrowed one is still there — it still holds live token rows, and
      // this screen is the only place they can be cleared from. An empty array
      // rather than the NULL an aggregate over no rows would hand a client that
      // is about to map over it.
      const dead = before.get(writeAppId)!;
      expect(dead.scopes).not.toBeNull();
      expect(dead.scopes).toEqual([]);
      expect(dead.active).toBe(false);

      const alive = before.get(publicAppId)!;
      expect(alive.scopes).toEqual(['expenses.read', 'groups.read']);
      expect(alive.active).toBe(true);

      // And the button under it works, which is the whole reason for keeping
      // the row rather than filtering it away.
      const { rows } = await client.query(`SELECT waves_api_revoke_app_access($1) AS revoked`, [
        writeAppId,
      ]);
      expect(Number(rows[0].revoked)).toBe(2);

      const after = await listed();
      expect([...after.keys()]).toEqual([publicAppId]);
    });
  });

  it('calls a switched-off application inactive while it still has its permissions', async () => {
    await asRole(client, 'authenticated', auth(userProfile), async () => {
      await grant(publicClientId, ['expenses.read', 'groups.read']);
      await grant(writeClientId, ['expenses.write', 'offline_access']);

      await becomes(devProfile);
      await client.query(
        `SELECT waves_api_update_app($1, NULL::text, NULL::text, NULL::text, NULL::text[],
           NULL::text[], NULL::text, true)`,
        [writeAppId],
      );
      await becomes(userProfile);

      const listed = async () => {
        const { rows } = await client.query<{
          app_id: string;
          scopes: string[];
          active: boolean;
        }>(`SELECT app_id, scopes, active FROM waves_api_connected_apps()`);
        return new Map(rows.map((row) => [row.app_id, row]));
      };

      const before = await listed();
      const disabled = before.get(writeAppId)!;

      // Its permissions are intact — nobody took them away, the application was
      // switched off. Keeping the two conditions separate is what lets the
      // screen say "this app cannot be used" without also claiming the person
      // revoked something they did not.
      expect(disabled.scopes).toEqual(['expenses.write', 'offline_access']);
      expect(disabled.active).toBe(false);

      expect(before.get(publicAppId)!.active).toBe(true);

      const { rows } = await client.query(`SELECT waves_api_revoke_app_access($1) AS revoked`, [
        writeAppId,
      ]);
      expect(Number(rows[0].revoked)).toBe(2);
      expect([...(await listed()).keys()]).toEqual([publicAppId]);
    });
  });

  it('leaves a personal token alone, since it answers to no application', async () => {
    await asRole(client, 'authenticated', auth(userProfile), async () => {
      // The intersection has to be skipped, not computed against an empty app
      // row — a personal token would otherwise lose every scope it has.
      const token = await mintPersonalToken(['expenses.write']);
      const verdict = await authorize(token, 'expenses.write');
      expect(verdict).toMatchObject({ allowed: true });
      expect(verdict.scopes).toEqual(['expenses.write']);
    });
  });
});

/**
 * Reuse detection (RFC 6749 §10.4). A refresh token presented after it has been
 * rotated means two parties hold it and one of them is a thief, and there is no
 * way to tell which from inside the database — so the grant goes and both have
 * to ask the person again.
 *
 * This is the one test in the file that commits, and it has to. The first
 * version of this code did the revoke and then raised, and plpgsql rolled the
 * revoke back with the exception: inside a transaction the wreckage is
 * indistinguishable from a test that simply tidied up after itself.
 */
describe('a refresh token presented twice', () => {
  it('disconnects the application, freshly minted pair included', async () => {
    const victim = randomUUID();
    await client.query(
      `INSERT INTO profiles (id, display_name, default_currency) VALUES ($1, 'Reuse victim', 'INR')`,
      [victim],
    );

    try {
      const { granted, rotated } = await asCommittedUser(victim, async () => {
        const first = await grant(writeClientId, ['expenses.read', 'offline_access']);
        const second = await rotate(
          { id: first.refreshTokenId, hash: first.refreshHash },
          writeClientId,
        );
        expect(second.result.ok).toBe(true);

        // The thief — or the client that never saw the first answer — presents
        // the original refresh token again.
        const replay = await rotate(
          { id: first.refreshTokenId, hash: first.refreshHash },
          writeClientId,
        );
        expect(replay.result).toMatchObject({
          ok: false,
          error: 'INVALID_GRANT',
          disconnected: true,
        });

        return { granted: first, rotated: second };
      });

      const rows = await client.query<{ id: string; revoked_at: Date | null }>(
        `SELECT id, revoked_at FROM api_tokens WHERE profile_id = $1 AND app_id = $2`,
        [victim, writeAppId],
      );

      // Two from the grant, two from the successful rotation, and every one of
      // them dead — the pair the winner of the race walked away with above all.
      expect(rows.rows).toHaveLength(4);
      expect(new Set(rows.rows.map((row) => row.id))).toEqual(
        new Set([
          granted.accessTokenId,
          granted.refreshTokenId,
          rotated.accessTokenId,
          rotated.refreshTokenId,
        ]),
      );
      expect(rows.rows.filter((row) => row.revoked_at === null)).toEqual([]);
    } finally {
      await client.query(`DELETE FROM profiles WHERE id = $1`, [victim]);
    }
  });

  it('does not call a token that merely got old a stolen one', async () => {
    const sleeper = randomUUID();
    await client.query(
      `INSERT INTO profiles (id, display_name, default_currency) VALUES ($1, 'Idle client', 'INR')`,
      [sleeper],
    );

    try {
      // A refresh token that ran out while nobody was using it: never rotated,
      // never withdrawn. Age is not evidence of anything.
      const stale = { id: randomUUID(), hash: hex() };
      await client.query(
        `INSERT INTO api_tokens
           (id, profile_id, app_id, kind, token_hash, token_prefix, scopes, expires_at)
         VALUES ($1, $2, $3, 'refresh', $4, $5, $6::text[], now() - interval '1 day')`,
        [
          stale.id,
          sleeper,
          writeAppId,
          stale.hash,
          prefix('rt'),
          ['expenses.read', 'offline_access'],
        ],
      );

      const healthy = await asCommittedUser(sleeper, async () => {
        // The same person has the same application connected on another device.
        const fresh = await grant(writeClientId, ['expenses.read', 'offline_access']);

        const message = await expectDenied(rotate(stale, writeClientId));
        expect(message).toMatch(/INVALID_GRANT/);
        expect(message).toMatch(/spent, expired or not for this client/);
        // The distinction that matters: refused, not accused.
        expect(message).not.toMatch(/already used|disconnected/);

        return fresh;
      });

      const rows = await client.query<{ revoked_at: Date | null }>(
        `SELECT revoked_at FROM api_tokens WHERE id = ANY($1::uuid[])`,
        [[healthy.accessTokenId, healthy.refreshTokenId]],
      );
      expect(rows.rows).toHaveLength(2);
      expect(rows.rows.filter((row) => row.revoked_at !== null)).toEqual([]);
    } finally {
      await client.query(`DELETE FROM profiles WHERE id = $1`, [sleeper]);
    }
  });
});
