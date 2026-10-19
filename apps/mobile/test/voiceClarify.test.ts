import { describe, expect, it } from 'vitest';

import {
  clarifyFollowUp,
  clarifyOptionViews,
  filterGroupChoices,
  otherGroupChoices,
  typedFollowUp,
} from '../src/lib/voiceClarifyPure';

describe('typedFollowUp', () => {
  it('builds the same payload a spoken answer does, from trimmed text', () => {
    expect(typedFollowUp('  the  500 one ', 'add 500', 'Which one?')).toEqual({
      transcript: 'add 500',
      question: 'Which one?',
      answer: 'the 500 one',
    });
  });
  it('sends nothing for blank text', () => {
    expect(typedFollowUp('   ', 'add 500', 'Which one?')).toBeNull();
  });
});

const two = [
  { label: '₹500', detail: 'Breakfast', icon: 'food', answer: '500 rupees for Breakfast' },
  {
    label: '$3,030.30',
    detail: 'Goa trip (split in group)',
    icon: 'trip',
    answer: '3030.30 dollars',
  },
];

describe('clarifyOptionViews', () => {
  it('maps icon hints to an icon and tint, and trims', () => {
    const views = clarifyOptionViews(two);
    expect(views).toHaveLength(2);
    expect(views[0]).toMatchObject({ label: '₹500', icon: 'cafe-outline', tint: 'peach' });
    expect(views[1]).toMatchObject({ icon: 'airplane-outline', tint: 'sky' });
  });

  it('falls back to a neutral look for a missing or unknown hint, and no detail', () => {
    const views = clarifyOptionViews([
      { label: 'A', answer: 'a' },
      { label: 'B', icon: 'zzz', detail: '  ', answer: 'b' },
    ]);
    expect(views.map((v) => v.icon)).toEqual(['help-circle-outline', 'help-circle-outline']);
    expect(views[1]!.detail).toBeNull();
  });

  it('shows nothing (the old speak/type card) when absent, too few or too many', () => {
    expect(clarifyOptionViews(undefined)).toEqual([]);
    expect(clarifyOptionViews([two[0]!])).toEqual([]);
    expect(
      clarifyOptionViews([1, 2, 3, 4, 5].map((n) => ({ label: `L${n}`, answer: `a${n}` }))),
    ).toEqual([]);
    expect(clarifyOptionViews([{ label: '', answer: 'x' }, two[0]!])).toEqual([]);
  });
});

describe('clarifyFollowUp', () => {
  const views = clarifyOptionViews(two);
  it('is null until an option is picked (Continue stays disabled)', () => {
    expect(clarifyFollowUp(views, null, 'I had 500', 'Which amount?')).toBeNull();
    expect(clarifyFollowUp(views, 5, 'I had 500', 'Which amount?')).toBeNull();
  });
  it("sends the chosen option's answer with the earlier command and question", () => {
    expect(clarifyFollowUp(views, 0, 'I had 500', 'Which amount?')).toEqual({
      transcript: 'I had 500',
      question: 'Which amount?',
      answer: '500 rupees for Breakfast',
    });
  });
});

describe('otherGroupChoices', () => {
  const groups = [
    { name: 'Goa trip', detail: 'Trip' },
    { name: 'Vietnam' },
    { name: 'Flatmates', detail: 'Home' },
    { name: 'Office lunch' },
    { name: '  ' },
    { name: 'flatmates' },
  ];
  const groupQuestion = clarifyOptionViews([
    { label: 'Goa trip', icon: 'trip', answer: 'Goa trip' },
    { label: 'Vietnam', icon: 'trip', answer: 'Vietnam' },
    { label: 'Personal', icon: 'person', answer: 'Personal' },
  ]);

  it('offers every group not already shown, by name, once each', () => {
    const rest = otherGroupChoices(groupQuestion, groups);
    expect(rest.map((r) => r.label)).toEqual(['Flatmates', 'Office lunch']);
    expect(rest[0]).toMatchObject({ answer: 'Flatmates', detail: 'Home', icon: 'people-outline' });
  });

  it('adds nothing when the question is not about groups', () => {
    expect(otherGroupChoices(clarifyOptionViews(two), groups)).toEqual([]);
  });

  it('adds nothing when every group is already offered', () => {
    expect(otherGroupChoices(groupQuestion, [{ name: 'Goa trip' }, { name: 'vietnam' }])).toEqual(
      [],
    );
  });

  it('filters by any part of the name, ignoring case', () => {
    const rest = otherGroupChoices(groupQuestion, groups);
    expect(filterGroupChoices(rest, ' LUNCH ').map((r) => r.label)).toEqual(['Office lunch']);
    expect(filterGroupChoices(rest, '')).toHaveLength(2);
    expect(filterGroupChoices(rest, 'zzz')).toEqual([]);
  });
});
