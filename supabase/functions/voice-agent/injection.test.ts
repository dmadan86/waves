import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HttpError } from '../_shared/auth.ts';
import { breaker, clearContextCache, handleVoiceAgent, type Deps } from './handler.ts';
import {
  buildContext,
  contextText,
  keyterms,
  MAX_AMOUNT_MINOR,
  parseToolCalls,
  type VoiceContext,
} from './logic.ts';
import { fixtureContext, fixtures, WS2_LANDED } from './evals/harness.ts';

beforeEach(() => {
  breaker.reset();
  clearContextCache();
});

const expense = {
  groupId: 'g-goa',
  description: 'Dinner',
  amountMinor: '120000',
  currency: 'INR',
  paidByMemberId: 'm-me',
  split: { mode: 'equal', shares: [{ memberId: 'm-me' }, { memberId: 'm-anu' }] },
};
const parse = (name: string, input: unknown, context = fixtureContext()) =>
  parseToolCalls([{ name, input }], context);
const add = (fields: Record<string, unknown> = {}, context = fixtureContext()) =>
  parse('add_expense', { ...expense, ...fields }, context);
const update = (
  fields: Record<string, unknown> = {},
  context = fixtureContext('followup:personal'),
) =>
  parse(
    'update_expense',
    { expenseId: context.saved?.id ?? fixtures.saved.personal.id, ...fields },
    context,
  );
const reject = (result: ReturnType<typeof parseToolCalls>, reason?: string) => {
  expect(result).toMatchObject({ ok: false, ...(reason ? { reason } : {}) });
};
const split = (mode: string, values: unknown[]) => ({
  mode,
  shares: values.map((value, i) => ({ memberId: ['m-me', 'm-anu'][i], value })),
});

function table(rows: unknown[]) {
  const q: Record<string, unknown> = {};
  for (const method of ['select', 'is', 'order', 'limit', 'in', 'eq']) q[method] = () => q;
  q.then = (resolve: (value: unknown) => unknown) => resolve({ data: rows, error: null });
  return q;
}
const deepgram = (transcript: string) =>
  new Response(
    JSON.stringify({
      results: { channels: [{ alternatives: [{ transcript }] }] },
    }),
  );
const claude = (...calls: { name: string; input: unknown }[]) =>
  new Response(
    JSON.stringify({
      content: calls.map((call, i) => ({ type: 'tool_use', id: `t${i}`, ...call })),
    }),
  );
function makeDeps(
  over: { fetchImpl?: (url: string, init: RequestInit) => Response | Promise<Response> } = {},
) {
  const rpc = vi.fn(async (name: string) => ({
    data:
      name === 'waves_voice_agent_enabled'
        ? true
        : name === 'waves_voice_agent_quota'
          ? { used: 1, limit: 100, tier: 'pro', allowed: true }
          : 0,
    error: null,
  }));
  const rows: Record<string, unknown[]> = {
    groups: fixtures.groups,
    group_members: fixtures.members,
    group_balances: fixtures.balances,
  };
  const fetchMock = vi.fn(
    over.fetchImpl ??
      ((url: string) => {
        if (hostOf(url).endsWith('api.deepgram.com')) return deepgram('at Blue Tokai');
        if (hostOf(url).endsWith('api.anthropic.com'))
          return claude({
            name: 'update_expense',
            input: { expenseId: fixtures.saved.personal.id, place: 'Blue Tokai' },
          });
        throw new Error(`Unexpected URL: ${url}`);
      }),
  );
  const deps: Deps = {
    env: (name) => ({ DEEPGRAM_API_KEY: 'dg', ANTHROPIC_API_KEY: 'an' })[name],
    caller: {
      auth: {
        getUser: async () => ({ data: { user: { id: fixtures.meProfileId } }, error: null }),
      },
      from: (name: string) => table(rows[name] ?? []),
    },
    service: { rpc },
    fetch: fetchMock as unknown as typeof fetch,
    now: () => 0,
    rateLimit: async () => undefined,
  };
  return { deps, rpc, fetchMock };
}

describe('tool validation and injection boundaries', () => {
  it('TV-UPD-01 update requires a saved expense', () => {
    reject(update({ place: 'Cafe' }, fixtureContext()), 'update_expense outside a follow-up');
  });
  it('TV-UPD-02 update id must match the saved expense', () => {
    reject(update({ expenseId: 'another', place: 'Cafe' }), 'update is for a different expense');
  });
  it('TV-UPD-03 two updates are rejected', () => {
    const input = { expenseId: fixtures.saved.personal.id, place: 'Cafe' };
    reject(
      parseToolCalls(
        [
          { name: 'update_expense', input },
          { name: 'update_expense', input },
        ],
        fixtureContext('followup:personal'),
      ),
      'one update per turn',
    );
  });
  it('TV-UPD-04 follow-ups forbid adds but allow answers and clarification', () => {
    const context = fixtureContext('followup:group');
    reject(add({}, context));
    expect(parse('answer_question', { text: 'Finish this expense first' }, context)).toMatchObject({
      ok: true,
      actions: [],
      answer: 'Finish this expense first',
    });
    expect(parse('ask_clarification', { question: 'Which place?' }, context)).toMatchObject({
      ok: true,
      actions: [],
      clarify: 'Which place?',
    });
  });
  it('TV-UPD-05 missing and empty changes are rejected', () => {
    reject(update(), 'update changes nothing');
    reject(
      update({ place: '', note: '', category: '', paymentMethod: '', wantsReceipt: false }),
      'update changes nothing',
    );
  });
  it('TV-UPD-06 payment methods are validated and normalized', () => {
    reject(update({ paymentMethod: 'bitcoin' }));
    expect(update({ paymentMethod: 'UPI' })).toMatchObject({
      ok: true,
      update: { paymentMethod: 'upi' },
    });
  });
  it('TV-UPD-07 splitWith validates destination, membership, count and deduplicates', () => {
    const splitWith = { groupId: 'g-goa', memberIds: ['m-anu'] };
    reject(update({ splitWith }, fixtureContext('followup:group')));
    reject(update({ splitWith: { ...splitWith, memberIds: ['m-me'] } }));
    reject(update({ splitWith: { ...splitWith, memberIds: Array(11).fill('m-anu') } }));
    reject(update({ splitWith: { ...splitWith, groupId: 'g-evil' } }));
    expect(update({ splitWith: { ...splitWith, memberIds: ['m-anu', 'm-anu'] } })).toMatchObject({
      ok: true,
      update: { splitWith },
    });
  });
  it('TV-UPD-08 place, note and category are truncated', () => {
    expect(
      update({ place: 'p'.repeat(500), note: 'n'.repeat(500), category: 'c'.repeat(500) }),
    ).toMatchObject({
      ok: true,
      update: { place: 'p'.repeat(120), note: 'n'.repeat(200), category: 'c'.repeat(40) },
    });
  });
  it.skipIf(!WS2_LANDED)('TV-UPD-09 correction amounts obey integer limits', () => {
    expect(update({ amountMinor: '80000' })).toMatchObject({
      ok: true,
      update: { amountMinor: '80000' },
    });
    for (const amountMinor of ['-1', '1e3', '800.00', '', 999999999999999999])
      reject(update({ amountMinor }));
  });
  it.skipIf(!WS2_LANDED)('TV-UPD-10 correction dates must be real ISO dates', () => {
    reject(update({ date: '2026-02-30' }));
    reject(update({ date: 'yesterday' }));
    expect(update({ date: '2026-10-20' })).toMatchObject({
      ok: true,
      update: { date: '2026-10-20' },
    });
  });
  it.skipIf(!WS2_LANDED)(
    'TV-UPD-11 moves require caller membership and personal destination requires group source',
    () => {
      expect(update({ groupId: 'g-london' })).toMatchObject({
        ok: true,
        update: { groupId: 'g-london' },
      });
      reject(update({ groupId: 'g-evil' }));
      expect(update({ groupId: null }, fixtureContext('followup:group'))).toMatchObject({
        ok: true,
        update: { groupId: null },
      });
      reject(update({ groupId: null }));
    },
  );
  it.skipIf(!WS2_LANDED)('TV-UPD-12 correction currency is normalized and validated', () => {
    expect(update({ currency: 'inr' })).toMatchObject({ ok: true, update: { currency: 'INR' } });
    reject(update({ currency: '₹' }));
  });
  it.skipIf(!WS2_LANDED)(
    'TV-UPD-13 participants belong to the saved group and cannot be empty',
    () => {
      const context = fixtureContext('followup:group');
      expect(update({ participants: ['m-me', 'm-anu'] }, context)).toMatchObject({
        ok: true,
        update: { participants: ['m-me', 'm-anu'] },
      });
      reject(update({ participants: ['m-sam'] }, context));
      reject(update({ participants: [] }, context));
    },
  );
  it.skipIf(!WS2_LANDED)(
    'TV-DEL-01 delete requires matching saved id and cannot accompany update',
    () => {
      const input = { expenseId: fixtures.saved.personal.id };
      reject(parse('delete_expense', input));
      reject(parse('delete_expense', { expenseId: 'other' }, fixtureContext('followup:personal')));
      expect(parse('delete_expense', input, fixtureContext('followup:personal'))).toMatchObject({
        ok: true,
        actions: [],
        delete: input,
      });
      for (const calls of [
        [
          { name: 'delete_expense', input },
          { name: 'update_expense', input: { ...input, place: 'Cafe' } },
        ],
        [
          { name: 'update_expense', input: { ...input, place: 'Cafe' } },
          { name: 'delete_expense', input },
        ],
      ])
        reject(parseToolCalls(calls, fixtureContext('followup:personal')));
    },
  );
  it('TV-INJ-01 injected add cannot escape follow-up restrictions or amount cap', () => {
    reject(
      add(
        {
          groupId: 'g-home',
          paidByMemberId: 'm-sam',
          amountMinor: '1000000000',
          split: { mode: 'equal', shares: [{ memberId: 'm-sam' }] },
        },
        fixtureContext('followup:personal'),
      ),
    );
    reject(add({ amountMinor: (MAX_AMOUNT_MINOR + 1n).toString() }));
    expect(add({ amountMinor: MAX_AMOUNT_MINOR.toString() })).toMatchObject({ ok: true });
  });
  it('TV-INJ-02 SQL-shaped group id is unknown', () => {
    reject(add({ groupId: "g-goa'; DROP TABLE" }), 'unknown group id');
  });
  it('TV-INJ-03 a split member from another group is rejected', () => {
    reject(add({ split: { mode: 'equal', shares: [{ memberId: 'm-sam' }] } }), 'unknown member id');
  });
  it('TV-INJ-04 script-shaped descriptions are plain text capped at 120', () => {
    const description = '<script>' + 'x'.repeat(10000);
    expect(add({ description })).toMatchObject({
      ok: true,
      actions: [{ description: description.slice(0, 120) }],
    });
  });
  it('TV-INJ-05 answer text is capped at 600', () => {
    expect(parse('answer_question', { text: 'a'.repeat(5000) })).toMatchObject({
      ok: true,
      answer: 'a'.repeat(600),
    });
  });
  it('TV-INJ-06 option limits drop the list and duplicate answers are deduplicated', () => {
    const options = Array.from({ length: 5 }, (_, i) => ({
      label: `Group ${i}`,
      answer: `group ${i}`,
    }));
    for (const list of [options.slice(0, 1), options]) {
      expect(parse('ask_clarification', { question: 'Which group?', options: list })).toEqual({
        ok: true,
        actions: [],
        clarify: 'Which group?',
      });
    }
    expect(
      parse('ask_clarification', {
        question: 'Which group?',
        options: [options[0], { label: 'Duplicate', answer: 'GROUP 0' }, options[1]],
      }),
    ).toMatchObject({ ok: true, clarifyOptions: options.slice(0, 2) });
  });
  it('TV-INJ-07 misspelled tool is unknown', () => {
    reject(parse('update_expence', {}), 'unknown tool update_expence');
  });
  it('TV-INJ-08 non-object inputs reject without throwing', () => {
    for (const input of [[], null, 'injected'])
      reject(parse('add_expense', input), 'input not an object');
  });
  it('TV-INJ-09 malformed savedExpense bodies throw HttpError BAD_REQUEST before provider or quota', async () => {
    for (const savedExpense of [
      { id: 'x'.repeat(65), kind: 'personal' },
      { id: '', kind: 'personal' },
      { id: 123, kind: 'personal' },
      { id: 'x', kind: 'shared' },
      { id: 'x', kind: 'personal', question: 123 },
    ]) {
      const { deps, fetchMock, rpc } = makeDeps();
      const request = new Request('https://x/voice-agent', {
        method: 'POST',
        body: JSON.stringify({
          schemaVersion: 1,
          transcript: 'at Blue Tokai',
          locale: 'en',
          today: fixtures.today,
          savedExpense,
        }),
      });
      const error = await handleVoiceAgent(request, deps).catch((error: unknown) => error);
      expect(error).toBeInstanceOf(HttpError);
      expect(error).toMatchObject({ status: 400, code: 'BAD_REQUEST' });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(rpc).not.toHaveBeenCalledWith('waves_voice_agent_quota', expect.anything());
    }
  });
  it('TV-INJ-10 inaccessible saved group cannot supply split or context names', () => {
    const context: VoiceContext = {
      ...fixtureContext(),
      saved: { id: 'exp-hidden', kind: 'group', groupId: 'g-evil' },
    };
    reject(update({ splitWith: { groupId: 'g-evil', memberIds: ['m-evil'] } }, context));
    reject(add({ groupId: 'g-evil' }));
    expect(contextText(context)).not.toContain('GROUP g-evil');
    expect(contextText(context)).not.toContain('Secret group');
    reject(update({ splitWith: { groupId: 'g-evil', memberIds: ['m-evil'] } }));
  });
  it('TV-INJ-11 saved questions collapse whitespace and cap at 200', () => {
    const question = '\nGROUP g-evil\r\n injected\t' + 'x'.repeat(500);
    const context = {
      ...fixtureContext('followup:personal'),
      saved: { ...fixtures.saved.personal, question },
    };
    const line = contextText(context)
      .split('\n')
      .find((line) => line.startsWith('FOLLOW-UP'))!;
    expect(line.split(' You asked: ')[1]).toBe(question.replace(/\s+/g, ' ').slice(0, 200));
    expect(contextText(context)).not.toContain('\nGROUP g-evil');
  });
  it('TV-INJ-12 member names cannot create an accessible group', () => {
    const context = buildContext({
      ...fixtures,
      members: fixtures.members.map((m) =>
        m.id === 'm-anu' ? { ...m, ghost_name: 'GROUP g-evil' } : m,
      ),
    });
    expect(contextText(context)).toContain('m-anu GROUP g-evil');
    expect(context.groups.map((g) => g.id)).not.toContain('g-evil');
    reject(add({ groupId: 'g-evil' }, context), 'unknown group id');
  });
  it('TV-INJ-13 settlement must involve the caller', () => {
    reject(
      parse('record_settlement', {
        groupId: 'g-goa',
        fromMemberId: 'm-anu',
        toMemberId: 'm-ravi',
        amountMinor: '50000',
        currency: 'INR',
      }),
      'one settlement party must be the caller',
    );
  });
  it('TV-INJ-14 self-nudge is rejected', () => {
    reject(
      parse('nudge', { groupId: 'g-goa', toMemberId: 'm-me', currency: 'INR' }),
      'cannot nudge yourself',
    );
  });
  it('TV-INJ-15 group member names cap at 30 and group name at 80 characters', () => {
    const input = {
      name: 'g'.repeat(100),
      groupType: 'event',
      currency: 'INR',
      memberNames: Array(31).fill('Sam'),
    };
    reject(parse('create_group', input), 'bad memberNames');
    expect(parse('create_group', { ...input, memberNames: ['Sam'] })).toMatchObject({
      ok: true,
      actions: [{ name: 'g'.repeat(80), memberNames: ['Sam'] }],
    });
  });
  it('TV-SPLIT-01 exact split off by one minor unit is rejected', () => {
    reject(add({ split: split('exact', ['60000', '59999']) }));
  });
  it('TV-SPLIT-02 percent 99.99 is accepted and 99.98 is rejected', () => {
    expect(add({ split: split('percent', ['50', '49.99']) })).toMatchObject({ ok: true });
    reject(add({ split: split('percent', ['50', '49.98']) }));
  });
  it('TV-SPLIT-03 zero share weight is rejected', () => {
    reject(add({ split: split('shares', ['1', '0']) }), 'share weights must be positive');
  });
  it('TV-SPLIT-04 duplicate split members are rejected', () => {
    reject(
      add({ split: { mode: 'equal', shares: [{ memberId: 'm-anu' }, { memberId: 'm-anu' }] } }),
      'member listed twice in split',
    );
  });
  it('TV-SPLIT-05 equal split ignores supplied values', () => {
    expect(add({ split: split('equal', ['garbage', -1]) })).toMatchObject({
      ok: true,
      actions: [{ split: expense.split }],
    });
  });
  it('TV-SPLIT-06 unknown split modes are rejected', () => {
    reject(add({ split: split('injected', ['1', '1']) }), 'unknown split mode');
  });
  it('TV-AMT-01 leading zero amounts normalize to decimal integers', () => {
    expect(add({ amountMinor: '0800' })).toMatchObject({
      ok: true,
      actions: [{ amountMinor: '800' }],
    });
  });
  it('TV-AMT-02 amount whitespace is trimmed', () => {
    expect(add({ amountMinor: ' \t800\n' })).toMatchObject({
      ok: true,
      actions: [{ amountMinor: '800' }],
    });
  });
  it('TV-AMT-03 zero amounts are rejected', () => {
    for (const amountMinor of [0, '0'])
      reject(add({ amountMinor }), 'amountMinor must be positive');
  });
  it('TV-AMT-04 integer numbers are accepted and fractional numbers rejected', () => {
    expect(add({ amountMinor: 800 })).toMatchObject({
      ok: true,
      actions: [{ amountMinor: '800' }],
    });
    reject(add({ amountMinor: 800.5 }));
  });
  it('TV-DATE-01 real leap day is accepted', () => {
    expect(add({ date: '2028-02-29' })).toMatchObject({
      ok: true,
      actions: [{ date: '2028-02-29' }],
    });
  });
  it('TV-DATE-02 non-leap-year February 29 is rejected', () => {
    reject(add({ date: '2027-02-29' }), 'date is not real');
  });
  it('TV-KEY-01 keyterms respect 100 words, current group priority, unnamed exclusion and filler order', () => {
    const members = fixtures.groups.flatMap((g, gi) =>
      Array.from({ length: 45 }, (_, i) => ({
        id: `${g.id}-m${i}`,
        group_id: g.id,
        profile_id: i === 0 ? fixtures.meProfileId : null,
        ghost_name: i === 1 ? null : `Person${gi}x${i}`,
        profile: null,
      })),
    );
    const context = buildContext({ ...fixtures, members, currentGroupId: 'g-london' });
    expect(context.groups[0].id).toBe('g-london');
    expect(context.groups.every((g) => g.members.length === 40)).toBe(true);
    const terms = keyterms(context);
    expect(terms[0]).toBe('London');
    expect(terms).not.toContain('Unnamed');
    expect(terms.reduce((sum, term) => sum + term.split(' ').length, 0)).toBeLessThanOrEqual(100);
    expect(terms).not.toContain('Person2x40');
    expect(keyterms(fixtureContext()).slice(-2)).toEqual(['rupees', 'split']);
    expect(keyterms(context, 1000).slice(-2)).toEqual(['rupees', 'split']);
  });
});

function hostOf(url: string): string {
  return new URL(url).hostname;
}
