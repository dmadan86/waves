/**
 * A deterministic stand-in for the LLM providers, so the Maestro flows
 * (`e2e/assistant-*.yaml`) get the same tool calls for the same sentence every
 * time instead of whatever a live model felt like (decision D3).
 *
 *   VOICE_AGENT_STUB=1
 *
 * on the STAGING project's voice-agent function, and nowhere else. It is
 * refused on the production project ref, and refused when the project cannot be
 * identified at all: a switch that can serve invented expenses to real people
 * must fail closed. Refusing means the stub is simply not installed and the
 * request takes the normal path (the real providers), with an error in the log.
 *
 * The seam sits at the network edge, like `voiceChaos.ts`: a fetch wrapper in
 * front of the LLM providers. Everything after it is the real code (the tool
 * schema, `parseToolCalls`' validation against the caller's own groups and
 * members, quota, refunds), so a flow that passes against the stub is a
 * statement that the real server path works. Only the model's choice is canned.
 *
 * The stub reads the same prompt the model would: the context block (group and
 * member ids) and the last line of the user turn, and answers with ids taken
 * from that context. Nothing here is a transcript store; nothing is logged.
 */

import { upstreamOf } from './voiceChaos.ts';

/** The production Supabase project. Keep in step with `e2e/seed-e2e.mjs`. */
export const PROD_PROJECT_REF = 'ywojpnfyxxltvihqmcni';

/** Hosts of a local `supabase start`, which is never a real person's data. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', 'host.docker.internal', 'kong']);

export type StubDecision =
  | { readonly active: true; readonly ref: string }
  | { readonly active: false; readonly reason: 'off' | 'production' | 'unknown_project' };

type Env = (name: string) => string | undefined;

/**
 * The project ref the function is running in, from `SUPABASE_URL` (injected on
 * every deployed function: `https://<ref>.supabase.co`) and, when set,
 * `SUPABASE_PROJECT_REF`. `'local'` for a local stack; null when unknown.
 * Both sources are checked for the production ref so that either one naming it
 * is enough to refuse.
 */
export function projectRefs(env: Env): { refs: string[]; local: boolean } {
  const refs: string[] = [];
  let local = false;
  const url = env('SUPABASE_URL')?.trim();
  if (url) {
    try {
      const host = new URL(url).hostname.toLowerCase();
      if (LOCAL_HOSTS.has(host)) local = true;
      else refs.push(host.split('.')[0] ?? '');
    } catch {
      // Unparseable: treated as unknown below.
    }
    // A hostname that merely contains the prod ref (a proxy in front of it).
    if (url.toLowerCase().includes(PROD_PROJECT_REF)) refs.push(PROD_PROJECT_REF);
  }
  const explicit = env('SUPABASE_PROJECT_REF')?.trim().toLowerCase();
  if (explicit) refs.push(explicit);
  return { refs: refs.filter(Boolean), local };
}

/** Whether the stub may run here. Pure; the only gate in front of the stub. */
export function stubDecision(env: Env): StubDecision {
  if (env('VOICE_AGENT_STUB') !== '1') return { active: false, reason: 'off' };
  const { refs, local } = projectRefs(env);
  if (refs.includes(PROD_PROJECT_REF)) return { active: false, reason: 'production' };
  if (refs.length > 0) return { active: true, ref: refs[0] as string };
  if (local) return { active: true, ref: 'local' };
  return { active: false, reason: 'unknown_project' };
}

/**
 * Env and fetch with the stub installed when it is allowed; the inputs
 * untouched when it is not. A refusal while the switch is on is loud in the log.
 * `env` gains a placeholder OpenRouter key so the provider chain is not empty
 * (the stub never sends it anywhere).
 */
export function withVoiceStub(
  env: Env,
  fetchFn: typeof fetch,
): { env: Env; fetch: typeof fetch; active: boolean } {
  const decision = stubDecision(env);
  if (!decision.active) {
    if (decision.reason !== 'off') {
      console.error(
        JSON.stringify({ fn: 'voice-agent', event: 'voice_stub_refused', reason: decision.reason }),
      );
    }
    return { env, fetch: fetchFn, active: false };
  }
  return {
    env: (name) => (name === 'OPENROUTER_API_KEY' ? (env(name) ?? 'stub-key') : env(name)),
    fetch: stubFetch(fetchFn),
    active: true,
  };
}

// ── the canned model ───────────────────────────────────────────────────────

interface StubMember {
  readonly id: string;
  readonly name: string;
  readonly me: boolean;
}
interface StubGroup {
  readonly id: string;
  readonly name: string;
  readonly currency: string;
  readonly current: boolean;
  readonly members: StubMember[];
  readonly balances: Record<string, number>;
}
export interface StubCall {
  readonly name: string;
  readonly input: Record<string, unknown>;
}

/** Groups, members and balances back out of the context block the model reads. */
export function readContext(prompt: string): { groups: StubGroup[]; followUpId: string | null } {
  const groups: StubGroup[] = [];
  let current: StubGroup | null = null;
  const followUp = /FOLLOW-UP about .*? expenseId (\S+?)\.?(?:\s|$)/.exec(prompt);
  for (const line of prompt.split('\n')) {
    const g = /^GROUP (\S+) "(.*)" ([A-Z]{3}) \(minor unit = 10\^-\d+\) \S+( \[CURRENT\])?$/.exec(
      line,
    );
    if (g) {
      current = {
        id: g[1] as string,
        name: g[2] as string,
        currency: g[3] as string,
        current: Boolean(g[4]),
        members: [],
        balances: {},
      };
      groups.push(current);
      continue;
    }
    if (!current) continue;
    const members = /^ {2}members: (.*)$/.exec(line);
    if (members) {
      for (const entry of (members[1] as string).split('; ')) {
        const [id, ...rest] = entry.trim().split(' ');
        let name = rest.join(' ');
        const me = name.endsWith(' (me)');
        if (me) name = name.slice(0, -5);
        if (id && name) current.members.push({ id, name, me });
      }
      continue;
    }
    const balances = /^ {2}balances \(minor, \+ is owed to them\): (.*)$/.exec(line);
    if (balances) {
      for (const entry of (balances[1] as string).split('; ')) {
        const m = /^(.*) ([+-]?\d+)$/.exec(entry);
        const member = m && current.members.find((x) => x.name === m[1]);
        if (member && m) current.balances[member.id] = Number(m[2]);
      }
    }
  }
  return { groups, followUpId: followUp ? (followUp[1] as string) : null };
}

const FILLER = new Set([
  'add',
  'to',
  'for',
  'in',
  'at',
  'my',
  'the',
  'a',
  'rupees',
  'rupee',
  'rs',
  'inr',
  'just',
  'me',
  'and',
]);

const title = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

const money = (minor: number, currency: string): string => {
  const major = minor / 100;
  const text = Number.isInteger(major) ? major.toLocaleString('en-IN') : major.toFixed(2);
  return `${currency === 'INR' ? '₹' : `${currency} `}${text}`;
};

/** The group a sentence names, by full name or by its first word ("goa"). */
function namedGroup(text: string, groups: readonly StubGroup[]): StubGroup | null {
  const t = text.toLowerCase();
  for (const g of groups) if (t.includes(g.name.toLowerCase())) return g;
  for (const g of groups) {
    const first = g.name.toLowerCase().split(/\s+/)[0] as string;
    if (first.length >= 3 && new RegExp(`\\b${first}\\b`).test(t)) return g;
  }
  return null;
}

/** "dinner ravi paid" from "dinner 1200 ravi paid, goa trip": the words that stay. */
function describe(text: string, group: StubGroup | null): string {
  let rest = text.toLowerCase();
  if (group) {
    rest = rest.replace(group.name.toLowerCase(), ' ');
    const first = group.name.toLowerCase().split(/\s+/)[0] as string;
    rest = rest.replace(new RegExp(`\\b${first}\\b`), ' ');
  }
  rest = rest
    .replace(/[\d,]+(\.\d+)?/g, ' ')
    .replace(/[^\p{L}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w && !FILLER.has(w))
    .join(' ');
  if (group) {
    for (const m of group.members) {
      const first = m.name.split(/\s+/)[0] as string;
      rest = rest.replace(new RegExp(`\\b${first.toLowerCase()}\\b`), first);
    }
  }
  return title(rest.slice(0, 60).trim());
}

const amountOf = (text: string): number | null => {
  const m = /(\d[\d,]*(?:\.\d+)?)/.exec(text);
  if (!m) return null;
  const n = Number((m[1] as string).replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
};

const clarify = (question: string, options?: StubCall['input'][]): StubCall => ({
  name: 'ask_clarification',
  input: { question, ...(options && options.length >= 2 ? { options } : {}) },
});

function groupExpense(text: string, group: StubGroup, amountMinor: number): StubCall {
  const me = group.members.find((m) => m.me) ?? (group.members[0] as StubMember);
  return {
    name: 'add_expense',
    input: {
      groupId: group.id,
      description: describe(text, group) || 'Expense',
      amountMinor: String(amountMinor),
      currency: group.currency,
      paidByMemberId: me.id,
      split: { mode: 'equal', shares: group.members.map((m) => ({ memberId: m.id })) },
    },
  };
}

/**
 * The tool calls for one turn. Deterministic: a pure function of the prompt's
 * context block and the last line of the user turn.
 */
export function cannedCalls(context: string, userTurn: string): StubCall[] {
  const { groups, followUpId } = readContext(context);
  // The last line is the person's words; earlier lines carry an earlier
  // command and the question it was answering.
  const lines = userTurn.split('\n').filter((l) => l.trim());
  const text = (lines[lines.length - 1] ?? '').trim();
  const t = text.toLowerCase();

  if (followUpId) {
    const input: Record<string, unknown> = { expenseId: followUpId };
    const PAY = /^(cash|upi|card|credit|debit|bank|wallet)$/;
    for (const raw of text.split(/[,;]/)) {
      const part = raw.trim();
      if (!part) continue;
      if (PAY.test(part.toLowerCase())) input.paymentMethod = part.toLowerCase();
      else if (!input.place) input.place = part.slice(0, 120);
    }
    if (!input.paymentMethod && !input.place) {
      return [{ name: 'answer_question', input: { text: "I couldn't use that" } }];
    }
    return [{ name: 'update_expense', input }];
  }

  if (/\b(who owes|owes me|owe me|who owed)\b/.test(t)) {
    const owed: string[] = [];
    for (const g of groups) {
      const me = g.members.find((m) => m.me);
      if (!me || (g.balances[me.id] ?? 0) <= 0) continue;
      for (const m of g.members) {
        const b = g.balances[m.id] ?? 0;
        if (!m.me && b < 0) owed.push(`${m.name} owes you ${money(-b, g.currency)}`);
      }
    }
    return [
      {
        name: 'answer_question',
        input: {
          text: owed.length ? `${owed.join('. ')}.` : 'Nobody owes you anything right now.',
        },
      },
    ];
  }

  // Two items in one breath: "breakfast 300 and cab 450 Goa".
  const parts = t.split(/\band\b/).filter((p) => /\d/.test(p));
  if (parts.length >= 2) {
    const group = namedGroup(t, groups) ?? groups.find((g) => g.current) ?? groups[0] ?? null;
    if (group) {
      return parts
        .map((p) => ({ p, a: amountOf(p) }))
        .filter((x): x is { p: string; a: number } => x.a !== null)
        .map(({ p, a }) => groupExpense(p, group, a));
    }
  }

  const amount = amountOf(t);
  if (amount === null) {
    return [clarify("Sorry, I didn't catch what to do with that. Could you say it again?")];
  }

  if (/\b(personal|just for me|only me|for myself|mattum)\b/.test(t)) {
    const description = describe(t, null) || 'Personal expense';
    return [
      {
        name: 'add_personal',
        input: {
          description,
          amountMinor: String(amount),
          currency: 'INR',
          // A stated category keeps the "what kind of spend" question out of
          // the way, so the flows meet the receipt and payment questions.
          ...(description === 'Personal expense' ? { category: 'shopping' } : {}),
        },
      },
    ];
  }

  const group = namedGroup(t, groups) ?? (groups.length === 1 ? (groups[0] as StubGroup) : null);
  if (!group) {
    return [
      clarify(
        'Which group is this for?',
        groups.slice(0, 4).map((g) => ({
          label: g.name,
          detail: 'Split in group',
          icon: 'people',
          answer: `${amount / 100} rupees for expenses in ${g.name}`,
        })),
      ),
    ];
  }
  return [groupExpense(t, group, amount)];
}

// ── provider wire formats ──────────────────────────────────────────────────

interface Prompt {
  readonly context: string;
  readonly userTurn: string;
}

/** The system context and the user turn out of any provider's request body. */
function promptOf(host: string, body: unknown): Prompt {
  const b = (body ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (host === 'api.anthropic.com') {
    const system = Array.isArray(b.system)
      ? b.system.map((s: { text?: string }) => s.text ?? '')
      : [];
    return {
      context: system.join('\n'),
      userTurn: String(b.messages?.[0]?.content ?? ''),
    };
  }
  if (host === 'generativelanguage.googleapis.com') {
    return {
      context: String(b.systemInstruction?.parts?.[0]?.text ?? ''),
      userTurn: String(b.contents?.[0]?.parts?.[0]?.text ?? ''),
    };
  }
  const messages = Array.isArray(b.messages) ? b.messages : [];
  return {
    context: String(messages.find((m: { role?: string }) => m.role === 'system')?.content ?? ''),
    userTurn: String(
      [...messages].reverse().find((m: { role?: string }) => m.role === 'user')?.content ?? '',
    ),
  };
}

function respond(host: string, calls: readonly StubCall[]): Response {
  const body =
    host === 'api.anthropic.com'
      ? {
          content: calls.map((c, i) => ({
            type: 'tool_use',
            id: `stub-${i}`,
            name: c.name,
            input: c.input,
          })),
        }
      : host === 'generativelanguage.googleapis.com'
        ? {
            candidates: [
              {
                content: {
                  parts: calls.map((c) => ({ functionCall: { name: c.name, args: c.input } })),
                },
              },
            ],
          }
        : {
            choices: [
              {
                message: {
                  tool_calls: calls.map((c) => ({
                    function: { name: c.name, arguments: JSON.stringify(c.input) },
                  })),
                },
              },
            ],
          };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** `fetchFn` with the LLM providers replaced by {@link cannedCalls}. */
export function stubFetch(fetchFn: typeof fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (upstreamOf(url) !== 'llm') return fetchFn(input, init);
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(typeof init?.body === 'string' ? init.body : '{}');
    } catch {
      parsed = null;
    }
    const host = new URL(url).hostname;
    const { context, userTurn } = promptOf(host, parsed);
    return respond(host, cannedCalls(context, userTurn));
  }) as typeof fetch;
}
