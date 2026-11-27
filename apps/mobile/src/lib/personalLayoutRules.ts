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

/** Personal sub-screens whose one add control is the header + (docs/design-standard.md, Add controls). */
const HEADER_ADD_SCREENS = new Set(['loans', 'recurring', 'budgets', 'upcoming']);

/** Whether the tab bar's round + shows in Personal: tab roots yes; back-header sub-screens, Rentals and Investments (own Add) no. */
export function personalShowsAddFab(segments: readonly string[]): boolean {
  return !(
    (segments[0] === 'personal' &&
      (HEADER_ADD_SCREENS.has(segments[1] ?? '') || segments[1] === 'setup')) ||
    segments[0] === 'rentals' ||
    segments[0] === 'investments' ||
    segments[0] === 'profile' ||
    segments[0] === 'settings'
  );
}
