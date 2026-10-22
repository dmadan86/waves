/**
 * Units (family) split tests for the voice-agent gate (logic.ts).
 *
 * Covers:
 *  - buildContext maps groups.units to families in ContextGroup
 *  - contextText renders a families line
 *  - parseToolCalls accepts a units split for a group with families
 *  - parseToolCalls rejects a units split for a group without families
 *  - parseToolCalls rejects unknown member ids in a units split
 */

import { describe, expect, it } from 'vitest';

import { buildContext, contextText, parseToolCalls, type VoiceContext } from './logic.ts';

const ME = 'profile-me';

/** A group with two families: Sharma (m-raj solo) and Patel (m-sara, m-kiran). */
function contextWithFamilies(): VoiceContext {
  return buildContext({
    groups: [
      {
        id: 'g-home',
        name: 'Home',
        type: 'home',
        default_currency: 'INR',
        units: {
          'unit-sharma': { name: 'Sharma', members: ['m-raj'] },
          'unit-patel': { name: 'Patel', members: ['m-sara', 'm-kiran'] },
        },
      },
    ],
    members: [
      {
        id: 'm-me',
        group_id: 'g-home',
        profile_id: ME,
        ghost_name: null,
        profile: { display_name: 'Priya' },
      },
      {
        id: 'm-raj',
        group_id: 'g-home',
        profile_id: 'p-raj',
        ghost_name: null,
        profile: { display_name: 'Raj' },
      },
      {
        id: 'm-sara',
        group_id: 'g-home',
        profile_id: 'p-sara',
        ghost_name: null,
        profile: { display_name: 'Sara' },
      },
      {
        id: 'm-kiran',
        group_id: 'g-home',
        profile_id: 'p-kiran',
        ghost_name: null,
        profile: { display_name: 'Kiran' },
      },
    ],
    balances: [],
    meProfileId: ME,
    currentGroupId: 'g-home',
    today: '2026-10-07',
  });
}

function contextWithoutFamilies(): VoiceContext {
  return buildContext({
    groups: [{ id: 'g-home', name: 'Home', type: 'home', default_currency: 'INR' }],
    members: [
      {
        id: 'm-me',
        group_id: 'g-home',
        profile_id: ME,
        ghost_name: null,
        profile: { display_name: 'Priya' },
      },
      {
        id: 'm-raj',
        group_id: 'g-home',
        profile_id: 'p-raj',
        ghost_name: null,
        profile: { display_name: 'Raj' },
      },
    ],
    balances: [],
    meProfileId: ME,
    currentGroupId: 'g-home',
    today: '2026-10-07',
  });
}

const call = (name: string, input: unknown) => [{ name, input }];

const expenseBase = (split: unknown) => ({
  groupId: 'g-home',
  description: 'Dinner',
  amountMinor: '100000',
  currency: 'INR',
  paidByMemberId: 'm-me',
  split,
});

describe('buildContext — units field', () => {
  it('maps groups.units to families in ContextGroup', () => {
    const ctx = contextWithFamilies();
    const group = ctx.groups[0];
    expect(group?.families).toBeDefined();
    expect(group?.families?.['unit-sharma']).toMatchObject({
      name: 'Sharma',
      memberIds: ['m-raj'],
    });
    expect(group?.families?.['unit-patel']).toMatchObject({
      name: 'Patel',
      memberIds: expect.arrayContaining(['m-sara', 'm-kiran']),
    });
  });

  it('leaves families absent when groups.units is null/undefined', () => {
    const ctx = contextWithoutFamilies();
    expect(ctx.groups[0]?.families).toBeUndefined();
  });

  it('filters out family members not in the group', () => {
    const ctx = buildContext({
      groups: [
        {
          id: 'g-x',
          name: 'X',
          type: 'other',
          default_currency: 'INR',
          units: {
            'unit-a': { name: 'Alpha', members: ['m-in-group', 'ghost-not-here'] },
          },
        },
      ],
      members: [
        {
          id: 'm-in-group',
          group_id: 'g-x',
          profile_id: ME,
          ghost_name: null,
          profile: { display_name: 'Ina' },
        },
      ],
      balances: [],
      meProfileId: ME,
      today: '2026-10-07',
    });
    // ghost-not-here is not in the group, so it should be filtered.
    expect(ctx.groups[0]?.families?.['unit-a']?.memberIds).toEqual(['m-in-group']);
  });
});

describe('contextText — families line', () => {
  it('renders a families line when the group has units', () => {
    const text = contextText(contextWithFamilies());
    expect(text).toContain('families (unitId "name" [memberIds])');
    expect(text).toContain('unit-sharma "Sharma" [m-raj]');
    expect(text).toContain('unit-patel "Patel"');
  });

  it('does not render a families line when the group has no units', () => {
    const text = contextText(contextWithoutFamilies());
    expect(text).not.toContain('families');
  });
});

describe('parseToolCalls — units split validation', () => {
  it('accepts a valid units split (all members listed, group has families)', () => {
    const ctx = contextWithFamilies();
    const result = parseToolCalls(
      call(
        'add_expense',
        expenseBase({
          mode: 'units',
          shares: [
            { memberId: 'm-me' },
            { memberId: 'm-raj' },
            { memberId: 'm-sara' },
            { memberId: 'm-kiran' },
          ],
        }),
      ),
      ctx,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const action = result.actions[0];
      expect(action?.type).toBe('add_expense');
      if (action?.type === 'add_expense') {
        expect(action.split.mode).toBe('units');
        // The normalised shares list all participating member ids.
        const memberIds = action.split.shares.map((s) => s.memberId);
        expect(memberIds).toContain('m-raj');
        expect(memberIds).toContain('m-sara');
        expect(memberIds).toContain('m-kiran');
        expect(memberIds).toContain('m-me');
      }
    }
  });

  it('rejects a units split when the group has no families', () => {
    const ctx = contextWithoutFamilies();
    const result = parseToolCalls(
      call(
        'add_expense',
        expenseBase({
          mode: 'units',
          shares: [{ memberId: 'm-me' }, { memberId: 'm-raj' }],
        }),
      ),
      ctx,
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a units split with an unknown member id', () => {
    const ctx = contextWithFamilies();
    const result = parseToolCalls(
      call(
        'add_expense',
        expenseBase({
          mode: 'units',
          shares: [{ memberId: 'm-ghost' }],
        }),
      ),
      ctx,
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a units split with no participants', () => {
    const ctx = contextWithFamilies();
    const result = parseToolCalls(
      call(
        'add_expense',
        expenseBase({
          mode: 'units',
          shares: [],
        }),
      ),
      ctx,
    );
    expect(result.ok).toBe(false);
  });

  it('accepts unitIds to restrict the split to specific families', () => {
    const ctx = contextWithFamilies();
    const result = parseToolCalls(
      call(
        'add_expense',
        expenseBase({
          mode: 'units',
          shares: [{ memberId: 'm-raj' }, { memberId: 'm-me' }],
          unitIds: ['unit-sharma'],
        }),
      ),
      ctx,
    );
    expect(result.ok).toBe(true);
  });

  it('rejects a duplicate member in units shares', () => {
    const ctx = contextWithFamilies();
    const result = parseToolCalls(
      call(
        'add_expense',
        expenseBase({
          mode: 'units',
          shares: [{ memberId: 'm-raj' }, { memberId: 'm-raj' }],
        }),
      ),
      ctx,
    );
    expect(result.ok).toBe(false);
  });
});
