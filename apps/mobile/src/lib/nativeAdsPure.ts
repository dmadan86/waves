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
