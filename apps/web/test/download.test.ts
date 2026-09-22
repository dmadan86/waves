/**
 * What an export must survive on its way from the function to the disk.
 *
 * The interesting case is the PDF, which arrives base64 and used to arrive
 * nowhere: the browser was handed the encoded text under a `.pdf` name. The
 * second test is the reason the decode is written a byte at a time — a PDF is
 * full of bytes above 0x7f, and putting the Latin-1 string `atob` returns
 * through UTF-8 encoding lengthens every one of them.
 */

import { describe, expect, it } from 'vitest';

import { toBlob } from '../src/lib/download';

describe('making a file out of what the server sent', () => {
  it('keeps a text format exactly as it came', async () => {
    const blob = toBlob({
      filename: 'waves.csv',
      contentType: 'text/csv',
      content: 'group,amount\nGoa,1200\n',
    });
    expect(blob.type).toBe('text/csv');
    await expect(blob.text()).resolves.toBe('group,amount\nGoa,1200\n');
  });

  it('decodes a PDF rather than saving the letters that spell one', async () => {
    const bytes = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0xff]);
    const blob = toBlob({
      filename: 'waves.pdf',
      contentType: 'application/pdf',
      content: Buffer.from(bytes).toString('base64'),
      encoding: 'base64',
    });
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
  });

  it('does not lengthen a byte above 0x7f', async () => {
    // Every byte in the file, to prove none of them is re-encoded on the way.
    const bytes = Uint8Array.from({ length: 256 }, (_, index) => index);
    const blob = toBlob({
      filename: 'waves.pdf',
      contentType: 'application/pdf',
      content: Buffer.from(bytes).toString('base64'),
      encoding: 'base64',
    });
    expect(blob.size).toBe(256);
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
  });
});
