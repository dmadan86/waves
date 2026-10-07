import { describe, expect, it } from 'vitest';

import { decodeAgentSplitParams, encodeAgentSplitParams } from '../src/lib/voiceAgentHandoff';
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
