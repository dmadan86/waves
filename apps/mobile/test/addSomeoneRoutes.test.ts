/**
 * The "add someone" section of a group's settings says where each way in leads.
 *
 * The old section offered a bare field and a button called "Browse my
 * contacts"; nothing on screen said what pressing anything would do. These
 * routes are the fix, so what is worth holding still is not how they look but
 * what they claim: every row carries a name, a line under it and a destination,
 * in a fixed order, and a row that cannot work on this device is not drawn at
 * all rather than drawn as a door into an apology.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }));

const { STRINGS_BY_LANGUAGE } = await import('../src/i18n');
const { addSomeoneRoutes } = await import('../src/lib/addSomeoneRoutes');

const LANGUAGES = ['en', 'ta', 'hi', 'ar'] as const;

const en = STRINGS_BY_LANGUAGE.en;

/** Where the row with this key leads, or undefined when it was not drawn. */
function href(
  routes: readonly { readonly key: string; readonly href: string }[],
  key: string,
): string | undefined {
  return routes.find((route) => route.key === key)?.href;
}

describe('the ways into a group', () => {
  it('offers contacts first and the join link second on a phone', () => {
    const routes = addSomeoneRoutes({ groupId: 'trip-group', t: en, addressBook: true });
    // Order is the claim, not a coincidence: most people added to a group are
    // already in the phone, and the link is for the ones who are not.
    expect(routes.map((route) => route.key)).toEqual(['contacts', 'inviteLink']);
  });

  it('sends each row at the flow it names', () => {
    const routes = addSomeoneRoutes({ groupId: 'trip-group', t: en, addressBook: true });
    expect(href(routes, 'contacts')).toBe('/contact-picker');
    expect(href(routes, 'inviteLink')).toBe('/group/trip-group/invite');
  });

  it('keeps the group id out of the address-book route', () => {
    // The picker is a shared screen driven by the bridge, not a per-group one.
    // A groupId baked into its path would be a second, silently ignored source
    // of truth about who the ticked people are being added to.
    const routes = addSomeoneRoutes({ groupId: 'trip-group', t: en, addressBook: true });
    expect(href(routes, 'contacts')).not.toContain('trip-group');
  });

  it('drops the contacts row where there is no address book to read', () => {
    // Web has no expo-contacts at all, so that row could only ever apologise.
    const routes = addSomeoneRoutes({ groupId: 'trip-group', t: en, addressBook: false });
    expect(routes.map((route) => route.key)).toEqual(['inviteLink']);
  });

  it('leaves the other ways in alone when contacts are unavailable', () => {
    // A device that cannot read an address book can still hand somebody a link
    // — the point of dropping one row rather than the section.
    const routes = addSomeoneRoutes({ groupId: 'trip-group', t: en, addressBook: false });
    expect(href(routes, 'inviteLink')).toBe('/group/trip-group/invite');
  });

  it('gives every row a name, a hint and a spoken label that carries both', () => {
    const routes = addSomeoneRoutes({ groupId: 'trip-group', t: en, addressBook: true });
    for (const route of routes) {
      expect(route.title.trim(), route.key).not.toBe('');
      expect(route.hint.trim(), route.key).not.toBe('');
      // The name alone says a place, not an act. A screen reader that stops at
      // "From your contacts" has been told half of it.
      expect(route.spoken, route.key).toContain(route.title);
      expect(route.spoken, route.key).toContain(route.hint);
      expect(route.icon.trim(), route.key).not.toBe('');
    }
  });

  it('names the contacts row exactly as the screen it opens is titled', () => {
    // The row and the picker's own heading say the same words, so arriving
    // confirms the tap rather than surprising it.
    const routes = addSomeoneRoutes({ groupId: 'trip-group', t: en, addressBook: true });
    expect(routes[0]?.title).toBe(en.misc.fromYourContacts);
  });

  it('is written in every language', () => {
    // The parity test only checks top-level keys, so a row left in English
    // inside `people` is caught by nothing else.
    for (const language of LANGUAGES) {
      const t = STRINGS_BY_LANGUAGE[language];
      for (const route of addSomeoneRoutes({ groupId: 'trip-group', t, addressBook: true })) {
        expect(route.title.trim(), `${language}.${route.key}.title`).not.toBe('');
        expect(route.hint.trim(), `${language}.${route.key}.hint`).not.toBe('');
      }
      expect(t.people.fromContactsHint.trim(), language).not.toBe('');
      expect(t.people.shareJoinLink.trim(), language).not.toBe('');
      expect(t.people.shareJoinLinkHint.trim(), language).not.toBe('');
      // The rule under the rows, which the by-name field is labelled by.
      expect(t.people.orByName.trim(), language).not.toBe('');
    }
  });

  it('says something different in each language', () => {
    // A key copied from the English table into the other three passes every
    // "not blank" check ever written and ships an English screen anyway.
    const said = LANGUAGES.map(
      (language) =>
        `${STRINGS_BY_LANGUAGE[language].people.shareJoinLink}|${STRINGS_BY_LANGUAGE[language].people.fromContactsHint}`,
    );
    expect(new Set(said).size).toBe(LANGUAGES.length);
  });
});
