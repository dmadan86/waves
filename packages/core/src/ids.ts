/**
 * A uuid-shaped id derived from what it identifies, rather than from chance.
 *
 * Where a row stands for one *thing* — the June occurrence of a rule, the "chit
 * fund" entry of a pack — a random id makes writing it twice produce two rows,
 * and every writer then has to remember to look first. Deriving the id from the
 * thing makes the second write an upsert of the first, whoever makes it and
 * whenever: an auto catch-up racing a manual confirmation, a re-install after a
 * reinstall, two devices offline at once. Idempotence stops being a discipline
 * and becomes a property.
 *
 * Two FNV-1a passes fill a uuid-shaped 32 hex characters, which Postgres's
 * `uuid` accepts. It is not a cryptographic hash and does not need to be —
 * nothing here is a secret, and within one person's ledger the collision odds
 * are vanishing.
 */

/**
 * The same seed always gives the same id; different seeds effectively never
 * collide. Callers namespace their own seeds (`pack:<id>:<key>`) so two kinds of
 * thing cannot land on one id.
 */
export function deterministicId(seed: string): string {
  const pass = (offset: number): string => {
    let hash = offset >>> 0;
    for (let i = 0; i < seed.length; i += 1) {
      hash ^= seed.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  };
  const hex = pass(0x811c9dc5) + pass(0x7ee3a5b1) + pass(0x243f6a88) + pass(0x9e3779b9);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
