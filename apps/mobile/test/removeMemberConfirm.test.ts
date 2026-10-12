/**
 * The confirm text for removing a member: it must say what is still open
 * between them and the group, because removal does not settle it.
 */

import { describe, expect, it, vi } from 'vitest';

import { removeMemberBody } from '../src/data/removeMemberConfirm';
import { STRINGS_BY_LANGUAGE } from '../src/i18n';

// The i18n module imports expo-localization, which needs a native host.
vi.mock('expo-localization', () => ({ getLocales: () => [] }));

const strings = {
  body: '{name} loses access. Their expenses and balance stay in the group history.',
  stillOwes: '{name} still owes {amount}.',
  isOwed: '{name} is owed {amount}.',
};

const base = { name: 'Ravi', currency: 'INR', locale: 'en-IN', strings };

describe('removeMemberBody', () => {
  it('is just the history note when the balance is square', () => {
    expect(removeMemberBody({ ...base, balance: 0n })).toBe(
      'Ravi loses access. Their expenses and balance stay in the group history.',
    );
  });

  it('warns that a member who owes still owes, with the amount in the group currency', () => {
    const text = removeMemberBody({ ...base, balance: -50000n });
    expect(text).toMatch(/^Ravi still owes .*500/);
    expect(text).toContain('stay in the group history');
    expect(text).not.toContain('-');
    expect(text).not.toContain('{');
  });

  it('warns that a member who is owed is still owed', () => {
    const text = removeMemberBody({ ...base, balance: 123456n });
    expect(text).toMatch(/^Ravi is owed .*1,234\.56/);
    expect(text).toContain('stay in the group history');
  });

  it('has the real strings in every language, with no placeholder left over', () => {
    for (const language of Object.keys(STRINGS_BY_LANGUAGE) as (keyof typeof STRINGS_BY_LANGUAGE)[]) {
      const people = STRINGS_BY_LANGUAGE[language].people;
      for (const balance of [0n, -1000n, 1000n]) {
        const text = removeMemberBody({
          name: 'Ravi',
          balance,
          currency: 'INR',
          locale: 'en-IN',
          strings: {
            body: people.removeConfirmBody,
            stillOwes: people.removeStillOwes,
            isOwed: people.removeIsOwed,
          },
        });
        expect(text).not.toMatch(/\{\w+\}/);
        expect(text).toContain('Ravi');
      }
    }
  });
});
