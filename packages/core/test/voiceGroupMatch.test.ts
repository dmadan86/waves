import { describe, expect, it } from 'vitest';
import { resolveSpokenGroup } from '../src/voice/names';
import { parseVoiceIntent } from '../src/voice/intent';
const groups = [
  { id: 'goa', name: 'Goa Trip' },
  { id: 'ooty', name: 'Ooty Trip' },
  { id: 'flat', name: 'Flat Expenses' },
];
describe('spoken group alignment', () => {
  it.each(['Goa Express', 'go a trip', 'goa tip', 'goa expenses', 'goa trips', 'goa'])(
    'uses the distinctive anchor in %s',
    (phrase) => {
      expect(resolveSpokenGroup(phrase, groups)).toMatchObject({ status: 'resolved', id: 'goa' });
    },
  );
  it.each(['dinner', 'petrol', 'the flat rent', 'office supplies', 'trip tickets'])(
    'rejects description %s',
    (phrase) => {
      expect(resolveSpokenGroup(phrase, groups).status).toBe('unresolved');
    },
  );
  it('keeps shared anchors ambiguous regardless of order or current group', () => {
    const rivals = [...groups, { id: 'goaflat', name: 'Goa Flat' }];
    for (const ordered of [rivals, [...rivals].reverse()]) {
      expect(resolveSpokenGroup('Goa Express', ordered)).toMatchObject({
        status: 'ambiguous',
        candidates: [{ id: 'goa' }, { id: 'goaflat' }],
      });
      expect(
        parseVoiceIntent('300 rupees for Goa Express', { groups: ordered, currentGroupId: 'goa' })
          .groupSource,
      ).toBe('ambiguous');
    }
  });
  it('keeps a weak anchor with extra heard words as a suggestion', () => {
    expect(resolveSpokenGroup('Goa travel', groups)).toMatchObject({
      status: 'ambiguous',
      candidates: [{ id: 'goa' }],
    });
  });
  it('retains real description words', () => {
    expect(parseVoiceIntent('300 rupees for Goa Express dinner', { groups }).remainder).toContain(
      'dinner',
    );
  });
  it('asks about alternative-only and conflicting group evidence', () => {
    for (const transcript of ['300 rupees dinner', '300 rupees dinner in Ooty Trip']) {
      const intent = parseVoiceIntent(transcript, {
        groups,
        alternatives: ['300 rupees dinner in Goa Trip'],
      });
      expect(intent.groupSource).toBe('ambiguous');
      expect(intent.targetGroupId).toBeUndefined();
      expect(intent.groupHint?.candidates?.some((c) => c.id === 'goa')).toBe(true);
    }
  });
});

it('does not confidently swallow a second correction as part of a group name', () => {
  expect(
    resolveSpokenGroup('Flat 4B, paid cash', [{ id: 'flat', name: 'Flat 4B' }], false).status,
  ).toBe('unresolved');
});

it('keeps identifiers literal and full names ahead of partial rivals', () => {
  const rivals = [
    { id: 'b', name: 'Flat 4B' },
    { id: 'c', name: 'Flat 4C' },
  ];
  expect(resolveSpokenGroup('Flat 4B', rivals)).toMatchObject({ status: 'resolved', id: 'b' });
  expect(resolveSpokenGroup('Flat 5B', rivals, false).status).toBe('unresolved');
  expect(parseVoiceIntent('300 dinner to Flat 4B', { groups: rivals }).targetGroupId).toBe('b');
  expect(
    resolveSpokenGroup('Goa', [
      { id: 'a', name: 'Goa' },
      { id: 'b', name: 'Goa Trip' },
    ]),
  ).toMatchObject({ status: 'resolved', id: 'a' });
});

it.each(['गोवा यात्रा', 'தமிழ் பயணம்', 'رحلة دبي', '\u200fرحلة دبي\u200f'])(
  'routes script name %s',
  (name) => {
    const refs = [
      { id: 'script', name },
      { id: 'empty', name: null },
      { id: 'blank', name: '  ' },
    ];
    expect(resolveSpokenGroup(name, refs)).toMatchObject({ status: 'resolved', id: 'script' });
    expect(parseVoiceIntent(`300 dinner in ${name}`, { groups: refs }).targetGroupId).toBe(
      'script',
    );
  },
);

it('preserves Tamil vowel marks', () => {
  const refs = [
    { id: 'a', name: 'கல்' },
    { id: 'b', name: 'கால்' },
  ];
  expect(resolveSpokenGroup('கால்', refs)).toMatchObject({ status: 'resolved', id: 'b' });
});

it('does not route a member through a shared group word', () => {
  expect(
    parseVoiceIntent('300 dinner for Arjun', {
      groups: [{ id: 'trip', name: 'Arjun Trip' }],
      members: [{ id: 'arjun', name: 'Arjun' }],
    }).targetGroupId,
  ).toBeUndefined();
});
