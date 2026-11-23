import type { UpcomingItem } from '@waves/core';
import { describe, expect, it } from 'vitest';

import { STRINGS_BY_LANGUAGE } from '../src/i18n';
import { askOf, headlineOf, subtitleOf, titleOf, whenOf } from '../src/lib/dateReminders/text';

const en = STRINGS_BY_LANGUAGE.en.dates;
const item = (over: Partial<UpcomingItem>): UpcomingItem => ({
  key: 'a:2026-11-26',
  source: 'date',
  kind: 'family_birthday',
  id: 'a',
  name: 'Asha',
  date: '2026-11-26',
  inDays: 5,
  years: null,
  ...over,
});

describe('date reminder text', () => {
  it('names a family birthday after the person, and keeps the name in the headline', () => {
    expect(titleOf(item({}), en)).toContain('Asha');
    expect(headlineOf(item({}), en, 'en')).toContain('Asha');
    expect(headlineOf(item({}), en, 'en')).toMatch(/5/);
  });

  it('says today for day zero and singular for one day', () => {
    expect(whenOf(item({ inDays: 0 }), en, 'en')).toBe(en.today);
    expect(whenOf(item({ inDays: 1 }), en, 'en')).toBe('tomorrow');
    expect(whenOf(item({ inDays: 1 }), en, 'en')).not.toBe(whenOf(item({ inDays: 2 }), en, 'en'));
    expect(headlineOf(item({ inDays: 0 }), en, 'en')).not.toMatch(/\{/);
  });

  it('a festival is titled by its festival name and needs no person name', () => {
    const f = item({ source: 'festival', kind: 'festival', id: 'diwali', name: '' });
    expect(titleOf(f, en)).toBe(en.festivals.diwali);
    expect(headlineOf(f, en, 'en')).toContain(en.festivals.diwali);
  });

  it('a work anniversary subtitle counts years; others count days', () => {
    const w = item({ kind: 'work_anniversary', years: 3 });
    expect(subtitleOf(w, en, 'en')).toMatch(/3/);
    expect(subtitleOf(item({ inDays: 4 }), en, 'en')).toMatch(/4/);
  });

  it('every kind and language leaves no unfilled placeholder', () => {
    const kinds = ['family_birthday', 'anniversary', 'work_anniversary', 'other'] as const;
    for (const lang of ['en', 'ar'] as const) {
      const t = STRINGS_BY_LANGUAGE[lang].dates;
      for (const kind of kinds)
        for (const inDays of [0, 1, 2, 5, 11]) {
          const i = item({ kind, inDays, years: kind === 'work_anniversary' ? 2 : null });
          for (const text of [
            titleOf(i, t),
            headlineOf(i, t, lang),
            subtitleOf(i, t, lang),
            askOf(i, t),
          ])
            expect(text, `${lang} ${kind} ${inDays}`).not.toMatch(/\{\w+\}/);
        }
    }
  });
});
