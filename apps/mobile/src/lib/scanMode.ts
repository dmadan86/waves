/**
 * The `mode` param the scan screen can be opened with. `paste` drops straight
 * into the "Paste a link instead" step, for somebody who already has a link or
 * code and has no use for the viewfinder.
 */
export const SCAN_PASTE_MODE = 'paste';

/** Whether the route's `mode` param asks for the paste step (a repeated param
 *  arrives as an array; the first value counts). */
export function scanOpensPaste(mode: string | string[] | undefined): boolean {
  const value = Array.isArray(mode) ? mode[0] : mode;
  return value === SCAN_PASTE_MODE;
}
