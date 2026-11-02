/** A typed percentage ("12.5") as basis points (1250); null when it is not 0-100 with at most 2 decimals. */
export function parsePercentBps(text: string): bigint | null {
  const m = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(text.trim());
  if (!m) return null;
  const bps = BigInt(m[1]!) * 100n + BigInt((m[2] ?? '').padEnd(2, '0') || '0');
  return bps > 10000n ? null : bps;
}

/** The discount in minor units for a percentage of the subtotal: rounded half up, never above the subtotal. */
export function percentToMinor(subtotalMinor: bigint, text: string): bigint {
  const bps = parsePercentBps(text);
  if (bps === null || subtotalMinor <= 0n) return 0n;
  const minor = (subtotalMinor * bps + 5000n) / 10000n;
  return minor > subtotalMinor ? subtotalMinor : minor;
}
