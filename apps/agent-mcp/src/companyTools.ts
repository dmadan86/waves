/**
 * Waves company tools for an AI agent (phase 1 of "agents for companies").
 *
 * A connection is bound to exactly one company, by the person, at consent time, and only while the owner allows
 * agents there. Supabase's OAuth tokens cannot carry a company, so the binding is a database row and EVERY tool here
 * opens with `waves_company_agent_gate(company_id)`: it checks the binding, the owner's switch, suspension and
 * membership on every call, so switching agents off or revoking a connection bites on the very next request. The
 * gate also returns the caller's current role, which the tools use to give a clear answer early; the company RPCs and
 * RLS still decide what is actually allowed, exactly as they do for the person in the app.
 *
 * What this deliberately does not offer: deletes, approving or rejecting claims, settings, payouts, wages.
 * Entries an agent writes may be held for the owner's approval (the company's "agent changes need approval" switch).
 */

import { randomUUID } from 'node:crypto';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };
const ok = (data: unknown): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
});
const fail = (message: string): ToolResult => ({
  content: [{ type: 'text', text: message }],
  isError: true,
});

const Company = z.string().uuid().describe('The company id (the one this connection is bound to)');
const Member = z.string().uuid().describe('A member id from list_company_people');
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const Minor = z
  .string()
  .regex(/^\d{1,16}$/, 'Integer minor units (paise/cents) as a string, e.g. "12500".')
  .describe('Integer minor units (paise/cents) as a string, e.g. "12500" for 125.00');
const Limit = z.number().int().min(1).max(200).default(50);

type Gated = { role: string } | ToolResult;
const refused = (g: Gated): g is ToolResult => 'content' in g;

export function registerCompanyTools(
  server: McpServer,
  supabase: SupabaseClient,
  readOnly: boolean,
): void {
  /** First call of every tool: binding, owner switch, suspension, membership, rate limit. */
  async function gate(companyId: string): Promise<Gated> {
    const { data, error } = await supabase.rpc('waves_company_agent_gate', {
      p_group_id: companyId,
    });
    if (error) return fail(error.message);
    return { role: String(data) };
  }

  /** The write's audit row (and what the daily cap counts). */
  async function record(
    action: string,
    companyId: string,
    objectId: string,
    amount: string | null,
    currency: string | null,
  ): Promise<ToolResult | null> {
    const { error } = await supabase.rpc('waves_record_agent_write', {
      p_action: action,
      p_group_id: companyId,
      p_object_id: objectId,
      p_amount_minor: amount,
      p_currency: currency,
    });
    return error ? fail(error.message) : null;
  }

  // ── reads ──────────────────────────────────────────────────────────────

  server.registerTool(
    'company_overview',
    {
      description:
        'The company this connection is bound to: name, currency, YOUR role in it (admin = owner, manager, member = employee), and whether entries need approval. Call this first.',
      inputSchema: { companyId: Company },
    },
    async ({ companyId }): Promise<ToolResult> => {
      const g = await gate(companyId);
      if (refused(g)) return g;
      const { data, error } = await supabase
        .from('groups')
        .select('id, name, default_currency, company_approvals_enabled, company_agent_approval')
        .eq('id', companyId)
        .is('deleted_at', null);
      if (error) return fail(error.message);
      const row = (data ?? [])[0] as Record<string, unknown> | undefined;
      if (!row) return fail('Company not found.');
      return ok({
        id: row.id,
        name: row.name,
        currency: row.default_currency,
        yourRole: g.role,
        entriesNeedApproval: Boolean(row.company_approvals_enabled),
        agentChangesNeedApproval: Boolean(row.company_agent_approval),
      });
    },
  );

  server.registerTool(
    'list_company_people',
    {
      description:
        'The people you can see in the company, with member ids (needed by every other tool). An owner sees everyone; a manager their team; an employee themselves, their manager and the owner.',
      inputSchema: { companyId: Company },
    },
    async ({ companyId }): Promise<ToolResult> => {
      const g = await gate(companyId);
      if (refused(g)) return g;
      const { data, error } = await supabase.rpc('waves_company_people', { p_group_id: companyId });
      if (error) return fail(error.message);
      return ok(data ?? []);
    },
  );

  server.registerTool(
    'list_company_entries',
    {
      description:
        'Expense claims and other money entries, newest first. Amounts are minor units. status: submitted = waiting for approval, approved, rejected, reimbursed. You only see entries the signed-in person may see.',
      inputSchema: {
        companyId: Company,
        status: z.enum(['submitted', 'approved', 'rejected', 'reimbursed']).optional(),
        member: Member.optional(),
        from: Day.optional().describe('Entries on or after this day'),
        to: Day.optional().describe('Entries on or before this day'),
        limit: Limit,
      },
    },
    async ({ companyId, status, member, from, to, limit }): Promise<ToolResult> => {
      const g = await gate(companyId);
      if (refused(g)) return g;
      let q = supabase
        .from('company_entries')
        .select('id, member_id, entry_kind, category, amount, currency, occurred_on, status, note')
        .eq('group_id', companyId)
        .is('deleted_at', null)
        .order('occurred_on', { ascending: false })
        .limit(limit);
      if (status) q = q.eq('status', status);
      if (member) q = q.eq('member_id', member);
      if (from) q = q.gte('occurred_on', from);
      if (to) q = q.lte('occurred_on', to);
      const { data, error } = await q;
      if (error) return fail(error.message);
      return ok(data ?? []);
    },
  );

  server.registerTool(
    'list_attendance',
    {
      description: 'Attendance marks (present, half, absent) between two days.',
      inputSchema: { companyId: Company, from: Day, to: Day, member: Member.optional() },
    },
    async ({ companyId, from, to, member }): Promise<ToolResult> => {
      const g = await gate(companyId);
      if (refused(g)) return g;
      let q = supabase
        .from('company_attendance')
        .select('member_id, day, status, note')
        .eq('group_id', companyId)
        .is('deleted_at', null)
        .gte('day', from)
        .lte('day', to)
        .order('day', { ascending: false })
        .limit(500);
      if (member) q = q.eq('member_id', member);
      const { data, error } = await q;
      if (error) return fail(error.message);
      return ok(data ?? []);
    },
  );

  server.registerTool(
    'list_work_tasks',
    {
      description: "Work tasks (a person's to-dos for a day), newest day first.",
      inputSchema: {
        companyId: Company,
        day: Day.optional(),
        member: Member.optional(),
        status: z.enum(['todo', 'doing', 'done', 'blocked']).optional(),
        limit: Limit,
      },
    },
    async ({ companyId, day, member, status, limit }): Promise<ToolResult> => {
      const g = await gate(companyId);
      if (refused(g)) return g;
      let q = supabase
        .from('company_work_tasks')
        .select('id, member_id, day, title, status, blocked_reason, note, due_time, client_id')
        .eq('group_id', companyId)
        .is('deleted_at', null)
        .order('day', { ascending: false })
        .limit(limit);
      if (day) q = q.eq('day', day);
      if (member) q = q.eq('member_id', member);
      if (status) q = q.eq('status', status);
      const { data, error } = await q;
      if (error) return fail(error.message);
      return ok(data ?? []);
    },
  );

  server.registerTool(
    'list_clients',
    {
      description:
        "The company's clients and leads (owner and managers only). expected_value is in minor units.",
      inputSchema: {
        companyId: Company,
        query: z.string().max(80).optional().describe('Part of the name'),
        limit: Limit,
      },
    },
    async ({ companyId, query, limit }): Promise<ToolResult> => {
      const g = await gate(companyId);
      if (refused(g)) return g;
      if (g.role === 'member') return fail('Only the owner and managers can list clients.');
      let q = supabase
        .from('company_clients')
        .select('id, name, phone, need, source, expected_value, address, stage, owner_member_id')
        .eq('group_id', companyId)
        .is('deleted_at', null)
        .order('name', { ascending: true })
        .limit(limit);
      // Strip the characters that mean something in a PostgREST filter.
      const term = query?.replace(/[%,()*\\]/g, ' ').trim();
      if (term) q = q.ilike('name', `%${term}%`);
      const { data, error } = await q;
      if (error) return fail(error.message);
      return ok(data ?? []);
    },
  );

  server.registerTool(
    'list_company_agent_writes',
    {
      description:
        'Everything AI assistants changed in this company, newest first, with who connected them (owner and managers only).',
      inputSchema: { companyId: Company, limit: Limit },
    },
    async ({ companyId, limit }): Promise<ToolResult> => {
      const g = await gate(companyId);
      if (refused(g)) return g;
      if (g.role === 'member') return fail('Only the owner and managers can see this.');
      const { data, error } = await supabase.rpc('waves_company_agent_writes', {
        p_group_id: companyId,
        p_limit: limit,
      });
      if (error) return fail(error.message);
      return ok(data ?? []);
    },
  );

  // ── writes ─────────────────────────────────────────────────────────────
  // Not registered at all on a read-only connection.
  if (readOnly) return;

  server.registerTool(
    'add_company_entry',
    {
      description:
        'Record an expense claim for a person. An employee can add one for themselves, a manager for their team, the owner for anyone. Amount is minor units (paise/cents). While the company\'s "agent changes need approval" switch is on, the entry is saved as "submitted" and waits for the owner or manager to approve it - tell the user that. entryId makes a retry safe: reuse it and nothing is added twice.',
      inputSchema: {
        companyId: Company,
        entryId: z.string().uuid().optional().describe('Your own uuid; reuse it when retrying'),
        member: Member.describe('Whose expense it is'),
        amount: Minor,
        category: z.enum(['fuel', 'transport', 'travel', 'food', 'office', 'other']),
        occurredOn: Day,
        note: z.string().max(500).optional(),
      },
    },
    async ({
      companyId,
      entryId,
      member,
      amount,
      category,
      occurredOn,
      note,
    }): Promise<ToolResult> => {
      const g = await gate(companyId);
      if (refused(g)) return g;
      const id = entryId ?? randomUUID();
      // Cap, write and audit happen in one database transaction (see the RPC), so concurrent calls cannot overspend.
      const { data, error } = await supabase.rpc('waves_company_agent_entry_add', {
        p_group_id: companyId,
        p_entry_id: id,
        p_member_id: member,
        p_data: { amount, category, occurredOn, ...(note ? { note } : {}) },
      });
      if (error) return fail(error.message);
      const status = data ? String(data) : null;
      return ok({ entryId: id, status, waitingForApproval: status === 'submitted' });
    },
  );

  server.registerTool(
    'set_attendance',
    {
      description:
        "Mark one person present, half-day or absent for a day (today or earlier, up to a year back). Owner, or the person's manager. Replaces any existing mark for that day.",
      inputSchema: {
        companyId: Company,
        member: Member,
        day: Day,
        status: z.enum(['present', 'half', 'absent']),
        note: z.string().max(200).optional(),
      },
    },
    async ({ companyId, member, day, status, note }): Promise<ToolResult> => {
      const g = await gate(companyId);
      if (refused(g)) return g;
      if (g.role === 'member')
        return fail("Only the owner or the person's manager can mark attendance.");
      const { error } = await supabase.rpc('waves_company_attendance_set', {
        p_group_id: companyId,
        p_member_id: member,
        p_day: day,
        p_status: status,
        p_note: note ?? null,
      });
      if (error) return fail(error.message);
      const written = await record('attendance.set', companyId, member, null, null);
      return written ?? ok({ member, day, status });
    },
  );

  server.registerTool(
    'set_work_task',
    {
      description:
        'Create or update a work task. Owner and managers can set everything (send all fields when editing). An employee can only change the status and note of a task assigned to them. taskId makes a retry safe.',
      inputSchema: {
        companyId: Company,
        taskId: z
          .string()
          .uuid()
          .optional()
          .describe('Omit to create; pass an existing id to update'),
        member: Member.describe('Who the task is for'),
        day: Day,
        title: z.string().min(1).max(200),
        status: z.enum(['todo', 'doing', 'done', 'blocked']).default('todo'),
        blockedReason: z.string().max(120).optional().describe('Required when status is blocked'),
        note: z.string().max(200).optional(),
        dueTime: z
          .string()
          .regex(/^\d{2}:\d{2}$/)
          .optional()
          .describe('HH:MM'),
      },
    },
    async ({
      companyId,
      taskId,
      member,
      day,
      title,
      status,
      blockedReason,
      note,
      dueTime,
    }): Promise<ToolResult> => {
      const g = await gate(companyId);
      if (refused(g)) return g;
      const id = taskId ?? randomUUID();
      // Keep the site the task is already on; the RPC would otherwise clear it.
      const prior = await supabase.from('company_work_tasks').select('project_id').eq('id', id);
      if (prior.error) return fail(prior.error.message);
      const projectId =
        ((prior.data ?? [])[0] as { project_id?: string | null } | undefined)?.project_id ?? null;
      const { error } = await supabase.rpc('waves_company_work_set', {
        p_group_id: companyId,
        p_task_id: id,
        p_member_id: member,
        p_day: day,
        p_title: title,
        p_project_id: projectId,
        p_status: status,
        p_blocked_reason: blockedReason ?? null,
        p_note: note ?? null,
        p_due_time: dueTime ?? null,
      });
      if (error) return fail(error.message);
      const written = await record('work_task.set', companyId, id, null, null);
      return written ?? ok({ taskId: id, status });
    },
  );

  server.registerTool(
    'upsert_client',
    {
      description:
        'Create or update a client or lead (owner and managers only). When updating, send every field you want to keep: omitted fields are cleared. expectedValue is minor units.',
      inputSchema: {
        companyId: Company,
        clientId: z
          .string()
          .uuid()
          .optional()
          .describe('Omit to create; pass an existing id to update'),
        name: z.string().min(1).max(120),
        phone: z.string().max(32).optional(),
        need: z.string().max(500).optional(),
        source: z.enum(['walk_in', 'call', 'whatsapp', 'referral', 'other']).default('other'),
        expectedValue: Minor.optional(),
        address: z.string().max(300).optional(),
        stage: z.enum(['inquiry', 'quoted', 'client', 'lost']).default('inquiry'),
        lostReason: z.string().max(200).optional(),
        ownerMemberId: Member.optional().describe('Who follows this client up'),
      },
    },
    async ({ companyId, clientId, ...fields }): Promise<ToolResult> => {
      const g = await gate(companyId);
      if (refused(g)) return g;
      if (g.role === 'member') return fail('Only the owner and managers can save clients.');
      const id = clientId ?? randomUUID();
      const data = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
      const { error } = await supabase.rpc('waves_company_client_set', {
        p_group_id: companyId,
        p_client_id: id,
        p_data: data,
      });
      if (error) return fail(error.message);
      const written = await record('client.save', companyId, id, null, null);
      return written ?? ok({ clientId: id });
    },
  );

  server.registerTool(
    'save_estimate_draft',
    {
      description:
        'Create or edit a DRAFT estimate (owner and managers only). It is never sent or converted to a bill from here - the owner does that in the app. Amounts are minor units; qtyMilli is quantity x 1000 (2 units = "2000").',
      inputSchema: {
        companyId: Company,
        docId: z
          .string()
          .uuid()
          .optional()
          .describe('Omit to create; pass a draft estimate id to edit'),
        customerName: z.string().min(1).max(120),
        customerPhone: z.string().max(32).optional(),
        docDate: Day,
        items: z
          .array(
            z.object({
              description: z.string().min(1).max(200),
              qtyMilli: z.string().regex(/^\d{1,9}$/),
              rateMinor: z.string().regex(/^\d{1,13}$/),
            }),
          )
          .min(1)
          .max(50),
        discountMinor: Minor.optional(),
        notes: z.string().max(1000).optional(),
        clientId: z.string().uuid().optional(),
      },
    },
    async ({
      companyId,
      docId,
      customerName,
      customerPhone,
      docDate,
      items,
      discountMinor,
      notes,
      clientId,
    }): Promise<ToolResult> => {
      const g = await gate(companyId);
      if (refused(g)) return g;
      if (g.role === 'member') return fail('Only the owner and managers can save estimates.');
      const id = docId ?? randomUUID();
      // Draft-only, cap and audit are enforced inside the RPC, in one transaction.
      const { data, error } = await supabase.rpc('waves_company_agent_estimate_save', {
        p_group_id: companyId,
        p_doc_id: id,
        p_data: {
          docType: 'estimate',
          customerName,
          docDate,
          items,
          ...(customerPhone ? { customerPhone } : {}),
          ...(discountMinor ? { discountMinor } : {}),
          ...(notes ? { notes } : {}),
          ...(clientId ? { clientId } : {}),
        },
      });
      if (error) return fail(error.message);
      return ok({ docId: id, status: 'draft', totalMinor: String(data ?? '') });
    },
  );
}
