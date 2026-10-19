/**
 * Corrections and undo in a follow-up turn (WS2): the validator for the
 * `update_expense` correction fields and `delete_expense`, and the handler's
 * rules for them (not metered, capped, scoped to the saved expense's group).
 * TV-UPD-09..13 and TV-DEL-01 are also covered in injection.test.ts; these add
 * the edges and the CR-30 handler flow.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  breaker,
  clearContextCache,
  FOLLOWUP_PER_EXPENSE,
  handleVoiceAgent,
  type Deps,
} from './handler.ts';
import { fixtureContext, fixtures } from './evals/harness.ts';
import { parseToolCalls, STATIC_SYSTEM_PROMPT, TOOLS } from './logic.ts';

const personal = fixtureContext('followup:personal');
const group = fixtureContext('followup:group');
const pid = fixtures.saved.personal.id;
const gid = fixtures.saved.group.id;

const upd = (input: Record<string, unknown>, ctx = personal, id = pid) =>
  parseToolCalls([{ name: 'update_expense', input: { expenseId: id, ...input } }], ctx);
const rejected = (parsed: ReturnType<typeof parseToolCalls>) => expect(parsed.ok).toBe(false);

describe('correction fields', () => {
  it('TV-UPD-09 amountMinor takes digits only, within the cap', () => {
    expect(upd({ amountMinor: '80000' })).toMatchObject({ ok: true, update: { amountMinor: '80000' } });
    expect(upd({ amountMinor: 80000 })).toMatchObject({ ok: true, update: { amountMinor: '80000' } });
    expect(upd({ amountMinor: ' 0800 ' })).toMatchObject({ ok: true, update: { amountMinor: '800' } });
    for (const bad of ['-1', '1e3', '800.00', '', '0', '999999999999999999', '1000000000000', 'abc', {}, [1]]) {
      // '' is "not given", so with nothing else it changes nothing; the rest are malformed.
      rejected(upd({ amountMinor: bad }));
    }
  });

  it('TV-UPD-10 dates must be real, ISO and not text', () => {
    for (const bad of ['2026-02-30', 'yesterday', '20/10/2026', '2026-13-01', '2027-02-29']) {
      rejected(upd({ date: bad }));
    }
    expect(upd({ date: '2028-02-29' })).toMatchObject({ ok: true, update: { date: '2028-02-29' } });
  });

  it('TV-UPD-11 a move needs a group the caller is in, and personal only from a group expense', () => {
    expect(upd({ groupId: 'g-london' })).toMatchObject({ ok: true, update: { groupId: 'g-london' } });
    rejected(upd({ groupId: "g-goa'; DROP TABLE" }));
    rejected(upd({ groupId: 'g-evil' }));
    rejected(upd({ groupId: null }));
    rejected(upd({ groupId: 'personal' }));
    expect(upd({ groupId: null }, group, gid)).toMatchObject({ ok: true, update: { groupId: null } });
    expect(upd({ groupId: 'personal' }, group, gid)).toMatchObject({
      ok: true,
      update: { groupId: null },
    });
  });

  it('TV-UPD-11b moving a group expense to the group it is already in changes nothing', () => {
    const parsed = upd({ groupId: fixtures.saved.group.groupId }, group, gid);
    expect(parsed).toEqual({ ok: false, reason: 'update changes nothing' });
  });

  it('TV-UPD-12 currency is upper-cased and must be three letters', () => {
    expect(upd({ currency: ' aed ' })).toMatchObject({ ok: true, update: { currency: 'AED' } });
    for (const bad of ['₹', 'RUPEE', 'IN', 'I1R']) rejected(upd({ currency: bad }));
  });

  it('TV-UPD-12b a currency change leaves amountMinor exactly as sent', () => {
    expect(upd({ currency: 'JPY', amountMinor: '80000' })).toMatchObject({
      ok: true,
      update: { currency: 'JPY', amountMinor: '80000' },
    });
  });

  it('TV-UPD-13 participants must be members of the saved group, deduplicated, 1 to 40', () => {
    expect(upd({ participants: ['m-me', 'm-anu', 'm-anu'] }, group, gid)).toMatchObject({
      ok: true,
      update: { participants: ['m-me', 'm-anu'] },
    });
    rejected(upd({ participants: [] }, group, gid));
    rejected(upd({ participants: ['m-sam'] }, group, gid));
    rejected(upd({ participants: 'm-me' }, group, gid));
    rejected(upd({ participants: Array.from({ length: 41 }, () => 'm-me') }, group, gid));
    // A personal expense has no group to share among.
    rejected(upd({ participants: ['m-me'] }));
  });

  it('TV-UPD-13b participants of a move are checked against the destination', () => {
    expect(upd({ groupId: 'g-london', participants: ['m-me3'] })).toMatchObject({ ok: true });
    rejected(upd({ groupId: 'g-london', participants: ['m-anu'] }));
  });

  it('TV-INJ-04 a long description is cut to 120 characters', () => {
    const parsed = upd({ description: `<script>${'x'.repeat(10_000)}</script>` });
    expect(parsed.ok && parsed.update?.description).toHaveLength(120);
  });

  it('TV-UPD-05 an update that sets only an empty correction changes nothing', () => {
    expect(upd({ description: '', amountMinor: '', date: '', currency: '' })).toEqual({
      ok: false,
      reason: 'update changes nothing',
    });
  });

  it('TV-UPD-03 one update per turn, the id must match', () => {
    rejected(
      parseToolCalls(
        [
          { name: 'update_expense', input: { expenseId: pid, amountMinor: '100' } },
          { name: 'update_expense', input: { expenseId: pid, date: '2026-10-20' } },
        ],
        personal,
      ),
    );
    rejected(upd({ amountMinor: '100' }, personal, 'someone-elses'));
  });
});

describe('delete_expense', () => {
  const del = (input: unknown, ctx = personal) =>
    parseToolCalls([{ name: 'delete_expense', input }], ctx);
  it('TV-DEL-01 only in a follow-up, only for the saved id', () => {
    expect(del({ expenseId: pid })).toMatchObject({ ok: true, actions: [], delete: { expenseId: pid } });
    rejected(del({ expenseId: pid }, fixtureContext('default')));
    rejected(del({ expenseId: 'other' }));
    rejected(del({}));
    rejected(del(null));
    rejected(del([pid]));
  });
  it('TV-DEL-01b one delete per turn; never with an update; clarify still wins', () => {
    rejected(
      parseToolCalls(
        [
          { name: 'delete_expense', input: { expenseId: pid } },
          { name: 'delete_expense', input: { expenseId: pid } },
        ],
        personal,
      ),
    );
    expect(
      parseToolCalls(
        [
          { name: 'delete_expense', input: { expenseId: pid } },
          { name: 'answer_question', input: { text: 'Removed.' } },
        ],
        personal,
      ),
    ).toMatchObject({ ok: true, delete: { expenseId: pid }, answer: 'Removed.' });
  });
  it('TV-DEL-01c delete_expense is offered to the model and the prompt says when', () => {
    expect(TOOLS.some((tool) => tool.name === 'delete_expense')).toBe(true);
    expect(STATIC_SYSTEM_PROMPT).toContain('delete_expense');
    expect(STATIC_SYSTEM_PROMPT).toContain('hata do');
    expect(STATIC_SYSTEM_PROMPT).toMatch(/new number, date or description is a correction/);
    const update = TOOLS.find((tool) => tool.name === 'update_expense');
    const props = Object.keys(
      (update?.input_schema as { properties: Record<string, unknown> }).properties,
    );
    for (const field of ['amountMinor', 'currency', 'date', 'description', 'groupId', 'participants']) {
      expect(props).toContain(field);
    }
  });
});

// ── the handler ──────────────────────────────────────────────────────────────

type Call = { name: string; input: unknown };

function llm(calls: Call[]) {
  return (url: string) => {
    if (url.includes('openrouter.ai'))
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                tool_calls: calls.map((c) => ({
                  function: { name: c.name, arguments: JSON.stringify(c.input) },
                })),
              },
            },
          ],
        }),
      );
    throw new Error(`Unexpected provider URL: ${url}`);
  };
}

function table(rows: unknown[]) {
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'is', 'order', 'limit', 'in', 'eq']) q[m] = () => q;
  q.then = (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null });
  return q;
}

function makeDeps(calls: Call[], now = () => 0) {
  const rpc = vi.fn(async (name: string) =>
    name === 'waves_voice_agent_enabled'
      ? { data: true, error: null }
      : name === 'waves_voice_agent_quota'
        ? { data: { used: 3, limit: 100, tier: 'pro', allowed: true }, error: null }
        : { data: 0, error: null },
  );
  const rows: Record<string, unknown[]> = {
    groups: fixtures.groups,
    group_members: fixtures.members,
    group_balances: fixtures.balances,
  };
  const fetchMock = vi.fn(llm(calls));
  const deps = {
    caller: {
      auth: { getUser: async () => ({ data: { user: { id: fixtures.meProfileId } }, error: null }) },
      from: (name: string) => table(rows[name] ?? []),
    },
    service: { rpc, from: vi.fn() },
    env: (n: string) => ({ OPENROUTER_API_KEY: 'or', OPENROUTER_MODELS: 'test/one' })[n],
    fetch: fetchMock,
    rateLimit: vi.fn(async () => undefined),
    now,
  } as unknown as Deps;
  return { deps, rpc, fetchMock };
}

const post = (deps: Deps, extra: Record<string, unknown>) =>
  handleVoiceAgent(
    new Request('https://x/voice-agent', {
      method: 'POST',
      body: JSON.stringify({
        schemaVersion: 1,
        transcript: 'no make it 800',
        locale: 'en',
        today: fixtures.today,
        groupId: fixtures.currentGroupId,
        ...extra,
      }),
    }),
    deps,
  ).then((r) => r.json());

beforeEach(() => {
  breaker.reset();
  clearContextCache();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('handler: corrections and undo', () => {
  it('CR-30 a correction in a follow-up is accepted and returned as an update', async () => {
    const { deps } = makeDeps([
      { name: 'update_expense', input: { expenseId: pid, amountMinor: '80000' } },
    ]);
    const body = await post(deps, { savedExpense: fixtures.saved.personal });
    expect(body.update).toEqual({ expenseId: pid, amountMinor: '80000' });
    expect(body.actions).toEqual([]);
  });

  it('CR-30b a model that answers a follow-up with add_personal is refused with the clarify fallback', async () => {
    const { deps, rpc } = makeDeps([
      {
        name: 'add_personal',
        input: { description: 'Coffee', amountMinor: '80000', currency: 'INR' },
      },
    ]);
    const body = await post(deps, { savedExpense: fixtures.saved.personal });
    expect(body.actions).toEqual([]);
    expect(body.update).toBeUndefined();
    expect(body.clarify).toMatch(/say it again/);
    // Not metered, so nothing to give back.
    expect(rpc.mock.calls.some(([n]) => n === 'waves_voice_agent_refund')).toBe(false);
  });

  it('CR-30c "undo" comes back as delete for the saved id and logs only names', async () => {
    const { deps } = makeDeps([{ name: 'delete_expense', input: { expenseId: pid } }]);
    const body = await post(deps, { transcript: 'hata do', savedExpense: fixtures.saved.personal });
    expect(body.delete).toEqual({ expenseId: pid });
    expect(body.actions).toEqual([]);
    const log = JSON.parse(String(vi.mocked(console.log).mock.calls.at(-1)?.[0]));
    expect(log.deleted).toBe(true);
    expect(JSON.stringify(log)).not.toMatch(/hata do|exp-personal/);
  });

  it('CR-30d the log names the fields an update changed, never the values', async () => {
    const { deps } = makeDeps([
      { name: 'update_expense', input: { expenseId: pid, amountMinor: '80000', date: '2026-10-20' } },
    ]);
    await post(deps, { savedExpense: fixtures.saved.personal });
    const log = JSON.parse(String(vi.mocked(console.log).mock.calls.at(-1)?.[0]));
    expect(log.updateFields).toEqual(['amountMinor', 'date']);
    expect(JSON.stringify(log)).not.toContain('80000');
  });

  it('CR-30e a follow-up costs no command: no quota reservation, no refund', async () => {
    const { deps, rpc } = makeDeps([
      { name: 'update_expense', input: { expenseId: pid, date: '2026-10-20' } },
    ]);
    await post(deps, { savedExpense: fixtures.saved.personal });
    const names = rpc.mock.calls.map(([n]) => n);
    expect(names).not.toContain('waves_voice_agent_quota');
    expect(names).not.toContain('waves_voice_agent_refund');
  });

  it('CR-30f a normal command is still metered', async () => {
    const { deps, rpc } = makeDeps([{ name: 'answer_question', input: { text: 'Hi' } }]);
    await post(deps, {});
    expect(rpc.mock.calls.map(([n]) => n)).toContain('waves_voice_agent_quota');
  });

  it('CR-30g the fourth follow-up for one expense in ten minutes is capped; another expense is not', async () => {
    let time = 0;
    const { deps, fetchMock } = makeDeps(
      [{ name: 'answer_question', input: { text: 'Ok' } }],
      () => time,
    );
    const saved = { ...fixtures.saved.personal, id: 'cap-me' };
    for (let i = 0; i < FOLLOWUP_PER_EXPENSE; i++) await post(deps, { savedExpense: saved });
    await expect(post(deps, { savedExpense: saved })).rejects.toMatchObject({
      status: 429,
      code: 'VOICE_AGENT_FOLLOWUP_CAP',
    });
    expect(fetchMock).toHaveBeenCalledTimes(FOLLOWUP_PER_EXPENSE);
    await expect(
      post(deps, { savedExpense: { ...saved, id: 'someone-else' } }),
    ).resolves.toBeTruthy();
    // Ten minutes later the same expense may be asked about again.
    time = 10 * 60_000 + 1;
    await expect(post(deps, { savedExpense: saved })).resolves.toBeTruthy();
  });

  it('CR-30h a follow-up on a group expense is told about that group only', async () => {
    const { deps, fetchMock } = makeDeps([{ name: 'answer_question', input: { text: 'Ok' } }]);
    await post(deps, { savedExpense: fixtures.saved.group });
    const sent = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const text = JSON.stringify(sent.messages);
    expect(text).toContain('g-goa');
    expect(text).not.toMatch(/g-home|g-london|m-sam|m-priya/);
  });

  it('CR-30i a request that is both an answer to a question and a follow-up is malformed', async () => {
    const { deps } = makeDeps([{ name: 'answer_question', input: { text: 'Ok' } }]);
    await expect(
      post(deps, {
        savedExpense: fixtures.saved.personal,
        followUp: { transcript: 'a', question: 'b' },
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
