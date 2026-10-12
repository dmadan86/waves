/**
 * An empty record keyed by names read from a user's file. It has no prototype,
 * so a person called `__proto__` or `constructor` is just a key and can never
 * reach Object.prototype.
 */
export function nameMap<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}
