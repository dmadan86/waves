import { describe, expect, it, vi } from 'vitest';

import { uploadWhenAllowed } from '../src/lib/logoUploadWhenReady';

const fast = { sleep: async () => undefined, tries: 4 };

describe('uploadWhenAllowed', () => {
  it('waits until the server allows it, then uploads once', async () => {
    const answers = [false, false, true];
    const upload = vi.fn(async () => 'ok');
    const ok = await uploadWhenAllowed(async () => answers.shift() ?? true, upload, fast);
    expect(ok).toBe(true);
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('never uploads when it is never allowed', async () => {
    const upload = vi.fn(async () => 'ok');
    expect(await uploadWhenAllowed(async () => false, upload, fast)).toBe(false);
    expect(upload).not.toHaveBeenCalled();
  });

  it('survives a failing check and reports a failed upload', async () => {
    let n = 0;
    const canUpload = async () => {
      if (n++ === 0) throw new Error('offline');
      return true;
    };
    expect(
      await uploadWhenAllowed(
        canUpload,
        async () => {
          throw new Error('x');
        },
        fast,
      ),
    ).toBe(false);
  });
});
