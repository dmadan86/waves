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
const SPLIT_MODES: readonly VoiceSplitMode[] = ['equal', 'exact', 'percent', 'shares'];

// ── context ────────────────────────────────────────────────────────────────

export interface ContextMember {
  readonly id: string;
  readonly name: string;
  readonly me: boolean;
}

export interface ContextGroup {
  readonly id: string;
  readonly name: string;
  readonly currency: string;
  readonly type: string;
  readonly members: readonly ContextMember[];
  /** member id -> signed minor units (positive = is owed). Non-zero only. */
  readonly balances: Readonly<Record<string, string>>;
}

export interface VoiceContext {
  /** Current group first. */
  readonly groups: readonly ContextGroup[];
  readonly currentGroupId: string | null;
  readonly today: string;
}

export interface RawGroup {
  id: string;
  name: string | null;
  type: string | null;
  default_currency: string | null;
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

/** Shape rows from the database into the compact context, current group first. */
export function buildContext(input: {
  groups: readonly RawGroup[];
  members: readonly RawMember[];
  balances: readonly RawBalance[];
  meProfileId: string;
  currentGroupId?: string | null;
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
    return {
      id: g.id,
      name: (g.name ?? '').trim() || 'Untitled group',
      currency,
      type: g.type ?? 'other',
      members,
      balances,
    };
  });
  const current =
    input.currentGroupId && groups.some((g) => g.id === input.currentGroupId)
      ? input.currentGroupId
      : null;
  return { groups, currentGroupId: current, today: input.today };
}

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
  return terms;
}

/** The compact context block the model reads. */
export function contextText(context: VoiceContext): string {
  const lines = [`Today: ${context.today}`];
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

export function systemPrompt(context: VoiceContext): string {
  return `You turn one spoken command about shared expenses into tool calls for the Waves app. A person confirms every action before anything is saved.

Rules:
- Call one tool per action, in the order spoken. If the command is a question, call answer_question. If it is ambiguous or missing something you cannot safely guess (who paid, how much, which group), call ask_clarification with one short question and no action tools.
- Resolve spoken names to member ids from the context below. Names may be transcribed approximately or in mixed Hindi/Tamil/English; match by closest sound. Never invent an id: use only ids that appear in the context. "me", "I", "my" mean the member marked (me). If a name matches nobody, ask.
- Use the CURRENT group unless a different group is named or the people spoken of only share another group.
- Amounts are integer minor units as a digit string (amountMinor). Use the group's currency unless another is spoken; "Rs", "rupees", "bucks" etc. map to the group's currency when it fits. Respect the group's minor unit: for 10^-2 currencies 1,250 rupees is "125000"; for 10^0 it is "1250".
- Unless said otherwise the speaker paid and the split is equal across everyone named, or all members of the group if nobody is named. For equal splits list the participants in split.shares without values. For exact/percent/shares give a value per share (exact in minor units, percent summing to 100).
- Relative dates ("yesterday", "last Friday") resolve against today, as YYYY-MM-DD. Omit date when it is today.
- nudge reminds a member who owes the caller. record_settlement is a payment between two members of one group and one party must be the caller (me).
- Keep descriptions short, in the speaker's words.
- Pick the group yourself whenever you can: if everyone named is in exactly one group, use it; if several, prefer the one-to-one group with that person, else the CURRENT group. Ask which group only when the people named are in several groups and nothing else decides it.
- "<amount> for <person>" (e.g. "8000 for Renny") means the speaker paid and that person owes all of it: split.shares lists only that person.
- Use add_personal only when no other person is named and the speaker says it is just for them, or they have no groups at all.
- If the message includes an earlier command and your question about it, the new words answer that question: complete the earlier command with them.

Context:
${contextText(context)}`;
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
      properties: { question: str('The question') },
      required: ['question'],
    },
  },
] as const;

// ── validation ─────────────────────────────────────────────────────────────

export type ToolCall = { name: string; input: unknown };

export type Parsed =
  | { ok: true; actions: VoiceAgentAction[]; answer?: string; clarify?: string }
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
    for (const call of calls) {
      const input = asRecord(call.input);
      if (call.name === 'answer_question') {
        answer = text(input.text, 'text', 600);
      } else if (call.name === 'ask_clarification') {
        clarify = text(input.question, 'question', 300);
      } else {
        actions.push(validateAction(call.name, input, context));
      }
    }
    if (clarify) return { ok: true, actions: [], clarify };
    if (actions.length === 0 && !answer) return { ok: false, reason: 'nothing to return' };
    return { ok: true, actions, ...(answer ? { answer } : {}) };
  } catch (error) {
    if (error instanceof Invalid) return { ok: false, reason: error.message };
    throw error;
  }
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
): { mode: VoiceSplitMode; shares: VoiceSplitShare[] } {
  const split = asRecord(value);
  const mode = split.mode as VoiceSplitMode;
  if (!SPLIT_MODES.includes(mode)) bad('unknown split mode');
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
