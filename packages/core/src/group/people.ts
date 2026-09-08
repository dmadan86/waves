/**
 * "Do these people already share a group?" — as one comparable key.
 *
 * A set of names is chosen in a picker, not typed in an order that means
 * anything, so "Ravi, Sam" and "sam, ravi" have to hash the same. Names are
 * trimmed, lowercased, de-duplicated, sorted and NUL-joined (NUL because it is
 * the one character a display name never carries, so "a, b" cannot collide with
 * a single person literally called "a,b").
 *
 * Deliberately names, not member ids: the people a picker offers are typed or
 * tapped by name, and "they already have a group" is a claim about the people,
 * not about which membership rows happen to represent them.
 */
export function peopleSignatureKey(names: readonly string[]): string {
  return [...new Set(names.map((name) => name.trim().toLowerCase()).filter(Boolean))]
    .sort()
    .join('\0');
}
