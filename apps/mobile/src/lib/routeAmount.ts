/**
 * An amount that arrived as a route parameter.
 *
 * Hand-offs between screens carry money as a decimal string in the URL — the
 * quick sheet to the group form, the quick sheet to the personal entry form,
 * the Review inbox to either. A route parameter is not a trusted integer: it
 * can be absent, empty, a leftover from an older link, or whatever a deep link
 * put there. `BigInt('')` throws, and a throw while a screen is seeding its
 * state is a white screen rather than a wrong number.
 *
 * So the failure is nothing — a form that opens at zero, which is exactly what
 * a form that was handed nothing should do.
 */
export function routeAmount(value: string | undefined): bigint {
  if (!value) return 0n;
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}
