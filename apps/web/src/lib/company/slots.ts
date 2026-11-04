/**
 * Paid extra companies: a user OWNS one company free; each further one needs a slot
 * bought in the phone app. The server is the source of truth (waves_company_slot_guard);
 * this is the page's pre-check. Ported from the phone's companySlots + companySlotApi.
 */

import { supabase } from '@/lib/waves';

export interface SlotStatus {
  needs_slot: boolean;
  has_free_slot: boolean;
}

/** The server's answer, or null when it cannot be reached. */
export async function fetchSlotStatus(): Promise<SlotStatus | null> {
  const { data, error } = await supabase.rpc('waves_company_slot_status');
  if (error || !data) return null;
  return data as unknown as SlotStatus;
}

/** Create straight away, or tell them to buy a slot first. Offline, the local count decides. */
export function createGate(status: SlotStatus | null, ownedLocally: number): 'create' | 'paywall' {
  if (status) return status.needs_slot && !status.has_free_slot ? 'paywall' : 'create';
  return ownedLocally >= 1 ? 'paywall' : 'create';
}

/** True when an error is the server saying an extra company needs a slot. */
export function isSlotRequired(error: unknown): boolean {
  const message =
    typeof error === 'string'
      ? error
      : ((error as { message?: unknown } | null)?.message as string | undefined);
  return typeof message === 'string' && message.includes('COMPANY_SLOT_REQUIRED');
}
