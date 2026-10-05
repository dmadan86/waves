/**
 * Payer, group and split through the whole mobile parse: the intent the core
 * reads, the items the amount parser reads from what is left, and the guard
 * rails that keep a sentence like this from being acted on unseen.
 */

import { describe, expect, it } from 'vitest';

import { buildVoiceSplit } from '@waves/core';

import { parseVoiceExpenses, voiceAutoAction, type VoiceGroupRef } from '@/lib/voiceExpense';

const groups: VoiceGroupRef[] = [
  { id: 'g-goa', name: 'Goa Trip' },
  { id: 'g-flat', name: 'Flat 4B' },
];

const members = [
  { id: 'm-me', name: 'Priya', isMe: true },
  { id: 'm-madan', name: 'Madan' },
  { id: 'm-renny', name: 'Renny' },
  { id: 'm-arjun', name: 'Arjun' },
  { id: 'm-meera', name: 'Meera' },
];

const NOW = new Date(2026, 9, 5, 12, 0, 0);

const parse = (say: string, withMembers = true) =>
  parseVoiceExpenses(say, groups, { members: withMembers ? members : undefined, now: NOW });

describe('the three sentences customers say', () => {
  it('"Madan paid 500 rupees in Goa trip group for dinner"', () => {
    const result = parse('Madan paid 500 rupees in Goa trip group for dinner');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ amountMajor: 500, currency: 'INR', note: 'dinner' });
    expect(result.group).toEqual({ kind: 'existing', groupId: 'g-goa' });
    expect(result.intent?.payer).toMatchObject({
      status: 'resolved',
      memberId: 'm-madan',
      explicit: true,
    });
    expect(voiceAutoAction(result)).toBeNull();
  });

  it('"Madan and Renny split 500 equally"', () => {
    const result = parse('Madan and Renny split 500 equally');
    expect(result.items.map((item) => item.amountMajor)).toEqual([500]);
    expect(result.intent?.participants?.map((person) => person.memberId)).toEqual([
      'm-madan',
      'm-renny',
    ]);
    expect(result.intent?.splitMode).toBe('equal');
    // The sentence names no group, so one still has to be chosen.
    expect(result.group).toBeNull();
  });

  it('"I paid 1200 for cab split with Arjun and Meera"', () => {
    const result = parse('I paid 1200 for cab split with Arjun and Meera');
    expect(result.items[0]).toMatchObject({ amountMajor: 1200, note: 'cab' });
    expect(result.intent?.payer.status).toBe('me');
    expect(result.intent?.participants?.map((person) => person.memberId)).toEqual([
      'm-me',
      'm-arjun',
      'm-meera',
    ]);
  });
});

describe('parseVoiceExpenses with a payer, people and a split', () => {
  it('keeps "Madan 300 Renny 200" as one split, not two expenses', () => {
    const result = parse('split 500 Madan 300 Renny 200');
    expect(result.items.map((item) => item.amountMajor)).toEqual([500]);
    expect(result.intent?.splitMode).toBe('exact');
  });

  it('adds the exact shares up when no total is said', () => {
    const result = parse('Madan 300 Renny 200 dinner');
    expect(result.items.map((item) => item.amountMajor)).toEqual([500]);
    expect(result.items[0].note).toBe('dinner');
  });

  it('gives each of several items the same payer and people', () => {
    const result = parse('Madan paid 500 for dinner and 200 for cab split with Arjun');
    expect(result.items.map((item) => [item.amountMajor, item.note])).toEqual([
      [500, 'dinner'],
      [200, 'cab'],
    ]);
    expect(result.intent?.payer.memberId).toBe('m-madan');
    expect(result.intent?.participants?.map((person) => person.memberId)).toEqual([
      'm-madan',
      'm-me',
      'm-arjun',
    ]);
  });

  it('reads Hinglish: the "ne … diya … ka" frame', () => {
    const result = parse('Madan ne 500 diya dinner ka');
    expect(result.items[0]).toMatchObject({ amountMajor: 500, note: 'dinner' });
    expect(result.intent?.payer.memberId).toBe('m-madan');
  });

  it('reads a Hinglish day word as the date', () => {
    const result = parse('kal 300 ka petrol Madan ne diya');
    expect(result.expenseDate).toBe('2026-10-04');
    expect(result.items[0].note).toBe('petrol');
  });

  it('understands a recogniser\'s "rainy" as Renny, and says it was a guess', () => {
    const result = parse('rainy paid 250 for snacks');
    expect(result.intent?.payer).toMatchObject({ memberId: 'm-renny', fuzzy: true });
  });

  it('hands an unknown payer to the review as unresolved', () => {
    const result = parse('Kiran paid 300 for tea');
    expect(result.items).toHaveLength(1);
    expect(result.intent?.payer.status).toBe('unresolved');
  });

  it('leaves the group for the review when the name fits two', () => {
    const two = parseVoiceExpenses(
      '500 for cab in goa',
      [...groups, { id: 'g-goaflat', name: 'Goa Flat' }],
      { members },
    );
    expect(two.group).toBeNull();
    expect(two.intent?.groupSource).toBe('ambiguous');
    expect(two.intent?.groupHint?.candidates?.map((c) => c.id)).toEqual(['g-goa', 'g-goaflat']);
  });

  it('does not file under whichever group overlaps when the named one is not there', () => {
    const result = parse('500 for dinner in vegas group');
    expect(result.group).toBeNull();
    expect(result.intent?.groupSource).toBe('unresolved');
  });

  it('puts the group the mic was opened in on the intent when none is spoken', () => {
    const result = parseVoiceExpenses('Madan paid 400 for cab', groups, {
      members,
      currentGroupId: 'g-flat',
    });
    expect(result.intent?.groupSource).toBe('current');
    expect(result.intent?.targetGroupId).toBe('g-flat');
  });

  it('plans a save that matches what was said', () => {
    const result = parse('Madan paid 900 for dinner split with Renny');
    const plan = buildVoiceSplit(result.intent!, {
      memberIds: members.map((member) => member.id),
      meMemberId: 'm-me',
      amountMinor: result.items[0].amountMinor,
    });
    expect(plan.payerId).toBe('m-madan');
    expect(plan.participants).toEqual(['m-madan', 'm-me', 'm-renny']);
    expect(plan.problems).toEqual([]);
  });
});

describe('what stays as it was', () => {
  it('still refuses a repayment, with or without a name', () => {
    expect(parse('Madan paid me back 500').items).toEqual([]);
    expect(parse('Madan gave me 400').items).toEqual([]);
  });

  it('does not treat a plain "I paid" as anything to review', () => {
    const result = parse('I paid 500 rupees for dinner');
    expect(result.intent?.hasSocialDetail).toBe(false);
    expect(result.items[0].note).toBe('dinner');
  });

  it('acts on a plain expense to a named group exactly as before', () => {
    const result = parse('add 500 rupees dinner to the Goa trip');
    expect(voiceAutoAction(result)).toEqual({ kind: 'commit-expense', groupId: 'g-goa' });
  });

  it('never acts alone on a sentence that names a payer', () => {
    expect(voiceAutoAction(parse('Madan paid 500 rupees in Goa trip group for dinner'))).toBeNull();
    expect(voiceAutoAction(parse('500 rupees dinner in Goa trip split with Arjun'))).toBeNull();
  });
});
