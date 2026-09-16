// @ts-nocheck
/**
 * Deterministic E2E fixture — the exact, known state the Maestro flows assert.
 *
 * Unlike `seed-demo` (a randomised dashboard to look at), this writes ONE fixed
 * account and ONE fixed group so `e2e/*.yaml` can assert real strings — "Goa
 * trip", "Beach shack dinner", the ghost "Priya" — instead of degrading to
 * `optional` "screen renders" proofs. It is the other half of un-disabling the
 * Maestro job in CI: the app signs into this account, syncs, and finds this
 * state.
 *
 * It talks to a Supabase project over the service key (bypassing RLS) plus the
 * admin API (to mint the login user). It NEVER touches the local Postgres or a
 * production project — it refuses to run against the known prod ref and requires
 * an explicit `E2E_SUPABASE_URL`.
 *
 * Required env:
 *   E2E_SUPABASE_URL   staging project URL      (e.g. https://abc.supabase.co)
 *   E2E_SERVICE_KEY    that project's service_role key
 *   E2E_EMAIL          the login the flows use   (e.g. e2e@waves.test)
 *   E2E_PASSWORD       its password
 *
 * Run:  node e2e/seed-e2e.mjs
 *
 * It is idempotent: it deletes any prior fixture (the group, then the user) and
 * rebuilds it, so a re-run always lands the same known state.
 */

import { randomUUID } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';

// ── config ──────────────────────────────────────────────────────────────────

const URL = process.env.E2E_SUPABASE_URL;
const SERVICE_KEY = process.env.E2E_SERVICE_KEY;
const EMAIL = process.env.E2E_EMAIL ?? 'e2e@waves.test';
const PASSWORD = process.env.E2E_PASSWORD;

// The production project ref. This seeder deletes and rewrites freely, so it
// must never point at it, the way `seed-demo` refuses DATABASE_URL/DIRECT_URL.
const PROD_REF = 'ywojpnfyxxltvihqmcni';

if (!URL || !SERVICE_KEY || !PASSWORD) {
  console.error(
    'Missing env. Set E2E_SUPABASE_URL, E2E_SERVICE_KEY and E2E_PASSWORD (E2E_EMAIL optional).',
  );
  process.exit(1);
}
if (URL.includes(PROD_REF)) {
  console.error(
    `Refusing to seed the production project (${PROD_REF}). Point at a staging project.`,
  );
  process.exit(1);
}

const db = createClient(URL, SERVICE_KEY, { auth: { persistSession: false } });

// The fixture. These strings are the contract the Maestro flows assert.
const GROUP_NAME = 'Goa trip';
const EXPENSE_DESC = 'Beach shack dinner';
const AMOUNT_MINOR = 120000n; // ₹1200.00 in paise
const GHOSTS = ['Priya', 'Sam', 'Dev'];

const die = (msg, error) => {
  console.error(msg, error?.message ?? error ?? '');
  process.exit(1);
};

// Split `total` minor units equally across `n` members, giving the earliest
// members the extra paise so the shares sum to the total exactly.
function equalShares(total, n) {
  const base = total / BigInt(n);
  let remainder = total - base * BigInt(n);
  const out = [];
  for (let i = 0; i < n; i += 1) {
    let share = base;
    if (remainder > 0n) {
      share += 1n;
      remainder -= 1n;
    }
    out.push(share);
  }
  return out;
}

// ── 1. reset any prior fixture ────────────────────────────────────────────────

async function findUserByEmail(email) {
  // The admin API has no get-by-email, so page through until we find it. A
  // staging project stays small, so one or two pages is plenty.
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) die('listUsers failed', error);
    const hit = data.users.find((u) => (u.email ?? '').toLowerCase() === email.toLowerCase());
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

/**
 * Retire any prior fixture, so a re-run lands the same known state.
 *
 * Retire, not delete. This used to hard-delete the groups the fixture user
 * created and lean on the cascade to take their expenses with them — and the
 * ledger will not allow that: `expenses` is append-only by trigger (ADR-004),
 * so the delete comes back as
 * `APPEND_ONLY: expenses rows cannot be delete. Insert a new version or set
 * deleted_at.` and the seeder stops before it has rebuilt anything. A ledger
 * whose history can be erased by whoever holds a service key is not a ledger,
 * so the rule is right and the seeder was wrong.
 *
 * Soft-deleting is enough for what a fixture needs. A group with `deleted_at`
 * set is out of the dashboard, out of balances and out of every list the flows
 * assert against, so the rebuilt "Goa trip" is unambiguously the only one on
 * screen. The retired rows stay in a staging database nobody reads, which is
 * the correct price for keeping the append-only guarantee honest.
 *
 * The user itself is still deleted outright: `auth.users` carries no history
 * worth keeping, and removing it is what lets `createUser` mint the login again
 * with the password this run was given.
 */
async function reset() {
  const existing = await findUserByEmail(EMAIL);
  if (!existing) return;

  const { data: groups } = await db.from('groups').select('id').eq('created_by', existing.id);
  for (const g of groups ?? []) {
    const { error } = await db
      .from('groups')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', g.id);
    if (error) die(`retiring group ${g.id} failed`, error);
  }

  const { error } = await db.auth.admin.deleteUser(existing.id);
  if (error) die('deleteUser failed', error);
  console.log(
    `· reset: retired ${groups?.length ?? 0} prior fixture group(s) and removed ${EMAIL}`,
  );
}

// ── 2. build the fixture ──────────────────────────────────────────────────────

async function insert(table, row) {
  const { error } = await db.from(table).insert(row);
  if (error) die(`insert into ${table} failed`, error);
}

/**
 * Insert a row that something else may already have made, and make it ours.
 *
 * One row here is not the seeder's to create: `profiles`. A trigger on
 * `auth.users` writes a profile the moment `createUser` returns (restored in
 * #667 — a squashed baseline had dropped it, and new accounts came up with no
 * profile at all, a blank avatar and a settings page that spun forever). So the
 * seeder's own insert lands on a primary key that already exists and the whole
 * fixture dies on its first row, which is what a fresh staging project did the
 * first time anybody stood one up.
 *
 * Upserting rather than skipping, because the trigger's row and the fixture's
 * are not the same row: the trigger knows an id and an email, and the fixture
 * wants a display name and a currency the flows assert against.
 */
async function upsert(table, row) {
  const { error } = await db.from(table).upsert(row);
  if (error) die(`upsert into ${table} failed`, error);
}

/**
 * One expense: `payer` paid `amount`, split equally among `shareMembers`.
 *
 * Through `waves_apply_expense`, the same routine the app's own writes land in
 * (`supabase/functions/expense-write`), and not by inserting the version, its
 * payers and its shares one table at a time — which is what this used to do,
 * and which cannot work.
 *
 * `expense_versions`, `expense_payers` and `expense_shares` each carry a
 * **deferred** constraint trigger (`*_totals_match`) checking that the payers
 * and the shares both sum to the expense. Deferred means it fires at COMMIT,
 * which is exactly right for the app: it writes all three inside one
 * transaction and the sums are whole by the time anything is checked. But
 * PostgREST gives every request its own transaction, so the version committed
 * on its own with no payers yet and the trigger refused it —
 * `PAYER_MISMATCH: payers sum to 0 but the expense is 120000`. There is no
 * ordering that fixes it, because no order makes the intermediate states
 * balance.
 *
 * Going through the RPC is better than a workaround anyway: the fixture is now
 * built by the code path the app uses, so a fixture that seeds is also a
 * statement that the write path works.
 */
async function insertExpense({
  groupId,
  payer,
  amount,
  shareMembers,
  description,
  category,
  date,
}) {
  const expenseId = randomUUID();
  const shares = equalShares(amount, shareMembers.length);
  const { error } = await db.rpc('waves_apply_expense', {
    p_group_id: groupId,
    p_expense_id: expenseId,
    p_author_member_id: payer,
    p_description: description,
    p_category: category ?? null,
    p_expense_date: date,
    p_currency: 'INR',
    p_amount: amount.toString(),
    p_split_type: 'equal',
    p_split_params: { kind: 'equal' },
    p_payers: [{ memberId: payer, amount: amount.toString() }],
    p_shares: shareMembers.map((memberId, i) => ({
      memberId,
      amount: shares[i].toString(),
    })),
    p_client_mutation_id: randomUUID(),
    p_notes: null,
    p_receipt_id: null,
    p_base_version_no: null,
    p_fx: null,
    p_payment_method: null,
    p_receipt_share_url: null,
    p_category_meta: null,
    p_location: null,
  });
  // The database speaks in its own vocabulary here — UNKNOWN_MEMBER,
  // WRONG_GROUP, SHARE_MISMATCH — and those names are the useful part of a
  // failed seed, so they are passed through rather than summarised.
  if (error) die('waves_apply_expense failed', error);
}

// A small group where the focus user shares an unsettled balance with one named
// ghost — so that ghost shows up on the Friends screen. Two of these, with the
// SAME ghost name, give `friends-merge-guests.yaml` two mergeable rows to fold
// together. The focus user pays and both split equally, so the ghost owes them.
async function seedMergeGroup(userId, groupName, ghostName) {
  const groupId = randomUUID();
  await insert('groups', {
    id: groupId,
    name: groupName,
    type: 'other',
    default_currency: 'INR',
    created_by: userId,
  });
  const focusMemberId = randomUUID();
  const ghostMemberId = randomUUID();
  await insert('group_members', {
    id: focusMemberId,
    group_id: groupId,
    profile_id: userId,
    role: 'admin',
    joined_via: 'creator',
  });
  await insert('group_members', {
    id: ghostMemberId,
    group_id: groupId,
    ghost_name: ghostName,
    joined_via: 'ghost',
  });
  await insertExpense({
    groupId,
    payer: focusMemberId,
    amount: 60000n, // ₹600, split 50/50 → the ghost owes the focus user ₹300
    shareMembers: [focusMemberId, ghostMemberId],
    description: `${groupName} split`,
    category: 'other',
    date: '2026-08-05',
  });
}

async function seed() {
  // The login user + its profile.
  const { data: created, error: userErr } = await db.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
  });
  if (userErr) die('createUser failed', userErr);
  const userId = created.user.id;
  // Upsert: the `auth.users` trigger has already written this profile.
  await upsert('profiles', { id: userId, display_name: 'You', default_currency: 'INR' });

  // The group.
  const groupId = randomUUID();
  await insert('groups', {
    id: groupId,
    name: GROUP_NAME,
    type: 'trip',
    default_currency: 'INR',
    cover_emoji: '🏖️',
    created_by: userId,
  });

  // Members: the focus user (admin) plus the ghosts the flows name.
  const focusMemberId = randomUUID();
  await insert('group_members', {
    id: focusMemberId,
    group_id: groupId,
    profile_id: userId,
    role: 'admin',
    joined_via: 'creator',
  });
  const ghostIds = {};
  for (const name of GHOSTS) {
    const id = randomUUID();
    ghostIds[name] = id;
    await insert('group_members', {
      id,
      group_id: groupId,
      ghost_name: name,
      joined_via: 'ghost',
    });
  }

  // One expense: paid by Priya, split equally across the three ghosts and NOT
  // the focus user — so the focus user's net balance is zero and `leave-group`
  // can leave without settling first, while `home-to-add-expense` still sees
  // the expense and the ghost.
  // Through the same RPC as every other expense here — see `insertExpense` for
  // why a table-at-a-time insert cannot work against the deferred totals
  // triggers.
  await insertExpense({
    groupId,
    payer: ghostIds.Priya,
    amount: AMOUNT_MINOR,
    shareMembers: GHOSTS.map((n) => ghostIds[n]),
    description: EXPENSE_DESC,
    category: 'food',
    date: '2026-08-01',
  });

  // The mergeable pair for friends-merge-guests: the same ghost "Reeya" in two
  // groups, each with a balance so she appears twice on Friends and can be
  // merged. Kept separate from Goa trip, whose focus balance stays zero.
  await seedMergeGroup(userId, 'Weekend hike', 'Reeya');
  await seedMergeGroup(userId, 'Diwali dinner', 'Reeya');

  console.log(
    `✓ seeded ${EMAIL}: "${GROUP_NAME}" (${GHOSTS.length} ghosts, "${EXPENSE_DESC}" ₹1200) + a mergeable "Reeya" in two groups`,
  );
}

// ── run ───────────────────────────────────────────────────────────────────────

await reset();
await seed();
