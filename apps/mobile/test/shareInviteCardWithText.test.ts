import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  shareImageWithText: vi.fn(),
  shareAsync: vi.fn(),
  isAvailableAsync: vi.fn(),
  captureRef: vi.fn(),
}));

vi.mock('../modules/waves-share', () => ({ shareImageWithText: m.shareImageWithText }));
vi.mock('expo-sharing', () => ({
  isAvailableAsync: m.isAvailableAsync,
  shareAsync: m.shareAsync,
}));
vi.mock('react-native-view-shot', () => ({ captureRef: m.captureRef }));
vi.mock('base64-arraybuffer', () => ({ decode: () => new ArrayBuffer(1) }));
vi.mock('expo-file-system', () => {
  class File {
    exists = false;
    uri: string;
    constructor(_dir: unknown, name: string) {
      this.uri = `file:///cache/${name}`;
    }
    delete() {}
    create() {}
    write() {}
  }
  return { File, Paths: { cache: {} } };
});

const { shareInviteCard } = await import('../src/lib/shareInviteCard');

const fallback = vi.fn();
const base = { cardRef: 1, filename: 'card.png', dialogTitle: 'title', fallback };

beforeEach(() => {
  vi.clearAllMocks();
  m.isAvailableAsync.mockResolvedValue(true);
  m.captureRef.mockResolvedValue('b64');
});

describe('shareInviteCard with text', () => {
  it('sends the card, text and subject through the native module', async () => {
    m.shareImageWithText.mockResolvedValue('shared');
    await shareInviteCard({ ...base, text: 'hi {link}', subject: 'sub', target: 'whatsapp' });
    expect(m.shareImageWithText).toHaveBeenCalledWith({
      fileUri: 'file:///cache/card.png',
      mimeType: 'image/png',
      text: 'hi {link}',
      subject: 'sub',
      target: 'whatsapp',
    });
    expect(m.shareAsync).not.toHaveBeenCalled();
    expect(fallback).not.toHaveBeenCalled();
  });

  it.each(['whatsapp', 'email'] as const)(
    'falls back to the link path for %s when unavailable',
    async (target) => {
      m.shareImageWithText.mockResolvedValue('unavailable');
      await shareInviteCard({ ...base, text: 't', target });
      expect(fallback).toHaveBeenCalledTimes(1);
      expect(m.shareAsync).not.toHaveBeenCalled();
    },
  );

  it('falls back to the image-only share for any when unavailable', async () => {
    m.shareImageWithText.mockResolvedValue('unavailable');
    await shareInviteCard({ ...base, text: 't', target: 'any' });
    expect(m.shareAsync).toHaveBeenCalledTimes(1);
    expect(fallback).not.toHaveBeenCalled();
  });

  it.each(['whatsapp', 'email', 'any'] as const)(
    'opens no second sheet when the user cancels %s',
    async (target) => {
      m.shareImageWithText.mockResolvedValue('cancelled');
      await shareInviteCard({ ...base, text: 't', target });
      expect(fallback).not.toHaveBeenCalled();
      expect(m.shareAsync).not.toHaveBeenCalled();
    },
  );

  it('uses the link path when the native call throws', async () => {
    m.shareImageWithText.mockRejectedValue(new Error('boom'));
    await shareInviteCard({ ...base, text: 't', target: 'email' });
    expect(fallback).toHaveBeenCalledTimes(1);
  });
});

describe('shareInviteCard without text', () => {
  it('keeps the image-only share and never touches the native module', async () => {
    await shareInviteCard(base);
    expect(m.shareImageWithText).not.toHaveBeenCalled();
    expect(m.shareAsync).toHaveBeenCalledTimes(1);
  });

  it('falls back when expo-sharing is unavailable', async () => {
    m.isAvailableAsync.mockResolvedValue(false);
    await shareInviteCard(base);
    expect(fallback).toHaveBeenCalledTimes(1);
  });
});
