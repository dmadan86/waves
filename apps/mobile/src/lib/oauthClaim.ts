/**
 * Which authorization codes this process has already spent.
 *
 * An OAuth code is single-use, and the callback carrying it can reach the app
 * twice by two unrelated routes: `WebBrowser.openAuthSessionAsync` hands it to
 * the call awaiting it, and Android also delivers the same URL as an app
 * intent. Both are legitimate — on a process that survived the round trip the
 * first wins, and on one Android killed mid-sign-in only the second exists.
 *
 * So neither can be removed, and both must not redeem. Whoever claims first
 * redeems; everybody else is told there was nothing to do, which is different
 * from being told it failed.
 *
 * Kept free of react-native imports so it can be tested in a plain node suite.
 */

const claimed = new Set<string>();

/** True the first time a code is seen, false every time after. */
export function claimCode(code: string): boolean {
  if (claimed.has(code)) return false;
  claimed.add(code);
  return true;
}

/** Test seam. Nothing in the app calls this: the set is per-process by design. */
export function resetClaimedCodes(): void {
  claimed.clear();
}
