/**
 * The decisions behind "Link to a Waves user" that need no screen: which
 * channel a typed value is looked up on, who the sheet offers, and what the
 * server's one-word reasons say in the viewer's language.
 */

import { describe, expect, it, vi } from 'vitest';

import { Language, STRINGS_BY_LANGUAGE, type UiStrings } from '@/i18n';
import { channelFor, linkReasonText, matchPeople, membersAsPeople } from '@/lib/linkMember';

vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }));

const t = STRINGS_BY_LANGUAGE[Language.En];

describe('channelFor', () => {
  it('reads an address as email and six or more digits as a phone', () => {
    expect(channelFor('renny@example.com')).toBe('email');
    expect(channelFor(' +91 98765 43210 ')).toBe('phone');
    expect(channelFor('98765')).toBeNull();
    expect(channelFor('Renny')).toBeNull();
    expect(channelFor('@')).toBeNull();
  });
});

describe('matchPeople', () => {
  const people = [{ name: 'Arun Kumar' }, { name: 'Renny' }, { name: 'Priya' }];
  it('filters by name, case-blind, and returns everyone for an empty box', () => {
    expect(matchPeople('', people)).toEqual(people);
    expect(matchPeople('  ', people)).toEqual(people);
    expect(matchPeople('ARUN', people)).toEqual([{ name: 'Arun Kumar' }]);
    expect(matchPeople('nn', people)).toEqual([{ name: 'Renny' }]);
    expect(matchPeople('zed', people)).toEqual([]);
  });
});

describe('membersAsPeople', () => {
  const members = [
    {
      id: 'me',
      profile_id: 'p-me',
      left_at: null,
      profile: { display_name: 'Madan', avatar_url: null },
    },
    {
      id: 'm-arun',
      profile_id: 'p-arun',
      left_at: null,
      profile: { display_name: 'Arun', avatar_url: 'a.png' },
    },
    {
      id: 'm-gone',
      profile_id: 'p-gone',
      left_at: '2026-01-01',
      profile: { display_name: 'Gone', avatar_url: null },
    },
    { id: 'ghost-1', profile_id: null, left_at: null, profile: null },
    {
      id: 'm-zara',
      profile_id: 'p-zara',
      left_at: null,
      profile: { display_name: 'Zara', avatar_url: null },
    },
  ];

  it('offers only live members with an account, never the viewer or the placeholder, by name', () => {
    expect(membersAsPeople(members, 'p-me', 'ghost-1')).toEqual([
      { profileId: 'p-arun', name: 'Arun', avatarUrl: 'a.png', memberId: 'm-arun' },
      { profileId: 'p-zara', name: 'Zara', avatarUrl: null, memberId: 'm-zara' },
    ]);
  });

  it('with no viewer yet, offers everybody rather than matching the first ghost', () => {
    expect(membersAsPeople(members, undefined, 'ghost-1').map((p) => p.memberId)).toEqual([
      'm-arun',
      'me',
      'm-zara',
    ]);
  });
});

describe('linkReasonText', () => {
  it('words every reason the server gives, and falls back to a plain failure', () => {
    expect(linkReasonText('GUEST', t)).toBe(t.link.guest);
    expect(linkReasonText('THAT_IS_YOU', t)).toBe(t.link.thatIsYou);
    expect(linkReasonText('RATE_LIMITED', t)).toBe(t.link.rateLimited);
    expect(linkReasonText('NOT_ALLOWED', t)).toBe(t.link.notAllowed);
    expect(linkReasonText('NOT_FOUND', t)).toBe(t.link.notFound);
    expect(linkReasonText('NOT_A_PLACEHOLDER', t)).toBe(t.link.placeTaken);
    expect(linkReasonText('NOT_CLAIMABLE', t)).toBe(t.link.placeTaken);
    expect(linkReasonText('ALREADY_DECIDED', t)).toBe(t.link.placeTaken);
    expect(linkReasonText('ACCOUNT_REQUIRED', t)).toBe(t.link.needsAccount);
    expect(linkReasonText('SOMETHING_NEW', t)).toBe(t.link.failed);
    expect(linkReasonText(undefined, t)).toBe(t.link.failed);
  });

  it('is worded in every language the app speaks', () => {
    for (const language of Object.values(Language)) {
      const strings = STRINGS_BY_LANGUAGE[language];
      for (const key of Object.keys(t.link) as (keyof UiStrings['link'])[]) {
        expect(strings.link[key], `${language}.link.${key}`).toBeTruthy();
      }
    }
  });
});
