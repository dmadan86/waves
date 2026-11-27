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

/**
 * Personal and household spaces draw no floating button: adding happens from a "+" in the
 * header of the screens that add things (docs/design-standard.md, Add controls). Kept as a
 * rule so the bar and its tests agree.
 */
export function personalShowsAddFab(_segments: readonly string[]): boolean {
  return false;
}

/**
 * Whether a floating button is actually drawn, so screens reserve room for it
 * only then (an empty band above the tab bar otherwise pushes footers up).
 */
export function fabDrawn(input: {
  personal: boolean;
  company: boolean;
  noAdd: boolean;
  segments: readonly string[];
}): boolean {
  // Only the company bar still floats its buttons; Personal and household spaces never do.
  return input.company && !input.noAdd;
}
