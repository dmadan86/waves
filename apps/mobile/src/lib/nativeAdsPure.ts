type NativeGate = {
  enabled?: boolean;
  nativeDailyCap?: number | null;
  settings?: { native_daily_cap?: number | null };
};
export function nativeDailyCap(gate: NativeGate | null | undefined): number | null | undefined {
  return gate?.settings?.native_daily_cap !== undefined
    ? gate.settings.native_daily_cap
    : gate?.nativeDailyCap;
}
export function nativeCapacityAvailable(
  impressions: number,
  pending: number,
  cap?: number | null,
): boolean {
  return (
    Number.isInteger(impressions) &&
    impressions >= 0 &&
    Number.isInteger(pending) &&
    pending >= 0 &&
    (cap == null || impressions + pending < cap)
  );
}
export function nativePositions(count: number, seed: string): number[] {
  if (!Number.isFinite(count) || count < 8) return [];
  // FNV-1a seeds a fresh mulberry32 stream so growing lists keep their prefix.
  let state = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    state = Math.imul(state ^ seed.charCodeAt(i), 0x01000193);
  }
  const random = () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const positions: number[] = [];
  for (let n = 5; n < count; n += 15 + Math.floor(random() * 6)) positions.push(n);
  return positions;
}
export function nativeEligible(
  signedIn: boolean,
  enabled: boolean,
  gate: NativeGate | null | undefined,
  impressions: number,
): boolean {
  return (
    signedIn &&
    enabled &&
    gate?.enabled === true &&
    nativeCapacityAvailable(impressions, 0, nativeDailyCap(gate))
  );
}
export function nativeUnitId(
  platform: string,
  configured: string | undefined,
  dev: boolean,
): string {
  return (
    (!dev && configured?.trim()) ||
    (platform === 'ios'
      ? 'ca-app-pub-3940256099942544/3986624511'
      : 'ca-app-pub-3940256099942544/2247696110')
  );
}
