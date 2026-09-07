/**
 * Matching an address-book entry — against what you typed, and against a person
 * Waves already has on file.
 *
 * All of it runs on the phone. Nothing here reads the network and nothing here
 * is ever handed a server response about the address book: the "does Waves
 * already know this person" question is answered against the ghosts *you* have
 * already created in *your* groups, which are rows the device already holds
 * (ADR-005). The usual version of that feature posts the whole book to a server
 * and asks it who is a user; that endpoint does not exist and this file is
 * deliberately the reason it does not need to (ADR-006).
 *
 * Two rules do the real work, and both exist because of how numbers are written
 * down rather than how they are dialled:
 *
 *  - A name is folded before it is compared, so `José` is found by `jose` and
 *    `Ramesh` by `ramesh`. Without it a search field is only useful to somebody
 *    who types their friends' names with the accents on.
 *  - A number is compared by its digits with the shorter one allowed to be a
 *    suffix of the longer. The same Indian mobile is written `+91 98765 43210`
 *    in one contact card, `09876543210` in the next and `9876543210` in a third;
 *    string equality calls those three different people, and greys out nobody.
 */

/** The shape both a picked contact and a stored member reduce to here. */
export interface AddressLike {
  readonly email: string | null;
  readonly phone: string | null;
}

/**
 * Case- and accent-insensitive text for comparison only — never for display.
 *
 * NFD splits an accented letter into the letter and its mark, and the mark is
 * then dropped, so the fold is script-agnostic: Tamil and Devanagari have no
 * combining marks to lose and come back unchanged.
 */
export function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase();
}

/**
 * One written decimal digit, in the numeral systems the app ships UI for.
 *
 * JavaScript's `\d` and `Number()` only understand ASCII digits, but address
 * books on Arabic, Hindi and Tamil phones can contain local numerals. Search and
 * duplicate detection are comparison-only paths, so folding them to ASCII is the
 * right representation here and never changes what is displayed.
 */
function asciiDigit(char: string): string | null {
  const code = char.codePointAt(0);
  if (code === undefined) return null;
  if (code >= 0x30 && code <= 0x39) return String(code - 0x30);
  if (code >= 0x660 && code <= 0x669) return String(code - 0x660);
  if (code >= 0x6f0 && code <= 0x6f9) return String(code - 0x6f0);
  if (code >= 0x966 && code <= 0x96f) return String(code - 0x966);
  if (code >= 0xbe6 && code <= 0xbef) return String(code - 0xbe6);
  return null;
}

/**
 * Just the digits, with any leading trunk zero dropped.
 *
 * The zero in `09876543210` is a dialling instruction for the local network,
 * not part of the number, and it is the single most common reason the same
 * person looks like two people.
 */
export function digitsOf(value: string): string {
  let digits = '';
  for (const char of value) digits += asciiDigit(char) ?? '';
  return digits.replace(/^0+/, '');
}

/**
 * Whether two written numbers are the same line.
 *
 * A short number has to match outright — a five-digit shortcode that happens to
 * end a real number is a coincidence, not a match. From seven digits up the
 * shorter is allowed to be the tail of the longer, which is exactly the
 * with-country-code versus without-country-code case.
 */
export function samePhone(a: string | null, b: string | null): boolean {
  const left = a ? digitsOf(a) : '';
  const right = b ? digitsOf(b) : '';
  if (!left || !right) return false;
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  if (shorter.length < 7) return shorter === longer;
  return longer.endsWith(shorter);
}

/** Two addresses for the same person. Email is exact once folded; a number is not. */
export function sameAddress(a: AddressLike, b: AddressLike): boolean {
  if (a.email && b.email && fold(a.email) === fold(b.email)) return true;
  return samePhone(a.phone, b.phone);
}

/**
 * Whether a contact answers the search box.
 *
 * Name, email and number all count, because people reach for whichever one they
 * remember. A query with digits in it is matched against the digits of the
 * number so spacing and punctuation in either the contact card or the search
 * box stop mattering; three digits is the floor, below which every number in
 * the book matches and the list stops meaning anything.
 */
export function matchesContactQuery(
  contact: { readonly name: string } & AddressLike,
  query: string,
): boolean {
  const needle = fold(query.trim());
  if (!needle) return true;
  if (fold(contact.name).includes(needle)) return true;
  if (contact.email && fold(contact.email).includes(needle)) return true;
  const typed = digitsOf(query);
  if (typed.length >= 3 && contact.phone) return digitsOf(contact.phone).includes(typed);
  return false;
}

// ─────────────────────────────────────────── who Waves already has ──

/** Somebody already in at least one of your groups, and which ones. */
export interface KnownPerson extends AddressLike {
  readonly name: string;
  /** Every group they are a member of, so the picker can say "in 3 of yours". */
  readonly groupIds: readonly string[];
  /** Those groups' labels, in the same order, for the one-group case. */
  readonly groupNames: readonly string[];
}

/**
 * The whole set. A list rather than a map, because a phone number has no single
 * canonical spelling to key on — `samePhone` decides, not string equality.
 */
export interface KnownIndex {
  readonly people: readonly KnownPerson[];
}

/** One group's worth of input, so building the index stays a pure function. */
export interface KnownGroupInput {
  readonly id: string;
  readonly label: string;
  readonly members: readonly ({ readonly name: string } & AddressLike)[];
}

/**
 * Fold the members of every group into one row per human.
 *
 * The same friend is usually a separate ghost row in each group, so the merge
 * matters: without it the picker would say "already in Goa" for somebody who is
 * in Goa, Flatmates and last year's wedding, and the count would always read
 * one. Two rows are the same person when they share an address, or — for
 * account-holders, who have no address to share here — when the name matches
 * exactly. Name is the weaker rule and is used only where there is no address
 * at all, because two flatmates called Ravi are two debts.
 */
export function buildKnownIndex(groups: readonly KnownGroupInput[]): KnownIndex {
  const people: {
    name: string;
    email: string | null;
    phone: string | null;
    groupIds: string[];
    groupNames: string[];
  }[] = [];

  for (const group of groups) {
    for (const member of group.members) {
      const name = member.name.trim();
      if (!name) continue;
      const addressed = Boolean(member.email || member.phone);
      const existing = people.find((person) =>
        addressed && (person.email || person.phone)
          ? sameAddress(person, member)
          : !person.email && !person.phone && !addressed && fold(person.name) === fold(name),
      );
      if (existing) {
        // Keep the first address seen rather than the last: an earlier group is
        // where this person was first written down, and letting a later blank
        // overwrite a good number would lose the only thing that matches.
        existing.email ??= member.email;
        existing.phone ??= member.phone;
        if (!existing.groupIds.includes(group.id)) {
          existing.groupIds.push(group.id);
          existing.groupNames.push(group.label);
        }
        continue;
      }
      people.push({
        name,
        email: member.email,
        phone: member.phone,
        groupIds: [group.id],
        groupNames: [group.label],
      });
    }
  }

  return { people };
}

/**
 * The person this contact already is, or null.
 *
 * Address first and name only as a fallback, in that order and never the other
 * way round: two people called Amma in one family's address book are two
 * different debts, and the number is what tells them apart.
 */
export function lookupKnown(
  index: KnownIndex,
  contact: { readonly name: string } & AddressLike,
): KnownPerson | null {
  const byAddress = index.people.find((person) => sameAddress(person, contact));
  if (byAddress) return byAddress;
  const folded = fold(contact.name.trim());
  if (!folded) return null;
  return (
    index.people.find((person) => !person.email && !person.phone && fold(person.name) === folded) ??
    null
  );
}
