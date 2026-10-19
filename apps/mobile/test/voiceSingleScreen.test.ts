/**
 * The voice flow happens on one screen: no route push or replace from the
 * capture, the review, the agent cards or the confirmation card; a save lands on
 * a success state with Add another and Done; and Edit is inline (the split
 * sheet's conversions and the confirmation's split override are pure and
 * tested here).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { AgentLocalData } from '@/lib/voiceAgentPlan';
import { initialFields, resolveConfirm, type AddExpenseAction } from '@/lib/voiceConfirmPure';
import { voiceFlowState, voiceStatusKey } from '@/lib/voiceFlowPure';
import { SplitKind } from '@/lib/split';
import { agentSplitFrom, splitEditFromAgent, splitEditFromParams } from '@/lib/voiceSplitPure';

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));

const src = (path: string): string => readFileSync(join(__dirname, '../src', path), 'utf8');

describe('one screen, start to saved', () => {
  const files = {
    voice: src('app/voice.tsx'),
    panel: src('components/VoiceAgentPanel.tsx'),
    confirm: src('components/VoiceConfirmCard.tsx'),
    capture: src('components/VoiceCapture.tsx'),
  };

  it('SS-01: no route push or replace anywhere in the voice flow', () => {
    for (const [name, text] of Object.entries(files)) {
      expect(text, name).not.toMatch(/router\.(push|replace|navigate)\(/);
      expect(text, name).not.toContain("pathname: '/group/[id]");
      expect(text, name).not.toContain("pathname: '/personal/entry'");
    }
  });

  it('SS-02: leaving is only ever back to where the reader came from', () => {
    const backs = files.voice.match(/router\.back\(\)/g) ?? [];
    // Done, the ✕ (dismiss) and the push-to-talk slide-away.
    expect(backs.length).toBe(3);
    expect(files.voice).toContain('const finishVoice = (): void => {\n    router.back();');
  });

  it('SS-03: a save lands on the success state with Add another and Done', () => {
    expect(files.voice).toContain("setPhase('saved')");
    expect(files.voice).toContain('label={t.voiceScreen.addAnother}');
    expect(files.voice).toContain('onPress={finishVoice}');
    expect(files.voice).toContain('<VoiceFollowUps');
    expect(files.panel).toContain('onAddAnother');
  });

  it('SS-04: Edit on an agent card opens the confirmation card in place', () => {
    expect(files.panel).toContain('const edit = (): void => setEditing(true);');
    expect(files.confirm).toContain('<VoiceSplitSheet');
  });

  it('SS-05: the saved phase is the success state', () => {
    expect(voiceFlowState({ phase: 'saved' })).toBe('success');
    expect(voiceStatusKey('success', { phase: 'saved' })).toBe('saved');
  });
});

describe('split sheet conversions', () => {
  it('SS-06: an equal agent split seeds the sheet with its people and no figures', () => {
    const edit = splitEditFromAgent(
      'm1',
      { mode: 'equal', shares: [{ memberId: 'm1' }, { memberId: 'm2' }] },
      'INR',
    );
    expect(edit).toEqual({
      payerId: 'm1',
      kind: SplitKind.Equal,
      participants: ['m1', 'm2'],
      entries: {},
    });
  });

  it('SS-07: an exact agent split reads its minor units as money', () => {
    const edit = splitEditFromAgent(
      'm2',
      {
        mode: 'exact',
        shares: [
          { memberId: 'm1', value: '30000' },
          { memberId: 'm2', value: '70000' },
        ],
      },
      'INR',
    );
    expect(edit.kind).toBe(SplitKind.Exact);
    expect(edit.entries).toEqual({ m1: '300.00', m2: '700.00' });
  });

  it('SS-08: core params round-trip to the agent shape for every kind', () => {
    const people = ['a', 'b'];
    expect(agentSplitFrom({ kind: 'equal' }, people)).toEqual({
      mode: 'equal',
      shares: [{ memberId: 'a' }, { memberId: 'b' }],
    });
    expect(agentSplitFrom({ kind: 'exact', amounts: { a: 300n, b: 700n } }, people).shares).toEqual(
      [
        { memberId: 'a', value: '300' },
        { memberId: 'b', value: '700' },
      ],
    );
    expect(
      agentSplitFrom({ kind: 'percent', basisPoints: { a: 3333, b: 6667 } }, people).shares,
    ).toEqual([
      { memberId: 'a', value: '33.33' },
      { memberId: 'b', value: '66.67' },
    ]);
    expect(agentSplitFrom({ kind: 'shares', weights: { a: 1, b: 2 } }, people).mode).toBe('shares');
  });

  it('SS-09: the basic review plan seeds the sheet in the editor’s own entries', () => {
    expect(
      splitEditFromParams(
        'a',
        { kind: 'percent', basisPoints: { a: 2500, b: 7500 } },
        ['a', 'b'],
        'INR',
      ),
    ).toEqual({
      payerId: 'a',
      kind: SplitKind.Percent,
      participants: ['a', 'b'],
      entries: { a: '25', b: '75' },
    });
    expect(
      splitEditFromParams('a', { kind: 'exact', amounts: { a: 12345n, b: 0n } }, ['a', 'b'], 'INR')
        .entries.a,
    ).toBe('123.45');
  });
});

describe('confirmation split override', () => {
  const local: AgentLocalData = {
    groups: [
      {
        id: 'g1',
        name: 'Vietnam',
        currency: 'INR',
        members: [
          { id: 'm1', name: 'Madan', isViewer: true },
          { id: 'm2', name: 'Renny', isViewer: false },
        ],
      },
      {
        id: 'g2',
        name: 'Goa',
        currency: 'INR',
        members: [{ id: 'n1', name: 'Madan', isViewer: true }],
      },
    ],
  } as AgentLocalData;
  const action: AddExpenseAction = {
    type: 'add_expense',
    groupId: 'g1',
    amountMinor: '100000',
    currency: 'INR',
    description: 'Dinner',
    paidByMemberId: 'm1',
    split: { mode: 'equal', shares: [{ memberId: 'm1' }, { memberId: 'm2' }] },
  };
  const initial = initialFields(action, local, 'You');
  const exact = {
    groupId: 'g1',
    amountMinor: '100000',
    paidByMemberId: 'm2',
    split: {
      mode: 'exact' as const,
      shares: [
        { memberId: 'm1', value: '30000' },
        { memberId: 'm2', value: '70000' },
      ],
    },
  };

  it('SS-10: the sheet’s payer and split are what Confirm writes', () => {
    const result = resolveConfirm(action, initial, initial, local, 'You', 'x', exact);
    expect(result.ok && result.action.type === 'add_expense' && result.action.paidByMemberId).toBe(
      'm2',
    );
    expect(result.ok && result.action.type === 'add_expense' && result.action.split).toEqual(
      exact.split,
    );
  });

  it('SS-11: a new amount after an exact split falls back to equal over the same people', () => {
    const result = resolveConfirm(
      action,
      initial,
      { ...initial, amountText: '1200' },
      local,
      'You',
      'x',
      exact,
    );
    expect(result.ok && result.action.type === 'add_expense' && result.action.split).toEqual({
      mode: 'equal',
      shares: [{ memberId: 'm1' }, { memberId: 'm2' }],
    });
  });

  it('SS-12: an override set for another group is ignored', () => {
    const result = resolveConfirm(
      action,
      initial,
      { ...initial, groupId: 'g2', personText: '' },
      local,
      'You',
      'x',
      exact,
    );
    expect(result.ok && result.action.type === 'add_expense' && result.action.paidByMemberId).toBe(
      'n1',
    );
  });
});
