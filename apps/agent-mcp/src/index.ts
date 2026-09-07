#!/usr/bin/env node
/**
 * Waves agent MCP server.
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
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import { buildExpenseWriteBody, expenseParticipants, type AgentSplit } from './expense.js';
import { currentUserId, makeClient, readEnv } from './supabase.js';

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

async function main(): Promise<void> {
  const env = readEnv();
  const supabase = await makeClient(env);
  const meId = await currentUserId(supabase);

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
      return ok({ userId: meId, email: data.user?.email ?? null, readOnly: env.readOnly });
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
      const { data, error } = await supabase
        .from('group_members')
        .select(
          'id, group_id, profile_id, ghost_name, vpa, role, profile:profiles!profile_id ( display_name, default_vpa )',
        )
        .eq('group_id', groupId)
        .is('left_at', null)
        .order('created_at', { ascending: true });
      if (error) return fail(error.message);
      return ok(
        (data ?? []).map((m) => {
          const profile = m.profile as { display_name?: string; default_vpa?: string } | null;
          return {
            memberId: m.id,
            name: profile?.display_name ?? m.ghost_name ?? 'Unnamed',
            isYou: m.profile_id === meId,
            isGhost: !m.profile_id,
            role: m.role,
            vpa: m.vpa ?? profile?.default_vpa ?? null,
          };
        }),
      );
    },
  );

  server.registerTool(
    'get_balances',
    {
      description:
        'Who owes what in a group, per member and currency, in minor units. A positive balance is owed to that member; a negative balance is owed by them. Use this to know a settlement amount before recording one.',
      inputSchema: { groupId: GroupId },
    },
    async ({ groupId }): Promise<ToolResult> => {
      const { data, error } = await supabase
        .from('group_balances')
        .select('member_id, currency, balance')
        .eq('group_id', groupId);
      if (error) return fail(error.message);
      return ok(data ?? []);
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

  if (!env.readOnly) {
    registerWriteTools(server, supabase);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // A stdio server must not print to stdout (that is the protocol channel).
  process.stderr.write(`waves-agent MCP up as ${meId}${env.readOnly ? ' (read-only)' : ''}\n`);
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
 */
async function resolveMembers(
  supabase: SupabaseClient,
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
    };
  });

  const resolved: ResolvedMember[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const matches = known.filter((m) => m.name.toLowerCase() === name.toLowerCase());
    if (matches.length > 1) {
      return fail(
        `"${name}" matches ${matches.length} members of this group. Ask which one, and pass their memberId directly.`,
      );
    }
    if (matches.length === 1) {
      resolved.push({ name, memberId: matches[0]!.memberId, created: false });
      continue;
    }
    const { data: ghostId, error: ghostError } = await supabase.rpc('waves_add_ghost_member', {
      p_group_id: groupId,
      p_name: name,
    });
    if (ghostError) return fail(ghostError.message);
    known.push({ memberId: ghostId as string, name });
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
async function expenseParty(
  supabase: SupabaseClient,
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
    const { data, error } = await supabase.rpc('waves_my_member_id_for', { p_group_id: groupId });
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
    const resolved = await resolveMembers(supabase, groupId, input.people);
    if (!Array.isArray(resolved)) return { ...nothing, participants: resolved };
    for (const member of resolved) ids.push(member.memberId);
    added = resolved.filter((m) => m.created).map((m) => m.name);
  }

  return { participants: [...expenseParticipants(paidBy, ids)], paidBy, added };
}

function registerWriteTools(server: McpServer, supabase: SupabaseClient): void {
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

      const party = await expenseParty(supabase, input.groupId, input);
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
        'Record that one member paid another to settle up. This writes a settlement row only — it does NOT move any money. The signed-in user (isYou in list_members) must be one of the two parties. Use payment_link to get the handoff URL a human opens to actually pay.',
      inputSchema: {
        groupId: GroupId,
        fromMemberId: MemberId.describe('Who paid.'),
        toMemberId: MemberId.describe('Who received.'),
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
      fromMemberId,
      toMemberId,
      amount,
      rail,
      currency,
      note,
    }): Promise<ToolResult> => {
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
      return ok({
        settlementId: data,
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
      const resolved = await resolveMembers(supabase, groupId, names);
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

main().catch((error: unknown) => {
  process.stderr.write(
    `waves-agent MCP failed to start: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
