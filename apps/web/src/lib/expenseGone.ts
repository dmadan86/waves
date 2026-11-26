/**
 * True when the expense being edited no longer exists as a live row, because
 * somebody (often another tab of the same person) deleted it. The write does
 * not refuse in that case, so saving would look fine and change nothing.
 */
export function isExpenseGone(current: { deleted_at: string | null } | null): boolean {
  return current === null || current.deleted_at !== null;
}
