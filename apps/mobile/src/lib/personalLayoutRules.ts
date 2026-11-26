/** Small layout decisions shared with tests so regressions can be exercised without mounting native views. */
export function overflowMenuHeight(contentHeight: number, room: number, estimate: number): number {
  return Math.min(contentHeight || estimate, Math.max(0, room));
}

export function loanNextStatus(status: 'active' | 'closed'): 'active' | 'closed' {
  return status === 'closed' ? 'active' : 'closed';
}

export function loanHeaderAddVisible(count: number): boolean {
  return count > 0;
}
