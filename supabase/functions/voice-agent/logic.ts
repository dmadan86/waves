/**
 * The pure half of `voice-agent`: building the context the model sees, the
 * prompt and tool definitions, and checking what comes back. No network, no
 * Deno, no database, so all of it is unit-tested.
 *
 * The model proposes; this file is the gate. Every id it names must be one the
 * caller's own context contained, every amount must be a positive integer in
 * range, and a split must add up. Anything else is rejected here, before the
 * app ever sees it.
 */

import {
  minorUnitExponent,
  type VoiceAgentAction,
  type VoiceClarifyOption,
  type VoiceExpenseUpdate,
  type VoiceSavedExpense,
  type VoiceSplitMode,
  type VoiceSplitShare,
} from '../_shared/core.js';

/** Ten crore of a major unit at 2 decimals: the largest amount accepted, in minor units. */
export const MAX_AMOUNT_MINOR = 100_000_000_000n;

const MAX_GROUPS = 12;
const MAX_MEMBERS_PER_GROUP = 40;
/** Deepgram `keyterm` is billed and limited by tokens; ~100 words is the ceiling we send. */
export const MAX_KEYTERM_WORDS = 100;

export const GROUP_TYPES = ['trip', 'home', 'couple', 'friends', 'event', 'other'] as const;
export const CLARIFY_ICONS = [
  'amount',
  'food',
  'trip',
  'group',
  'person',
  'date',
  'other',
] as const;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 4;
const SPLIT_MODES: readonly (VoiceSplitMode | 'units')[] = [
  'equal',
  'exact',
  'percent',
  'shares',
  'units',
];
const PAYMENT_METHODS = ['cash', 'upi', 'card', 'credit', 'debit', 'bank', 'wallet'] as const;

// ── context ────────────────────────────────────────────────────────────────

export interface ContextMember {
  readonly id: string;
  readonly name: string;
  readonly me: boolean;
}

export interface ContextFamily {
  /** The display name of the family. */
  readonly name: string;
  /** Member ids that belong to this family (all must be in this group). */
  readonly memberIds: readonly string[];
}

export interface ContextGroup {
  readonly id: string;
  readonly name: string;
  readonly currency: string;
  readonly type: string;
  readonly members: readonly ContextMember[];
  /** member id -> signed minor units (positive = is owed). Non-zero only. */
  readonly balances: Readonly<Record<string, string>>;
  /** Families defined in this group: unitId -> family. Absent when none. */
  readonly families?: Readonly<Record<string, ContextFamily>>;
}

export interface VoiceContext {
  /** Current group first. */
  readonly groups: readonly ContextGroup[];
  readonly currentGroupId: string | null;
  readonly personal?: boolean;
  readonly today: string;
  /** Set for a follow-up turn: the expense the person just saved. */
  readonly saved?: VoiceSavedExpense;
}

export interface RawGroup {
  id: string;
  name: string | null;
  type: string | null;
  default_currency: string | null;
  /**
   * `groups.units` column value: unitId -> { name, members: string[], head? }.
   * Passed through from the database as-is; buildContext validates and maps it.
   */
  units?: unknown;
}
export interface RawMember {
  id: string;
  group_id: string;
  profile_id: string | null;
  ghost_name: string | null;
  profile: { display_name?: string | null } | { display_name?: string | null }[] | null;
}
export interface RawBalance {
  group_id: string;
  member_id: string;
  currency: string;
  balance: string | number | bigint;
}

/**
 * Safely parse `groups.units` (arbitrary JSON) into ContextFamily records.
 * Returns null when there are no valid families so the caller can omit the
 * field entirely.
 */
function parseFamilies(
  raw: unknown,
  memberIds: ReadonlySet<string>,
): Record<string, ContextFamily> | null {
  if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const result: Record<string, ContextFamily> = {};
  for (const [unitId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue;
    const unit = value as Record<string, unknown>;
    const name = typeof unit.name === 'string' ? unit.name.trim() : '';
    if (!name) continue;
    if (!Array.isArray(unit.members)) continue;
    const unitMemberIds = (unit.members as unknown[]).filter(
      (m): m is string => typeof m === 'string' && memberIds.has(m),
    );
    if (unitMemberIds.length === 0) continue;
    result[unitId] = { name, memberIds: unitMemberIds };
  }
  return Object.keys(result).length > 0 ? result : null;
}

/** Shape rows from the database into the compact context, current group first. */
export function buildContext(input: {
  groups: readonly RawGroup[];
  members: readonly RawMember[];
  balances: readonly RawBalance[];
  meProfileId: string;
  currentGroupId?: string | null;
  personal?: boolean;
  today: string;
}): VoiceContext {
  const ordered = [...input.groups].sort((a, b) => {
    if (a.id === input.currentGroupId) return -1;
    if (b.id === input.currentGroupId) return 1;
    return 0;
  });
  const groups: ContextGroup[] = ordered.slice(0, MAX_GROUPS).map((g) => {
    const currency = (g.default_currency ?? 'INR').toUpperCase();
    const members: ContextMember[] = input.members
      .filter((m) => m.group_id === g.id)
      .map((m) => {
        const profile = Array.isArray(m.profile) ? m.profile[0] : m.profile;
        const name = (profile?.display_name ?? m.ghost_name ?? '').trim() || 'Unnamed';
        return { id: m.id, name, me: m.profile_id === input.meProfileId };
      })
      .sort((a, b) => Number(b.me) - Number(a.me))
      .slice(0, MAX_MEMBERS_PER_GROUP);
    const balances: Record<string, string> = {};
    for (const b of input.balances) {
      if (b.group_id !== g.id || b.currency !== currency) continue;
      const value = String(b.balance);
      if (value !== '0' && members.some((m) => m.id === b.member_id)) balances[b.member_id] = value;
    }
    const memberIds = new Set(members.map((m) => m.id));
    const families = parseFamilies(g.units, memberIds);
    return {
      id: g.id,
      name: (g.name ?? '').trim() || 'Untitled group',
      currency,
      type: g.type ?? 'other',
      members,
      balances,
      ...(families ? { families } : {}),
    };
  });
  const current =
    input.currentGroupId && groups.some((g) => g.id === input.currentGroupId)
      ? input.currentGroupId
      : null;
  return { groups, currentGroupId: current, personal: input.personal, today: input.today };
}

const FILLER_KEYTERMS = ['rupees', 'split'] as const;

/** Group and member names to bias transcription, capped at about 100 words. */
export function keyterms(context: VoiceContext, maxWords = MAX_KEYTERM_WORDS): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  let words = 0;
  const add = (raw: string) => {
    const term = raw
      .replace(/[^\p{L}\p{N}' -]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!term || term === 'Unnamed') return;
    const key = term.toLowerCase();
    if (seen.has(key)) return;
    const count = term.split(' ').length;
    if (words + count > maxWords) return;
    seen.add(key);
    words += count;
    terms.push(term);
  };
  // Current group first so a cap cuts the least relevant names, not the most.
  for (const g of context.groups) {
    add(g.name);
    for (const m of g.members) add(m.name);
  }
  // Words the transcript tends to mangle into amounts ("split three" ->
  // "$3,030.30") or a foreign currency. Last, so names win under the cap.
  for (const word of FILLER_KEYTERMS) add(word);
  return terms;
}

/** The compact context block the model reads. */
export function contextText(context: VoiceContext): string {
  const lines = [`Today: ${context.today}`];
  if (context.personal) {
    lines.push(
      'The caller opened the assistant from their private Personal ledger, so default to add_personal for an expense unless the speaker explicitly names a group (named group wins).',
    );
  }
  if (context.saved) {
    const where =
      context.saved.kind === 'group'
        ? `a group expense in ${context.saved.groupId ?? '?'}`
        : 'a personal expense';
    lines.push(
      `FOLLOW-UP about ${where} already saved, expenseId ${context.saved.id}.` +
        (context.saved.question
          ? ` You asked: ${context.saved.question.replace(/\s+/g, ' ').slice(0, 200)}`
          : ''),
    );
  }
  for (const g of context.groups) {
    const exp = safeExponent(g.currency);
    const tag = g.id === context.currentGroupId ? ' [CURRENT]' : '';
    lines.push(`GROUP ${g.id} "${g.name}" ${g.currency} (minor unit = 10^-${exp}) ${g.type}${tag}`);
    lines.push(
      `  members: ${g.members.map((m) => `${m.id} ${m.name}${m.me ? ' (me)' : ''}`).join('; ')}`,
    );
    const bal = g.members
      .filter((m) => g.balances[m.id])
      .map((m) => `${m.name} ${Number(g.balances[m.id]) > 0 ? '+' : ''}${g.balances[m.id]}`);
    if (bal.length) lines.push(`  balances (minor, + is owed to them): ${bal.join('; ')}`);
    if (g.families) {
      const fams = Object.entries(g.families)
        .map(([unitId, f]) => `${unitId} "${f.name}" [${f.memberIds.join(', ')}]`)
        .join('; ');
      lines.push(`  families (unitId "name" [memberIds]): ${fams}`);
    }
  }
  if (context.groups.length === 0) lines.push('The caller is in no groups yet.');
  return lines.join('\n');
}

function safeExponent(currency: string): number {
  try {
    return minorUnitExponent(currency);
  } catch {
    return 2;
  }
}

/**
 * The instructions: identical for every request, so they can sit in a cached
 * prefix (Anthropic prompt caching). Nothing per-person or per-day belongs here.
 */
export const STATIC_SYSTEM_PROMPT = `You turn one spoken command about shared expenses into tool calls for the Waves app. A person confirms every action before anything is saved.

Rules:
- Call one tool per action, in the order spoken. If the command is a question, call answer_question. If it is ambiguous or missing something you cannot safely guess (who paid, how much, which group), call ask_clarification with one short question and no action tools.
- Resolve spoken names to member ids from the context below. Names may be transcribed approximately or in mixed Hindi/Tamil/English; match by closest sound. Never invent an id: use only ids that appear in the context. "me", "I", "my" mean the member marked (me). If a name matches nobody, ask.
- Use the CURRENT group unless a different group is named or the people spoken of only share another group.
- Amounts are integer minor units as a digit string (amountMinor). Use the group's currency unless another is spoken; "Rs", "rupees", "bucks" etc. map to the group's currency when it fits. Respect the group's minor unit: for 10^-2 currencies 1,250 rupees is "125000"; for 10^0 it is "1250".
- Unless said otherwise the speaker paid and the split is equal across everyone named, or all members of the group if nobody is named. For equal splits list the participants in split.shares without values. For exact/percent/shares give a value per share (exact in minor units, percent summing to 100). For units splits (families): if the group has a "families" line in the context and the person says "split by family", "per family", "family wise", "between the families", or names specific families (e.g. "Sharma family and Patel family"), use mode=units. List all participating member ids in split.shares (no values). Optionally supply split.unitIds with the unit ids of the named families to restrict the split; omit for all families. Each family pays one share regardless of size.
- Relative dates ("yesterday", "last Friday") resolve against today, as YYYY-MM-DD. Omit date when it is today.
- nudge reminds a member who owes the caller. record_settlement is a payment between two members of one group and one party must be the caller (me).
- Keep descriptions short, in the speaker's words.
- Pick the group yourself whenever you can: if everyone named is in exactly one group, use it; if several, prefer the one-to-one group with that person, else the CURRENT group. Ask which group only when the people named are in several groups and nothing else decides it.
- "<amount> for <person>" (e.g. "8000 for Renny") means the speaker paid and that person owes all of it: split.shares lists only that person.
- Use add_personal only when no other person is named and the speaker says it is just for them, or they have no groups at all.
- "<amount> for <thing> in/and/at <group name>" (e.g. "500 rupees for breakfast in Goa trip") is ONE expense in that group: the amount belongs to the thing, the group name only says where. Never read a group name as a second item or a second amount.
- The transcript comes from speech recognition and can be wrong. A number right after "split" or similar filler, or a figure in a currency the speaker never named that does not fit the group's currency (e.g. "$3,030.30" after "Split,"), is most likely a transcription artifact of something like "split three ways" or "split equally". Prefer the amount spoken with a currency word that matches the group ("500 rupees" in a rupee group) and ignore the artifact. "split N ways", "split between N" and "split, 3" are head-counts: hints about who shares it, never amounts.
- Ask only when it is genuinely ambiguous after the rules above. When you do ask which of several concrete values, groups or people was meant, also pass options (2-4): label is the value itself, detail says what it is, answer is the words to send back so the choice is complete on its own (e.g. "500 rupees for Breakfast"). Leave options out for open questions.
- If the message includes an earlier command and your question about it, the new words answer that question: complete the earlier command with them.
- If the context has a FOLLOW-UP line, the message answers a question about an expense that is already saved. Call only update_expense, with exactly that expenseId, filling just what was said (place, note, category, paymentMethod, wantsReceipt, splitWith). Never add, settle or create anything new, and never invent a place or person. If nothing in the message fits, call ask_clarification or answer_question.
- A FOLLOW-UP message that says a new number, date or description is a correction: call update_expense with that field (amountMinor, date, description, currency, or groupId to move it to another of the caller's groups, or "personal" to move a group expense to the personal ledger). A new currency only relabels, never converts. "undo", "delete that", "remove it", "hata do", "cancel that" mean delete_expense with that expenseId.`;

/** Everything per-request: today's date, the caller's groups, members and balances. */
export function dynamicContextText(context: VoiceContext): string {
  return `Context:\n${contextText(context)}`;
}

export function systemPrompt(context: VoiceContext): string {
  return `${STATIC_SYSTEM_PROMPT}\n\n${dynamicContextText(context)}`;
}

/**
 * Anthropic `system` as blocks: the static instructions behind a cache
 * breakpoint, then the dynamic context after it (uncached). Caching is
 * prefix-based, so nothing per-request may come before the breakpoint.
 */
export function anthropicSystem(context: VoiceContext) {
  return [
    { type: 'text', text: STATIC_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: dynamicContextText(context) },
  ];
}

// ── tools ──────────────────────────────────────────────────────────────────

const str = (description: string) => ({ type: 'string', description });
const SPLIT = {
  type: 'object',
  properties: {
    mode: { type: 'string', enum: [...SPLIT_MODES] },
    shares: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          memberId: str('A member id from the context'),
          value: str('exact: minor units; percent: 0-100; shares: weight. Omit for equal.'),
        },
        required: ['memberId'],
      },
      description:
        'For mode=units: list all member ids that participate (each family is expanded server-side). For other modes, the normal per-member list.',
    },
    unitIds: {
      type: 'array',
      items: { type: 'string' },
      description:
        'For mode=units only: the unit ids (from the "families" line in the context) that share this bill. Omit to include all families with at least one member in shares.',
    },
  },
  required: ['mode', 'shares'],
};

export const TOOLS = [
  {
    name: 'add_expense',
    description: 'Add a shared expense to a group.',
    input_schema: {
      type: 'object',
      properties: {
        groupId: str('Group id from the context'),
        description: str('Short description'),
        amountMinor: str('Total in minor units, digits only'),
        currency: str('ISO 4217 code'),
        paidByMemberId: str('Member id of the single payer'),
        split: SPLIT,
        category: str('Optional category word'),
        date: str('YYYY-MM-DD, omit for today'),
      },
      required: ['groupId', 'description', 'amountMinor', 'currency', 'paidByMemberId', 'split'],
    },
  },
  {
    name: 'add_personal',
    description: "A spend that is nobody else's: the caller's personal ledger.",
    input_schema: {
      type: 'object',
      properties: {
        description: str('Short description'),
        amountMinor: str('Minor units, digits only'),
        currency: str('ISO 4217 code'),
        category: str('Optional category word'),
        date: str('YYYY-MM-DD, omit for today'),
      },
      required: ['description', 'amountMinor', 'currency'],
    },
  },
  {
    name: 'record_settlement',
    description: 'Record that one member paid another back. One party must be the caller.',
    input_schema: {
      type: 'object',
      properties: {
        groupId: str('Group id'),
        fromMemberId: str('Who paid'),
        toMemberId: str('Who received'),
        amountMinor: str('Minor units, digits only'),
        currency: str('ISO 4217 code'),
      },
      required: ['groupId', 'fromMemberId', 'toMemberId', 'amountMinor', 'currency'],
    },
  },
  {
    name: 'nudge',
    description: 'Remind a group member who owes the caller to pay up.',
    input_schema: {
      type: 'object',
      properties: {
        groupId: str('Group id'),
        toMemberId: str('Who to remind'),
        currency: str('ISO 4217 code of the debt'),
      },
      required: ['groupId', 'toMemberId', 'currency'],
    },
  },
  {
    name: 'create_group',
    description: 'Create a new group.',
    input_schema: {
      type: 'object',
      properties: {
        name: str('Group name'),
        groupType: { type: 'string', enum: [...GROUP_TYPES] },
        currency: str('ISO 4217 code'),
        memberNames: { type: 'array', items: { type: 'string' }, description: 'People to add' },
      },
      required: ['name', 'groupType', 'currency', 'memberNames'],
    },
  },
  {
    name: 'add_member',
    description: 'Add a person to an existing group by name.',
    input_schema: {
      type: 'object',
      properties: { groupId: str('Group id'), name: str('Person name') },
      required: ['groupId', 'name'],
    },
  },
  {
    name: 'update_expense',
    description:
      'Only in a FOLLOW-UP turn: enrich the expense that was just saved with what the person said. Never for a new expense.',
    input_schema: {
      type: 'object',
      properties: {
        expenseId: str('The expenseId from the FOLLOW-UP line, exactly'),
        place: str('Where it was, as said (a venue or area)'),
        note: str('A short note to keep with it'),
        category: str('Optional category word'),
        paymentMethod: {
          type: 'string',
          enum: [...PAYMENT_METHODS],
          description: 'How it was paid',
        },
        wantsReceipt: {
          type: 'boolean',
          description: 'True if they want to add a receipt or bill photo',
        },
        amountMinor: str('A corrected amount, integer minor units as a digit string'),
        currency: str('A corrected ISO 4217 code; relabels only, never converts'),
        date: str('A corrected date, YYYY-MM-DD, resolved against today'),
        description: str('A corrected short description'),
        groupId: str(
          'Move it to this group id from the context, or "personal" for the personal ledger',
        ),
        participants: {
          type: 'array',
          items: { type: 'string' },
          description: "Member ids of the expense's group who share it",
        },
        splitWith: {
          type: 'object',
          description: 'Share it with these people (personal expenses only)',
          properties: {
            groupId: str('Group id from the context'),
            memberIds: {
              type: 'array',
              items: { type: 'string' },
              description: 'Member ids, not the caller',
            },
          },
          required: ['groupId', 'memberIds'],
        },
      },
      required: ['expenseId'],
    },
  },
  {
    name: 'delete_expense',
    description:
      'Only in a FOLLOW-UP turn: the person says undo, delete that, remove it or cancel. Removes the expense that was just saved.',
    input_schema: {
      type: 'object',
      properties: { expenseId: str('The expenseId from the FOLLOW-UP line, exactly') },
      required: ['expenseId'],
    },
  },
  {
    name: 'answer_question',
    description: 'Answer a question about balances or groups, in one short spoken-style sentence.',
    input_schema: {
      type: 'object',
      properties: { text: str('The answer') },
      required: ['text'],
    },
  },
  {
    name: 'ask_clarification',
    description: 'Ask one short question when the command is ambiguous. Use instead of guessing.',
    input_schema: {
      type: 'object',
      properties: {
        question: str('The question'),
        options: {
          type: 'array',
          description:
            '2-4 tappable answers when asking which of several concrete values, groups or people. Omit for open questions.',
          minItems: 2,
          maxItems: 4,
          items: {
            type: 'object',
            properties: {
              label: str('Bold line: the amount, group or person, e.g. ₹500'),
              detail: str('Secondary line, e.g. Breakfast or Goa trip (split in group)'),
              icon: {
                type: 'string',
                enum: [...CLARIFY_ICONS],
                description: 'Icon hint',
              },
              answer: str('Text sent back as the answer, a complete reply on its own'),
            },
            required: ['label', 'answer'],
          },
        },
      },
      required: ['question'],
    },
  },
] as const;

/** TOOLS with a breakpoint on the last definition, which caches every tool before it. */
export const ANTHROPIC_TOOLS = TOOLS.map((tool, index) =>
  index === TOOLS.length - 1 ? { ...tool, cache_control: { type: 'ephemeral' } } : tool,
);

// ── validation ─────────────────────────────────────────────────────────────

export type ToolCall = { name: string; input: unknown };

export type Parsed =
  | {
      ok: true;
      actions: VoiceAgentAction[];
      answer?: string;
      clarify?: string;
      clarifyOptions?: VoiceClarifyOption[];
      update?: VoiceExpenseUpdate;
      delete?: { expenseId: string };
    }
  | { ok: false; reason: string };

class Invalid extends Error {}
const bad = (message: string): never => {
  throw new Invalid(message);
};

/** Validate every tool call the model made against the caller's own context. */
export function parseToolCalls(calls: readonly ToolCall[], context: VoiceContext): Parsed {
  if (calls.length === 0) return { ok: false, reason: 'no tool called' };
  try {
    const actions: VoiceAgentAction[] = [];
    let answer: string | undefined;
    let clarify: string | undefined;
    let clarifyOptions: VoiceClarifyOption[] | undefined;
    let update: VoiceExpenseUpdate | undefined;
    let deleted: { expenseId: string } | undefined;
    for (const call of calls) {
      const input = asRecord(call.input);
      if (call.name === 'update_expense') {
        if (!context.saved) bad('update_expense outside a follow-up');
        if (update) bad('one update per turn');
        update = validateUpdate(input, context);
      } else if (call.name === 'delete_expense') {
        if (!context.saved) bad('delete_expense outside a follow-up');
        if (deleted) bad('one delete per turn');
        if (input.expenseId !== context.saved.id) bad('delete is for a different expense');
        deleted = { expenseId: context.saved.id };
      } else if (
        context.saved &&
        call.name !== 'answer_question' &&
        call.name !== 'ask_clarification'
      ) {
        // A follow-up may enrich the saved expense and nothing else.
        bad(`${call.name} is not allowed in a follow-up`);
      } else if (call.name === 'answer_question') {
        answer = text(input.text, 'text', 600);
      } else if (call.name === 'ask_clarification') {
        clarify = text(input.question, 'question', 300);
        clarifyOptions = clarifyOptionsOf(input.options);
      } else {
        actions.push(validateAction(call.name, input, context));
      }
    }
    if (deleted && update) bad('cannot update and delete the same expense');
    if (clarify) {
      return {
        ok: true,
        actions: [],
        clarify,
        ...(clarifyOptions ? { clarifyOptions } : {}),
      };
    }
    if (actions.length === 0 && !answer && !update && !deleted)
      return { ok: false, reason: 'nothing to return' };
    return {
      ok: true,
      actions,
      ...(answer ? { answer } : {}),
      ...(update ? { update } : {}),
      ...(deleted ? { delete: deleted } : {}),
    };
  } catch (error) {
    if (error instanceof Invalid) return { ok: false, reason: error.message };
    throw error;
  }
}

/**
 * Tappable answers are a nicety: a malformed list is dropped (the person just
 * speaks or types instead) rather than failing the whole turn.
 */
function clarifyOptionsOf(value: unknown): VoiceClarifyOption[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const options: VoiceClarifyOption[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
    const o = raw as Record<string, unknown>;
    const label = typeof o.label === 'string' ? o.label.trim().slice(0, 40) : '';
    const answer = typeof o.answer === 'string' ? o.answer.trim().slice(0, 200) : '';
    if (!label || !answer) return undefined;
    const key = answer.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const detail = typeof o.detail === 'string' ? o.detail.trim().slice(0, 60) : '';
    const icon =
      typeof o.icon === 'string' && (CLARIFY_ICONS as readonly string[]).includes(o.icon)
        ? o.icon
        : undefined;
    options.push({
      label,
      ...(detail ? { detail } : {}),
      ...(icon ? { icon } : {}),
      answer,
    });
  }
  if (options.length < MIN_OPTIONS || options.length > MAX_OPTIONS) return undefined;
  return options;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    bad('input not an object');
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') bad(`${field} must be a string`);
  const trimmed = (value as string).trim();
  if (!trimmed) bad(`${field} is empty`);
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/** A positive integer, as a decimal string, no larger than MAX_AMOUNT_MINOR. */
function amount(value: unknown, field: string): bigint {
  const raw = typeof value === 'number' && Number.isInteger(value) ? String(value) : value;
  if (typeof raw !== 'string' || !/^[0-9]{1,15}$/.test(raw.trim())) {
    return bad(`${field} must be a positive integer in minor units`);
  }
  const n = BigInt(raw.trim());
  if (n <= 0n) bad(`${field} must be positive`);
  if (n > MAX_AMOUNT_MINOR) bad(`${field} is too large`);
  return n;
}

function currencyOf(value: unknown): string {
  const c = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!/^[A-Z]{3}$/.test(c)) bad('currency must be an ISO 4217 code');
  return c;
}

function dateOf(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return bad('date must be YYYY-MM-DD');
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) bad('date is not real');
  return value;
}

function optionalCategory(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return text(value, 'category', 40);
}

function groupOf(context: VoiceContext, id: unknown): ContextGroup {
  const group = context.groups.find((g) => g.id === id);
  return group ?? bad('unknown group id');
}

function memberOf(group: ContextGroup, id: unknown): ContextMember {
  const member = group.members.find((m) => m.id === id);
  return member ?? bad('unknown member id');
}

function validateSplit(
  group: ContextGroup,
  value: unknown,
  total: bigint,
): { mode: VoiceSplitMode | 'units'; shares: VoiceSplitShare[] } {
  const split = asRecord(value);
  const mode = split.mode as VoiceSplitMode | 'units';
  if (!SPLIT_MODES.includes(mode)) bad('unknown split mode');

  if (mode === 'units') {
    // For a units split the model supplies member ids in shares (flat list).
    // We validate every member id is in the group, then build a units split
    // using the group's families. If no families are defined, reject.
    if (!group.families || Object.keys(group.families).length === 0) {
      bad('units split requires families to be defined on this group');
    }
    if (!Array.isArray(split.shares)) bad('split needs shares');
    const participantIds: string[] = [];
    const seen = new Set<string>();
    for (const raw of split.shares as unknown[]) {
      const s = asRecord(raw);
      const member = memberOf(group, s.memberId);
      if (seen.has(member.id)) bad('member listed twice in split');
      seen.add(member.id);
      participantIds.push(member.id);
    }
    if (participantIds.length === 0) bad('units split needs at least one participant');
    // If unitIds were provided, restrict to those families.
    const allowedUnitIds =
      Array.isArray(split.unitIds) && split.unitIds.length > 0
        ? new Set(split.unitIds as unknown[])
        : null;
    if (allowedUnitIds) {
      for (const id of allowedUnitIds) {
        if (typeof id !== 'string' || !Object.hasOwn(group.families!, id))
          bad('unknown family id in units split');
      }
    }
    // Build the UnitsParams-compatible shares: one entry per family.
    // We reuse the families from the context to emit per-family member lists.
    const unitShares: VoiceSplitShare[] = [];
    for (const [unitId, fam] of Object.entries(group.families)) {
      if (allowedUnitIds && !allowedUnitIds.has(unitId)) continue;
      const famMembers = fam.memberIds.filter((id) => participantIds.includes(id));
      if (famMembers.length === 0) continue;
      // Represent family split: one share entry per family member (equal within family).
      for (const mid of famMembers) {
        unitShares.push({ memberId: mid });
      }
    }
    // Members in no family are a unit of one.
    const placedInFamily = new Set(
      Object.values(group.families!).flatMap((family) => family.memberIds),
    );
    for (const id of participantIds) {
      if (!placedInFamily.has(id)) unitShares.push({ memberId: id });
    }
    if (unitShares.length === 0) bad('units split: no participants resolved to families');
    return { mode: 'units', shares: unitShares };
  }

  if (!Array.isArray(split.shares) || split.shares.length === 0) bad('split needs shares');
  const seen = new Set<string>();
  const shares: VoiceSplitShare[] = [];
  for (const raw of split.shares as unknown[]) {
    const s = asRecord(raw);
    const member = memberOf(group, s.memberId);
    if (seen.has(member.id)) bad('member listed twice in split');
    seen.add(member.id);
    if (mode === 'equal') {
      shares.push({ memberId: member.id });
      continue;
    }
    const v = typeof s.value === 'number' ? String(s.value) : s.value;
    if (typeof v !== 'string' || !/^\d+(\.\d+)?$/.test(v.trim())) bad('split value missing');
    shares.push({ memberId: member.id, value: (v as string).trim() });
  }
  if (mode === 'exact') {
    let sum = 0n;
    for (const s of shares) {
      if (!/^\d+$/.test(s.value ?? '')) bad('exact values must be integers');
      sum += BigInt(s.value as string);
    }
    if (sum !== total) bad('exact shares do not add up to the amount');
  } else if (mode === 'percent') {
    const sum = shares.reduce((acc, s) => acc + Number(s.value), 0);
    if (Math.abs(sum - 100) > 0.01) bad('percent shares do not add up to 100');
  } else if (mode === 'shares') {
    if (shares.some((s) => !(Number(s.value) > 0))) bad('share weights must be positive');
  }
  return { mode, shares };
}

/**
 * A follow-up answer's changes to the just-saved expense. The id must be the
 * one the app said it saved; a person named must be in the caller's own groups,
 * and never the caller; the group must be one of theirs; at least one field.
 */
function validateUpdate(input: Record<string, unknown>, context: VoiceContext): VoiceExpenseUpdate {
  const saved = context.saved as VoiceSavedExpense;
  if (input.expenseId !== saved.id) bad('update is for a different expense');
  const place =
    input.place === undefined || input.place === null || input.place === ''
      ? undefined
      : text(input.place, 'place', 120);
  const note =
    input.note === undefined || input.note === null || input.note === ''
      ? undefined
      : text(input.note, 'note', 200);
  const category = optionalCategory(input.category);
  let paymentMethod: string | undefined;
  if (
    input.paymentMethod !== undefined &&
    input.paymentMethod !== null &&
    input.paymentMethod !== ''
  ) {
    const raw =
      typeof input.paymentMethod === 'string' ? input.paymentMethod.trim().toLowerCase() : '';
    if (!(PAYMENT_METHODS as readonly string[]).includes(raw)) bad('unknown payment method');
    paymentMethod = raw;
  }
  if (input.wantsReceipt !== undefined && typeof input.wantsReceipt !== 'boolean')
    bad('wantsReceipt must be a boolean');
  const wantsReceipt = input.wantsReceipt === true ? true : undefined;
  let splitWith: VoiceExpenseUpdate['splitWith'];
  if (input.splitWith !== undefined && input.splitWith !== null) {
    if (saved.kind !== 'personal') bad('only a personal expense can be shared from here');
    const raw = asRecord(input.splitWith);
    const group = groupOf(context, raw.groupId);
    if (!Array.isArray(raw.memberIds) || raw.memberIds.length === 0 || raw.memberIds.length > 10) {
      bad('splitWith needs 1-10 members');
    }
    const ids: string[] = [];
    for (const id of raw.memberIds as unknown[]) {
      const member = memberOf(group, id);
      if (member.me) bad('cannot split with yourself');
      if (!ids.includes(member.id)) ids.push(member.id);
    }
    splitWith = { groupId: group.id, memberIds: ids };
  }
  // Corrections: a new amount, date, description, currency, ledger or set of sharers.
  const amountMinor =
    input.amountMinor === undefined || input.amountMinor === null || input.amountMinor === ''
      ? undefined
      : amount(input.amountMinor, 'amountMinor').toString();
  const currency =
    input.currency === undefined || input.currency === null || input.currency === ''
      ? undefined
      : currencyOf(input.currency);
  const date = dateOf(input.date);
  const description =
    input.description === undefined || input.description === null || input.description === ''
      ? undefined
      : text(input.description, 'description', 120);

  let groupId: string | null | undefined;
  let target: ContextGroup | undefined;
  if (input.groupId !== undefined && input.groupId !== '') {
    const wantsPersonal =
      input.groupId === null ||
      (typeof input.groupId === 'string' && input.groupId.trim().toLowerCase() === 'personal');
    if (wantsPersonal) {
      if (saved.kind !== 'group') bad('only a group expense can move to personal');
      groupId = null;
    } else {
      target = groupOf(context, input.groupId);
      // Moving to where it already is changes nothing.
      if (!(saved.kind === 'group' && saved.groupId === target.id)) groupId = target.id;
    }
  }
  let participants: string[] | undefined;
  if (input.participants !== undefined && input.participants !== null) {
    const home = target ?? (saved.kind === 'group' ? groupOf(context, saved.groupId) : undefined);
    if (!home) bad('participants need a group');
    if (
      !Array.isArray(input.participants) ||
      input.participants.length === 0 ||
      input.participants.length > 40
    ) {
      bad('participants needs 1-40 members');
    }
    const ids: string[] = [];
    for (const id of input.participants as unknown[]) {
      const member = memberOf(home, id);
      if (!ids.includes(member.id)) ids.push(member.id);
    }
    participants = ids;
  }

  if (
    !place &&
    !note &&
    !category &&
    !paymentMethod &&
    !wantsReceipt &&
    !splitWith &&
    !amountMinor &&
    !currency &&
    !date &&
    !description &&
    groupId === undefined &&
    !participants
  ) {
    bad('update changes nothing');
  }
  return {
    expenseId: saved.id,
    ...(amountMinor ? { amountMinor } : {}),
    ...(currency ? { currency } : {}),
    ...(date ? { date } : {}),
    ...(description ? { description } : {}),
    ...(groupId !== undefined ? { groupId } : {}),
    ...(participants ? { participants } : {}),
    ...(place ? { place } : {}),
    ...(note ? { note } : {}),
    ...(category ? { category } : {}),
    ...(paymentMethod ? { paymentMethod } : {}),
    ...(wantsReceipt ? { wantsReceipt } : {}),
    ...(splitWith ? { splitWith } : {}),
  };
}

function validateAction(
  name: string,
  input: Record<string, unknown>,
  context: VoiceContext,
): VoiceAgentAction {
  switch (name) {
    case 'add_expense': {
      const group = groupOf(context, input.groupId);
      const total = amount(input.amountMinor, 'amountMinor');
      const paidBy = memberOf(group, input.paidByMemberId);
      const split = validateSplit(group, input.split, total);
      const category = optionalCategory(input.category);
      const date = dateOf(input.date);
      return {
        type: 'add_expense',
        groupId: group.id,
        description: text(input.description, 'description', 120),
        amountMinor: total.toString(),
        currency: currencyOf(input.currency),
        paidByMemberId: paidBy.id,
        split,
        ...(category ? { category } : {}),
        ...(date ? { date } : {}),
      };
    }
    case 'add_personal': {
      const category = optionalCategory(input.category);
      const date = dateOf(input.date);
      return {
        type: 'add_personal',
        description: text(input.description, 'description', 120),
        amountMinor: amount(input.amountMinor, 'amountMinor').toString(),
        currency: currencyOf(input.currency),
        ...(category ? { category } : {}),
        ...(date ? { date } : {}),
      };
    }
    case 'record_settlement': {
      const group = groupOf(context, input.groupId);
      const from = memberOf(group, input.fromMemberId);
      const to = memberOf(group, input.toMemberId);
      if (from.id === to.id) bad('settlement parties are the same member');
      if (!from.me && !to.me) bad('one settlement party must be the caller');
      return {
        type: 'record_settlement',
        groupId: group.id,
        fromMemberId: from.id,
        toMemberId: to.id,
        amountMinor: amount(input.amountMinor, 'amountMinor').toString(),
        currency: currencyOf(input.currency),
      };
    }
    case 'nudge': {
      const group = groupOf(context, input.groupId);
      const to = memberOf(group, input.toMemberId);
      if (to.me) bad('cannot nudge yourself');
      return {
        type: 'nudge',
        groupId: group.id,
        toMemberId: to.id,
        currency: currencyOf(input.currency),
      };
    }
    case 'create_group': {
      const groupType = typeof input.groupType === 'string' ? input.groupType : '';
      if (!(GROUP_TYPES as readonly string[]).includes(groupType)) bad('unknown group type');
      if (!Array.isArray(input.memberNames) || input.memberNames.length > 30)
        bad('bad memberNames');
      const memberNames = (input.memberNames as unknown[]).map((n) => text(n, 'memberName', 60));
      return {
        type: 'create_group',
        name: text(input.name, 'name', 80),
        groupType,
        currency: currencyOf(input.currency),
        memberNames,
      };
    }
    case 'add_member': {
      const group = groupOf(context, input.groupId);
      return { type: 'add_member', groupId: group.id, name: text(input.name, 'name', 60) };
    }
    default:
      return bad(`unknown tool ${name}`);
  }
}

// ── Deepgram ───────────────────────────────────────────────────────────────

/** Deepgram language for a UI locale. English speakers here mostly speak Indian English. */
export function deepgramLanguage(locale: string): string {
  const base = locale.toLowerCase().split('-')[0];
  if (base === 'en') return 'en-IN';
  if (base === 'hi') return 'hi';
  return 'multi';
}

export function deepgramUrl(locale: string, terms: readonly string[]): string {
  const params = new URLSearchParams({
    model: 'nova-3',
    language: deepgramLanguage(locale),
    smart_format: 'true',
    punctuate: 'true',
    // Spoken numbers as digits ("eight thousand" -> "8000"): the amount is the
    // one word an expense cannot get wrong.
    numerals: 'true',
    mip_opt_out: 'true',
  });
  for (const t of terms) params.append('keyterm', t);
  return `https://api.deepgram.com/v1/listen?${params.toString()}`;
}

/** The user turn the model reads: the transcript, and an earlier command plus the
 *  question this clip answers, when there is one. */
export function userMessage(input: {
  cloud: string;
  followUp?: { transcript: string; question: string } | null;
}): string {
  const lines: string[] = [];
  if (input.followUp?.transcript && input.followUp.question) {
    lines.push(`Earlier command: ${input.followUp.transcript.trim()}`);
    lines.push(`You asked: ${input.followUp.question.trim()}`);
    lines.push('Their answer:');
  }
  lines.push(input.cloud.trim());
  return lines.join('\n');
}

/** The live (WebSocket) transcription URL for the app's stream: raw 16 kHz mono
 *  PCM in, interim results back, the same model, language, formatting and
 *  keyterms as the pre-recorded path. */
export function deepgramStreamUrl(locale: string, terms: readonly string[], tag?: string): string {
  const params = new URLSearchParams({
    model: 'nova-3',
    language: deepgramLanguage(locale),
    encoding: 'linear16',
    sample_rate: '16000',
    channels: '1',
    interim_results: 'true',
    smart_format: 'true',
    punctuate: 'true',
    numerals: 'true',
    // A short pause marks a phrase final; the app still decides when the
    // command ends (the person lets go of the mic).
    endpointing: '300',
    mip_opt_out: 'true',
  });
  for (const t of terms) params.append('keyterm', t);
  // Deepgram usage-API tag (free): lets billed minutes be reconciled per caller.
  if (tag) params.append('tag', tag);
  return `wss://api.deepgram.com/v1/listen?${params.toString()}`;
}

// ── Anthropic usage and price ──────────────────────────────────────────────

/** The token counts on an Anthropic response's `usage`. */
export interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

/** USD per million tokens, input and output, for the models the chain asks. */
const ANTHROPIC_PRICE_PER_MTOK: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5-20251001': { input: 1, output: 5 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
};

/** A cache read costs 0.1x the input price; a 5-minute cache write 1.25x. */
export const CACHE_READ_MULTIPLIER = 0.1;
export const CACHE_WRITE_MULTIPLIER = 1.25;

/**
 * What one Anthropic response cost, in USD. `input_tokens` is only the part
 * after the last breakpoint; cache reads and writes are reported (and priced)
 * separately. Null for a model with no known price.
 */
export function anthropicCostUsd(model: string, usage: AnthropicUsage): number | null {
  const price = ANTHROPIC_PRICE_PER_MTOK[model];
  if (!price) return null;
  const fresh = usage.input_tokens ?? 0;
  const read = usage.cache_read_input_tokens ?? 0;
  const written = usage.cache_creation_input_tokens ?? 0;
  const out = usage.output_tokens ?? 0;
  return (
    (fresh * price.input +
      read * price.input * CACHE_READ_MULTIPLIER +
      written * price.input * CACHE_WRITE_MULTIPLIER +
      out * price.output) /
    1_000_000
  );
}
