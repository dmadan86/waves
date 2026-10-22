/**
 * The retired token mint (abuse audit H1 / WAV-09): a token handed to the phone
 * bought unbounded Deepgram minutes per mint. The handler now answers 410 to
 * everything and consults nothing: no auth, no flag, no mint, no Deepgram.
 */

import { describe, expect, it, vi } from 'vitest';

import { handleVoiceStreamToken, VOICE_STREAM_TOKEN_RETIRED, type Deps } from './handler.ts';

function makeDeps() {
  const getUser = vi.fn(async () => ({ data: { user: { id: 'profile-me' } }, error: null }));
  const rpc = vi.fn(async () => ({ data: true, error: null }));
  const fetchMock = vi.fn(
    async () => new Response(JSON.stringify({ access_token: 'tmp-token', expires_in: 60 })),
  );
  const rateLimit = vi.fn(async () => undefined);
  const deps: Deps = {
    env: (n) => ({ DEEPGRAM_API_KEY: 'dg' })[n],
    caller: { auth: { getUser } } as never,
    service: { rpc } as never,
    fetch: fetchMock as unknown as typeof fetch,
    rateLimit,
  };
  return { deps, getUser, rpc, fetchMock, rateLimit };
}

const request = (init: RequestInit = { method: 'POST', body: '{"locale":"en"}' }) =>
  new Request('https://x/voice-stream-token', init);

describe('handleVoiceStreamToken (retired)', () => {
  it('answers 410 VOICE_STREAM_TOKEN_RETIRED to a well-formed request', async () => {
    const { deps } = makeDeps();
    await expect(handleVoiceStreamToken(request(), deps)).rejects.toMatchObject({
      status: 410,
      code: VOICE_STREAM_TOKEN_RETIRED,
    });
  });

  it('mints nothing and reads nothing: no auth, no flag, no stream mint, no Deepgram', async () => {
    const { deps, getUser, rpc, fetchMock, rateLimit } = makeDeps();
    await handleVoiceStreamToken(request(), deps).catch(() => null);
    expect(getUser).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(rateLimit).not.toHaveBeenCalled();
  });

  it('is 410 for every method and body, so no variant of the old call still mints', async () => {
    const { deps } = makeDeps();
    for (const init of [
      { method: 'GET' },
      { method: 'POST', body: 'not json' },
      { method: 'POST', body: JSON.stringify({ locale: 'ta', groupId: 'g1' }) },
    ]) {
      await expect(handleVoiceStreamToken(request(init), deps)).rejects.toMatchObject({
        status: 410,
      });
    }
  });
});
