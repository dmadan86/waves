import { describe, expect, it } from 'vitest';

import {
  agentHandoffCategory,
  agentHandoffDate,
  decodeAgentSplitParams,
  encodeAgentSplitParams,
} from '../src/lib/voiceAgentHandoff';
import { SplitKind } from '../src/lib/split';

const members = ['m-me', 'm-renny', 'm-anu'];

describe('agent proposal → full form hand-off', () => {
  it('carries the payer and an equal split through', () => {
    const params = encodeAgentSplitParams({
      paidByMemberId: 'm-renny',
      split: { mode: 'equal', shares: [{ memberId: 'm-me' }, { memberId: 'm-anu' }] },
    });
    const decoded = decodeAgentSplitParams(params.payer, params.split, members);
    expect(decoded).toMatchObject({
      payer: 'm-renny',
      participants: ['m-me', 'm-anu'],
      splitKind: SplitKind.Equal,
    });
  });

  it('keeps exact shares in minor units and percent/shares as typed', () => {
    const exact = decodeAgentSplitParams(
      undefined,
      JSON.stringify({ mode: 'exact', shares: [{ memberId: 'm-renny', value: '800000' }] }),
      members,
    );
    expect(exact?.splitKind).toBe(SplitKind.Exact);
    expect(exact?.exactMinor).toEqual({ 'm-renny': 800000n });
    const pct = decodeAgentSplitParams(
      undefined,
      JSON.stringify({
        mode: 'percent',
        shares: [
          { memberId: 'm-me', value: '60' },
          { memberId: 'm-anu', value: '40' },
        ],
      }),
      members,
    );
    expect(pct?.percents).toEqual({ 'm-me': '60', 'm-anu': '40' });
  });

  it('drops ids that are not members of the group, and gives up on garbage', () => {
    const decoded = decodeAgentSplitParams(
      'stranger',
      JSON.stringify({ mode: 'equal', shares: [{ memberId: 'stranger' }, { memberId: 'm-anu' }] }),
      members,
    );
    expect(decoded).toMatchObject({ payer: null, participants: ['m-anu'] });
    expect(decodeAgentSplitParams('stranger', '{not json', members)).toBeNull();
    expect(decodeAgentSplitParams(undefined, undefined, members)).toBeNull();
  });
});

describe('agent proposal → form: the proposal is settled, not re-guessed', () => {
  const guess = (description: string): string | null =>
    /dinner|lunch/i.test(description) ? 'food' : /cab|uber/i.test(description) ? 'transport' : null;

  it('marks the hand-off as a proposal', () => {
    expect(encodeAgentSplitParams({ paidByMemberId: 'm-me' }).proposal).toBe('1');
    expect(encodeAgentSplitParams({}).proposal).toBe('1');
  });

  it("keeps the proposal's own category, chosen, whatever the description says", () => {
    expect(agentHandoffCategory('shopping', 'Dinner at Saravana', guess)).toEqual({
      category: 'shopping',
      chosen: true,
    });
  });

  it('settles the arrival guess when the proposal named no category', () => {
    // Chosen: retyping "Dinner" as "Cab home" afterwards must not move it.
    expect(agentHandoffCategory(undefined, 'Dinner at Saravana', guess)).toEqual({
      category: 'food',
      chosen: true,
    });
    expect(agentHandoffCategory('', 'something odd', guess)).toEqual({
      category: null,
      chosen: true,
    });
  });

  it("carries the proposal's date, and only a real one", () => {
    expect(agentHandoffDate('2026-10-05')).toBe('2026-10-05');
    expect(agentHandoffDate(undefined)).toBeNull();
    expect(agentHandoffDate('yesterday')).toBeNull();
  });
});
