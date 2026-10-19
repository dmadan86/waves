import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PREFS,
  NEW_SESSION,
  advanceSession,
  isMuted,
  learningFor,
  markWrapUpShown,
  muteKind,
  parsePrefs,
  recordAnswer,
  recordSkip,
  resetMuted,
  type FollowUpPrefs,
} from '../src/voice/followUps';

const learned = (yes: number, no: number): FollowUpPrefs => ({
  ...DEFAULT_PREFS,
  learned: { 'split|food': { yes, no } },
});

describe('follow-up learning and stored preferences', () => {
  it('LR-SKIP-01 skips learn no and mute at the per-kind threshold', () => {
    let prefs = DEFAULT_PREFS;
    for (let n = 1; n <= 3; n++) {
      prefs = recordSkip(prefs, 'split', 'food');
      expect(prefs.skips.split).toBe(n);
      expect(prefs.learned['split|food']).toEqual({ yes: 0, no: n });
      expect(isMuted(prefs, 'split')).toBe(n === 3);
    }
    expect(prefs.muted).toEqual(['split']);
    const work = recordSkip(DEFAULT_PREFS, 'work', 'travel');
    expect(work.muted).toEqual(['work']);
    expect(work.learned['work|travel']).toEqual({ yes: 0, no: 1 });
  });
  it('LR-SKIP-02 answers delete skips and learn yes', () => {
    const prefs = recordAnswer(recordSkip(DEFAULT_PREFS, 'split', 'food'), 'split', 'food');
    expect(prefs.skips).not.toHaveProperty('split');
    expect(prefs.learned['split|food']).toEqual({ yes: 1, no: 1 });
  });
  it('LR-LEARN-01 three unanswered nos block; answers permit a bounded penalty', () => {
    expect(learningFor(learned(0, 3), 'split', 'food')).toEqual({ blocked: true, delta: -100 });
    expect(learningFor(learned(1, 3), 'split', 'food')).toEqual({ blocked: false, delta: -18 });
    expect(learningFor(learned(1, 40), 'split', 'food')).toEqual({ blocked: false, delta: -30 });
  });
  it('LR-LEARN-02 forty-one answers store only forty', () => {
    let prefs = DEFAULT_PREFS;
    for (let i = 0; i < 41; i++) prefs = recordAnswer(prefs, 'split', 'food');
    expect(prefs.learned['split|food']).toEqual({ yes: 40, no: 0 });
  });
  it('LR-LEARN-03 positive score delta caps at twelve', () => {
    expect(learningFor(learned(5, 0), 'split', 'food')).toEqual({ blocked: false, delta: 12 });
  });
  it('LR-LEARN-04 learning stays within its category', () => {
    expect(learningFor(learned(0, 3), 'split', 'food').blocked).toBe(true);
    expect(learningFor(learned(0, 3), 'split', 'travel')).toEqual({ blocked: false, delta: 0 });
  });
  it('LR-LEARN-05 null category uses the dash key', () => {
    const prefs = recordAnswer(DEFAULT_PREFS, 'place', null);
    expect(prefs.learned).toEqual({ 'place|-': { yes: 1, no: 0 } });
    expect(learningFor(prefs, 'place', null)).toEqual({ blocked: false, delta: 6 });
  });
  it('LR-MUTE-01 muting twice is idempotent', () => {
    const prefs = muteKind(DEFAULT_PREFS, 'place');
    expect(prefs.muted).toEqual(['place']);
    expect(muteKind(prefs, 'place')).toBe(prefs);
  });
  it('LR-MUTE-02 reset keeps enabled and shown groups only', () => {
    const prefs = {
      ...recordSkip(DEFAULT_PREFS, 'work', 'travel'),
      enabled: false,
      wrapUpShown: ['g-goa'],
    };
    expect(resetMuted(prefs)).toEqual({ ...DEFAULT_PREFS, enabled: false, wrapUpShown: ['g-goa'] });
  });
  it('LR-WRAP-01 shown groups dedupe and retain the newest hundred', () => {
    let prefs = DEFAULT_PREFS;
    for (let i = 0; i < 101; i++) prefs = markWrapUpShown(prefs, `g-${i}`);
    expect(prefs.wrapUpShown).toEqual(Array.from({ length: 100 }, (_, i) => `g-${i + 1}`));
    expect(markWrapUpShown(prefs, 'g-100')).toBe(prefs);
  });
  it('LR-SESS-01 outcomes reset or increment skips, stop and dedupe asked kinds', () => {
    const skipped = advanceSession(NEW_SESSION, 'place', 'skipped');
    expect(skipped).toEqual({ asked: ['place'], consecutiveSkips: 1, stopped: false });
    expect(advanceSession(skipped, 'place', 'answered')).toEqual({
      asked: ['place'],
      consecutiveSkips: 0,
      stopped: false,
    });
    expect(advanceSession(skipped, 'receipt', 'dismissed')).toEqual({
      asked: ['place', 'receipt'],
      consecutiveSkips: 2,
      stopped: true,
    });
    expect(advanceSession(skipped, 'place', 'done')).toEqual({
      asked: ['place'],
      consecutiveSkips: 1,
      stopped: true,
    });
  });
  it('LR-PREF-01 null reads defaults', () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
  });
  it('LR-PREF-02 malformed JSON reads defaults', () => {
    expect(parsePrefs('{broken')).toEqual(DEFAULT_PREFS);
  });
  it('LR-PREF-03 unknown muted kinds are dropped', () => {
    expect(parsePrefs(JSON.stringify({ muted: ['bogus', 'place', 'place'] })).muted).toEqual([
      'place',
    ]);
  });
  it('LR-PREF-04 invalid skip counts are dropped and floats floored', () => {
    // NaN is not JSON: an overflowing JSON number exercises the finite-number guard too.
    expect(parsePrefs('{"skips":{"place":-1,"split":2.9,"work":1e999,"date":null}}').skips).toEqual(
      { split: 2 },
    );
    expect(parsePrefs(JSON.stringify({ skips: { place: NaN } })).skips).toEqual({});
  });
  it('LR-PREF-05 negative learned yes is dropped', () => {
    expect(
      parsePrefs(JSON.stringify({ learned: { 'split|food': { yes: -1, no: 3 } } })).learned,
    ).toEqual({});
  });
  it('LR-PREF-06 enabled defaults true and preserves false', () => {
    expect(parsePrefs('{}').enabled).toBe(true);
    expect(parsePrefs('{"enabled":false}').enabled).toBe(false);
  });
  it('LR-PREF-07 shown groups filter non-strings before keeping the last hundred', () => {
    const groups = Array.from({ length: 102 }, (_, i) => `g-${i}`);
    expect(
      parsePrefs(JSON.stringify({ wrapUpShown: [null, ...groups, 7, false] })).wrapUpShown,
    ).toEqual(groups.slice(-100));
  });
  it('LR-PREF-08 learned keys with unknown kinds are dropped', () => {
    expect(
      parsePrefs(
        JSON.stringify({
          learned: { 'unknown|food': { yes: 1, no: 0 }, 'split|food': { yes: 2, no: 1 } },
        }),
      ).learned,
    ).toEqual({ 'split|food': { yes: 2, no: 1 } });
  });
  it('LR-PREF-09 unknown top-level preference keys round-trip', () => {
    const prefs = { ...DEFAULT_PREFS, futurePreference: { mode: 'quiet', versions: [1, 2] } };
    // BUG?: parsePrefs drops unknown top-level keys; FollowUpPrefs has no passthrough field.
    expect(parsePrefs(JSON.stringify(prefs))).toEqual(prefs);
  });
  it('LR-PREF-10 valid populated preferences round-trip', () => {
    const prefs = markWrapUpShown(
      muteKind(recordAnswer(recordSkip(DEFAULT_PREFS, 'split', 'food'), 'place', null), 'receipt'),
      'g-goa',
    );
    expect(parsePrefs(JSON.stringify(prefs))).toEqual(prefs);
  });
});
