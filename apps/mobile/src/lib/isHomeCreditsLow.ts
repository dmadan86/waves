/** An unknown wallet stays neutral until its balance and voice cost arrive. */
export function isHomeCreditsLow(
  balance: number | null | undefined,
  voiceCost: number | null | undefined,
): boolean {
  return balance != null && voiceCost != null && balance < voiceCost;
}

export function homeCreditsAction(
  balance: number | null | undefined,
  voiceCost: number | null | undefined,
): {
  labelKey: 'creditsTitle' | 'getCredits' | 'creditOne' | 'creditMany';
  badge?: number;
  highlight: boolean;
} {
  const highlight = balance != null && (balance <= 0 || isHomeCreditsLow(balance, voiceCost));
  return {
    labelKey: highlight
      ? 'getCredits'
      : balance == null
        ? 'creditsTitle'
        : balance === 1
          ? 'creditOne'
          : 'creditMany',
    badge: highlight ? 0 : undefined,
    highlight,
  };
}
