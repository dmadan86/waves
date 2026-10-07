/**
 * The gate between the model and the app: names resolve to the caller's own
 * ids, amounts are bounded, splits add up. Pure functions, no network.
 */

import { describe, expect, it } from 'vitest';

import {
  buildContext,
  contextText,
  deepgramLanguage,
  deepgramUrl,
  keyterms,
  parseToolCalls,
  systemPrompt,
  type VoiceContext,
} from './logic.ts';

const ME = 'profile-me';

function context(): VoiceContext {
  return buildContext({
    groups: [
      { id: 'g-home', name: 'Flat 4B', type: 'home', default_currency: 'INR' },
      { id: 'g-goa', name: 'Goa trip', type: 'trip', default_currency: 'INR' },
    ],
    members: [
      {
        id: 'm-me',
        group_id: 'g-goa',
        profile_id: ME,
        ghost_name: null,
        profile: { display_name: 'Madan' },
      },
      {
        id: 'm-anu',
        group_id: 'g-goa',
        profile_id: 'p2',
        ghost_name: null,
        profile: [{ display_name: 'Anu' }],
      },
      { id: 'm-ravi', group_id: 'g-goa', profile_id: null, ghost_name: 'Ravi', profile: null },
      {
        id: 'm-me2',
        group_id: 'g-home',
        profile_id: ME,
        ghost_name: null,
        profile: { display_name: 'Madan' },
      },
      { id: 'm-sam', group_id: 'g-home', profile_id: null, ghost_name: 'Sam', profile: null },
    ],
    balances: [
      { group_id: 'g-goa', member_id: 'm-anu', currency: 'INR', balance: '-125000' },
      { group_id: 'g-goa', member_id: 'm-me', currency: 'INR', balance: '125000' },
      { group_id: 'g-goa', member_id: 'm-ravi', currency: 'INR', balance: '0' },
      { group_id: 'g-goa', member_id: 'm-ravi', currency: 'USD', balance: '500' },
    ],
    meProfileId: ME,
    currentGroupId: 'g-goa',
    today: '2026-10-07',
  });
}

const call = (name: string, input: unknown) => [{ name, input }];

describe('buildContext / contextText / keyterms', () => {
  it('puts the current group first and marks me', () => {
    const c = context();
    expect(c.groups.map((g) => g.id)).toEqual(['g-goa', 'g-home']);
    expect(c.currentGroupId).toBe('g-goa');
    expect(c.groups[0]?.members[0]).toEqual({ id: 'm-me', name: 'Madan', me: true });
    expect(c.groups[0]?.members.map((m) => m.name)).toContain('Ravi');
  });

  it('keeps only non-zero balances in the group currency', () => {
    expect(context().groups[0]?.balances).toEqual({ 'm-anu': '-125000', 'm-me': '125000' });
  });

  it('ignores a current group the caller is not in', () => {
    const c = buildContext({
      groups: [{ id: 'a', name: 'A', type: null, default_currency: null }],
      members: [],
      balances: [],
      meProfileId: ME,
      currentGroupId: 'someone-elses',
      today: '2026-10-07',
    });
    expect(c.currentGroupId).toBeNull();
    expect(c.groups[0]?.currency).toBe('INR');
  });

  it('renders ids, the (me) mark, the date and the CURRENT group compactly', () => {
    const text = contextText(context());
    expect(text).toContain('Today: 2026-10-07');
    expect(text).toContain('GROUP g-goa "Goa trip" INR');
    expect(text).toContain('[CURRENT]');
    expect(text).toContain('m-me Madan (me)');
    expect(text).toContain('Anu -125000');
    expect(text.length).toBeLessThan(900);
    expect(systemPrompt(context())).toContain(text);
  });

  it('builds distinct keyterms, current group first, capped by words', () => {
    const terms = keyterms(context());
    expect(terms[0]).toBe('Goa trip');
    expect(terms).toEqual(['Goa trip', 'Madan', 'Anu', 'Ravi', 'Flat 4B', 'Sam']);
    const capped = keyterms(context(), 4);
    expect(capped.join(' ').split(' ').length).toBeLessThanOrEqual(4);
  });
});

describe('deepgram request', () => {
  it('picks a language and encodes keyterms', () => {
    expect(deepgramLanguage('en')).toBe('en-IN');
    expect(deepgramLanguage('hi')).toBe('hi');
    expect(deepgramLanguage('ta')).toBe('multi');
    const url = new URL(deepgramUrl('en', ['Goa trip', 'Anu']));
    expect(url.searchParams.get('model')).toBe('nova-3');
    expect(url.searchParams.get('mip_opt_out')).toBe('true');
    expect(url.searchParams.getAll('keyterm')).toEqual(['Goa trip', 'Anu']);
  });
});

const expense = (over: Record<string, unknown> = {}) => ({
  groupId: 'g-goa',
  description: 'Dinner',
  amountMinor: '300000',
  currency: 'INR',
  paidByMemberId: 'm-me',
  split: { mode: 'equal', shares: [{ memberId: 'm-me' }, { memberId: 'm-anu' }] },
  ...over,
});

describe('parseToolCalls', () => {
  it('accepts a valid add_expense and normalises it', () => {
    const r = parseToolCalls(
      call('add_expense', expense({ date: '2026-10-06', amountMinor: 300000 })),
      context(),
    );
    expect(r).toMatchObject({ ok: true });
    if (r.ok) {
      expect(r.actions[0]).toMatchObject({
        type: 'add_expense',
        amountMinor: '300000',
        date: '2026-10-06',
      });
    }
  });

  it("rejects unknown ids, including another group's member", () => {
    for (const bad of [
      expense({ groupId: 'nope' }),
      expense({ paidByMemberId: 'm-sam' }),
      expense({ split: { mode: 'equal', shares: [{ memberId: 'm-sam' }] } }),
    ]) {
      expect(parseToolCalls(call('add_expense', bad), context()).ok).toBe(false);
    }
  });

  it('bounds amounts', () => {
    for (const amountMinor of ['0', '-5', '12.5', '', 'abc', '100000000001', 1.5]) {
      expect(parseToolCalls(call('add_expense', expense({ amountMinor })), context()).ok).toBe(
        false,
      );
    }
    expect(
      parseToolCalls(call('add_expense', expense({ amountMinor: '100000000000' })), context()).ok,
    ).toBe(true);
  });

  it('checks exact, percent and shares splits', () => {
    const split = (mode: string, a: string, b: string) => ({
      mode,
      shares: [
        { memberId: 'm-me', value: a },
        { memberId: 'm-anu', value: b },
      ],
    });
    const ok = (s: unknown) =>
      parseToolCalls(call('add_expense', expense({ split: s })), context()).ok;
    expect(ok(split('exact', '100000', '200000'))).toBe(true);
    expect(ok(split('exact', '100000', '100000'))).toBe(false);
    expect(ok(split('percent', '60', '40'))).toBe(true);
    expect(ok(split('percent', '60', '50'))).toBe(false);
    expect(ok(split('shares', '2', '1'))).toBe(true);
    expect(ok(split('shares', '0', '1'))).toBe(false);
    expect(ok(split('exact', '100000', undefined as unknown as string))).toBe(false);
    expect(ok({ mode: 'equal', shares: [{ memberId: 'm-me' }, { memberId: 'm-me' }] })).toBe(false);
    expect(ok({ mode: 'weird', shares: [{ memberId: 'm-me' }] })).toBe(false);
  });

  it('rejects impossible dates and bad currencies', () => {
    expect(parseToolCalls(call('add_expense', expense({ date: '2026-02-30' })), context()).ok).toBe(
      false,
    );
    expect(parseToolCalls(call('add_expense', expense({ currency: 'rupees' })), context()).ok).toBe(
      false,
    );
  });

  it('validates settlements: parties differ and one is the caller', () => {
    const s = (from: string, to: string) =>
      parseToolCalls(
        call('record_settlement', {
          groupId: 'g-goa',
          fromMemberId: from,
          toMemberId: to,
          amountMinor: '5000',
          currency: 'INR',
        }),
        context(),
      ).ok;
    expect(s('m-anu', 'm-me')).toBe(true);
    expect(s('m-me', 'm-me')).toBe(false);
    expect(s('m-anu', 'm-ravi')).toBe(false);
  });

  it('will not nudge the caller', () => {
    const n = (id: string) =>
      parseToolCalls(
        call('nudge', { groupId: 'g-goa', toMemberId: id, currency: 'INR' }),
        context(),
      ).ok;
    expect(n('m-anu')).toBe(true);
    expect(n('m-me')).toBe(false);
  });

  it('handles create_group, add_member and add_personal', () => {
    expect(
      parseToolCalls(
        call('create_group', {
          name: 'Ooty',
          groupType: 'trip',
          currency: 'inr',
          memberNames: ['Anu'],
        }),
        context(),
      ),
    ).toMatchObject({ ok: true, actions: [{ type: 'create_group', currency: 'INR' }] });
    expect(
      parseToolCalls(
        call('create_group', {
          name: 'Ooty',
          groupType: 'cruise',
          currency: 'INR',
          memberNames: [],
        }),
        context(),
      ).ok,
    ).toBe(false);
    expect(
      parseToolCalls(call('add_member', { groupId: 'g-goa', name: 'Dev' }), context()).ok,
    ).toBe(true);
    expect(parseToolCalls(call('add_member', { groupId: 'zzz', name: 'Dev' }), context()).ok).toBe(
      false,
    );
    expect(
      parseToolCalls(
        call('add_personal', { description: 'Coffee', amountMinor: '15000', currency: 'INR' }),
        context(),
      ).ok,
    ).toBe(true);
  });

  it('returns answers and clarifications; a clarification drops actions', () => {
    expect(
      parseToolCalls(call('answer_question', { text: 'Anu owes you 1,250.' }), context()),
    ).toMatchObject({
      ok: true,
      actions: [],
      answer: 'Anu owes you 1,250.',
    });
    const r = parseToolCalls(
      [
        { name: 'add_expense', input: expense() },
        { name: 'ask_clarification', input: { question: 'Which group?' } },
      ],
      context(),
    );
    expect(r).toEqual({ ok: true, actions: [], clarify: 'Which group?' });
  });

  it('keeps several actions in spoken order and fails the lot if one is bad', () => {
    const two = [
      { name: 'add_member', input: { groupId: 'g-goa', name: 'Dev' } },
      { name: 'add_expense', input: expense() },
    ];
    const r = parseToolCalls(two, context());
    expect(r.ok && r.actions.map((a) => a.type)).toEqual(['add_member', 'add_expense']);
    expect(
      parseToolCalls([...two, { name: 'add_expense', input: expense({ groupId: 'x' }) }], context())
        .ok,
    ).toBe(false);
  });

  it('fails with no tool, an unknown tool, or non-object input', () => {
    expect(parseToolCalls([], context()).ok).toBe(false);
    expect(parseToolCalls(call('delete_everything', {}), context()).ok).toBe(false);
    expect(parseToolCalls(call('add_expense', null), context()).ok).toBe(false);
  });
});
