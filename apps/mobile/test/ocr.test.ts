import { describe, expect, it } from 'vitest';

import { recogniseReceipt } from '../src/lib/ocr';

describe('recogniseReceipt', () => {
  it('has no on-device recogniser, so every caller falls back to uploading the image', async () => {
    await expect(recogniseReceipt('file://receipt.jpg')).resolves.toBeNull();
  });
});
