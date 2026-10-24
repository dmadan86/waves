import type { AdsStatus } from './rewardedAdsPure';

export const NATIVE_DAILY_CAP = 3;
export function nativePosition(rowCount: number): number | null {
  return rowCount > 8 ? 8 : null;
}
export function nativeEligible(
  signedIn: boolean,
  enabled: boolean,
  status: AdsStatus | null | undefined,
  impressions: number,
): boolean {
  return (
    signedIn &&
    enabled &&
    status?.eligible === true &&
    Number.isInteger(impressions) &&
    impressions >= 0 &&
    impressions < NATIVE_DAILY_CAP
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
