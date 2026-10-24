/** One UI host serves every group-create entry point (voice, captures, friends). */
export type ActionAdPlacement = 'group_create_rewarded' | 'export_rewarded';
type Handler = (placement: ActionAdPlacement) => Promise<boolean>;
let handler: Handler | null = null;
export function registerAdGate(next: Handler) {
  handler = next;
  return () => {
    if (handler === next) handler = null;
  };
}
export async function requestActionAd(placement: ActionAdPlacement): Promise<boolean> {
  // No mounted host (boot, locked, tests): preserve availability.
  return handler ? handler(placement) : true;
}
export class AdGateCancelledError extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'AdGateCancelledError';
  }
}
