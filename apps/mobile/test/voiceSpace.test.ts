import { describe, expect, it } from 'vitest';

import {
  addVoice,
  dropVoice,
  EMPTY_VOICE_ADDED,
  markSeen,
  newVoiceIds,
} from '../src/lib/voiceAdded';
import {
  canAddInto,
  canMoveInto,
  copyStep,
  mapMove,
  mayRemoveOriginal,
  moveTargets,
  planMove,
  resolveVoiceSpace,
} from '../src/lib/voiceSpace';

describe('resolveVoiceSpace', () => {
  const members = new Set(['a', 'b']);
  it('launch group beats the default', () => {
    expect(resolveVoiceSpace({ launchId: 'a', defaultId: 'b', memberIds: members })).toBe('a');
  });
  it('uses the default when there is no launch group', () => {
    expect(resolveVoiceSpace({ launchId: null, defaultId: 'b', memberIds: members })).toBe('b');
  });
  it('ignores a default the viewer left, or one not yet loaded', () => {
    expect(resolveVoiceSpace({ launchId: null, defaultId: 'z', memberIds: members })).toBeNull();
    expect(resolveVoiceSpace({ launchId: null, defaultId: 'b', memberIds: null })).toBeNull();
  });
});

describe('moveTargets / mapMove', () => {
  it('lists other open spaces only', () => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c', archived_at: 'x' }];
    expect(moveTargets(rows, 'a').map((r) => r.id)).toEqual(['b']);
  });
  const src = { amount: 1250n, currency: 'INR', date: '2026-11-01', note: 'tea', category: null };
  it('keeps amount, date and note; a company entry always has a category', () => {
    expect(mapMove(src, { type: 'company' })).toMatchObject({
      kind: 'company',
      amount: 1250n,
      date: '2026-11-01',
      note: 'tea',
      category: 'other',
    });
    expect(mapMove(src, { type: 'trip' })).toMatchObject({ kind: 'group', category: null });
  });
});

describe('canMoveInto', () => {
  const group = { id: 'g', type: 'trip', default_currency: 'INR' };
  const company = { id: 'c', type: 'company', default_currency: 'INR' };
  it('needs an active, non-vendor membership', () => {
    expect(canMoveInto(group, 'member', 'INR')).toBe(true);
    expect(canMoveInto(group, null, 'INR')).toBe(false);
    expect(canMoveInto(company, 'vendor', 'INR')).toBe(false);
  });
  it('refuses archived, suspended and demo spaces', () => {
    expect(canMoveInto({ ...group, archived_at: 'x' }, 'admin', 'INR')).toBe(false);
    expect(canMoveInto({ ...company, suspended_at: 'x' }, 'admin', 'INR')).toBe(false);
    expect(canMoveInto({ ...group, isDemo: true }, 'admin', 'INR')).toBe(false);
  });
  it('needs the same currency where a rate would be needed', () => {
    expect(canMoveInto(company, 'member', 'USD')).toBe(false);
    expect(canMoveInto({ ...group, convert_to_group_currency: true }, 'member', 'USD')).toBe(false);
    expect(canMoveInto(group, 'member', 'USD')).toBe(true);
  });
});

describe('new voice count', () => {
  it('counts unseen entries, clears on open, ignores other spaces and gone ones', () => {
    let s = addVoice(EMPTY_VOICE_ADDED, 'g1', ['e1', 'e2'], 100);
    s = addVoice(s, 'g2', ['e3'], 110);
    expect(newVoiceIds(s, 'g1')).toEqual(['e1', 'e2']);
    expect(newVoiceIds(s, 'g1', new Set(['e1']))).toEqual(['e1']);
    s = markSeen(s, 'g1', 120);
    expect(newVoiceIds(s, 'g1')).toEqual([]);
    expect(newVoiceIds(s, 'g2')).toEqual(['e3']);
    s = addVoice(s, 'g1', ['e4'], 130);
    expect(newVoiceIds(s, 'g1')).toEqual(['e4']);
    expect(newVoiceIds(dropVoice(s, 'e4'), 'g1')).toEqual([]);
  });
});

describe('blocker rules', () => {
  const members = [
    { id: 'm1', profile_id: 'p1' },
    { id: 'm2', profile_id: 'p2' },
    { id: 'm3', profile_id: null },
  ];
  const base = {
    splitKind: 'equal',
    payerProfileIds: ['p1'],
    participantProfileIds: ['p1', 'p2'],
    photoCount: 0,
  };
  it('1 and 4: removes the original only when the copy landed; a retry resumes', () => {
    expect(mayRemoveOriginal(false)).toBe(false);
    expect(mayRemoveOriginal(true)).toBe(true);
    expect(copyStep({ landed: true, queuedId: null })).toBe('resume');
    expect(copyStep({ landed: false, queuedId: 'q' })).toBe('wait');
    expect(copyStep({ landed: false, queuedId: null })).toBe('create');
  });
  it('2: a split expense keeps one bill, a company entry keeps them all', () => {
    expect(planMove({ ...base, photoCount: 2 }, { type: 'trip' }, members, 'p1')).toBeNull();
    const solo = { ...base, participantProfileIds: ['p1'], photoCount: 3 };
    expect(planMove(solo, { type: 'company' }, members, 'p1')).toEqual({
      payerId: 'm1',
      participantIds: ['m1'],
    });
  });
  it('3: carries the same people when all exist there, else offers nothing', () => {
    expect(planMove(base, { type: 'trip' }, members, 'p1')).toEqual({
      payerId: 'm1',
      participantIds: ['m1', 'm2'],
    });
    expect(planMove(base, { type: 'trip' }, members.slice(0, 1), 'p1')).toBeNull();
    expect(planMove({ ...base, splitKind: 'exact' }, { type: 'trip' }, members, 'p1')).toBeNull();
    expect(
      planMove({ ...base, participantProfileIds: ['p1', null] }, { type: 'trip' }, members, 'p1'),
    ).toBeNull();
    expect(planMove(base, { type: 'company' }, members, 'p1')).toBeNull();
  });
  it('5: a default must pass the can-add check', () => {
    const company = { id: 'c', type: 'company' };
    expect(canAddInto(company, 'member')).toBe(true);
    expect(canAddInto(company, 'vendor')).toBe(false);
    expect(canAddInto({ ...company, slot_lapsed_at: 'x' }, 'admin')).toBe(false);
    expect(canAddInto({ ...company, isDemo: true }, 'admin')).toBe(false);
    expect(canAddInto(company, null)).toBe(false);
    // a default that fails is not in the addable set, so the launch/none path stands
    expect(
      resolveVoiceSpace({ launchId: null, defaultId: 'c', memberIds: new Set(['g']) }),
    ).toBeNull();
  });
});
