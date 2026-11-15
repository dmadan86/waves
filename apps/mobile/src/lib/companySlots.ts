/**
 * Paid extra companies: a user OWNS one company free; each further owned company needs its own monthly
 * "company slot" subscription. Employee/manager roles elsewhere are never counted. The server is the
 * source of truth (waves_company_slot_guard); this is the screen's pre-check and the ids it sells.
 */

/**
 * Store products, same ids on Android and iOS; edit here once the real ones exist. Mirrors
 * COMPANY_SLOT_PRODUCT_IDS in revenuecat-webhook/logic.ts. A store account can hold one subscription
 * per product, so owning N extra companies needs N ids here (add `..._2`, ...); the app offers the
 * first one the account does not already hold.
 */
export const COMPANY_SLOT_PRODUCT_IDS: readonly string[] = ['waves_company_slot_monthly'];
export const COMPANY_SLOT_ENTITLEMENT = 'company_slot';

/** What `waves_company_slot_status` answers. */
export interface SlotStatus {
  needs_slot: boolean;
  has_free_slot: boolean;
}

interface OwnedLike {
  type: string;
  deleted_at: string | null;
  created_by?: string | null;
  pending?: boolean;
}

/** Companies this viewer created and has not deleted (a not-yet-synced one counts: it is theirs). */
export function ownedCompanyCount(groups: readonly OwnedLike[], viewerId: string | null): number {
  if (!viewerId) return 0;
  return groups.filter(
    (g) =>
      g.type === 'company' &&
      !g.deleted_at &&
      (g.created_by === viewerId || (g.pending === true && !g.created_by)),
  ).length;
}

/**
 * Create straight away, or show the paywall first. The server's answer wins; offline (no answer) the
 * local count decides, and the server still checks when the create syncs.
 */
export function createGate(status: SlotStatus | null, ownedLocally: number): 'create' | 'paywall' {
  if (status) return status.needs_slot && !status.has_free_slot ? 'paywall' : 'create';
  return ownedLocally >= 1 ? 'paywall' : 'create';
}

/** True when a rejection or error is the server saying an extra company needs a slot. */
export function isSlotRequired(error: unknown): boolean {
  const message =
    typeof error === 'string'
      ? error
      : ((error as { message?: unknown } | null)?.message as string | undefined);
  return typeof message === 'string' && message.includes('COMPANY_SLOT_REQUIRED');
}
