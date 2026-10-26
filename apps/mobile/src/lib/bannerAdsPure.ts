export const HOME_BANNER_MIN_GROUPS = 10;

export function showHomeBanner(totalGroupCount: number): boolean {
  return totalGroupCount >= HOME_BANNER_MIN_GROUPS;
}

export function bannerGateOpen(status: { bannerEligible?: boolean } | null | undefined): boolean {
  return status?.bannerEligible === true;
}

export function bannerUnitId(
  platform: string,
  configured: string | undefined,
  dev: boolean,
): string {
  return (
    (!dev && configured?.trim()) ||
    (platform === 'ios'
      ? 'ca-app-pub-3940256099942544/2934735716'
      : 'ca-app-pub-3940256099942544/6300978111')
  );
}
