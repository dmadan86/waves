/**
 * A one-shot handoff between a row that shows the settling country and the
 * full-screen country picker.
 *
 * The picker used to be a React Native `Modal` opened straight from the row, so
 * it rose from the bottom edge while every other full-screen page in the app
 * slides in from the leading edge. Moving it to its own route buys the app's one
 * navigation motion for free, but a pushed route cannot hand a value back the
 * way an inline callback could. So the row leaves its intent here first — which
 * country is set now, and what to do with the answer — and the route reads it
 * once on open.
 *
 * Deliberately a module singleton, not React state: it has to outlive the
 * navigation that carries the caller off-screen and back. It holds exactly one
 * request — there is only ever one picker open — and is cleared the moment it is
 * read, so a stale request can never leak into the next open. This mirrors
 * `contactPickerBridge`, which solves the same problem for the contact picker.
 */

export interface CountryRequest {
  /** The country set right now, so the picker opens with it ticked. */
  readonly initial: string | null;
  /** What the caller does with the country chosen, before the picker closes. */
  readonly onPicked: (countryCode: string | null) => void;
}

let pending: CountryRequest | null = null;

/** Stash the caller's intent, then navigate to `/country`. */
export function requestCountry(request: CountryRequest): void {
  pending = request;
}

/**
 * Take the open request and clear it in the same step — the picker reads this
 * once on mount and thereafter owns the captured request, so nothing carries
 * over to the next open whether it picks a country or is backed out of.
 */
export function takeCountryRequest(): CountryRequest | null {
  const request = pending;
  pending = null;
  return request;
}
