/** An unknown wallet stays neutral until its balance and voice cost arrive. */
export function isHomeCreditsLow(
  balance: number | null | undefined,
  voiceCost: number | null | undefined,
): boolean {
  return balance != null && voiceCost != null && balance < voiceCost;
}
