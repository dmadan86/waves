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

const CLAIM_TTL_MS = 10 * 60 * 1000;
const MAX_CLAIMED_CODES = 256;

const claimed = new Map<string, number>();
let now = (): number => Date.now();

/** True the first time a code is seen, false while it is still in the replay window. */
export function claimCode(code: string): boolean {
  pruneClaimedCodes(now());
  if (claimed.has(code)) return false;
  claimed.set(code, now());
  pruneClaimedCodes(now());
  return true;
}

/** Test seam. Nothing in the app calls this: the registry is per-process by design. */
export function resetClaimedCodes(): void {
  claimed.clear();
  now = () => Date.now();
}

/** Test seam for expiry and eviction. */
export function setClaimedCodeClock(clock: () => number): void {
  now = clock;
}

function pruneClaimedCodes(current: number): void {
  for (const [code, claimedAt] of claimed) {
    if (current - claimedAt <= CLAIM_TTL_MS) break;
    claimed.delete(code);
  }

  while (claimed.size > MAX_CLAIMED_CODES) {
    const oldest = claimed.keys().next().value as string | undefined;
    if (!oldest) return;
    claimed.delete(oldest);
  }
}
