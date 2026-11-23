import { describe, expect, it } from 'vitest';

import {
  agentAddsAtOnce,
  formatHoldTime,
  holdLanding,
  holdPlan,
  holdSummary,
  lastAddedGroupId,
} from '@/lib/holdVoicePure';
import { parseVoiceExpenses } from '@/lib/voiceExpense';

const ready = {
  recognition: true,
  micGranted: true,
  statusReady: true,
  consentReady: true,
  agentServerOn: true,
  consent: 'granted' as const,
};

describe('holdPlan', () => {
  it('holds on the spot when everything is granted', () => {
    expect(holdPlan(ready)).toBe('overlay');
    expect(holdPlan({ ...ready, agentServerOn: false, consent: 'needed' })).toBe('overlay');
    expect(holdPlan({ ...ready, consent: 'revoked' })).toBe('overlay');
  });
  it('opens the screen when consent is still to be asked', () => {
    expect(holdPlan({ ...ready, consent: 'needed' })).toBe('screen');
  });
  it('opens the screen without mic permission, recogniser or known status', () => {
    expect(holdPlan({ ...ready, micGranted: false })).toBe('screen');
    expect(holdPlan({ ...ready, recognition: false })).toBe('screen');
    expect(holdPlan({ ...ready, statusReady: false })).toBe('screen');
    expect(holdPlan({ ...ready, consentReady: false })).toBe('screen');
  });
});

describe('formatHoldTime', () => {
  it('reads minutes and seconds', () => {
    expect(formatHoldTime(0)).toBe('0:00');
    expect(formatHoldTime(3400)).toBe('0:03');
    expect(formatHoldTime(65000)).toBe('1:05');
  });
});

describe('holdLanding', () => {
  const groups = [{ id: 'g1', name: 'Goa trip', currency: 'INR' }];
  const parse = (text: string) => parseVoiceExpenses(text, groups);
  it('adds a named group at once', () => {
    expect(
      holdLanding(
        parse('3000 for hotel in Goa trip'),
        { launchGroupId: null, launchPersonal: false },
        new Set(['g1']),
      ),
    ).toEqual({ kind: 'group', groupId: 'g1' });
  });
  it('uses the group the mic was held in', () => {
    expect(
      holdLanding(
        parse('coffee 120'),
        { launchGroupId: 'g1', launchPersonal: false },
        new Set(['g1']),
      ),
    ).toEqual({ kind: 'group', groupId: 'g1' });
  });
  it('keeps a sentence with no destination as a draft', () => {
    expect(
      holdLanding(
        parse('coffee 120'),
        { launchGroupId: null, launchPersonal: false },
        new Set(['g1']),
      ),
    ).toEqual({ kind: 'later' });
  });
  it('keeps a stale group as a draft', () => {
    expect(
      holdLanding(parse('coffee 120'), { launchGroupId: 'g1', launchPersonal: false }, new Set()),
    ).toEqual({ kind: 'later' });
  });
  it('adds a personal one from the personal ledger', () => {
    expect(
      holdLanding(parse('coffee 120'), { launchGroupId: null, launchPersonal: true }, new Set()),
    ).toEqual({ kind: 'personal' });
  });
  it('adds several expenses said in one go', () => {
    expect(
      holdLanding(
        parse('lunch 200, taxi 300 and petrol 500'),
        { launchGroupId: 'g1', launchPersonal: false },
        new Set(['g1']),
      ),
    ).toEqual({ kind: 'group', groupId: 'g1' });
    expect(parse('lunch 200, taxi 300 and petrol 500').items).toHaveLength(3);
  });
  it('keeps no amount as a draft', () => {
    expect(
      holdLanding(
        parse('lunch with Ravi'),
        { launchGroupId: 'g1', launchPersonal: false },
        new Set(['g1']),
      ),
    ).toEqual({ kind: 'later' });
  });
});

describe('agentAddsAtOnce', () => {
  const one = { problem: false, action: { type: 'add_expense' } };
  it('adds one clean expense', () => {
    expect(agentAddsAtOnce({ cards: [one], answer: null, clarify: null })).toBe(true);
  });
  it('leaves problems, questions and several cards', () => {
    expect(
      agentAddsAtOnce({ cards: [{ ...one, problem: true }], answer: null, clarify: null }),
    ).toBe(false);
    expect(agentAddsAtOnce({ cards: [one], answer: null, clarify: 'Which?' })).toBe(false);
    expect(agentAddsAtOnce({ cards: [one, one], answer: null, clarify: null })).toBe(true);
    expect(
      agentAddsAtOnce({ cards: [one, { ...one, problem: true }], answer: null, clarify: null }),
    ).toBe(false);
    expect(
      agentAddsAtOnce({
        cards: [{ problem: false, action: { type: 'settle' } }],
        answer: null,
        clarify: null,
      }),
    ).toBe(false);
  });
});

describe('an empty hold', () => {
  it('files nothing, so a hold that never got the mic ends quietly', async () => {
    const { worthFiling } = await import('@/lib/voiceDraftPure');
    expect(worthFiling('')).toBe(false);
  });
});

describe('holdSummary', () => {
  it('keeps a single result as its own toast', () => {
    expect(holdSummary(1, 0)).toEqual({ kind: 'one-added' });
    expect(holdSummary(0, 1)).toEqual({ kind: 'one-later' });
  });

  it('sums a queued run into one line', () => {
    expect(holdSummary(2, 0)).toEqual({ kind: 'many', added: 2, later: 0 });
    expect(holdSummary(1, 1)).toEqual({ kind: 'many', added: 1, later: 1 });
  });

  it('says nothing when nothing was filed', () => {
    expect(holdSummary(0, 0)).toEqual({ kind: 'none' });
  });
});

describe('lastAddedGroupId', () => {
  const row = (group_id: string, actor: string, verb = 'added', object_type = 'expense') => ({
    group_id,
    actor_member_id: actor,
    verb,
    object_type,
  });
  it('picks the newest group I added an expense to', () => {
    const rows = [
      row('g3', 'them'),
      row('g2', 'me2', 'edited'),
      row('g1', 'me1'),
      row('g2', 'me2'),
    ];
    expect(lastAddedGroupId(rows, new Set(['me1', 'me2']), () => true)).toBe('g1');
  });
  it('skips groups that cannot take it', () => {
    const rows = [row('gone', 'me1'), row('g2', 'me2')];
    expect(lastAddedGroupId(rows, new Set(['me1', 'me2']), (id) => id !== 'gone')).toBe('g2');
  });
  it('is null with nothing of mine', () => {
    expect(lastAddedGroupId([row('g1', 'them')], new Set(['me1']), () => true)).toBeNull();
  });
});
