/**
 * The reason line under a "Likely duplicates" row: which signal matched, then
 * how far the set reaches. It is the evidence somebody weighs before a merge
 * that cannot be undone, so a shared name must never read like a shared number.
 */

import { describe, expect, it, vi } from 'vitest';

import type { DuplicateSet, MergeCandidate } from '@/data/mergePeople';
import { Language, LANGUAGES, STRINGS_BY_LANGUAGE } from '@/i18n';
import { duplicateNames, duplicateReason } from '@/lib/mergeSuggestionText';

// The i18n module imports expo-localization (and through it react-native) at
// load; only the strings are needed here.
vi.mock('expo-localization', () => ({ getLocales: () => [] }));

const en = STRINGS_BY_LANGUAGE[Language.En].mergePeople;

function person(key: string, name: string): MergeCandidate {
  return {
    person_key: key,
    member_ids: [key],
    group_ids: ['g1'],
    display_name: name,
    phone: null,
    email: null,
    pending: false,
  };
}

function set(signal: DuplicateSet['signal'], groupCount: number): DuplicateSet {
  const people = [person('a', 'Renny'), person('b', 'Renny')];
  return { key: 'a|b', people, signal, groupCount };
}

/** Strip the LTR isolates so assertions read like the screen does. */
const plain = (text: string): string => text.replace(/[⁦⁩]/g, '');

describe('duplicateNames', () => {
  it('joins the names the way the row draws them', () => {
    expect(duplicateNames(set({ kind: 'name' }, 2))).toBe('Renny · Renny');
  });
});

describe('duplicateReason', () => {
  it('says "same name" and the group count, pluralised', () => {
    expect(duplicateReason(set({ kind: 'name' }, 2), 'en', en)).toBe('Same name · 2 groups');
    expect(duplicateReason(set({ kind: 'name' }, 1), 'en', en)).toBe('Same name · 1 group');
  });

  it('shows the shared number, formatted, isolated left-to-right', () => {
    const line = duplicateReason(set({ kind: 'phone', phone: '919713812345' }, 1), 'en', en);
    expect(plain(line)).toBe('Same phone +91 97138 12345 · 1 group');
    // The isolate is what keeps "+91" at the start of the number in Arabic.
    expect(line).toContain('⁦+91 97138 12345⁩');
  });

  it('shows the shared email', () => {
    const line = duplicateReason(set({ kind: 'email', email: 'r@example.com' }, 3), 'en', en);
    expect(plain(line)).toBe('Same email r@example.com · 3 groups');
  });

  it('is fully translated in every language, with no placeholder left behind', () => {
    for (const language of LANGUAGES) {
      const strings = STRINGS_BY_LANGUAGE[language].mergePeople;
      for (const signal of [
        { kind: 'name' },
        { kind: 'phone', phone: '+919713812345' },
        { kind: 'email', email: 'r@example.com' },
      ] as const) {
        for (const count of [1, 2, 5, 11]) {
          const line = duplicateReason(set(signal, count), language, strings);
          expect(line, `${language} ${signal.kind} ${count}`).not.toMatch(/[{}]/);
          if (language !== Language.En) {
            expect(line).not.toBe(duplicateReason(set(signal, count), 'en', en));
          }
        }
      }
    }
  });
});
