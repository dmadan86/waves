import { readCredits, spendCredits } from './adCredits';
import { isScanQuotaMessage } from './rewardedAdsPure';
export async function withScanCredits<T>(
  scan: () => Promise<T>,
  onSpent: (n: number) => void,
): Promise<T> {
  try {
    return await scan();
  } catch (error) {
    if (!isScanQuotaMessage((error as { message?: unknown } | null)?.message)) throw error;
    const wallet = await readCredits();
    if (!wallet || wallet.reason === 'ineligible' || wallet.credits < wallet.costs.scan)
      throw error;
    const spent = await spendCredits('scan');
    if (!spent?.ok) throw error;
    if (spent.spent) onSpent(spent.spent);
    return scan();
  }
}
