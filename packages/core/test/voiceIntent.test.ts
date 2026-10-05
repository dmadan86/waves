/**
 * Spoken payer, group and split — the sentences people actually say, as
 * speech-to-text hands them back (lowercase, no punctuation, Indian English with
 * Hindi grammar), and what the intent parser must read out of each.
 *
 * Members and groups are the same cast throughout. "Priya" is the speaker.
 */

import { describe, expect, it } from 'vitest';

import {
  buildVoiceSplit,
  parseVoiceIntent,
  resolveIntentPeople,
  resolveSpokenGroup,
  resolveSpokenName,
  type VoiceIntent,
  type VoiceIntentContext,
} from '../src/voice/index.js';

const MEMBERS = [
  { id: 'm-me', name: 'Priya', isMe: true },
  { id: 'm-madan', name: 'Madan' },
  { id: 'm-renny', name: 'Renny' },
  { id: 'm-arjun', name: 'Arjun' },
  { id: 'm-meera', name: 'Meera' },
  { id: 'm-rose', name: 'Rose' },
  { id: 'm-mark', name: 'Mark' },
  { id: 'm-sunny', name: 'Sunny' },
];

const GROUPS = [
  { id: 'g-goa', name: 'Goa Trip' },
  { id: 'g-flat', name: 'Flat Expenses' },
  { id: 'g-lunch', name: 'Office Lunch' },
];

const NOW = new Date(2026, 9, 5, 12, 0, 0); // 5 Oct 2026

const CTX: VoiceIntentContext = { members: MEMBERS, groups: GROUPS, now: NOW };

interface Row {
  say: string;
  ctx?: VoiceIntentContext;
  amount?: number | null;
  currency?: string;
  desc?: string;
  /** 'me', a member's name, or '?heard' for a name nobody matched. */
  payer?: string;
  explicit?: boolean;
  /** Group name when resolved, 'ambiguous', '?heard', 'current' or 'none'. */
  group?: string;
  /** Participant names in order; 'me' for the speaker. Absent means nobody was named. */
  who?: string[];
  everyone?: boolean;
  mode?: 'equal' | 'exact' | 'percent' | 'full_on';
  exact?: Record<string, number>;
  percent?: Record<string, number>;
  date?: string;
  notes?: string[];
  items?: [number, string][];
  social?: boolean;
}

function payerLabel(intent: VoiceIntent): string {
  const { payer } = intent;
  if (payer.status === 'me') return 'me';
  if (payer.status === 'resolved') return payer.name;
  return `?${payer.name}`;
}

function groupLabel(intent: VoiceIntent): string {
  switch (intent.groupSource) {
    case 'named':
      return intent.groupHint?.name ?? '';
    case 'ambiguous':
      return 'ambiguous';
    case 'unresolved':
      return `?${intent.groupHint?.name}`;
    default:
      return intent.groupSource;
  }
}

const ROWS: Row[] = [
  // ── the three customer examples ────────────────────────────────────────
  {
    say: 'Madan paid 500 rupees in Goa trip group for dinner',
    amount: 500,
    currency: 'INR',
    desc: 'dinner',
    payer: 'Madan',
    explicit: true,
    group: 'Goa Trip',
    mode: 'equal',
    social: true,
  },
  {
    say: 'Madan and Renny split 500 equally',
    amount: 500,
    payer: 'me',
    explicit: false,
    who: ['Madan', 'Renny'],
    mode: 'equal',
    notes: ['payer_not_in_split'],
  },
  {
    say: 'I paid 1200 for cab split with Arjun and Meera',
    amount: 1200,
    desc: 'cab',
    payer: 'me',
    explicit: true,
    who: ['me', 'Arjun', 'Meera'],
    mode: 'equal',
  },

  // ── payer ──────────────────────────────────────────────────────────────
  {
    say: 'i paid 300 for lunch',
    amount: 300,
    desc: 'lunch',
    payer: 'me',
    explicit: true,
    social: false,
  },
  {
    say: 'paid 300 for lunch',
    amount: 300,
    desc: 'lunch',
    payer: 'me',
    explicit: false,
    notes: ['payer_default_me'],
  },
  {
    say: 'groceries 800 paid by arjun',
    amount: 800,
    desc: 'groceries',
    payer: 'Arjun',
    explicit: true,
  },
  { say: 'paid by me 800 for groceries', payer: 'me', explicit: true, desc: 'groceries' },
  { say: 'meera gave 400 for petrol', amount: 400, desc: 'petrol', payer: 'Meera', explicit: true },
  {
    say: 'arjun gave me 400',
    payer: 'me',
    explicit: false,
    notes: ['looks_like_transfer'],
    social: false,
  },
  {
    say: 'madan ne 500 diya dinner ka',
    amount: 500,
    desc: 'dinner',
    payer: 'Madan',
    explicit: true,
  },
  { say: 'main ne 700 diya taxi ke liye', amount: 700, desc: 'taxi', payer: 'me', explicit: true },
  { say: 'renny paid 250 for snacks', amount: 250, desc: 'snacks', payer: 'Renny', explicit: true },
  { say: 'rainy paid 250 for snacks', payer: 'Renny', notes: ['name_fuzzy:rainy->Renny'] },
  { say: 'reni paid 250', payer: 'Renny', amount: 250 },
  {
    say: 'madan and meera paid 600 for hotel',
    payer: '?madan and meera',
    notes: ['multiple_payers'],
  },
  {
    say: 'kiran paid 300 for tea',
    payer: '?kiran',
    explicit: true,
    notes: ['name_unresolved:kiran'],
  },
  { say: 'i will pay 500 for dinner', payer: 'me', explicit: true, amount: 500 },
  { say: 'madan will pay 500', payer: 'Madan', explicit: true, amount: 500 },
  { say: 'priya paid 100 for tea', payer: 'me', explicit: true },
  { say: 'add expense madan paid 500 for dinner', payer: 'Madan', amount: 500, desc: 'dinner' },

  // ── group targeting ───────────────────────────────────────────────────
  { say: 'dinner 500 in goa trip', amount: 500, group: 'Goa Trip', desc: 'dinner' },
  { say: '500 for dinner for goa trip group', amount: 500, group: 'Goa Trip', desc: 'dinner' },
  { say: 'goa trip: dinner 500', amount: 500, group: 'Goa Trip', desc: 'dinner' },
  { say: 'goa trip group mein 500 ka dinner', amount: 500, group: 'Goa Trip', desc: 'dinner' },
  { say: '500 cab in goa', group: 'Goa Trip' },
  {
    say: '500 cab in goa',
    ctx: { ...CTX, groups: [...GROUPS, { id: 'g-goaflat', name: 'Goa Flat' }] },
    group: 'ambiguous',
  },
  { say: '500 cab in the flat expenss group', group: 'Flat Expenses', desc: 'cab' },
  { say: 'dinner 500 in vegas group', group: '?vegas', desc: 'dinner' },
  { say: 'dinner 500', ctx: { ...CTX, currentGroupId: 'g-flat' }, group: 'current' },
  { say: 'dinner 500', group: 'none', social: false },
  {
    say: 'dinner 500 in office lunch group',
    ctx: { ...CTX, currentGroupId: 'g-flat' },
    group: 'Office Lunch',
  },
  { say: 'i paid 500 for lunch', amount: 500, desc: 'lunch', group: 'none' },

  // ── participants ──────────────────────────────────────────────────────
  { say: 'split 600 with arjun', amount: 600, who: ['me', 'Arjun'], mode: 'equal' },
  {
    say: '600 for dinner between arjun meera and me'.replace('arjun meera', 'arjun, meera'),
    amount: 600,
    who: ['Arjun', 'Meera', 'me'],
    desc: 'dinner',
  },
  {
    say: '500 for dinner for arjun and meera',
    amount: 500,
    desc: 'dinner',
    who: ['Arjun', 'Meera'],
    notes: ['payer_not_in_split'],
  },
  { say: 'split 900 equally between everyone', amount: 900, everyone: true, mode: 'equal' },
  { say: 'split among all 900', amount: 900, everyone: true },
  { say: 'dinner 900 for everyone', amount: 900, desc: 'dinner', everyone: true },
  { say: 'arjun aur meera ke saath 600 baant do', amount: 600, who: ['me', 'Arjun', 'Meera'] },
  {
    say: 'arjun ne 300 diya flat expenses group mein sab me baant do',
    payer: 'Arjun',
    group: 'Flat Expenses',
    everyone: true,
    amount: 300,
  },
  {
    say: 'madan paid 900 split with renny',
    payer: 'Madan',
    who: ['Madan', 'me', 'Renny'],
    notes: ['me_included_by_with'],
  },
  {
    say: 'dinner with arjun and meera 500',
    amount: 500,
    desc: 'dinner',
    who: ['me', 'Arjun', 'Meera'],
  },

  // ── split modes ───────────────────────────────────────────────────────
  { say: 'split 500 half half with arjun', amount: 500, who: ['me', 'Arjun'], mode: 'equal' },
  { say: 'split 500 50 50 with arjun', amount: 500, who: ['me', 'Arjun'], mode: 'equal' },
  {
    say: '500 arjun 300 meera 200',
    amount: 500,
    who: ['Arjun', 'Meera'],
    mode: 'exact',
    exact: { Arjun: 300, Meera: 200 },
  },
  {
    say: 'split 500 arjun 300 and me 200',
    amount: 500,
    who: ['Arjun', 'me'],
    mode: 'exact',
    exact: { Arjun: 300, me: 200 },
  },
  {
    say: '600 arjun 300 meera 200',
    amount: 600,
    who: ['Arjun', 'Meera', 'me'],
    mode: 'exact',
    exact: { Arjun: 300, Meera: 200, me: 100 },
    notes: ['payer_gets_remainder'],
  },
  {
    say: 'split arjun 300 meera 200',
    amount: 500,
    who: ['Arjun', 'Meera'],
    mode: 'exact',
  },
  {
    say: 'split 500 60 40 with arjun',
    amount: 500,
    who: ['me', 'Arjun'],
    mode: 'percent',
    percent: { me: 60, Arjun: 40 },
    notes: ['percent_order_assumed'],
  },
  {
    say: 'split 1000 arjun 70 percent meera 30 percent',
    amount: 1000,
    who: ['Arjun', 'Meera'],
    mode: 'percent',
    percent: { Arjun: 70, Meera: 30 },
  },
  {
    say: 'arjun 60 meera 40 split 500',
    amount: 500,
    who: ['Arjun', 'Meera'],
    mode: 'percent',
    percent: { Arjun: 60, Meera: 40 },
  },
  { say: 'arjun owes full 500', amount: 500, who: ['Arjun'], mode: 'full_on' },
  {
    say: 'arjun owes the whole amount 500 for dinner',
    amount: 500,
    who: ['Arjun'],
    mode: 'full_on',
    desc: 'dinner',
  },
  { say: 'all on meera 500 dinner', amount: 500, who: ['Meera'], mode: 'full_on', desc: 'dinner' },
  { say: 'full amount on renny 300', amount: 300, who: ['Renny'], mode: 'full_on' },
  {
    say: '500 for arjun i owe nothing',
    amount: 500,
    who: ['Arjun'],
    mode: 'full_on',
    notes: ['speaker_owes_nothing'],
  },
  {
    say: 'i paid 700 i dont owe anything',
    amount: 700,
    mode: 'full_on',
    notes: ['speaker_owes_nothing'],
  },
  { say: 'split 800 3 ways', amount: 800, who: undefined },

  // ── currency, date, description ───────────────────────────────────────
  {
    say: 'paid 200 dirhams for taxi yesterday',
    amount: 200,
    currency: 'AED',
    desc: 'taxi',
    date: '2026-10-04',
  },
  { say: 'i paid $30 for lunch', amount: 30, currency: 'USD', desc: 'lunch' },
  { say: '₹450 for groceries', amount: 450, currency: 'INR', desc: 'groceries' },
  {
    say: 'paid 12 dollars for coffee today',
    amount: 12,
    currency: 'USD',
    desc: 'coffee',
    date: '2026-10-05',
  },
  { say: 'paid rs 1,200 for cab', amount: 1200, currency: 'INR', desc: 'cab' },
  { say: '2k for rent', amount: 2000, desc: 'rent' },
  {
    say: 'kal 300 ka petrol madan ne diya',
    amount: 300,
    desc: 'petrol',
    payer: 'Madan',
    date: '2026-10-04',
    notes: ['date_kal_assumed_yesterday'],
  },
  { say: '3 days ago i paid 150 for tea', amount: 150, desc: 'tea', date: '2026-10-02' },

  // ── several things in one sentence ────────────────────────────────────
  {
    say: '500 for dinner and 200 for cab',
    amount: 500,
    items: [
      [500, 'dinner'],
      [200, 'cab'],
    ],
    notes: ['multiple_amounts'],
  },
  {
    say: 'madan paid 500 for dinner and 200 for cab in goa trip group',
    payer: 'Madan',
    group: 'Goa Trip',
    items: [
      [500, 'dinner'],
      [200, 'cab'],
    ],
  },

  // ── names that are also words ─────────────────────────────────────────
  { say: 'rose paid 300 for flowers', amount: 300, payer: 'Rose', desc: 'flowers' },
  { say: 'i paid 200 for rose flowers', payer: 'me', desc: 'rose flowers', who: undefined },
  { say: 'mark paid 400 for cab', payer: 'Mark', desc: 'cab' },
  { say: 'sunny paid 100 for tea', payer: 'Sunny', desc: 'tea' },

  // ── odd input ─────────────────────────────────────────────────────────
  { say: 'madan paid for dinner', amount: null, payer: 'Madan' },
  { say: 'paid me back 500', notes: ['looks_like_transfer'], payer: 'me' },
  { say: '', amount: null, payer: 'me', group: 'none' },
];

describe('parseVoiceIntent — what was said', () => {
  it.each(ROWS.map((row) => [row.say || '(empty)', row] as const))('%s', (_say, row) => {
    const intent = parseVoiceIntent(row.say, row.ctx ?? CTX);

    if (row.amount !== undefined)
      expect(intent.amountMinor, 'amount').toBe(
        row.amount === null ? null : BigInt(row.amount * 100),
      );
    if (row.currency !== undefined) expect(intent.currency, 'currency').toBe(row.currency);
    if (row.desc !== undefined) expect(intent.description, 'description').toBe(row.desc);
    if (row.payer !== undefined) expect(payerLabel(intent), 'payer').toBe(row.payer);
    if (row.explicit !== undefined)
      expect(intent.payer.explicit, 'explicit payer').toBe(row.explicit);
    if (row.group !== undefined) expect(groupLabel(intent), 'group').toBe(row.group);
    if (row.who !== undefined || 'who' in row) {
      const names = intent.participants?.map((p) => (p.status === 'me' ? 'me' : p.name));
      expect(names, 'participants').toEqual(row.who);
    }
    if (row.everyone !== undefined) expect(intent.everyone, 'everyone').toBe(row.everyone);
    if (row.mode !== undefined) expect(intent.splitMode, 'split mode').toBe(row.mode);
    if (row.exact) {
      const got = Object.fromEntries(
        (intent.participants ?? []).map((p) => [
          p.status === 'me' ? 'me' : p.name,
          Number(p.exactMinor) / 100,
        ]),
      );
      expect(got, 'exact amounts').toEqual(row.exact);
    }
    if (row.percent) {
      const got = Object.fromEntries(
        (intent.participants ?? []).map((p) => [p.status === 'me' ? 'me' : p.name, p.percent]),
      );
      expect(got, 'percentages').toEqual(row.percent);
    }
    if (row.date !== undefined) expect(intent.date, 'date').toBe(row.date);
    for (const code of row.notes ?? []) expect(intent.notes, 'notes').toContain(code);
    if (row.items)
      expect(
        intent.items?.map((item) => [Number(item.amountMinor) / 100, item.description]),
        'items',
      ).toEqual(row.items);
    if (row.social !== undefined) expect(intent.hasSocialDetail, 'social detail').toBe(row.social);
  });

  it('has well over forty utterances in the table', () => {
    expect(ROWS.length).toBeGreaterThanOrEqual(40);
  });
});

describe('parseVoiceIntent — details the table cannot say', () => {
  it('reports the split count and takes it out of the amount', () => {
    const intent = parseVoiceIntent('split 800 3 ways', CTX);
    expect(intent.splitCount).toBe(3);
    expect(intent.amountMinor).toBe(80000n);
  });

  it('keeps the person-and-group words out of the remainder the amount parser reads', () => {
    const intent = parseVoiceIntent('Madan paid 500 rupees in Goa trip group for dinner', CTX);
    expect(intent.remainder).toBe('500 rupees for dinner');
  });

  it('adds the exact amounts together when no total was said', () => {
    const intent = parseVoiceIntent('split arjun 300 meera 200', CTX);
    expect(intent.remainder).toContain('500');
  });

  it('puts the payer in the remainder-free sentence regardless of case and punctuation', () => {
    const intent = parseVoiceIntent('MADAN, paid 500.', CTX);
    expect(intent.payer.name).toBe('Madan');
  });

  it('is not fooled by a description that merely sounds like several expenses', () => {
    const intent = parseVoiceIntent('dinner 500 and cab 200 split with arjun', CTX);
    expect(intent.items?.length).toBe(2);
    expect(intent.participants?.map((p) => p.name)).toEqual(['me', 'Arjun']);
  });

  it('classes a bare third-party payer as social detail but a plain sentence as not', () => {
    expect(parseVoiceIntent('madan paid 100', CTX).hasSocialDetail).toBe(true);
    expect(parseVoiceIntent('i paid 100 for tea', CTX).hasSocialDetail).toBe(false);
  });

  it('works without any members: names stay as heard', () => {
    const intent = parseVoiceIntent('Madan paid 500 split with Arjun and Meera', {});
    expect(intent.payer).toMatchObject({
      kind: 'member',
      name: 'madan',
      status: 'unresolved',
      explicit: true,
    });
    expect(intent.participants?.map((p) => p.name)).toEqual(['madan', 'me', 'arjun', 'meera']);
  });

  it('works without any groups: a "… group" phrase is kept as a name to check', () => {
    const intent = parseVoiceIntent('500 for dinner in goa trip group', {});
    expect(intent.groupHint).toMatchObject({ name: 'goa trip', status: 'unresolved' });
    expect(intent.notes).toContain('group_unchecked');
  });

  it('never reads a plain "for dinner" as a group, even with a group called Dinner Club', () => {
    const intent = parseVoiceIntent('500 for dinner', {
      ...CTX,
      groups: [...GROUPS, { id: 'g-club', name: 'Dinner Club' }],
    });
    expect(intent.groupSource).toBe('none');
    expect(intent.description).toBe('dinner');
  });
});

describe('resolveIntentPeople — the same words in another group', () => {
  it('re-reads names against the members it is given', () => {
    const heard = parseVoiceIntent('rainy paid 300 split with arjun', { groups: GROUPS });
    expect(heard.payer.status).toBe('unresolved');

    const resolved = resolveIntentPeople(heard, MEMBERS);
    expect(resolved.payer).toMatchObject({ status: 'resolved', memberId: 'm-renny', fuzzy: true });
    expect(resolved.participants?.map((p) => p.memberId)).toEqual(['m-renny', 'm-me', 'm-arjun']);
  });

  it('leaves a name nobody matches unresolved and says so', () => {
    const resolved = resolveIntentPeople(parseVoiceIntent('kiran paid 300', {}), MEMBERS);
    expect(resolved.payer.status).toBe('unresolved');
    expect(resolved.notes).toContain('name_unresolved:kiran');
  });

  it('turns two equally good matches into a question, not a pick', () => {
    const twins = [
      ...MEMBERS,
      { id: 'm-rahul1', name: 'Rahul Sharma' },
      { id: 'm-rahul2', name: 'Rahul Verma' },
    ];
    const resolved = resolveIntentPeople(parseVoiceIntent('rahul paid 300', {}), twins);
    expect(resolved.payer.status).toBe('ambiguous');
    expect(resolved.payer.candidates?.map((c) => c.id)).toEqual(['m-rahul1', 'm-rahul2']);
    // …and a surname settles it.
    const settled = resolveIntentPeople(parseVoiceIntent('rahul verma paid 300', {}), twins);
    expect(settled.payer).toMatchObject({ status: 'resolved', memberId: 'm-rahul2' });
  });

  it('reads the speaker\'s own name as "me" and gives the row an id', () => {
    const resolved = resolveIntentPeople(parseVoiceIntent('priya paid 100', {}), MEMBERS);
    expect(resolved.payer).toMatchObject({ kind: 'me', status: 'me', memberId: 'm-me' });
  });

  it('does not list one person twice when "me" and their own name both appear', () => {
    const resolved = resolveIntentPeople(
      parseVoiceIntent('split 100 between priya and me', {}),
      MEMBERS,
    );
    expect(resolved.participants).toHaveLength(1);
  });
});

describe('resolveSpokenName', () => {
  const resolve = (heard: string) => resolveSpokenName(heard, MEMBERS);

  it.each(['me', 'I', 'myself', 'mine', 'main', 'mujhe'])('%s is the speaker', (word) => {
    expect(resolve(word)).toEqual({ status: 'me' });
  });

  it.each([
    ['renny', false],
    ['rainy', true],
    ['reni', true],
    ['RENNY', false],
    ['arjun bhai', false],
    ['arjan', true],
    ['meera', false],
    ['mira', true],
  ])('%s → %s (fuzzy)', (heard, fuzzy) => {
    const result = resolve(heard);
    expect(result.status).toBe('resolved');
    if (result.status === 'resolved') expect(result.fuzzy).toBe(fuzzy);
  });

  it('keeps the right person for a close pair', () => {
    expect(resolve('arjun')).toMatchObject({ id: 'm-arjun' });
    expect(resolve('renny')).toMatchObject({ id: 'm-renny' });
  });

  it('does not stretch a short word into a name', () => {
    expect(resolve('ar')).toEqual({ status: 'unresolved' });
    expect(resolve('ren')).toEqual({ status: 'unresolved' });
  });

  it('returns unresolved for a stranger and for nothing at all', () => {
    expect(resolve('kiran')).toEqual({ status: 'unresolved' });
    expect(resolve('')).toEqual({ status: 'unresolved' });
  });
});

describe('resolveSpokenGroup', () => {
  const groups = [
    { id: 'a', name: 'Goa Trip' },
    { id: 'b', name: 'Goa Flat' },
    { id: 'c', name: 'Office Lunch' },
    { id: 'd', name: null },
  ];

  it('finds the whole name', () => {
    expect(resolveSpokenGroup('goa trip', groups)).toMatchObject({
      status: 'resolved',
      id: 'a',
      exact: true,
    });
  });

  it('finds a part of the name when nothing else shares it', () => {
    expect(resolveSpokenGroup('lunch', groups)).toMatchObject({
      status: 'resolved',
      id: 'c',
      exact: false,
    });
  });

  it('asks when two groups fit equally', () => {
    const result = resolveSpokenGroup('goa', groups);
    expect(result.status).toBe('ambiguous');
    if (result.status === 'ambiguous')
      expect(result.candidates.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('forgives a misspelling', () => {
    expect(resolveSpokenGroup('ofice lunch', groups)).toMatchObject({
      status: 'resolved',
      id: 'c',
    });
  });

  it('ignores "group" and "the"', () => {
    expect(resolveSpokenGroup('the office lunch group', groups)).toMatchObject({ id: 'c' });
  });

  it('says unresolved for a group nobody has', () => {
    expect(resolveSpokenGroup('vegas', groups)).toEqual({ status: 'unresolved' });
  });
});

describe('buildVoiceSplit — what can be saved', () => {
  const memberIds = MEMBERS.map((m) => m.id);
  const plan = (say: string, amountMinor: bigint | null = null) => {
    const intent = parseVoiceIntent(say, CTX);
    return buildVoiceSplit(intent, {
      memberIds,
      meMemberId: 'm-me',
      amountMinor: amountMinor ?? intent.amountMinor,
    });
  };

  it('defaults to "I paid, split between everyone"', () => {
    const result = plan('dinner 500');
    expect(result.payerId).toBe('m-me');
    expect(result.participants).toEqual(memberIds);
    expect(result.params).toEqual({ kind: 'equal' });
    expect(result.problems).toEqual([]);
  });

  it('puts a named payer and a named group of people on the expense', () => {
    const result = plan('madan paid 900 split with renny');
    expect(result.payerId).toBe('m-madan');
    expect(result.participants).toEqual(['m-madan', 'm-me', 'm-renny']);
    expect(result.problems).toEqual([]);
  });

  it('builds exact amounts', () => {
    const result = plan('500 arjun 300 meera 200');
    expect(result.params).toEqual({
      kind: 'exact',
      amounts: { 'm-arjun': 30000n, 'm-meera': 20000n },
    });
    expect(result.problems).toEqual([]);
  });

  it('flags exact amounts that do not add up to the total', () => {
    const result = plan('400 arjun 300 meera 200');
    expect(result.problems).toContainEqual({ code: 'exact_sum_mismatch' });
  });

  it('builds basis points from percentages', () => {
    const result = plan('split 500 60 40 with arjun');
    expect(result.params).toEqual({
      kind: 'percent',
      basisPoints: { 'm-me': 6000, 'm-arjun': 4000 },
    });
    expect(result.problems).toEqual([]);
  });

  it('puts everything on the one who owes it', () => {
    const result = plan('arjun owes full 500');
    expect(result.participants).toEqual(['m-arjun']);
    expect(result.payerId).toBe('m-me');
  });

  it('"I owe nothing" with nobody named leaves everyone else owing', () => {
    const result = plan('i paid 700 i dont owe anything');
    expect(result.participants).toEqual(memberIds.filter((id) => id !== 'm-me'));
    expect(result.problems).toEqual([]);
  });

  it('refuses to save while the payer is a stranger', () => {
    const result = plan('kiran paid 300');
    expect(result.payerId).toBeNull();
    expect(result.problems).toContainEqual({ code: 'payer_unresolved', name: 'kiran' });
  });

  it('refuses to save while a participant is a stranger', () => {
    const result = buildVoiceSplit(parseVoiceIntent('split 300 with kiran', CTX), {
      memberIds,
      meMemberId: 'm-me',
      amountMinor: 30000n,
    });
    expect(result.problems).toContainEqual({ code: 'participant_unresolved', name: 'kiran' });
  });

  it('refuses a payer who is not in the group the expense is going to', () => {
    const result = buildVoiceSplit(parseVoiceIntent('madan paid 300', CTX), {
      memberIds: ['m-me', 'm-renny'],
      meMemberId: 'm-me',
      amountMinor: 30000n,
    });
    expect(result.payerId).toBeNull();
  });

  it('wants an amount', () => {
    expect(plan('madan paid for dinner').problems).toContainEqual({ code: 'no_amount' });
  });
});
