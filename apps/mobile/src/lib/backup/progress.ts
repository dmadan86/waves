/** Public state contains no account or ledger data. */
export type RunStatus = 'preparing' | 'uploading' | 'paused' | 'complete' | 'failed' | 'cancelled';
export interface RunProgress {
  status: RunStatus;
  percent: number | null;
}
export function uploadPercent(sent: number, total: number): number | null {
  return total > 0 ? Math.min(94, 15 + Math.floor((79 * Math.max(0, sent)) / total)) : null;
}
export function shouldNotify(previous: RunProgress, next: RunProgress, elapsed: number): boolean {
  return (
    previous.status !== next.status ||
    (next.percent === 95 && previous.percent !== 95) ||
    (previous.percent !== next.percent && elapsed >= 1000)
  );
}
export const active = (state: RunProgress) =>
  ['preparing', 'uploading', 'paused'].includes(state.status);

/** Terminal transitions are explicit; only a new preparation starts a retry. */
export function transition(previous: RunProgress, next: RunProgress): RunProgress {
  if (!active(previous) && active(next) && next.status !== 'preparing') return previous;
  if (next.status === 'complete' && next.percent !== 100) return previous;
  if (active(next) && next.percent !== null && next.percent >= 100) return previous;
  return next;
}
