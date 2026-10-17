import { describe, expect, it } from 'vitest';

import { clarifyFollowUp, clarifyOptionViews } from '../src/lib/voiceClarifyPure';

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
