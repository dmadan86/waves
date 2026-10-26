/** Keep the action readable while the wallet is loading or unavailable. */
export function homeCreditsLabel(
  balance: number | null | undefined,
  strings: { creditsTitle: string; creditsLabel: string },
): string {
  return balance == null
    ? strings.creditsTitle
    : strings.creditsLabel.replace(/\{n\}/g, String(balance));
}
