export async function attachRentalDocs<T, O>(
  sources: readonly T[],
  oldDocs: readonly O[],
  attach: (source: T) => Promise<unknown>,
  removeOld: (doc: O) => Promise<unknown>,
  reload: () => Promise<unknown>,
): Promise<void> {
  let saved = 0;
  try {
    for (const source of sources) {
      await attach(source);
      saved++;
    }
  } catch (error) {
    if (saved > 0) await reload().catch(() => undefined);
    throw error;
  }
  try {
    for (const doc of oldDocs) await removeOld(doc);
  } finally {
    await reload();
  }
}

export function shouldShowPreviousBalance(value: string, previous: string, mask: string): boolean {
  return value !== mask && previous !== mask;
}

export function shouldAnimatePostedLayout(postedKey: string | null): boolean {
  return postedKey !== null;
}

export function shouldAnimateFlowStep(index: number): boolean {
  return index > 0;
}
