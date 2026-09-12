/**
 * The named ways of getting another person into a group, and the order they are
 * offered in.
 *
 * The group settings screen used to answer "how do I add someone?" with an
 * unlabelled text field, a ghost button reading "Browse my contacts", and —
 * four rows further down the page, in a card of its own — the invite link.
 * Three ways in, none of which said where the person was coming from before you
 * pressed it, and the one most people actually reach for (send a link, they
 * join themselves) did not look like part of adding anybody at all.
 *
 * So the doors are described here rather than drawn inline: a key, a mark, a
 * name, and one line saying what pressing it does. Keeping them in a pure
 * module has a point beyond tidiness — the screen renders whatever this returns,
 * so "which ways does this group offer, in what order, leading where" becomes a
 * question a test can ask without a renderer, which is the only kind of test
 * this app runs (see `vitest.config.ts`).
 *
 * Two things are deliberately *not* here:
 *
 *  - Typing a name. It is not a door — there is nowhere to go — it is the
 *    fallback field under the rule, which is what ADR-006 actually says: a name
 *    alone is enough to start splitting with somebody, not that a name alone is
 *    the first thing to reach for. The members screen settled on the same shape.
 *  - "From another group" — the people already in your other groups, which is
 *    what a second trip with the same friends wants and probably the commonest
 *    reason this section is opened at all. Nothing in the app does it today.
 *    The contacts picker comes closest: it floats people you have written down
 *    before to the head of its list and names the group they are already in —
 *    but only for the ones it can match against the phone's address book, and
 *    only on the screens that hand it that index. A row leading nowhere is
 *    worse than no row, so none is returned until the flow exists.
 */

import Ionicons from '@expo/vector-icons/Ionicons';

import type { UiStrings } from '@/i18n';

export type AddSomeoneRouteKey = 'contacts' | 'fromAnotherGroup' | 'inviteLink';

export interface AddSomeoneRoute {
  /** Stable id — what the screen switches on, never what it draws. */
  readonly key: AddSomeoneRouteKey;
  readonly icon: keyof typeof Ionicons.glyphMap;
  /** The row's name. On its own it has to predict what pressing it does. */
  readonly title: string;
  /** The line under it, saying where the person is coming from. */
  readonly hint: string;
  /**
   * What a screen reader hears. The name and the hint together, because a
   * reader that stops at "From your contacts" has been told a place and not an
   * act — the hint is the half that says what the tap will do.
   */
  readonly spoken: string;
  /** The route pressing it pushes. */
  readonly href: string;
}

export interface AddSomeoneContext {
  readonly groupId: string;
  readonly t: UiStrings;
  /**
   * Whether this device has an address book to read at all. False on web, where
   * `expo-contacts` has no implementation and the picker can do nothing but
   * apologise — so the row is dropped rather than drawn as a door into a dead
   * end. It is only the *device* question, never the permission one: a refusal
   * is answered inside the picker, on its own screen, and coming back leaves
   * every other way in this section untouched.
   */
  readonly addressBook: boolean;
  /**
   * Whether any of the viewer's *other* groups holds somebody this one could
   * take. Decided by running the real selection rather than a proxy like "is in
   * more than one group": a lone other group made up entirely of real account
   * holders has nobody to copy, and a row opening onto an empty list is the
   * dead end this module exists to refuse.
   */
  readonly otherGroupPeople: boolean;
}

export function addSomeoneRoutes({
  groupId,
  t,
  addressBook,
  otherGroupPeople,
}: AddSomeoneContext): readonly AddSomeoneRoute[] {
  const routes: AddSomeoneRoute[] = [];

  // Ordered by how often each is the right answer rather than alphabetically:
  // most people added to a group are already in the phone, and the link is for
  // the ones who are not.
  if (addressBook) {
    routes.push({
      key: 'contacts',
      icon: 'people-outline',
      // The picker's own screen title, on purpose: the row and the screen it
      // opens say the same words, so arriving confirms rather than surprises.
      title: t.misc.fromYourContacts,
      hint: t.people.fromContactsHint,
      spoken: `${t.misc.fromYourContacts}, ${t.people.fromContactsHint}`,
      href: '/contact-picker',
    });
  }

  // Second rather than first, though it is the case people describe when asked
  // — "the same friends, a new trip". The address book is the bigger net and
  // the one that works for somebody whose first group this nearly is; this row
  // only has anything to offer once there is a second group to take from.
  if (otherGroupPeople) {
    routes.push({
      key: 'fromAnotherGroup',
      icon: 'albums-outline',
      title: t.people.fromAnotherGroup,
      hint: t.people.fromAnotherGroupHint,
      spoken: `${t.people.fromAnotherGroup}, ${t.people.fromAnotherGroupHint}`,
      href: '/add-from-another-group',
    });
  }

  routes.push({
    key: 'inviteLink',
    icon: 'qr-code-outline',
    title: t.people.shareJoinLink,
    hint: t.people.shareJoinLinkHint,
    spoken: `${t.people.shareJoinLink}, ${t.people.shareJoinLinkHint}`,
    href: `/group/${groupId}/invite`,
  });

  return routes;
}
