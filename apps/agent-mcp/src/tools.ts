/**
 * Waves agent MCP tools.
 *
 * Exposes the app's *operations* — not the database — as MCP tools, so an AI
 * agent can create a group, add an expense, and record a settlement on behalf
 * of a signed-in person. Every write goes through the same authorized path the
 * mobile app uses:
 *
 *   - create_group      → rpc('waves_create_group')          (user JWT)
 *   - add_expense        → functions.invoke('expense-write')  (user JWT; the
 *                          edge function recomputes the split and calls the
 *                          service-role-only waves_apply_expense for us — #274)
 *   - record_settlement  → rpc('waves_record_settlement')     (user JWT)
 *
 * Two things this server deliberately does NOT do:
 *   - It never runs raw SQL. There is no query tool. Every write is one named,
 *     validated operation, so business rules (split maths, ledger integrity,
 *     the RPC boundary) can never be bypassed.
 *   - It never moves money. `record_settlement` writes a settlement row saying
 *     "X paid Y"; the actual transfer is a UPI/PayPal handoff link a human
 *     opens and confirms in their own bank app. `payment_link` builds that
 *     link; nothing here debits an account.
 */

import { randomUUID } from 'node:crypto';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import { buildExpenseWriteBody, expenseParticipants, type AgentSplit } from './expense';
import { pairwiseTransfers, simplifyNet, type Transfer } from './settle';

type ToolResult = {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
};

const ok = (data: unknown): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
});
const fail = (message: string): ToolResult => ({
  content: [{ type: 'text', text: message }],
  isError: true,
});

/** Integer minor units (paise/cents) as a decimal string — money is never a float. */
const MinorUnits = z
  .string()
  .regex(/^\d+$/, 'Amount must be integer minor units (paise/cents) as a string, e.g. "12500".')
  .describe('Integer minor units as a string, e.g. "12500" for ₹125.00');

const MemberId = z.string().uuid().describe('A group_members.id from list_members');
const GroupId = z.string().uuid().describe('A group id from list_groups');
const Currency = z
  .string()
  .length(3)
  .transform((c) => c.toUpperCase())
  .describe('ISO-4217, e.g. INR, USD');

const todayIso = (): string => new Date().toISOString().slice(0, 10);

/** How a bill is divided. Shared by add_expense and edit_expense. */
const SplitSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('equal') }),
    z.object({
      kind: z.literal('exact'),
      amounts: z
        .record(z.string(), MinorUnits)
        .describe('memberId → minor units; must sum to the total.'),
    }),
    z.object({
      kind: z.literal('shares'),
      weights: z
        .record(z.string(), z.number().int().positive())
        .describe('memberId → weight, e.g. {"a":2,"b":1}.'),
    }),
  ])
  .describe('How to split. Defaults to an equal split across participants.');

/**
 * A group's own currency, so the caller does not have to state one.
 *
 * Returns the code, or the failure to hand straight back — an expense written
 * in the wrong currency is not a cosmetic mistake, so guessing is not an
 * option when the group cannot be read.
 */
async function groupCurrency(
  supabase: SupabaseClient,
  groupId: string,
): Promise<string | ToolResult> {
  const { data, error } = await supabase
    .from('groups')
    .select('default_currency')
    .eq('id', groupId)
    .is('deleted_at', null)
    .single();
  if (error) return fail(error.message);
  return String(data.default_currency);
}

/** Read the app-defined error code out of a wrapped edge-function failure. */
async function edgeError(error: unknown): Promise<string> {
  const context = (error as { context?: Response }).context;
  if (context && typeof context.json === 'function') {
    try {
      const body = (await context.json()) as { code?: string; message?: string };
      if (body?.message) return body.code ? `${body.code}: ${body.message}` : body.message;
      if (body?.code) return body.code;
    } catch {
      /* fall through */
    }
  }
  return error instanceof Error ? error.message : String(error);
}

/** A group member as every tool hands one back. */
interface Member {
  memberId: string;
  name: string;
  isYou: boolean;
  isGhost: boolean;
  role: unknown;
  rail: string | null;
  handle: string | null;
  /** @deprecated Superseded by `handle`; kept while callers move over. */
  vpa: string | null;
}

/** A group's current members, named, with "you" marked and how each is paid. */
async function loadMembers(
  supabase: SupabaseClient,
  meId: string,
  groupId: string,
): Promise<Member[] | ToolResult> {
  const { data, error } = await supabase
    .from('group_members')
    .select(
      'id, group_id, profile_id, ghost_name, vpa, payment_rail, payment_handle, role, profile:profiles!profile_id ( display_name, default_vpa, payment_rail, payment_handle )',
    )
    .eq('group_id', groupId)
    .is('left_at', null)
    .order('created_at', { ascending: true });
  if (error) return fail(error.message);
  return (data ?? []).map((m) => {
    const profile = m.profile as {
      display_name?: string;
      default_vpa?: string;
      payment_rail?: string;
      payment_handle?: string;
    } | null;
    // `payableFor` from `@waves/core`, inlined because this server
    // deliberately depends on nothing in the workspace. Reading
    // `vpa ?? default_vpa` alone told an agent that a payee on any rail
    // but UPI had given no details at all. The pairs are taken whole —
    // a rail from one source with a handle from another is how a UPI
    // intent gets built around an Australian phone number.
    const payable =
      (m.payment_rail && m.payment_handle
        ? { rail: m.payment_rail, handle: m.payment_handle }
        : null) ??
      (m.vpa ? { rail: 'upi', handle: m.vpa } : null) ??
      (profile?.payment_rail && profile.payment_handle
        ? { rail: profile.payment_rail, handle: profile.payment_handle }
        : null) ??
      (profile?.default_vpa ? { rail: 'upi', handle: profile.default_vpa } : null);
    return {
      memberId: m.id as string,
      name: profile?.display_name ?? (m.ghost_name as string | null) ?? 'Unnamed',
      isYou: m.profile_id === meId,
      isGhost: !m.profile_id,
      role: m.role,
      rail: (payable?.rail as string | undefined) ?? null,
      handle: (payable?.handle as string | undefined) ?? null,
      vpa: (payable?.handle as string | undefined) ?? null,
    };
  });
}

/**
 * A member id as a person reads it. Somebody who has since left the group
 * keeps their debts, so they are named as such rather than dropped.
 */
function partyOf(members: readonly Member[]) {
  const byId = new Map(members.map((m) => [m.memberId, m]));
  return (memberId: string) => {
    const m = byId.get(memberId);
    return { memberId, name: m?.name ?? 'Former member', isYou: m?.isYou ?? false };
  };
}

/** How to pay a member, for payment_link. */
function payee(members: readonly Member[], memberId: string) {
  const m = members.find((x) => x.memberId === memberId);
  return { rail: m?.rail ?? null, handle: m?.handle ?? null };
}

/** A group's settlements, newest first, with both sides named. */
async function loadSettlements(
  supabase: SupabaseClient,
  groupId: string,
  members: readonly Member[],
  options: { status?: string; limit: number },
): Promise<Record<string, unknown>[] | ToolResult> {
  let query = supabase
    .from('settlements')
    .select(
      'id, from_member_id, to_member_id, amount, currency, method, rail, status, note, initiated_at, confirmed_at',
    )
    .eq('group_id', groupId);
  if (options.status) query = query.eq('status', options.status);
  const { data, error } = await query
    .order('initiated_at', { ascending: false })
    .limit(options.limit);
  if (error) return fail(error.message);
  const who = partyOf(members);
  return (data ?? []).map((s) => ({
    settlementId: s.id,
    from: who(s.from_member_id as string),
    to: who(s.to_member_id as string),
    amount: String(s.amount),
    currency: s.currency,
    rail: s.rail ?? s.method,
    status: s.status,
    note: s.note ?? null,
    initiatedAt: s.initiated_at,
    confirmedAt: s.confirmed_at ?? null,
  }));
}

/**
 * Every tool this server offers, over whichever transport is carrying it.
 *
 * Transport-free on purpose. The same registrations serve the stdio entry
 * (`index.ts`, one machine, one signed-in person) and the HTTP one
 * (`apps/web/src/app/api/mcp`, where each request arrives carrying a different
 * person's OAuth token). A tool that behaved differently depending on how the
 * request arrived would be a tool nobody could reason about.
 *
 * @param supabase a client already acting as the person on whose behalf the
 *   agent is calling — never a service-role client.
 * @param meId that person's id, for marking "you" among a group's members.
 * @param readOnly when true the write tools are never registered at all, which
 *   is stronger than refusing them: they do not appear in `tools/list`, so a
 *   model is not tempted to try.
 */
export function buildWavesServer(
  supabase: SupabaseClient,
  meId: string,
  readOnly: boolean,
): McpServer {
  const server = new McpServer({ name: 'waves-agent', version: '0.1.0' });

  // ── reads ──────────────────────────────────────────────────────────────

  server.registerTool(
    'whoami',
    {
      description:
        'The identity this server is acting as. Every write is performed as this user, under the same permissions they have in the app.',
      inputSchema: {},
    },
    async (): Promise<ToolResult> => {
      const { data } = await supabase.auth.getUser();
      return ok({ userId: meId, email: data.user?.email ?? null, readOnly });
    },
  );

  server.registerTool(
    'list_groups',
    {
      description:
        'List the groups the signed-in user belongs to (RLS scopes this to them). Use it to find a group id before adding an expense or a settlement.',
      inputSchema: {
        includeArchived: z
          .boolean()
          .optional()
          .describe('Include archived groups (default false).'),
      },
    },
    async ({ includeArchived }): Promise<ToolResult> => {
      let query = supabase
        .from('groups')
        .select('id, name, type, default_currency, cover_emoji, archived_at, start_date, end_date')
        .is('deleted_at', null)
        .order('created_at', { ascending: false });
      if (!includeArchived) query = query.is('archived_at', null);
      const { data, error } = await query;
      if (error) return fail(error.message);
      return ok(
        (data ?? []).map((g) => ({
          id: g.id,
          name: g.name,
          type: g.type,
          currency: g.default_currency,
          emoji: g.cover_emoji,
          archived: Boolean(g.archived_at),
          startDate: g.start_date,
          endDate: g.end_date,
        })),
      );
    },
  );

  server.registerTool(
    'list_members',
    {
      description:
        'The members of a group, with their member ids. Expenses and settlements are addressed by member id, not by person, so resolve names here first. "isYou" marks the signed-in user, who must be a party to any settlement.',
      inputSchema: { groupId: GroupId },
    },
    async ({ groupId }): Promise<ToolResult> => {
      const members = await loadMembers(supabase, meId, groupId);
      return Array.isArray(members) ? ok(members) : members;
    },
  );

  server.registerTool(
    'get_balances',
    {
      description:
        'Who owes what in a group, per member and currency, in minor units. A positive balance is owed to that member; a negative balance is owed by them. Each row carries the member\'s name and "isYou". Settlements still waiting to be confirmed are not counted yet. For who should pay whom, use settlement_plan.',
      inputSchema: { groupId: GroupId },
    },
    async ({ groupId }): Promise<ToolResult> => {
      const { data, error } = await supabase
        .from('group_balances')
        .select('member_id, currency, balance')
        .eq('group_id', groupId);
      if (error) return fail(error.message);
      const members = await loadMembers(supabase, meId, groupId);
      if (!Array.isArray(members)) return members;
      const byId = new Map(members.map((m) => [m.memberId, m]));
      return ok(
        (data ?? []).map((row) => ({
          member_id: row.member_id,
          name: byId.get(row.member_id)?.name ?? 'Former member',
          isYou: byId.get(row.member_id)?.isYou ?? false,
          currency: row.currency,
          balance: row.balance,
        })),
      );
    },
  );

  server.registerTool(
    'settlement_plan',
    {
      description:
        'Who should pay whom, and how much, to settle a group — the same transfers the app suggests. With "simplify debts" on, the fewest payments that settle everyone; with it off, each real debt between two people. Each side carries a name, "isYou", and the payee\'s rail and handle for payment_link. "pending" lists settlements recorded but not yet confirmed: they are not counted in the plan yet, so check it before telling someone to pay again.',
      inputSchema: { groupId: GroupId },
    },
    async ({ groupId }): Promise<ToolResult> => {
      const { data: group, error: groupError } = await supabase
        .from('groups')
        .select('simplify_debts')
        .eq('id', groupId)
        .is('deleted_at', null)
        .single();
      if (groupError) return fail(groupError.message);

      const members = await loadMembers(supabase, meId, groupId);
      if (!Array.isArray(members)) return members;

      let transfers: Transfer[];
      if (group.simplify_debts) {
        const { data, error } = await supabase
          .from('group_balances')
          .select('member_id, currency, balance')
          .eq('group_id', groupId);
        if (error) return fail(error.message);
        transfers = simplifyNet(data ?? []);
      } else {
        const { data, error } = await supabase
          .from('pairwise_balances')
          .select('from_member_id, to_member_id, currency, amount')
          .eq('group_id', groupId);
        if (error) return fail(error.message);
        transfers = pairwiseTransfers(data ?? []);
      }

      const pending = await loadSettlements(supabase, groupId, members, {
        status: 'initiated',
        limit: 50,
      });
      if (!Array.isArray(pending)) return pending;

      const who = partyOf(members);
      return ok({
        simplified: Boolean(group.simplify_debts),
        settled: transfers.length === 0,
        transfers: transfers.map((t) => ({
          from: who(t.from),
          to: { ...who(t.to), ...payee(members, t.to) },
          amount: t.amount.toString(),
          currency: t.currency,
        })),
        pending,
      });
    },
  );

  server.registerTool(
    'list_settlements',
    {
      description:
        'Settlements recorded in a group, newest first: who paid whom, how much, by what rail, and whether it has been confirmed. Use it to answer "did I already record paying Matt?" before recording it again. Only confirmed settlements count towards balances.',
      inputSchema: {
        groupId: GroupId,
        status: z
          .enum(['initiated', 'confirmed', 'auto_confirmed', 'disputed', 'cancelled'])
          .optional()
          .describe(
            'Only settlements in this state. "initiated" means recorded, not yet confirmed.',
          ),
        limit: z.number().int().min(1).max(100).default(20),
      },
    },
    async ({ groupId, status, limit }): Promise<ToolResult> => {
      const members = await loadMembers(supabase, meId, groupId);
      if (!Array.isArray(members)) return members;
      const rows = await loadSettlements(supabase, groupId, members, { status, limit });
      return Array.isArray(rows) ? ok(rows) : rows;
    },
  );

  server.registerTool(
    'list_agent_writes',
    {
      description:
        'Everything an AI assistant has changed in Waves on this person\'s behalf, newest first: expenses added, edited or deleted, settlements recorded, groups created, people added, join links minted. Each row names the assistant (clientId) and the group. Writes the person made in the app themselves are not here. Use it to answer "what did you change today?".',
      inputSchema: {
        limit: z.number().int().min(1).max(200).default(50),
      },
    },
    async ({ limit }): Promise<ToolResult> => {
      const { data, error } = await supabase.rpc('waves_my_agent_writes', { p_limit: limit });
      if (error) return fail(error.message);
      const rows = (data ?? []) as {
        id: string;
        client_id: string;
        action: string;
        group_id: string | null;
        object_id: string | null;
        amount_minor: string | number | null;
        currency: string | null;
        created_at: string;
      }[];

      // Names for the groups, read as the person: a group they have since left
      // stays unnamed rather than being looked up with more than they can see.
      const groupIds = [...new Set(rows.map((r) => r.group_id).filter((id): id is string => !!id))];
      const names = new Map<string, string>();
      if (groupIds.length) {
        const { data: groups, error: groupsError } = await supabase
          .from('groups')
          .select('id, name')
          .in('id', groupIds);
        if (groupsError) return fail(groupsError.message);
        for (const g of groups ?? []) names.set(g.id as string, (g.name as string | null) ?? '');
      }

      return ok(
        rows.map((r) => ({
          at: r.created_at,
          clientId: r.client_id,
          action: r.action,
          groupId: r.group_id,
          groupName: r.group_id ? (names.get(r.group_id) ?? null) : null,
          objectId: r.object_id,
          amount: r.amount_minor === null ? null : String(r.amount_minor),
          currency: r.currency,
        })),
      );
    },
  );

  server.registerTool(
    'list_expenses',
    {
      description:
        "What is actually in a group's ledger, newest first — each expense with its current description, amount, who paid and how it was split. Use it to show somebody what was recorded, to find the expenseId for edit_expense or delete_expense, and to check what you just wrote.",
      inputSchema: {
        groupId: GroupId,
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(20)
          .describe('How many to return, newest first.'),
        includeDeleted: z
          .boolean()
          .default(false)
          .describe('Include deleted expenses, which keep their place in the history.'),
      },
    },
    async ({ groupId, limit, includeDeleted }): Promise<ToolResult> => {
      // An expense is a chain of versions (ADR-004); `current_version_id` is
      // the one in force. Reading the chain instead would show an edited
      // expense at its original amount, which is worse than showing nothing.
      let query = supabase
        .from('expenses')
        .select(
          `id, deleted_at, created_at,
           current:expense_versions!expenses_current_version_id_fkey (
             version_no, description, category, expense_date, currency, amount,
             split_type, author_member_id, notes,
             payers:expense_payers ( member_id, amount ),
             shares:expense_shares ( member_id, amount )
           )`,
        )
        .eq('group_id', groupId)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (!includeDeleted) query = query.is('deleted_at', null);

      const { data, error } = await query;
      if (error) return fail(error.message);
      return ok(
        (data ?? []).map((row) => {
          // PostgREST types an embedded relation as an array even when the
          // foreign key makes it to-one, and returns an object at runtime.
          // Accept either rather than trusting one of them.
          const embedded = row.current as unknown;
          const current = (Array.isArray(embedded) ? embedded[0] : embedded) as
            Record<string, unknown> | null | undefined;
          return {
            expenseId: row.id,
            deleted: Boolean(row.deleted_at),
            // The version number is what edit_expense has to send back as
            // baseVersionNo, so it is not an internal detail here.
            versionNo: current?.version_no ?? null,
            description: current?.description ?? null,
            amount: current?.amount ?? null,
            currency: current?.currency ?? null,
            date: current?.expense_date ?? null,
            splitType: current?.split_type ?? null,
            category: current?.category ?? null,
            notes: current?.notes ?? null,
            payers: current?.payers ?? [],
            shares: current?.shares ?? [],
          };
        }),
      );
    },
  );

  // Pure: it builds a string and touches nothing. It sits with the reads
  // deliberately — `WAVES_MCP_READONLY` is for "look but do not change the
  // ledger", and a person on a read-only server still needs the link that lets
  // them go and pay somebody.
  server.registerTool(
    'payment_link',
    {
      description:
        'Build a payment handoff link (UPI or PayPal) for a payer to open in their own app and complete a transfer. This does not move money; it is a deep link a human taps and confirms.',
      inputSchema: {
        rail: z.enum(['upi', 'paypal']).default('upi'),
        payeeVpa: z
          .string()
          .optional()
          .describe(
            'The payee UPI id (vpa), e.g. name@bank — from list_members. Required for upi.',
          ),
        payeeHandle: z
          .string()
          .optional()
          .describe('The payee PayPal.me handle. Required for paypal.'),
        payeeName: z.string().optional(),
        amount: MinorUnits,
        currency: Currency.default('INR'),
      },
    },
    async ({ rail, payeeVpa, payeeHandle, payeeName, amount, currency }): Promise<ToolResult> => {
      // Minor → major with two decimals. Every currency this app settles in is
      // two-decimal; a decimal string keeps the exact value without a float.
      const major = `${(BigInt(amount) / 100n).toString()}.${(BigInt(amount) % 100n)
        .toString()
        .padStart(2, '0')}`;

      if (rail === 'upi') {
        if (!payeeVpa) return fail("A UPI link needs payeeVpa (the payee's UPI id).");
        const params = new URLSearchParams({
          pa: payeeVpa,
          ...(payeeName ? { pn: payeeName } : {}),
          am: major,
          cu: currency,
        });
        return ok({ rail, uri: `upi://pay?${params.toString()}`, amountMajor: major, currency });
      }

      if (!payeeHandle) return fail('A PayPal link needs payeeHandle (the PayPal.me handle).');
      return ok({
        rail,
        uri: `https://paypal.me/${encodeURIComponent(payeeHandle)}/${major}${currency}`,
        amountMajor: major,
        currency,
      });
    },
  );

  // ── writes ─────────────────────────────────────────────────────────────
  // Registered only when the server is not in read-only mode.

  if (!readOnly) {
    registerWriteTools(server, supabase, meId);
  }

  return server;
}

/** What people call themselves when they mean the signed-in person. */
const SELF = new Set(['me', 'i', 'myself']);

type NameMatch =
  | { kind: 'one'; memberId: string }
  | { kind: 'none' }
  | { kind: 'many'; names: string[] }
  | { kind: 'not-in-group' };

/**
 * Which member somebody means by a name, the way people say it: "me" is the
 * signed-in person, the whole name wins, and otherwise a unique first name —
 * "Renny" for Renny Benita. Two matches is an answer too: it means ask.
 */
function matchMember(
  known: readonly { memberId: string; name: string; isMe: boolean }[],
  name: string,
): NameMatch {
  const said = name.trim().toLowerCase();
  if (SELF.has(said)) {
    const me = known.find((m) => m.isMe);
    return me ? { kind: 'one', memberId: me.memberId } : { kind: 'not-in-group' };
  }
  // The whole name first, so "Raj" is the member called Raj even when a
  // "Raj Kumar" is in the group too; then the first name, for "Renny".
  let matches = known.filter((m) => m.name.trim().toLowerCase() === said);
  if (matches.length === 0 && !/\s/.test(said)) {
    matches = known.filter((m) => m.name.trim().toLowerCase().split(/\s+/)[0] === said);
  }
  if (matches.length > 1) return { kind: 'many', names: matches.map((m) => m.name) };
  const [only] = matches;
  return only ? { kind: 'one', memberId: only.memberId } : { kind: 'none' };
}

interface ResolvedMember {
  readonly name: string;
  readonly memberId: string;
  readonly created: boolean;
}

/**
 * Turn the names somebody actually said into member ids, adding as ghosts the
 * people who are not in the group yet.
 *
 * A ghost is a member with a real balance and no account, and it is the normal
 * case here rather than an edge one: "split it with Raj and Priya" is the whole
 * request this product exists to serve, and Raj usually has not heard of it.
 *
 * Returns the failure to hand back when a name is ambiguous. Two members called
 * Raj is a fork in the road, not a detail to guess at — choosing one of them
 * silently puts a real debt on the wrong person, and nothing downstream would
 * ever catch it.
 *
 * A name is matched the way people say it, not the way the app stores it:
 * "me" is the signed-in person, and "Renny" is the one member whose name
 * starts with Renny. Matching the stored name exactly turned both into new
 * ghosts — a person called "me", sharing a bill with the person who said it.
 *
 * Every name is resolved before any ghost is added, so a request that stops
 * on its third name has not already added people for its first two.
 */
async function resolveMembers(
  supabase: SupabaseClient,
  meId: string,
  groupId: string,
  names: readonly string[],
): Promise<ResolvedMember[] | ToolResult> {
  const { data: rows, error } = await supabase
    .from('group_members')
    .select('id, ghost_name, profile_id, profile:profiles!profile_id ( display_name )')
    .eq('group_id', groupId)
    .is('left_at', null);
  if (error) return fail(error.message);

  const known = (rows ?? []).map((m) => {
    const profile = m.profile as { display_name?: string } | null;
    return {
      memberId: m.id as string,
      name: (profile?.display_name ?? (m.ghost_name as string | null) ?? 'Unnamed').trim(),
      isMe: m.profile_id === meId,
    };
  });

  const plan: { name: string; memberId: string | null }[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const match = matchMember(known, name);
    if (match.kind === 'not-in-group') {
      return fail(
        `"${name}" means you, and you are not a member of this group. Pass paidBy and participants as member ids instead.`,
      );
    }
    if (match.kind === 'many') {
      return fail(
        `"${name}" matches ${match.names.length} members of this group (${match.names.join(
          ', ',
        )}). Ask which one, and pass their memberId directly.`,
      );
    }
    plan.push({ name, memberId: match.kind === 'one' ? match.memberId : null });
  }

  const resolved: ResolvedMember[] = [];
  const added = new Map<string, string>();
  for (const { name, memberId } of plan) {
    if (memberId) {
      resolved.push({ name, memberId, created: false });
      continue;
    }
    const again = added.get(name.toLowerCase());
    if (again) {
      resolved.push({ name, memberId: again, created: false });
      continue;
    }
    const { data: ghostId, error: ghostError } = await supabase.rpc('waves_add_ghost_member', {
      p_group_id: groupId,
      p_name: name,
    });
    if (ghostError) return fail(ghostError.message);
    added.set(name.toLowerCase(), ghostId as string);
    resolved.push({ name, memberId: ghostId as string, created: true });
  }
  return resolved;
}

/**
 * Who the expense is split between, and who paid.
 *
 * Names go through `resolveMembers`; member ids are taken as given. The payer
 * defaults to the signed-in user and is always party to their own expense —
 * told "split it with Raj and Priya", a request names two people and means
 * three, and leaving the payer out would have them lending the whole bill.
 */
export async function expenseParty(
  supabase: SupabaseClient,
  meId: string,
  groupId: string,
  input: { people?: string[]; participants?: string[]; paidBy?: string },
): Promise<{ participants: string[] | ToolResult; paidBy: string; added: string[] }> {
  const nothing = { paidBy: '', added: [] };
  if (!input.people?.length && !input.participants?.length) {
    return {
      ...nothing,
      participants: fail(
        'Say who the expense is split between: `people` (names) or `participants` (member ids).',
      ),
    };
  }

  let paidBy = input.paidBy;
  if (!paidBy) {
    const { data, error } = await supabase.rpc('waves_my_member_id_for', {
      p_group_id: groupId,
      p_profile_id: meId,
    });
    if (error) return { ...nothing, participants: fail(error.message) };
    if (!data) {
      return {
        ...nothing,
        participants: fail('You are not a member of that group, so say who paid with paidBy.'),
      };
    }
    paidBy = data as string;
  }

  const ids = [...(input.participants ?? [])];
  let added: string[] = [];
  if (input.people?.length) {
    const resolved = await resolveMembers(supabase, meId, groupId, input.people);
    if (!Array.isArray(resolved)) return { ...nothing, participants: resolved };
    for (const member of resolved) ids.push(member.memberId);
    added = resolved.filter((m) => m.created).map((m) => m.name);
  }

  return { participants: [...expenseParticipants(paidBy, ids)], paidBy, added };
}

function registerWriteTools(server: McpServer, supabase: SupabaseClient, meId: string): void {
  server.registerTool(
    'create_group',
    {
      description:
        'Create a new group. The signed-in user is added as its first (admin) member automatically. Returns the new group id.',
      inputSchema: {
        name: z
          .string()
          .min(1)
          .optional()
          .describe('Optional; an unnamed group is labelled by its members.'),
        type: z
          .enum(['trip', 'home', 'couple', 'event', 'other'])
          .default('other')
          .describe('What kind of group this is.'),
        currency: Currency.default('INR'),
        country: z
          .string()
          .length(2)
          .optional()
          .describe('ISO-3166 alpha-2, e.g. IN. Decides which payment rails the group offers.'),
        emoji: z.string().optional().describe('A cover emoji.'),
        simplify: z
          .boolean()
          .default(true)
          .describe('Simplify debts in the presentation (ledger is untouched).'),
      },
    },
    async ({ name, type, currency, country, emoji, simplify }): Promise<ToolResult> => {
      const { data, error } = await supabase.rpc('waves_create_group', {
        p_name: name?.trim() || null,
        p_type: type,
        p_currency: currency,
        p_emoji: emoji ?? null,
        p_simplify: simplify,
        p_group_id: null,
        p_photo_path: null,
        p_country: country ? country.toUpperCase() : null,
        p_creator_member_id: null,
      });
      if (error) return fail(error.message);
      return ok({ groupId: data });
    },
  );

  server.registerTool(
    'add_expense',
    {
      description:
        "Add an expense to a group. The server does NOT trust a client-computed split — it sends the split intent to the app's expense-write edge function, which recomputes every share and writes the ledger. Amounts are integer minor units as strings. Name the people in `people` and anyone new is added as a ghost; use `participants` with member ids from list_members when you already have them, or when two members share a name. The payer defaults to the signed-in user. This puts a real debt on real people — confirm the amount and who is on it before calling.",
      inputSchema: {
        groupId: GroupId,
        description: z.string().min(1).describe('What the expense was for.'),
        amount: MinorUnits.describe('Total of the expense, in minor units.'),
        currency: Currency.optional().describe("Defaults to the group's currency if omitted."),
        paidBy: MemberId.optional().describe(
          'The member who paid. Defaults to the signed-in user.',
        ),
        people: z
          .array(z.string().min(1))
          .min(1)
          .optional()
          .describe(
            'The people it is split between, named the way the user named them. Anyone not in the group yet is added as a ghost. The payer is included automatically.',
          ),
        participants: z
          .array(MemberId)
          .min(1)
          .optional()
          .describe('Member ids, when you have them. Use instead of `people`, not as well.'),
        split: SplitSchema.optional(),
        expenseDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe('YYYY-MM-DD; defaults to today.'),
        category: z.string().optional(),
        notes: z.string().optional(),
      },
    },
    async (input): Promise<ToolResult> => {
      const currency = await groupCurrency(supabase, input.groupId);
      if (typeof currency !== 'string') return currency;

      const party = await expenseParty(supabase, meId, input.groupId, input);
      if (!Array.isArray(party.participants)) return party.participants;
      const { participants, paidBy, added } = party;

      const expenseId = randomUUID();
      const { data, error } = await supabase.functions.invoke('expense-write', {
        body: buildExpenseWriteBody(
          {
            groupId: input.groupId,
            description: input.description,
            amount: input.amount,
            currency: input.currency,
            paidBy,
            participants,
            split: input.split as AgentSplit | undefined,
            expenseDate: input.expenseDate,
            category: input.category,
            notes: input.notes,
          },
          {
            expenseId,
            clientMutationId: randomUUID(),
            today: todayIso(),
            groupCurrency: currency,
          },
        ),
      });
      if (error) return fail(await edgeError(error));
      return ok({ ...(data as object), expenseId, addedToGroup: added });
    },
  );

  server.registerTool(
    'edit_expense',
    {
      description:
        'Correct an expense that is already in the ledger. Nothing is overwritten — this appends a new version (ADR-004), so the history of what was recorded and when stays intact. Send the expense as it should now read, in full: fields are not merged into the old version. Get expenseId and versionNo from list_expenses.',
      inputSchema: {
        groupId: GroupId,
        expenseId: z.string().uuid().describe('The expense to correct, from list_expenses.'),
        baseVersionNo: z
          .number()
          .int()
          .min(1)
          .describe(
            'The versionNo you are correcting, from list_expenses. If somebody else edited it in the meantime the write is refused rather than silently overwriting them.',
          ),
        description: z.string().min(1),
        amount: MinorUnits,
        currency: Currency.optional(),
        paidBy: MemberId,
        participants: z.array(MemberId).min(1),
        split: SplitSchema.optional(),
        expenseDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        category: z.string().optional(),
        notes: z.string().optional(),
      },
    },
    async (input): Promise<ToolResult> => {
      const currency = await groupCurrency(supabase, input.groupId);
      if (typeof currency !== 'string') return currency;

      const { data, error } = await supabase.functions.invoke('expense-write', {
        body: {
          ...buildExpenseWriteBody(
            {
              groupId: input.groupId,
              description: input.description,
              amount: input.amount,
              currency: input.currency,
              paidBy: input.paidBy,
              participants: input.participants,
              split: input.split as AgentSplit | undefined,
              expenseDate: input.expenseDate,
              category: input.category,
              notes: input.notes,
            },
            {
              expenseId: input.expenseId,
              clientMutationId: randomUUID(),
              today: todayIso(),
              groupCurrency: currency,
            },
          ),
          // What makes this an edit rather than a create: the server checks it
          // against the version in force and turns a concurrent edit into a
          // logged conflict instead of a silent overwrite (TDR §4.4).
          baseVersionNo: input.baseVersionNo,
        },
      });
      if (error) return fail(await edgeError(error));
      return ok({ ...(data as object), expenseId: input.expenseId });
    },
  );

  server.registerTool(
    'delete_expense',
    {
      description:
        'Remove an expense from the ledger. It is a soft delete — the expense keeps its place in the history and everyone in the group sees that it was removed — and it changes what people owe each other, so confirm with the user before calling it.',
      inputSchema: {
        expenseId: z.string().uuid().describe('The expense to remove, from list_expenses.'),
      },
    },
    async ({ expenseId }): Promise<ToolResult> => {
      const { error } = await supabase.rpc('waves_delete_expense', { p_expense_id: expenseId });
      if (error) return fail(error.message);
      return ok({ expenseId, deleted: true });
    },
  );

  server.registerTool(
    'record_settlement',
    {
      description:
        'Record that one member paid another to settle up. This writes a settlement row only — it does NOT move any money. The signed-in user must be one of the two parties. Name the two sides the way the user did — `from: "Matt", to: "me"` for "Matt paid me back" — or pass member ids. A name must already be in the group; nobody is added, and a name that fits two members is refused so you can ask which. Use payment_link to get the handoff URL a human opens to actually pay.',
      inputSchema: {
        groupId: GroupId,
        from: z
          .string()
          .min(1)
          .optional()
          .describe('Who paid, by name — "me" for the signed-in user. Or use fromMemberId.'),
        to: z
          .string()
          .min(1)
          .optional()
          .describe('Who received, by name — "me" for the signed-in user. Or use toMemberId.'),
        fromMemberId: MemberId.optional().describe('Who paid, by member id.'),
        toMemberId: MemberId.optional().describe('Who received, by member id.'),
        amount: MinorUnits,
        rail: z
          .string()
          .default('upi')
          .describe('The payment rail id, e.g. upi, cash, bank, paypal.'),
        currency: Currency.optional(),
        note: z.string().optional(),
      },
    },
    async ({
      groupId,
      from,
      to,
      fromMemberId: fromId,
      toMemberId: toId,
      amount,
      rail,
      currency,
      note,
    }): Promise<ToolResult> => {
      if (!fromId && !from)
        return fail('Say who paid: `from` (a name, or "me") or `fromMemberId`.');
      if (!toId && !to) return fail('Say who received: `to` (a name, or "me") or `toMemberId`.');

      // A settlement is between people already in the ledger, so a name that
      // matches nobody is a mistake to report, never a ghost to invent.
      let fromMemberId = fromId;
      let toMemberId = toId;
      let members: Member[] = [];
      if (!fromMemberId || !toMemberId) {
        const loaded = await loadMembers(supabase, meId, groupId);
        if (!Array.isArray(loaded)) return loaded;
        members = loaded;
        const known = members.map((m) => ({ memberId: m.memberId, name: m.name, isMe: m.isYou }));
        const pick = (name: string): string | ToolResult => {
          const match = matchMember(known, name);
          if (match.kind === 'one') return match.memberId;
          if (match.kind === 'many') {
            return fail(
              `"${name}" matches ${match.names.length} members of this group (${match.names.join(
                ', ',
              )}). Ask which one, and pass their memberId.`,
            );
          }
          if (match.kind === 'not-in-group') return fail('You are not a member of this group.');
          return fail(
            `Nobody called "${name}" is in this group (${members
              .map((m) => m.name)
              .join(', ')}). Check the name with the user.`,
          );
        };
        if (!fromMemberId) {
          const picked = pick(from as string);
          if (typeof picked !== 'string') return picked;
          fromMemberId = picked;
        }
        if (!toMemberId) {
          const picked = pick(to as string);
          if (typeof picked !== 'string') return picked;
          toMemberId = picked;
        }
      }
      if (fromMemberId === toMemberId) {
        return fail('Both sides of that settlement are the same member.');
      }

      const method = (['upi', 'cash', 'bank', 'other'] as const).includes(
        rail as 'upi' | 'cash' | 'bank' | 'other',
      )
        ? rail
        : 'other';
      const { data, error } = await supabase.rpc('waves_record_settlement', {
        p_group_id: groupId,
        p_from_member_id: fromMemberId,
        p_to_member_id: toMemberId,
        p_amount: amount,
        p_method: method,
        p_rail: rail,
        p_currency: currency ?? null,
        p_note: note ?? null,
        p_allocations: [],
        p_client_mutation_id: randomUUID(),
      });
      if (error) return fail(error.message);
      const who = partyOf(members);
      return ok({
        settlementId: data,
        ...(members.length ? { from: who(fromMemberId), to: who(toMemberId) } : {}),
        status: 'initiated',
        note: 'Recorded only — no money moved. Use payment_link for the payer to complete the transfer.',
      });
    },
  );

  server.registerTool(
    'add_people',
    {
      description:
        'Make sure these people are in the group, and return their member ids. Anyone not already there is added as a ghost — a member with a real balance and no account — which is what "split it with Raj and Priya" almost always means. Call this before add_expense when the request names people rather than member ids.',
      inputSchema: {
        groupId: GroupId,
        names: z
          .array(z.string().min(1))
          .min(1)
          .describe('The people, named the way the user named them.'),
      },
    },
    async ({ groupId, names }): Promise<ToolResult> => {
      const resolved = await resolveMembers(supabase, meId, groupId, names);
      if (!Array.isArray(resolved)) return resolved;

      return ok({
        members: resolved,
        added: resolved.filter((r) => r.created).map((r) => r.name),
      });
    },
  );

  server.registerTool(
    'invite_link',
    {
      description:
        "The group's reusable join link, to send to someone so they can see the ledger themselves and claim what they are owed. Anyone holding the link can join the group, so send it to people, not to channels.",
      inputSchema: { groupId: GroupId },
    },
    async ({ groupId }): Promise<ToolResult> => {
      const { data, error } = await supabase.rpc('waves_ensure_group_join_token', {
        p_group_id: groupId,
      });
      if (error) return fail(error.message);
      // The shape has to match `groupJoinLink` in the app exactly — the token
      // in the fragment, so it never reaches a server log or a referrer header,
      // and the path a literal `/join`, which the QR scanner checks.
      const base = process.env.WAVES_WEB_URL ?? 'https://app.wavs.co.in';
      return ok({ url: `${base}/join#${data as string}` });
    },
  );
}
