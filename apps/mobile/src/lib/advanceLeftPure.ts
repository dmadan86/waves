/** Advance still to recover: given, less taken back from wages, less cash returned directly. Never below zero. */
export function advanceLeft(advances: bigint, wageRecovery: bigint, returned: bigint): bigint {
  const left = advances - wageRecovery - returned;
  return left > 0n ? left : 0n;
}
