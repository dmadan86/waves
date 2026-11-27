import { describe, expect, it, vi } from 'vitest';

import {
  attachRentalDocs,
  shouldShowPreviousBalance,
  shouldAnimatePostedLayout,
  shouldAnimateFlowStep,
} from '../src/lib/rentalExtrasBehavior';

describe('rental and wealth UI behavior', () => {
  it('reloads after partial attachment failure without deleting replacement files', async () => {
    const attach = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('copy failed'));
    const removeOld = vi.fn();
    const reload = vi.fn().mockResolvedValue(undefined);

    await expect(
      attachRentalDocs(['page 1', 'page 2'], ['old'], attach, removeOld, reload),
    ).rejects.toThrow('copy failed');

    expect(reload).toHaveBeenCalledOnce();
    expect(removeOld).not.toHaveBeenCalled();
  });

  it('does not render a previous masked balance', () => {
    expect(shouldShowPreviousBalance('$10', '••••', '••••')).toBe(false);
    expect(shouldShowPreviousBalance('••••', '$10', '••••')).toBe(false);
    expect(shouldShowPreviousBalance('$10', '$9', '••••')).toBe(true);
  });

  it('only animates posted layout while the posted row marker is active', () => {
    expect(shouldAnimatePostedLayout('posted')).toBe(true);
    expect(shouldAnimatePostedLayout(null)).toBe(false);
  });

  it('skips the entrance animation for the first flow step', () => {
    expect(shouldAnimateFlowStep(0)).toBe(false);
    expect(shouldAnimateFlowStep(1)).toBe(true);
  });
});
