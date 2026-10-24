import { describe, expect, it } from 'vitest';

import { receiptDisplayUri } from '../src/lib/receiptDisplayUri';

describe('receiptDisplayUri', () => {
  it.each([undefined, null, 'https://example.com/receipt.jpg'])(
    'shows a staged photo immediately despite remote result %s',
    (remote) => {
      expect(receiptDisplayUri('file:///picked.jpg', remote)).toBe('file:///picked.jpg');
    },
  );

  it.each([undefined, null, 'https://example.com/receipt.jpg'])(
    'preserves the remote resolution state %s when no device copy exists',
    (remote) => {
      expect(receiptDisplayUri(null, remote)).toBe(remote);
    },
  );
});
