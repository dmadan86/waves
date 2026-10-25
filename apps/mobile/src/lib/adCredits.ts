import { randomUUID } from 'expo-crypto';
import { backend } from '@/lib/backend';
import { adTimeout } from '@/lib/adTimeout';
import { parseCredits, parseSpend, type CreditKind } from './adCreditsPure';
export async function readCredits() {
  try {
    const result = await adTimeout(backend.rpc('waves_my_credits'));
    return result && !result.error ? parseCredits(result.data) : null;
  } catch {
    return null;
  }
}
export async function spendCredits(kind: CreditKind) {
  try {
    const result = await adTimeout(
      backend.rpc('waves_spend_credits', { p_kind: kind, p_event_id: randomUUID() }),
    );
    return result && !result.error ? parseSpend(result.data) : null;
  } catch {
    return null;
  }
}
