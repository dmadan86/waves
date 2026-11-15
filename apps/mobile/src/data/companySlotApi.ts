/** Server calls for paid extra companies (see 20261120090000_company_slots). */

import { backend } from '@/lib/backend';
import type { SlotStatus } from '@/lib/companySlots';

/** The server's answer, or null when it cannot be reached (the caller then falls back to the local count). */
export async function fetchSlotStatus(): Promise<SlotStatus | null> {
  const { data, error } = await backend.rpc('waves_company_slot_status');
  if (error || !data) return null;
  return data as unknown as SlotStatus;
}

/** Wait for the store's purchase to reach the server (webhook), up to ~12 seconds. */
export async function waitForFreeSlot(tries = 12): Promise<boolean> {
  for (let i = 0; i < tries; i += 1) {
    if ((await fetchSlotStatus())?.has_free_slot) return true;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

/** Bind a free slot to a lapsed company and lift its read-only state. */
export async function renewCompanySlot(groupId: string): Promise<boolean> {
  const { data, error } = await backend.rpc('waves_company_slot_renew', { p_group_id: groupId });
  if (error) throw new Error(error.message);
  return data === true;
}
