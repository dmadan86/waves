import { describe, expect, it, vi } from 'vitest';

import { outcomeFromCodes, readInviteFromPhoto } from '../src/lib/qrPhoto';

const link = 'https://app.wavs.co.in/join#photo-token';

describe('outcomeFromCodes', () => {
  it('reports no QR for an empty decode', () => {
    expect(outcomeFromCodes([])).toEqual({ kind: 'no-qr' });
  });

  it('reports invalid when no code is a Waves invite', () => {
    expect(outcomeFromCodes([{ data: 'https://example.com/menu' }])).toEqual({ kind: 'invalid' });
  });

  it('takes the first code that is an invite, skipping others', () => {
    const out = outcomeFromCodes([{ data: 'hello' }, { data: link }, { data: 'x' }]);
    expect(out).toEqual({ kind: 'token', token: 'photo-token' });
  });
});

describe('readInviteFromPhoto', () => {
  it('is a no-op on cancel and never decodes', async () => {
    const scan = vi.fn();
    expect(await readInviteFromPhoto({ pick: async () => null, scan })).toEqual({
      kind: 'cancelled',
    });
    expect(scan).not.toHaveBeenCalled();
  });

  it('decodes the picked uri', async () => {
    const scan = vi.fn(async () => [{ data: link }]);
    const out = await readInviteFromPhoto({ pick: async () => 'file:///a.png', scan });
    expect(scan).toHaveBeenCalledWith('file:///a.png');
    expect(out).toEqual({ kind: 'token', token: 'photo-token' });
  });

  it('maps picker and decoder failures to no-qr', async () => {
    expect(
      await readInviteFromPhoto({
        pick: async () => {
          throw new Error('boom');
        },
        scan: async () => [],
      }),
    ).toEqual({ kind: 'no-qr' });
    expect(
      await readInviteFromPhoto({
        pick: async () => 'file:///a.png',
        scan: async () => {
          throw new Error('bad image');
        },
      }),
    ).toEqual({ kind: 'no-qr' });
  });
});
