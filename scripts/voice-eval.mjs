#!/usr/bin/env node
/**
 * Live LLM eval for the voice agent (spec 5.13, EV-01..EV-70).
 *
 * Opt-in: needs OPENROUTER_API_KEY (default) or ANTHROPIC_API_KEY. It sends
 * each utterance in supabase/functions/voice-agent/evals/utterances.json through
 * the production system prompt, tool list and validator (logic.ts) and scores
 * the model's tool calls against the expected ones. It never touches Supabase.
 *
 *   node scripts/voice-eval.mjs [--provider openrouter|anthropic] [--model <id>]
 *        [--lang en,hinglish] [--id EV-05,EV-06] [--concurrency 4] [--json out.json]
 *
 * Scoring per utterance:
 *   tool match  the multiset of tool names equals the expected (or an `alt`) one
 *   full match  tool match AND every expected arg matches: amounts, ids, dates,
 *               enums and booleans exactly; free text (description, place, note,
 *               name, question) case-insensitively contains / is contained;
 *               answer_question text contains one of `contains`; keys listed in an
 *               utterance's `loose` are not compared (placeholder descriptions)
 *   rejected    the production validator refuses the model's calls
 * Pass bars: tool match >= 90 % overall, >= 85 % Hinglish, >= 75 % Tamil-English,
 * full match >= 85 %, zero action tools in follow-up turns. Exit code 1 on a miss.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fnDir = resolve(root, 'supabase/functions/voice-agent');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    out[argv[i].slice(2)] =
      argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? 'true' : argv[(i += 1)];
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));

const provider =
  args.provider ??
  (process.env.OPENROUTER_API_KEY
    ? 'openrouter'
    : process.env.ANTHROPIC_API_KEY
      ? 'anthropic'
      : '');
if (provider !== 'openrouter' && provider !== 'anthropic') {
  console.error('voice-eval: set OPENROUTER_API_KEY (or ANTHROPIC_API_KEY) to run the live eval.');
  process.exit(2);
}
const key =
  provider === 'openrouter' ? process.env.OPENROUTER_API_KEY : process.env.ANTHROPIC_API_KEY;
if (!key) {
  console.error(
    `voice-eval: ${provider === 'openrouter' ? 'OPENROUTER_API_KEY' : 'ANTHROPIC_API_KEY'} is not set.`,
  );
  process.exit(2);
}
const model =
  args.model ??
  (provider === 'openrouter'
    ? process.env.OPENROUTER_MODELS?.split(',')[0]?.trim() || 'google/gemini-3.5-flash-lite'
    : 'claude-haiku-4-5-20251001');

// logic.ts imports the bundled core (`_shared/core.js`, git-ignored); build it once.
const coreBundle = resolve(root, 'supabase/functions/_shared/core.js');
if (!existsSync(coreBundle)) {
  console.error('voice-eval: building _shared/core.js ...');
  execFileSync(
    'npx',
    [
      'esbuild',
      'src/index.ts',
      '--bundle',
      '--format=esm',
      '--platform=neutral',
      '--target=es2022',
      `--outfile=${coreBundle}`,
    ],
    { cwd: resolve(root, 'packages/core'), stdio: 'inherit' },
  );
}
const logic = await import(pathToFileURL(resolve(fnDir, 'logic.ts')).href);
const { buildContext, systemPrompt, userMessage, parseToolCalls, TOOLS } = logic;

const fixtures = JSON.parse(readFileSync(resolve(fnDir, 'evals/fixtures.json'), 'utf8'));
let utterances = JSON.parse(readFileSync(resolve(fnDir, 'evals/utterances.json'), 'utf8'));
if (args.lang) utterances = utterances.filter((u) => args.lang.split(',').includes(u.lang));
if (args.id) utterances = utterances.filter((u) => args.id.split(',').includes(u.id));

const ACTION_TOOLS = new Set([
  'add_expense',
  'add_personal',
  'record_settlement',
  'nudge',
  'create_group',
  'add_member',
]);

function contextFor(name) {
  const none = name === 'noGroups';
  const base = buildContext({
    groups: none ? [] : fixtures.groups,
    members: none ? [] : fixtures.members,
    balances: none ? [] : fixtures.balances,
    meProfileId: fixtures.meProfileId,
    currentGroupId: none ? null : fixtures.currentGroupId,
    today: fixtures.today,
  });
  if (name === 'followup:personal') return { ...base, saved: fixtures.saved.personal };
  if (name === 'followup:group') return { ...base, saved: fixtures.saved.group };
  return base;
}

// ── providers ───────────────────────────────────────────────────────────────

async function post(url, headers, body) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
    return res.json();
  }
  throw new Error('provider unavailable after retries');
}

async function askModel(context, message) {
  if (provider === 'anthropic') {
    const out = await post(
      'https://api.anthropic.com/v1/messages',
      { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      {
        model,
        max_tokens: 2000,
        system: systemPrompt(context),
        tools: TOOLS,
        tool_choice: { type: 'any' },
        messages: [{ role: 'user', content: message }],
      },
    );
    return (out.content ?? [])
      .filter((b) => b.type === 'tool_use')
      .map((b) => ({ name: b.name, input: b.input }));
  }
  const out = await post(
    'https://openrouter.ai/api/v1/chat/completions',
    { authorization: `Bearer ${key}`, 'x-title': 'Waves voice eval' },
    {
      model,
      max_tokens: 2000,
      reasoning: { effort: 'low' },
      provider: { data_collection: 'deny' },
      tools: TOOLS.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.input_schema },
      })),
      tool_choice: 'required',
      messages: [
        { role: 'system', content: systemPrompt(context) },
        { role: 'user', content: message },
      ],
    },
  );
  return (out.choices?.[0]?.message?.tool_calls ?? []).map((c) => {
    let input = {};
    try {
      input = JSON.parse(c.function?.arguments ?? '{}');
    } catch {
      input = {};
    }
    return { name: c.function?.name, input };
  });
}

// ── scoring ─────────────────────────────────────────────────────────────────

const FREE_TEXT = new Set([
  'description',
  'place',
  'note',
  'name',
  'question',
  'text',
  'category',
  'options',
  'memberNames',
]);
const norm = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();

function same(expected, actual) {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || expected.length !== actual.length) return false;
    const used = new Set();
    return expected.every((e) =>
      actual.some((a, i) => {
        if (used.has(i) || !same(e, a)) return false;
        used.add(i);
        return true;
      }),
    );
  }
  if (expected && typeof expected === 'object') {
    if (!actual || typeof actual !== 'object') return false;
    return Object.entries(expected).every(([k, v]) => same(v, actual[k]));
  }
  if (typeof expected === 'string' && typeof actual === 'string') return expected === actual;
  return expected === actual;
}

function argsMatch(tool, expected, actual, contains, loose = []) {
  if (tool === 'answer_question') {
    const t = norm(actual?.text ?? '');
    const needles = contains?.length ? contains : [];
    return needles.length === 0 || needles.some((n) => t.includes(norm(n)));
  }
  if (tool === 'ask_clarification') return typeof actual?.question === 'string';
  return Object.entries(expected ?? {}).every(([k, v]) => {
    if (loose.includes(k)) return true;
    if (FREE_TEXT.has(k) && typeof v === 'string') {
      const a = norm(actual?.[k] ?? '');
      const e = norm(v);
      return a.includes(e) || (a.length > 0 && e.includes(a));
    }
    if (FREE_TEXT.has(k)) return true;
    return same(v, actual?.[k]);
  });
}

const asList = (e) => (Array.isArray(e) ? e : [e]);
const names = (list) =>
  list
    .map((c) => c.tool ?? c.name)
    .sort()
    .join(',');

/** Greedy pairing by tool name; returns true when every expected call has a match. */
function matchCalls(expectedList, calls, requireArgs, loose) {
  if (names(expectedList) !== names(calls)) return false;
  if (!requireArgs) return true;
  const left = [...calls];
  return expectedList.every((e) => {
    const i = left.findIndex(
      (c) => c.name === e.tool && argsMatch(e.tool, e.args, c.input, e.contains, loose),
    );
    if (i < 0) return false;
    left.splice(i, 1);
    return true;
  });
}

async function runOne(u) {
  const context = contextFor(u.context);
  const message = userMessage({ cloud: u.text, followUp: u.followUp ?? null });
  const started = Date.now();
  let calls = [];
  let error = null;
  try {
    calls = await askModel(context, message);
  } catch (e) {
    error = String(e.message ?? e);
  }
  const parsed = error ? { ok: false, reason: error } : parseToolCalls(calls, context);
  const accepted = [u.expect, ...(u.alt ?? [])].map(asList);
  const toolMatch = accepted.some((e) => matchCalls(e, calls, false));
  const fullMatch = accepted.some((e) => matchCalls(e, calls, true, u.loose));
  const followup = u.context.startsWith('followup');
  return {
    id: u.id,
    lang: u.lang,
    text: u.text,
    calls,
    toolMatch,
    fullMatch: fullMatch && parsed.ok,
    rejected: !error && !parsed.ok,
    reason: parsed.ok ? null : parsed.reason,
    actionInFollowup: followup && calls.some((c) => ACTION_TOOLS.has(c.name)),
    ms: Date.now() - started,
  };
}

async function pool(items, size, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < items.length) {
        const i = next;
        next += 1;
        results[i] = await fn(items[i]);
      }
    }),
  );
  return results;
}

console.error(`voice-eval: ${utterances.length} utterances via ${provider} / ${model}`);
const results = await pool(utterances, Number(args.concurrency ?? 4), runOne);

const pct = (n, d) => (d === 0 ? '  n/a' : `${((100 * n) / d).toFixed(1).padStart(5)}%`);
const langs = [...new Set(results.map((r) => r.lang))];
const rows = [['all', results], ...langs.map((l) => [l, results.filter((r) => r.lang === l)])];
console.log('\nlanguage        n   tool-match  full-match  rejected');
for (const [label, rs] of rows) {
  console.log(
    `${String(label).padEnd(14)} ${String(rs.length).padStart(2)}   ${pct(rs.filter((r) => r.toolMatch).length, rs.length)}      ${pct(
      rs.filter((r) => r.fullMatch).length,
      rs.length,
    )}     ${rs.filter((r) => r.rejected).length}`,
  );
}
const misses = results.filter((r) => !r.fullMatch);
if (misses.length) {
  console.log('\nmisses (id  tool?  got -> text)');
  for (const r of misses) {
    console.log(
      `${r.id} ${r.toolMatch ? 'tool-ok' : 'TOOL-X '} [${r.calls.map((c) => c.name).join('+') || 'none'}]${r.reason ? ` rejected: ${r.reason}` : ''} <- ${r.text}`,
    );
  }
}
const violations = results.filter((r) => r.actionInFollowup);
const tm = (rs) => rs.filter((r) => r.toolMatch).length / Math.max(1, rs.length);
const lang = (l) => results.filter((r) => r.lang === l);
const bars = [
  ['tool match >= 90% overall', tm(results) >= 0.9],
  ['tool match >= 85% Hinglish', lang('hinglish').length === 0 || tm(lang('hinglish')) >= 0.85],
  [
    'tool match >= 75% Tamil-English',
    lang('tamil-english').length === 0 || tm(lang('tamil-english')) >= 0.75,
  ],
  [
    'full match >= 85% overall',
    results.filter((r) => r.fullMatch).length / Math.max(1, results.length) >= 0.85,
  ],
  ['zero action tools in follow-up turns', violations.length === 0],
];
console.log('\npass bars');
for (const [label, ok] of bars) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
if (args.json)
  writeFileSync(resolve(args.json), JSON.stringify({ provider, model, results }, null, 2));
process.exit(bars.every(([, ok]) => ok) ? 0 : 1);
