/**
 * Which channel a typed query means, if any.
 *
 * There is no second control asking "email or phone?" — nobody types an
 * address wondering which kind it is. What the box holds decides.
 *
 * Both floors exist for the same reason: `waves_find_person` allows only a few
 * lookups per caller per day, so a query that cannot match anything must not
 * cost one. `a@@` is not an address anybody has, and four digits is not a phone
 * number anywhere; letting either through spends somebody's daily allowance to
 * be told what this function already knows.
 */
export function channelFor(query: string): 'email' | 'phone' | null {
  const value = query.trim();
  if (value.includes('@')) {
    // Exactly one `@`, something either side of it, and no whitespace in
    // between — "priya @ example.com" is a sentence about an address, not one.
    const parts = value.split('@');
    const shaped = parts.length === 2 && parts[0]!.length > 0 && parts[1]!.length > 0;
    return shaped && !/\s/.test(value) ? 'email' : null;
  }
  // Six digits is not a valid number anywhere; it is the floor below which a
  // search cannot mean anything.
  return value.replace(/[^0-9]/g, '').length >= 6 ? 'phone' : null;
}
