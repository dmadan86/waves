/**
 * Table-driven tests for Phase 3: "split by family" voice parsing.
 *
 * Covers:
 *  - all English family-split phrases
 *  - simple Hindi/Tamil equivalents the parser handles
 *  - families with 1, 2 and 3 members
 *  - no-families fallback (equal)
 *  - family name colliding with a person name (person wins on exact id match)
 *  - named families ("Sharma family and Patel family")
 *  - buildVoiceSplit with families → UnitsParams
 */

import { describe, expect, it } from 'vitest';

import { buildVoiceSplit, parseVoiceIntent, type VoiceIntentContext } from '../src/voice/index.js';
import type { GroupUnits } from '../src/group/units.js';

// ── cast ────────────────────────────────────────────────────────────────────

const MEMBERS = [
  { id: 'm-priya', name: 'Priya', isMe: true },
  { id: 'm-raj', name: 'Raj' },
  { id: 'm-sara', name: 'Sara' },
  { id: 'm-kiran', name: 'Kiran' },
  { id: 'm-anand', name: 'Anand' },
  { id: 'm-meena', name: 'Meena' },
];

/**
 * Two families:
 *   Sharma: Raj (1 member)
 *   Patel:  Sara, Kiran, Anand (3 members)
 * Meena is in no family.
 */
const FAMILIES: GroupUnits = {
  'unit-sharma': { name: 'Sharma', members: ['m-raj'], head: 'm-raj' },
  'unit-patel': { name: 'Patel', members: ['m-sara', 'm-kiran', 'm-anand'] },
};

const NOW = new Date(2026, 9, 5, 12, 0, 0);

const CTX_WITH_FAMILIES: VoiceIntentContext = {
  members: MEMBERS,
  now: NOW,
  families: FAMILIES,
};

const CTX_NO_FAMILIES: VoiceIntentContext = {
  members: MEMBERS,
  now: NOW,
  families: null,
};

const ALL_MEMBER_IDS = MEMBERS.map((m) => m.id);

// ── helpers ─────────────────────────────────────────────────────────────────

function parse(say: string, ctx: VoiceIntentContext = CTX_WITH_FAMILIES) {
  return parseVoiceIntent(say, ctx);
}

function plan(say: string, ctx: VoiceIntentContext = CTX_WITH_FAMILIES, amountMinor = 120000n) {
  const intent = parse(say, ctx);
  return buildVoiceSplit(intent, {
    memberIds: ALL_MEMBER_IDS,
    meMemberId: 'm-priya',
    amountMinor,
    families: FAMILIES,
    members: MEMBERS,
  });
}

function planNoFamilies(say: string, amountMinor = 60000n) {
  const intent = parse(say, CTX_NO_FAMILIES);
  return buildVoiceSplit(intent, {
    memberIds: ALL_MEMBER_IDS,
    meMemberId: 'm-priya',
    amountMinor,
    families: null,
  });
}

// ── intent parsing: phrase detection ────────────────────────────────────────

describe('parseVoiceIntent — family split phrase detection', () => {
  const phrases = [
    'i paid 600 split by family',
    'i paid 600 per family',
    'i paid 600 family wise',
    'i paid 600 between the families',
    'i paid 600 among families',
    'i paid 600 split between families',
  ];

  for (const say of phrases) {
    it(`detects units mode: "${say}"`, () => {
      const intent = parse(say);
      expect(intent.splitMode).toBe('units');
    });
  }

  it('detects units mode: "i paid 600 parivaar ke hisab se" (Hindi)', () => {
    expect(parse('i paid 600 parivaar ke hisab se').splitMode).toBe('units');
  });

  it('detects units mode: "i paid 600 kudumba vaari" (Tamil)', () => {
    expect(parse('i paid 600 kudumba vaari').splitMode).toBe('units');
  });

  it('detects units mode: "i paid 600 kudumba vaariyaaga" (Tamil long form)', () => {
    expect(parse('i paid 600 kudumba vaariyaaga').splitMode).toBe('units');
  });

  it('falls back to equal and adds note when group has no families', () => {
    const intent = parse('i paid 600 split by family', CTX_NO_FAMILIES);
    expect(intent.splitMode).toBe('equal');
    expect(intent.notes).toContain('no_families_fallback');
  });
});

// ── intent parsing: specific family names ───────────────────────────────────

describe('parseVoiceIntent — named families', () => {
  it('picks up "Sharma family and Patel family" and sets units mode', () => {
    const intent = parse('i paid 600 split between Sharma family and Patel family');
    expect(intent.splitMode).toBe('units');
    expect(intent.familyNames).toEqual(['sharma', 'patel']);
  });

  it('picks up a single named family', () => {
    const intent = parse('i paid 600 Patel family');
    expect(intent.splitMode).toBe('units');
    expect(intent.familyNames).toEqual(['patel']);
  });
});

// ── buildVoiceSplit: UnitsParams construction ────────────────────────────────

describe('buildVoiceSplit — units split with families', () => {
  it('produces UnitsParams with all members when no family is named', () => {
    const result = plan('i paid 600 split by family');
    expect(result.params.kind).toBe('units');
    if (result.params.kind !== 'units') return;
    // Sharma family: [m-raj], Patel: [m-sara, m-kiran, m-anand], Meena: solo
    // All 6 members are participants (payer + all others).
    expect(result.problems).toEqual([]);
    const units = result.params.units;
    expect(units['unit-sharma']).toEqual(['m-raj']);
    expect([...(units['unit-patel'] ?? [])].sort()).toEqual(['m-anand', 'm-kiran', 'm-sara']);
    // Meena and Priya (payer/me) are units of one keyed by memberId.
    expect(units['m-meena']).toEqual(['m-meena']);
    expect(units['m-priya']).toEqual(['m-priya']);
  });

  it('Sharma family has only 1 member — still a unit of one in units[]', () => {
    const result = plan('i paid 600 per family');
    expect(result.params.kind).toBe('units');
    if (result.params.kind !== 'units') return;
    expect(result.params.units['unit-sharma']).toEqual(['m-raj']);
  });

  it('Patel family has 3 members — they share one split unit', () => {
    const result = plan('i paid 600 family wise');
    expect(result.params.kind).toBe('units');
    if (result.params.kind !== 'units') return;
    expect(result.params.units['unit-patel']).toHaveLength(3);
  });

  it('falls back to equal split when group has no families', () => {
    const result = planNoFamilies('i paid 600 split by family');
    expect(result.params.kind).toBe('equal');
    expect(result.problems).toEqual([]);
  });

  it('named families: only Sharma family → units only include that family', () => {
    const intent = parse('i paid 600 Sharma family');
    // buildVoiceSplit with named families expands only Sharma members.
    const result = buildVoiceSplit(intent, {
      memberIds: ALL_MEMBER_IDS,
      meMemberId: 'm-priya',
      amountMinor: 60000n,
      families: FAMILIES,
    });
    expect(result.params.kind).toBe('units');
    if (result.params.kind !== 'units') return;
    // Sharma (m-raj) + payer (m-priya, added automatically) are participants.
    const unitKeys = Object.keys(result.params.units);
    expect(unitKeys).toContain('unit-sharma');
    // Patel should not be present.
    expect(unitKeys).not.toContain('unit-patel');
  });

  it('person name wins over family name when ids match (person has priority)', () => {
    /**
     * Families: { 'unit-meena': { name: 'Meena', members: ['m-sara'] } }
     * Members include m-meena (name: 'Meena').
     * "Meena family" → because m-meena is a real member whose display name
     * is 'Meena', the person match takes priority over the family expansion.
     * m-meena is added as a solo participant; unit-meena (containing m-sara)
     * is NOT expanded.
     */
    const familiesWithNameCollision: GroupUnits = {
      'unit-meena': { name: 'Meena', members: ['m-sara'] },
    };
    const ctxCollision: VoiceIntentContext = {
      members: MEMBERS,
      now: NOW,
      families: familiesWithNameCollision,
    };
    const intent = parse('i paid 600 Meena family', ctxCollision);
    expect(intent.splitMode).toBe('units');
    // buildVoiceSplit: "meena" matches member m-meena by display name →
    // person wins, m-meena is a solo participant; unit-meena is NOT expanded.
    const result = buildVoiceSplit(intent, {
      memberIds: ALL_MEMBER_IDS,
      meMemberId: 'm-priya',
      amountMinor: 60000n,
      families: familiesWithNameCollision,
      members: MEMBERS,
    });
    expect(result.params.kind).toBe('units');
    if (result.params.kind !== 'units') return;
    // m-meena should be a solo unit (person reference wins).
    expect(result.participants).toContain('m-meena');
    // The family unit 'unit-meena' (which contains m-sara) must NOT appear.
    expect(result.params.units['unit-meena']).toBeUndefined();
    // m-sara should NOT be in participants — the family was not expanded.
    expect(result.participants).not.toContain('m-sara');
  });
});

// ── buildVoiceSplit: participant expansion with families ─────────────────────

describe('buildVoiceSplit — family participant expansion', () => {
  it('all families → all members are participants', () => {
    const result = plan('i paid 600 between the families');
    expect(result.problems).toEqual([]);
    // All 6 members should be in participants.
    expect([...result.participants].sort()).toEqual([...ALL_MEMBER_IDS].sort());
  });

  it('two named families include their respective members', () => {
    const intent = parse('i paid 600 split between Sharma family and Patel family');
    const result = buildVoiceSplit(intent, {
      memberIds: ALL_MEMBER_IDS,
      meMemberId: 'm-priya',
      amountMinor: 120000n,
      families: FAMILIES,
    });
    expect(result.params.kind).toBe('units');
    if (result.params.kind !== 'units') return;
    // Sharma: m-raj; Patel: m-sara, m-kiran, m-anand; payer m-priya added.
    const participantsInUnits = Object.values(result.params.units).flat();
    expect(participantsInUnits).toContain('m-raj');
    expect(participantsInUnits).toContain('m-sara');
    expect(participantsInUnits).toContain('m-kiran');
    expect(participantsInUnits).toContain('m-anand');
    expect(participantsInUnits).toContain('m-priya');
  });

  it('payer is always included in participants even if not in any named family', () => {
    const intent = parse('i paid 600 Patel family');
    const result = buildVoiceSplit(intent, {
      memberIds: ALL_MEMBER_IDS,
      meMemberId: 'm-priya',
      amountMinor: 60000n,
      families: FAMILIES,
    });
    expect(result.participants).toContain('m-priya');
  });
});

// ── voice-agent logic: units split validation (server-side) ─────────────────

describe('voice-agent validateSplit — units mode', () => {
  // We test logic.ts directly (it lives in supabase/functions/voice-agent).
  // These tests import from there using a relative path within the supabase
  // functions vitest config (supabase/functions/vitest.config.ts).
  // Since packages/core tests run separately, we keep these here as
  // integration-style checks using buildVoiceSplit instead.

  it('units split params round-trip: kind, units, no weights', () => {
    const result = plan('i paid 600 split by family');
    expect(result.params).toMatchObject({ kind: 'units' });
    if (result.params.kind === 'units') {
      expect(result.params.weights).toBeUndefined();
    }
  });
});

it.each(['family dinner', 'family trip'])('keeps %s as a normal expense', (description) => {
  const intent = parse(`I paid ${description} 600`);
  expect(intent.splitMode).toBe('equal');
  expect(intent.remainder).toContain(description);
});

it('blocks an unknown family rather than saving only the payer', () => {
  expect(plan('I paid 600 Jones family').problems).toContainEqual({
    code: 'participant_unresolved',
    name: 'jones',
  });
});
