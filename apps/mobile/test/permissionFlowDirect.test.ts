import { describe, expect, it, vi } from 'vitest';

import { ensurePermission } from '@/lib/permissionFlow';

describe('ensurePermission direct', () => {
  it('asks natively without showing the explainer', async () => {
    const explain = vi.fn();
    const request = vi.fn().mockResolvedValue({ granted: true, canAskAgain: true });
    const out = await ensurePermission('mic', {
      check: async () => ({ granted: false, canAskAgain: true }),
      request,
      explain,
      direct: true,
    });
    expect(explain).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledOnce();
    expect(out.granted).toBe(true);
  });
});
