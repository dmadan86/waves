// @ts-nocheck
/**
 * Demo data for ONE existing account — a realistic ledger to demo and to find
 * UI problems at scale, written into a live database.
 *
 * Different from `seed-demo.mjs` next door, which invents its own focus user and
 * only ever talks to a throwaway local Postgres. This one attaches to a real
 * account that already exists (by email), creates groups it is an admin of, and
 * fills them through the application's own write path.
 *
 * ── what it will not do ────────────────────────────────────────────────────
 *
 *   • It never UPDATEs or DELETEs a pre-existing row. It only INSERTs, and only
 *     into groups it created in this run.
 *   • It never creates an auth user. Everybody except the target account is a
 *     ghost — a `group_members` row with a `ghost_name` and no profile (ADR-006).
 *   • It never disables a trigger or a constraint.
 *
 * ── how the ledger stays honest ────────────────────────────────────────────
 *
 * Every expense goes through `waves_apply_expense`, the same SQL function that
 * `supabase/functions/expense-write` and `/sync` call, and the shares come from
 * `computeShares` in `@waves/core` — the same split engine the app runs. So the
 * three invariants hold by construction rather than by hope:
 *
 *   Σ payers = amount            — checked by `waves_check_expense_totals`
 *   Σ shares = amount            — checked by the same trigger, and by
 *                                  `computeShares` before that
 *   Σ balance = 0 per currency   — falls out of the first two; ADR-004 keeps
 *                                  currencies in separate buckets and never
 *                                  sums across them
 *
 * `--verify` re-proves all three by reading the database back, and every run
 * ends with that check.
 *
 * ── reversibility ──────────────────────────────────────────────────────────
 *
 * Every group it creates is named with `SEED_MARKER` (default "[demo] ").
 * `scripts/demo-seed-cleanup.sql` removes exactly those groups and nothing else.
 *
 * ── running it ─────────────────────────────────────────────────────────────
 *
 *   node packages/db/scripts/seed-account.mjs --canary   # 1 small group, then verify
 *   node packages/db/scripts/seed-account.mjs            # the remaining nine
 *   node packages/db/scripts/seed-account.mjs --verify   # re-check, write nothing
 *
 * Connection comes from SEED_DATABASE_URL, else DIRECT_URL (`packages/db/.env`).
 * A non-local host needs SEED_ALLOW_REMOTE=1, and the production project needs
 * SEED_ALLOW_PROD=1 on top of that — two separate deliberate acts, because the
 * difference between the demo database and the one with other people's money in
 * it is not something to discover afterwards.
 */

import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';
import pg from 'pg';

import {
  CATEGORIES,
  computeShares,
  minorUnitExponent,
  serialiseSplitParams,
} from '../../core/dist/core.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(HERE, '..', '.env'), quiet: true });

// ── configuration ──────────────────────────────────────────────────────────

const CONNECTION_STRING = process.env.SEED_DATABASE_URL ?? process.env.DIRECT_URL;
const TARGET_EMAIL = (process.env.SEED_TARGET_EMAIL ?? 'apptest@gmail.com').toLowerCase();
const MARKER = process.env.SEED_MARKER ?? '[demo] ';

/** The production project. Named so the guard below can say what it is guarding. */
const PROD_REF = 'ywojpnfyxxltvihqmcni';

const ARGS = new Set(process.argv.slice(2));
const CANARY_ONLY = ARGS.has('--canary');
const VERIFY_ONLY = ARGS.has('--verify');

// Reproducible when SEED_RANDOM is set, varied otherwise.
let seedState = Number(process.env.SEED_RANDOM ?? Date.now()) >>> 0;
function rand() {
  seedState |= 0;
  seedState = (seedState + 0x6d2b79f5) | 0;
  let t = Math.imul(seedState ^ (seedState >>> 15), 1 | seedState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const randInt = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
function sample(arr, k) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, Math.min(k, copy.length));
}

// ── the ten groups ─────────────────────────────────────────────────────────
//
// `members` counts the target account too, so `members - 1` ghosts get created.
// `foreign` is the currencies expenses may be recorded in besides the group's
// own — an expense in a currency the group does not settle in carries an fx
// record, exactly as the app writes it (ADR-003).

const GROUPS = [
  // The canary: small enough to read by eye, complete enough to prove the path.
  {
    key: 'canary',
    name: 'Weekend in Goa',
    type: 'trip',
    currency: 'INR',
    emoji: '🏖️',
    members: 3,
    expenses: 10,
    foreign: [],
    country: 'IN',
    zone: 'Asia/Kolkata',
    trip: true,
  },

  {
    name: 'Flat 402',
    type: 'home',
    currency: 'INR',
    emoji: '🏠',
    members: 4,
    expenses: 45,
    foreign: [],
    country: 'IN',
    zone: 'Asia/Kolkata',
  },

  {
    name: 'Tokyo, cherry season',
    type: 'trip',
    currency: 'JPY',
    emoji: '🌸',
    members: 6,
    expenses: 180,
    foreign: ['INR', 'USD'],
    country: 'JP',
    zone: 'Asia/Tokyo',
    trip: true,
  },

  {
    name: 'Coffee club',
    type: 'friends',
    currency: 'INR',
    emoji: '☕',
    members: 2,
    expenses: 14,
    foreign: [],
    country: 'IN',
    zone: 'Asia/Kolkata',
  },

  {
    name: 'Eurail, nine cities',
    type: 'trip',
    currency: 'EUR',
    emoji: '🚆',
    members: 8,
    expenses: 120,
    foreign: ['GBP', 'CHF'],
    country: 'DE',
    zone: 'Europe/Berlin',
    trip: true,
  },

  {
    name: 'Q3 offsite',
    type: 'event',
    currency: 'AED',
    emoji: '🎯',
    members: 12,
    expenses: 60,
    foreign: ['INR'],
    country: 'AE',
    zone: 'Asia/Dubai',
  },

  {
    name: 'Us two',
    type: 'couple',
    currency: 'GBP',
    emoji: '❤️',
    members: 2,
    expenses: 22,
    foreign: [],
    country: 'GB',
    zone: 'Europe/London',
  },

  {
    name: 'Dubai sprint',
    type: 'trip',
    currency: 'USD',
    emoji: '🏙️',
    members: 5,
    expenses: 30,
    foreign: ['AED'],
    country: 'AE',
    zone: 'Asia/Dubai',
    trip: true,
  },

  // The wide one — near the 20-member top of the range.
  {
    name: 'Hostel crew',
    type: 'home',
    currency: 'SGD',
    emoji: '🛏️',
    members: 19,
    expenses: 18,
    foreign: [],
    country: 'SG',
    zone: 'Asia/Singapore',
  },

  // The deep one — near the 300-expense top of the range.
  {
    name: 'The big trip',
    type: 'trip',
    currency: 'INR',
    emoji: '🧳',
    members: 14,
    expenses: 300,
    foreign: ['THB', 'USD'],
    country: 'IN',
    zone: 'Asia/Kolkata',
    trip: true,
  },
];

// ── content ────────────────────────────────────────────────────────────────

const GHOST_NAMES = [
  'Priya',
  'Sam',
  'Nikhil',
  'Zoya',
  'Dev',
  'Aarav',
  'Diya',
  'Kabir',
  'Ananya',
  'Vivaan',
  'Ishaan',
  'Meera',
  'Rohan',
  'Sara',
  'Tara',
  'Arjun',
  'Leila',
  'Farhan',
  'Nina',
  'Omar',
  'Riya',
  'Yusuf',
  'Kiran',
  'Maya',
  'Ravi',
];

/** description pools per category, so a row reads like a real one. */
const SPEND = [
  [
    'food',
    [
      'Dinner',
      'Lunch',
      'Breakfast',
      'Street food',
      'Pizza',
      'Bakery',
      'Ice cream',
      'Late-night noodles',
      'Brunch',
      'Sunday roast',
      'Snacks for the drive',
      'Drinks',
      'Coffee',
      'Rooftop bar',
      'Beers after work',
      'Wine for dinner',
    ],
  ],
  [
    'travel',
    [
      'Uber to airport',
      'Train tickets',
      'Auto rickshaw',
      'Petrol',
      'Parking',
      'Metro cards',
      'Taxi from the station',
      'Bike rental',
      'Ferry',
      'Airport transfer',
    ],
  ],
  ['stay', ['Hotel night', 'Airbnb', 'Hostel beds', 'Late checkout', 'Resort deposit']],
  ['groceries', ['Groceries', 'Big weekly shop', 'Water bottles', 'Milk and bread', 'Fruit stall']],
  [
    'entertainment',
    [
      'Museum entry',
      'Movie tickets',
      'Boat ride',
      'Cooking class',
      'Snorkelling',
      'Concert tickets',
      'Football tickets',
    ],
  ],
  ['home', ['Electricity', 'Internet', 'Gas cylinder', 'Cleaner', 'Laundry', 'Rent top-up']],
  ['shopping', ['Souvenirs', 'SIM card', 'Sunscreen', 'Luggage tag', 'Beach towels', 'Umbrella']],
  ['health', ['Pharmacy', 'Clinic visit', 'Travel insurance', 'Plasters and paracetamol']],
  ['gifts', ['Birthday present', 'Thank-you flowers', 'Wedding gift']],
  ['other', ['Tips', 'Bank charge', 'Lost key replacement', 'Rounding it out']],
];

// Checked against the app's own catalog rather than trusted. A category id the
// catalog does not know falls back to "Other" in every client (`categoryOf`), so
// a typo here would not fail — it would quietly produce a demo account where
// every row says Other, which is the whole point of seeding one gone.
{
  const known = new Set(CATEGORIES.map((category) => category.id));
  const unknown = SPEND.map(([id]) => id).filter((id) => !known.has(id));
  if (unknown.length) {
    throw new Error(
      `Unknown category id(s): ${unknown.join(', ')}. The catalog has ${[...known].join(', ')}.`,
    );
  }
}

/**
 * How often each category actually turns up. Picking uniformly from `SPEND`
 * produces as many birthday presents as dinners, which reads as generated the
 * moment anybody looks at the list — people eat and travel constantly and buy
 * wedding gifts twice a year.
 */
const CATEGORY_WEIGHTS = {
  food: 10,
  travel: 7,
  groceries: 5,
  stay: 4,
  entertainment: 3,
  shopping: 3,
  home: 3,
  other: 2,
  health: 1,
  gifts: 1,
};

const SPEND_POOL = SPEND.flatMap((entry) =>
  Array.from({ length: CATEGORY_WEIGHTS[entry[0]] ?? 1 }, () => entry),
);

const PAYMENT_METHODS = ['cash', 'credit', 'debit', 'forex', null];
const SETTLEMENT_METHODS = ['upi', 'cash', 'bank', 'other'];

/**
 * Rough mid-market rates against USD, good enough for demo money and honest
 * about being made up — every fx record it builds says `source: 'demo-seed'`,
 * so nobody mistakes one for a rate that was actually quoted.
 */
const PER_USD = {
  USD: 1,
  INR: 83.2,
  EUR: 0.92,
  GBP: 0.79,
  JPY: 151.4,
  AED: 3.67,
  CHF: 0.88,
  SGD: 1.34,
  THB: 35.8,
};

// ── money helpers ──────────────────────────────────────────────────────────

/** A plausible spend in `currency`, in minor units, around `usdish` dollars. */
function amountIn(currency, usdish) {
  const exponent = minorUnitExponent(currency);
  const major = usdish * (PER_USD[currency] ?? 1);
  // Round to something a person would actually see on a bill.
  const rounded = exponent === 0 ? Math.round(major) : Math.round(major * 100) / 100;
  return BigInt(Math.max(1, Math.round(rounded * 10 ** exponent)));
}

/** The fx record the app stores when an expense is not in the group currency. */
function fxRecordFor(from, to, ts) {
  const rate = (PER_USD[to] ?? 1) / (PER_USD[from] ?? 1); // 1 `from` = rate `to`
  // Kept as an exact rational with a fixed denominator: ADR-003 wants the rate
  // reproducible, not pretty.
  const den = 1000000n;
  const num = BigInt(Math.round(rate * 1000000));
  return { num: num.toString(), den: den.toString(), from, to, ts, source: 'demo-seed' };
}

// ── dates ──────────────────────────────────────────────────────────────────

const TODAY = new Date();
function isoDate(daysAgo) {
  const d = new Date(TODAY);
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

/**
 * Spread `count` dates over `spanDays`, clustered rather than uniform — a trip
 * happens in a fortnight, a flat share trickles along for a year. Sorted oldest
 * first so the activity feed reads in order.
 */
function datesFor(count, spanDays, clustered) {
  const out = [];
  if (clustered) {
    // One burst: the trip itself, somewhere in the last `spanDays`.
    const start = randInt(10, Math.max(12, spanDays));
    const width = Math.max(4, Math.min(start - 1, Math.ceil(count / 8) + randInt(3, 10)));
    for (let i = 0; i < count; i += 1) out.push(start - randInt(0, width));
  } else {
    for (let i = 0; i < count; i += 1) out.push(randInt(0, spanDays));
  }
  return out.sort((a, b) => b - a).map(isoDate);
}

// ── splits ─────────────────────────────────────────────────────────────────

/**
 * Pick a split for this expense and return what `waves_apply_expense` needs:
 * the type, the wire-form params, and the shares — computed by the same engine
 * the app uses, seeded with the expense id exactly as the client does.
 */
function buildSplit(expenseId, amount, participants) {
  const roll = rand();
  let params;

  if (roll < 0.55 || participants.length < 2) {
    params = { kind: 'equal' };
  } else if (roll < 0.75) {
    // Shares: someone had the big room, someone brought a plus-one.
    const weights = {};
    for (const member of participants) weights[member] = pick([1, 1, 1, 2, 2, 3]);
    if (!Object.values(weights).some((w) => w > 0)) weights[participants[0]] = 1;
    params = { kind: 'shares', weights };
  } else if (roll < 0.9) {
    // Percent: basis points, and they have to land on exactly 10000.
    const basisPoints = {};
    let left = 10000;
    participants.forEach((member, index) => {
      if (index === participants.length - 1) {
        basisPoints[member] = left;
      } else {
        const remaining = participants.length - index - 1;
        const share = Math.max(
          100,
          Math.min(
            left - remaining * 100,
            Math.round(((left / (remaining + 1)) * (0.6 + rand() * 0.8)) / 100) * 100,
          ),
        );
        basisPoints[member] = share;
        left -= share;
      }
    });
    params = { kind: 'percent', basisPoints };
  } else {
    // Exact: "I only had the starter". Amounts must sum to the total.
    const amounts = {};
    let left = amount;
    participants.forEach((member, index) => {
      if (index === participants.length - 1) {
        amounts[member] = left;
      } else {
        const remaining = BigInt(participants.length - index - 1);
        const cap = left - remaining; // leave at least 1 minor unit each
        const want = left / BigInt(participants.length - index);
        const jittered = want + BigInt(Math.round((rand() - 0.5) * Number(want) * 0.5));
        const chosen = jittered < 1n ? 1n : jittered > cap ? cap : jittered;
        amounts[member] = chosen;
        left -= chosen;
      }
    });
    params = { kind: 'exact', amounts };
  }

  const shares = computeShares({ amount, participants, params, seed: expenseId });
  return { splitType: params.kind, splitParams: serialiseSplitParams(params), shares };
}

/** Who actually put money down. Usually one person; sometimes two or three. */
function buildPayers(amount, participants) {
  if (rand() > 0.15 || participants.length < 2) {
    return { [pick(participants)]: amount };
  }
  const payers = sample(participants, randInt(2, Math.min(3, participants.length)));
  const out = {};
  let left = amount;
  payers.forEach((member, index) => {
    if (index === payers.length - 1) {
      out[member] = left;
    } else {
      const remaining = BigInt(payers.length - index - 1);
      const cap = left - remaining;
      const want = left / BigInt(payers.length - index);
      out[member] = want < 1n ? 1n : want > cap ? cap : want;
      left -= out[member];
    }
  });
  return out;
}

// ── database ───────────────────────────────────────────────────────────────

const jsonMoney = (map) =>
  JSON.stringify(
    Object.entries(map).map(([memberId, amount]) => ({
      memberId,
      amount: amount.toString(),
    })),
  );

async function findTargetProfile(client) {
  // The account must already exist — this script never mints one.
  const { rows } = await client.query(
    `SELECT p.id, p.display_name, p.default_currency
       FROM public.profiles p
       JOIN auth.users u ON u.id = p.id
      WHERE lower(u.email) = $1`,
    [TARGET_EMAIL],
  );
  if (rows.length === 0) {
    throw new Error(
      `No profile for ${TARGET_EMAIL}. This seeder attaches to an account that ` +
        `already exists; it does not create auth users.`,
    );
  }
  return rows[0];
}

/**
 * Everything already in a half-built group, so a run interrupted by a dropped
 * connection can pick up where it stopped rather than leaving one group short
 * forever. Returns null when the group does not exist yet.
 */
async function existingGroup(client, name) {
  const { rows } = await client.query(
    `SELECT g.id,
            (SELECT m.id FROM public.group_members m
              WHERE m.group_id = g.id AND m.role = 'admin' AND m.profile_id IS NOT NULL
              LIMIT 1) AS owner_member_id,
            (SELECT count(*)::int FROM public.expenses e WHERE e.group_id = g.id) AS expenses
       FROM public.groups g
      WHERE g.name = $1 AND g.deleted_at IS NULL`,
    [name],
  );
  if (rows.length === 0) return null;
  const { rows: members } = await client.query(
    `SELECT id FROM public.group_members WHERE group_id = $1 ORDER BY created_at`,
    [rows[0].id],
  );
  return {
    groupId: rows[0].id,
    ownerMemberId: rows[0].owner_member_id,
    memberIds: members.map((m) => m.id),
    expenses: rows[0].expenses,
  };
}

/** Create one group, its members, and its expenses. Returns a summary row. */
async function buildGroup(client, spec, profile) {
  const name = `${MARKER}${spec.name}`;

  // Resume a group a previous run left half-full rather than starting a second
  // copy of it. Membership is created in one transaction with the group, so a
  // group that exists has all its people.
  const resume = await existingGroup(client, name);
  if (resume) {
    if (resume.expenses >= spec.expenses) return null; // already complete
    return fillGroup(client, spec, resume, spec.expenses - resume.expenses, true);
  }

  const groupId = randomUUID();
  await client.query('BEGIN');
  await client.query(
    `INSERT INTO public.groups
       (id, name, type, default_currency, cover_emoji, created_by, country_code,
        time_zone, start_date, end_date, simplify_debts, remind_daily)
     VALUES ($1, $2, $3::public."GroupType", $4, $5, $11, $6, $7, $8, $9, $10, false)`,
    [
      groupId,
      name,
      spec.type,
      spec.currency,
      spec.emoji,
      spec.country,
      spec.zone,
      spec.trip ? isoDate(randInt(120, 300)) : null,
      spec.trip ? isoDate(randInt(20, 110)) : null,
      rand() < 0.7,
      // A profile id, not a member id. `groups.created_by` carries no foreign
      // key, so nothing stops the wrong kind of uuid going in — this is what
      // `waves_create_group` writes, and matching it is the only reason the
      // column means anything.
      profile.id,
    ],
  );

  // The account this is all for, as admin.
  const ownerMemberId = randomUUID();
  await client.query(
    `INSERT INTO public.group_members (id, group_id, profile_id, role, joined_via)
     VALUES ($1, $2, $3, 'admin', 'creator')`,
    [ownerMemberId, groupId, profile.id],
  );

  // Everybody else is a ghost: a name, no account, no auth user (ADR-006).
  const memberIds = [ownerMemberId];
  for (const ghost of sample(GHOST_NAMES, spec.members - 1)) {
    const id = randomUUID();
    await client.query(
      `INSERT INTO public.group_members (id, group_id, ghost_name, role, joined_via)
       VALUES ($1, $2, $3, 'member', 'ghost')`,
      [id, groupId, ghost],
    );
    memberIds.push(id);
  }
  await client.query('COMMIT');

  return fillGroup(client, spec, { groupId, ownerMemberId, memberIds }, spec.expenses, false);
}

/**
 * The expenses, the removals and the settlements. Separate from the group and
 * its people so a resumed run can call it alone.
 *
 * One transaction per expense. Deliberately not one big transaction: the balance
 * refresh is a deferred constraint trigger that fires once per inserted row at
 * COMMIT and recomputes the whole group each time, so batching would make the
 * commit quadratic in the finished size of the group rather than merely walking
 * up to it. It also means an interrupted run leaves whole expenses behind, never
 * half of one.
 */
async function fillGroup(client, spec, shell, count, resumed) {
  const { groupId, ownerMemberId, memberIds } = shell;
  const name = `${MARKER}${spec.name}`;
  const dates = datesFor(count, spec.trip ? 320 : 300, Boolean(spec.trip));
  const splitCounts = { equal: 0, shares: 0, percent: 0, exact: 0 };
  const currencyCounts = {};
  const expenseIds = [];
  let multiPayer = 0;

  for (let i = 0; i < count; i += 1) {
    // Not everybody is on every expense — two people sharing a taxi is normal.
    const size =
      memberIds.length <= 3
        ? randInt(2, memberIds.length)
        : Math.min(
            memberIds.length,
            Math.max(2, Math.round(memberIds.length * (0.45 + rand() * 0.55))),
          );
    const participants = sample(memberIds, size);

    // The group's own currency most of the time; a foreign one now and then.
    const currency = spec.foreign.length && rand() < 0.18 ? pick(spec.foreign) : spec.currency;
    const [category, descriptions] = pick(SPEND_POOL);
    const amount = amountIn(currency, 4 + rand() * (spec.trip ? 180 : 60));

    const expenseId = randomUUID();
    const { splitType, splitParams, shares } = buildSplit(expenseId, amount, participants);
    const payers = buildPayers(amount, participants);
    if (Object.keys(payers).length > 1) multiPayer += 1;

    const date = dates[i];
    const fx =
      currency === spec.currency
        ? null
        : fxRecordFor(currency, spec.currency, `${date}T12:00:00.000Z`);

    // The author of an expense is whoever wrote it, and only a real account can
    // have written one — a ghost has no device. Payer and author are different
    // questions, which is why a ghost can pay for something.
    await client.query(
      // Named arguments, not positional: this function takes twenty-two, most
      // of them optional, and a seeder that silently slid `fx` into the
      // `notes` slot would still look right in the output.
      `SELECT public.waves_apply_expense(
         p_group_id         => $1::uuid,
         p_expense_id       => $2::uuid,
         p_author_member_id => $3::uuid,
         p_description      => $4::text,
         p_category         => $5::text,
         p_expense_date     => $6::date,
         p_currency         => $7::char(3),
         p_amount           => $8::bigint,
         p_split_type       => $9::text,
         p_split_params     => $10::jsonb,
         p_payers           => $11::jsonb,
         p_shares           => $12::jsonb,
         p_client_mutation_id => $13::uuid,
         p_fx               => $14::jsonb,
         p_payment_method   => $15::text,
         p_source           => 'manual')`,
      [
        groupId,
        expenseId,
        ownerMemberId,
        pick(descriptions),
        category,
        date,
        currency,
        amount.toString(),
        splitType,
        JSON.stringify(splitParams),
        jsonMoney(payers),
        jsonMoney(Object.fromEntries(shares)),
        randomUUID(),
        fx ? JSON.stringify(fx) : null,
        pick(PAYMENT_METHODS),
      ],
    );

    expenseIds.push(expenseId);
    splitCounts[splitType] += 1;
    currencyCounts[currency] = (currencyCounts[currency] ?? 0) + 1;
  }

  // A few things people typed and then removed. Soft-delete, the way the app
  // does it — the row stays, the balance stops counting it.
  let deleted = 0;
  for (const id of sample(expenseIds, Math.floor(expenseIds.length / 40))) {
    await client.query(
      `UPDATE public.expenses SET deleted_at = now(), deleted_by = $1 WHERE id = $2`,
      [ownerMemberId, id],
    );
    deleted += 1;
  }

  // And a couple of payments back, some confirmed and some still waiting —
  // both states are worth looking at on the screen.
  let settlements = 0;
  if (memberIds.length >= 2) {
    for (let i = 0; i < randInt(1, 3); i += 1) {
      const [from, to] = sample(memberIds, 2);
      const confirmed = rand() < 0.6;
      await client.query(
        `INSERT INTO public.settlements
           (id, group_id, from_member_id, to_member_id, currency, amount, method, status,
            confirmed_at, note, initiated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::public."SettlementMethod",
                 $8::public."SettlementStatus", $9, $10, $11)`,
        [
          randomUUID(),
          groupId,
          from,
          to,
          spec.currency,
          amountIn(spec.currency, 5 + rand() * 60).toString(),
          pick(SETTLEMENT_METHODS),
          confirmed ? 'confirmed' : 'initiated',
          confirmed ? new Date().toISOString() : null,
          pick(['Paid back', 'Settled up', 'Sent over UPI', null]),
          new Date(Date.now() - randInt(1, 40) * 86400000).toISOString(),
        ],
      );
      settlements += 1;
    }
  }

  return {
    groupId,
    name,
    type: spec.type,
    currency: spec.currency,
    resumed,
    members: memberIds.length,
    expenses: count,
    deleted,
    settlements,
    multiPayer,
    splitCounts,
    currencyCounts,
  };
}

// ── verification ───────────────────────────────────────────────────────────

/**
 * Read the ledger back and prove it. Three separate questions, all of which
 * have to answer yes, and none of which trusts what the seeder thinks it wrote.
 */
async function verify(client, profileId) {
  const problems = [];

  const { rows: groups } = await client.query(
    `SELECT g.id, g.name, g.default_currency,
            (SELECT count(*) FROM public.group_members m
              WHERE m.group_id = g.id) AS members,
            (SELECT count(*) FROM public.expenses e
              WHERE e.group_id = g.id AND e.deleted_at IS NULL) AS live_expenses
       FROM public.groups g
      WHERE g.name LIKE $1 AND g.deleted_at IS NULL
      ORDER BY g.created_at`,
    [`${MARKER}%`],
  );

  // 1. Does the target account actually see them? Membership, not just existence.
  const { rows: seen } = await client.query(
    `SELECT count(*)::int AS n
       FROM public.groups g
       JOIN public.group_members m ON m.group_id = g.id
      WHERE g.name LIKE $1 AND g.deleted_at IS NULL
        AND m.profile_id = $2 AND m.left_at IS NULL AND m.role = 'admin'`,
    [`${MARKER}%`, profileId],
  );
  if (seen[0].n !== groups.length) {
    problems.push(
      `${TARGET_EMAIL} is an admin of ${seen[0].n} of the ${groups.length} seeded groups`,
    );
  }

  // 2. Σ shares = amount and Σ payers = amount, on every live version. The
  //    trigger enforces this on write; this asks the data, not the trigger.
  const { rows: mismatched } = await client.query(
    `SELECT ev.id, ev.amount,
            (SELECT COALESCE(sum(amount), 0) FROM public.expense_payers p
              WHERE p.expense_version_id = ev.id) AS payers,
            (SELECT COALESCE(sum(amount), 0) FROM public.expense_shares s
              WHERE s.expense_version_id = ev.id) AS shares
       FROM public.expense_versions ev
       JOIN public.expenses e ON e.id = ev.expense_id AND e.current_version_id = ev.id
       JOIN public.groups g ON g.id = e.group_id
      WHERE g.name LIKE $1
        AND ((SELECT COALESCE(sum(amount), 0) FROM public.expense_payers p
               WHERE p.expense_version_id = ev.id) <> ev.amount
          OR (SELECT COALESCE(sum(amount), 0) FROM public.expense_shares s
               WHERE s.expense_version_id = ev.id) <> ev.amount)`,
    [`${MARKER}%`],
  );
  for (const row of mismatched) {
    problems.push(
      `version ${row.id}: amount ${row.amount}, payers ${row.payers}, shares ${row.shares}`,
    );
  }

  // 3. Σ balance = 0 per (group, currency) — ADR-004. Checked against the
  //    stored table AND against the ground-truth function, because a stored
  //    balance that has drifted is exactly the bug worth catching.
  const { rows: sums } = await client.query(
    `SELECT b.group_id, g.name, b.currency, sum(b.balance) AS total, count(*)::int AS rows
       FROM public.group_balances b
       JOIN public.groups g ON g.id = b.group_id
      WHERE g.name LIKE $1
      GROUP BY b.group_id, g.name, b.currency
      ORDER BY g.name, b.currency`,
    [`${MARKER}%`],
  );
  for (const row of sums) {
    if (BigInt(row.total) !== 0n) {
      problems.push(`${row.name} / ${row.currency}: balances sum to ${row.total}, not zero`);
    }
  }

  const { rows: drift } = await client.query(
    `SELECT g.name, t.member_id, t.currency, t.balance AS truth, b.balance AS stored
       FROM public.groups g
       CROSS JOIN LATERAL public.waves_group_balances_truth(g.id) t
       LEFT JOIN public.group_balances b
         ON b.group_id = g.id AND b.member_id = t.member_id AND b.currency = t.currency
      WHERE g.name LIKE $1
        AND (b.balance IS NULL OR b.balance <> t.balance)`,
    [`${MARKER}%`],
  );
  for (const row of drift) {
    problems.push(
      `${row.name}: stored balance ${row.stored ?? 'missing'} ≠ truth ${row.truth} for ${row.member_id} in ${row.currency}`,
    );
  }

  return { groups, sums, problems };
}

// ── reporting ──────────────────────────────────────────────────────────────

function report(summaries) {
  console.log('\nCreated:');
  for (const s of summaries) {
    const splits = Object.entries(s.splitCounts)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${k} ${n}`)
      .join(', ');
    const currencies = Object.entries(s.currencyCounts)
      .map(([k, n]) => `${k} ${n}`)
      .join(', ');
    console.log(`  ${s.name}${s.resumed ? '  (resumed)' : ''}`);
    console.log(`    ${s.groupId}`);
    console.log(
      `    ${s.type}, settles in ${s.currency} · ${s.members} members · ${s.expenses} expenses`,
    );
    console.log(`    splits: ${splits}`);
    console.log(`    expense currencies: ${currencies}`);
    console.log(
      `    ${s.multiPayer} multi-payer · ${s.deleted} removed · ${s.settlements} settlements`,
    );
  }
}

// ── entry ──────────────────────────────────────────────────────────────────

async function main() {
  if (!CONNECTION_STRING) {
    throw new Error('No SEED_DATABASE_URL and no DIRECT_URL. Nothing to connect to.');
  }

  const parsed = new URL(CONNECTION_STRING.replace(/^postgres(ql)?:/, 'http:'));
  const host = parsed.hostname;
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  const isProd = CONNECTION_STRING.includes(PROD_REF);

  if (!isLocal && process.env.SEED_ALLOW_REMOTE !== '1') {
    throw new Error(
      `Refusing a non-local host (${host}) without SEED_ALLOW_REMOTE=1. This writes ` +
        `rows into whatever it is pointed at.`,
    );
  }
  if (isProd && process.env.SEED_ALLOW_PROD !== '1') {
    throw new Error(
      `That is the production project (${PROD_REF}). Set SEED_ALLOW_PROD=1 as well if ` +
        `you really mean it.`,
    );
  }

  // pg now reads sslmode=require as verify-full, which the Supabase pooler's
  // chain does not satisfy. Strip it and be explicit instead.
  const connectionString = CONNECTION_STRING.replace(/([?&])sslmode=[^&]*/g, '$1').replace(
    /[?&]$/,
    '',
  );
  const client = new pg.Client({
    connectionString,
    ssl: isLocal ? undefined : { rejectUnauthorized: false },
    application_name: 'waves-demo-seed',
  });
  await client.connect();
  // The Supabase CLI's temporary login role (`cli_login_postgres`) is a member
  // of postgres but does not inherit it, so it has to assume the role itself.
  if (process.env.SEED_SET_ROLE) {
    await client.query(`set role ${pg.escapeIdentifier(process.env.SEED_SET_ROLE)}`);
  }

  console.log(`host      ${host}`);
  console.log(`project   ${isProd ? `${PROD_REF} (PRODUCTION)` : host}`);
  console.log(`account   ${TARGET_EMAIL}`);
  console.log(`marker    "${MARKER}"`);

  try {
    const profile = await findTargetProfile(client);
    console.log(`profile   ${profile.id} (${profile.display_name})`);

    if (!VERIFY_ONLY) {
      const todo = GROUPS.filter((spec) => (CANARY_ONLY ? spec.key === 'canary' : true));
      const summaries = [];
      for (const spec of todo) {
        const started = Date.now();
        process.stdout.write(`\n${MARKER}${spec.name} … `);
        const summary = await buildGroup(client, spec, profile);
        if (!summary) {
          process.stdout.write('already complete, skipped');
          continue;
        }
        summaries.push(summary);
        process.stdout.write(
          `${summary.resumed ? 'topped up with ' : ''}${summary.expenses} expenses in ` +
            `${((Date.now() - started) / 1000).toFixed(1)}s`,
        );
      }
      console.log('');
      if (summaries.length) report(summaries);
    }

    const { groups, sums, problems } = await verify(client, profile.id);

    console.log('\nVerification');
    console.log(`  groups seeded          ${groups.length}`);
    console.log(
      `  live expenses          ${groups.reduce((n, g) => n + Number(g.live_expenses), 0)}`,
    );
    console.log(`  member rows            ${groups.reduce((n, g) => n + Number(g.members), 0)}`);
    console.log(`  balance buckets        ${sums.length} (group × currency)`);
    for (const row of sums) {
      console.log(`    ${row.name} / ${row.currency}: ${row.rows} members, Σ = ${row.total}`);
    }
    if (problems.length) {
      console.log(`\n  ${problems.length} PROBLEM(S):`);
      for (const p of problems) console.log(`    ✗ ${p}`);
      process.exitCode = 1;
    } else {
      console.log('\n  ✓ Σ payers = Σ shares = amount on every live version');
      console.log('  ✓ Σ balance = 0 for every (group, currency) — ADR-004');
      console.log('  ✓ stored balances match waves_group_balances_truth()');
      console.log(`  ✓ ${TARGET_EMAIL} is an admin member of all ${groups.length}`);
    }
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* not in a transaction */
    }
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(
    `\nSeed failed — ${error?.code ? `${error.code}: ` : ''}${error?.message ?? error}`,
  );
  if (error?.detail) console.error(`  ${error.detail}`);
  process.exit(1);
});
