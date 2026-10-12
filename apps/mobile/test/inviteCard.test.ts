/**
 * The pure pieces behind the shared invite image: which art and which type word
 * a group gets, and the wording on it in every language.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { inviteTypeWordKey } from '../src/components/invite/inviteCardModel';
import { GroupType } from '../src/data/types';

vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }));

const { fill, LANGUAGES, plural, STRINGS_BY_LANGUAGE } = await import('../src/i18n');

describe('inviteTypeWordKey', () => {
  it('names trip, home, event and friends', () => {
    for (const type of ['trip', 'home', 'event', 'friends'] as const) {
      expect(inviteTypeWordKey(type)).toBe(type);
    }
  });

  it('falls back to the plain group for couple, other and unknown', () => {
    expect(inviteTypeWordKey(GroupType.Couple)).toBe('other');
    expect(inviteTypeWordKey(GroupType.Other)).toBe('other');
    expect(inviteTypeWordKey(undefined)).toBe('other');
    expect(inviteTypeWordKey('cruise')).toBe('other');
  });
});

describe('shared image background', () => {
  it('is one scene for every group', () => {
    expect(existsSync(join(__dirname, '../assets/images/invite-card/background.webp'))).toBe(true);
  });
});

describe('wording on the shared image', () => {
  it('reads singular and plural people in English', () => {
    const forms = STRINGS_BY_LANGUAGE.en.people.inviteMembersHere;
    expect(plural('en', 1, forms)).toBe('1 person already here');
    expect(plural('en', 3, forms)).toBe('3 people already here');
  });

  it('puts the type word into the subtitle', () => {
    const line = fill(STRINGS_BY_LANGUAGE.en.people.cardScanSubtitle, { type: 'trip' });
    expect(line).toBe('to join the trip on Waves');
  });

  it('has every card string in every language', () => {
    for (const language of LANGUAGES) {
      const people = STRINGS_BY_LANGUAGE[language].people;
      for (const key of [
        'cardScanTitle',
        'cardScanSubtitle',
        'cardOr',
        'cardJoinLink',
        'cardCopy',
        'cardNoApp',
        'cardJoinFast',
        'cardStartSplitting',
      ] as const) {
        expect(people[key].length).toBeGreaterThan(0);
      }
    }
  });
});
