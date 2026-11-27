/**
 * A voice clip recorded on the watch: decoding the file event, and turning a
 * transcript (free) or the voice-agent's response (Pro) into captures plus the
 * line the watch shows. Same safety as `voiceAdd`: unassigned captures only,
 * and a payer who is someone else is refused.
 */

import { describe, expect, it, vi } from 'vitest';

import type { VoiceAgentResponse } from '@waves/core';

import {
  outcomeFromAgent,
  outcomeFromTranscript,
  parseWatchClip,
  placeForCapture,
  placeForWatchAdd,
  isFromWatch,
  watchCaptureParsed,
  clipFileName,
  clipOfParsed,
  clipsToSweep,
  showClipPlayer,
  processClip,
  type ClipContext,
  type ClipDeps,
} from '@/lib/watch/voiceClipPure';

const ctx: ClipContext = {
  groups: [{ id: 'g1', name: 'Goa trip' }],
  defaultCurrency: 'INR',
  locale: 'en-IN',
};

const quota = { used: 1, limit: 10, tier: 'free' } as const;

function agent(
  actions: VoiceAgentResponse['actions'],
  extra: Partial<VoiceAgentResponse> = {},
): VoiceAgentResponse {
  return { schemaVersion: 1, transcript: '', actions, quota, ...extra };
}

describe('parseWatchClip', () => {
  const metadata = { t: 'voiceClip', id: 'c1', durationMs: 3000, version: 1 };

  it('decodes a clip file event', () => {
    expect(parseWatchClip({ uri: 'file:///c/a.m4a', metadata })).toEqual({
      id: 'c1',
      durationMs: 3000,
      uri: 'file:///c/a.m4a',
    });
  });

  it('rejects other kinds, bad metadata and a missing uri', () => {
    expect(
      parseWatchClip({ uri: 'file:///c/a.m4a', metadata: { ...metadata, t: 'quickAdd' } }),
    ).toBeNull();
    expect(parseWatchClip({ uri: 'file:///c/a.m4a', metadata: { t: 'voiceClip' } })).toBeNull();
    expect(parseWatchClip({ uri: '', metadata })).toBeNull();
    expect(
      parseWatchClip({ uri: 'file:///c/a.m4a', metadata: { ...metadata, version: 2 } }),
    ).toBeNull();
    expect(parseWatchClip(null)).toBeNull();
  });
});

describe('outcomeFromTranscript (free path)', () => {
  it('turns a spoken expense into a capture and an "added" line', () => {
    const out = outcomeFromTranscript('8000 for Renny', ctx);
    expect(out.captures).toHaveLength(1);
    expect(out.captures[0]?.amountMinor).toBe(800000n);
    expect(out.result.status).toBe('added');
    expect(out.result.text).toContain('8,000');
    expect(out.rawText).toBe('8000 for Renny');
  });

  it('refuses a sentence with no amount', () => {
    const out = outcomeFromTranscript('hello there', ctx);
    expect(out.captures).toEqual([]);
    expect(out.result).toMatchObject({ status: 'error', error: 'no-amount' });
  });

  it('reports silence as nothing heard', () => {
    expect(outcomeFromTranscript('   ', ctx).result).toMatchObject({
      status: 'error',
      error: 'nothing-heard',
    });
  });

  it("does not book money someone else paid as the wearer's", () => {
    const out = outcomeFromTranscript('Madan paid 500 for dinner', {
      ...ctx,
      groups: [],
    });
    // Either refused as another payer, or no amount: never a capture.
    expect(out.captures).toEqual([]);
    expect(out.result.status).toBe('error');
  });
});

describe('outcomeFromAgent (Pro path)', () => {
  it("saves a personal spend from the agent's own fields", () => {
    const out = outcomeFromAgent(
      agent([
        { type: 'add_personal', description: 'Renny', amountMinor: '800000', currency: 'INR' },
      ]),
      ctx,
    );
    expect(out.captures).toEqual([{ amountMinor: 800000n, currency: 'INR', note: 'Renny' }]);
    expect(out.result.status).toBe('added');
    expect(out.result.text).toContain('Renny');
  });

  it('reports a group expense as review and files it unassigned from the transcript', () => {
    const out = outcomeFromAgent(
      agent(
        [
          {
            type: 'add_expense',
            groupId: 'g1',
            description: 'dinner',
            amountMinor: '120000',
            currency: 'INR',
            paidByMemberId: 'm1',
            split: { mode: 'equal', shares: [{ memberId: 'm1' }, { memberId: 'm2' }] },
          },
        ],
        { transcript: '1200 dinner in Goa trip' },
      ),
      ctx,
    );
    expect(out.result.status).toBe('review');
    expect(out.captures[0]?.amountMinor).toBe(120000n);
  });

  it('runs no write for a settlement and says so', () => {
    const out = outcomeFromAgent(
      agent(
        [
          {
            type: 'record_settlement',
            groupId: 'g1',
            fromMemberId: 'm1',
            toMemberId: 'm2',
            amountMinor: '5000',
            currency: 'INR',
          },
        ],
        { transcript: 'I settled up with Anu' },
      ),
      ctx,
    );
    expect(out.captures).toEqual([]);
    expect(out.result.status).toBe('error');
  });

  it("shows the agent's question when there is nothing to save", () => {
    const out = outcomeFromAgent(
      agent([], { transcript: 'dinner', clarify: 'How much was it?' }),
      ctx,
    );
    expect(out.result).toEqual({ status: 'error', text: 'How much was it?', error: 'clarify' });
  });

  it('ignores a zero or malformed personal amount', () => {
    const out = outcomeFromAgent(
      agent([{ type: 'add_personal', description: 'x', amountMinor: '0', currency: 'INR' }], {
        transcript: 'nothing',
      }),
      ctx,
    );
    expect(out.captures).toEqual([]);
  });
});

describe('processClip', () => {
  const clip = { id: 'c1', durationMs: 4000, uri: 'file:///c/a.m4a' };
  function deps(over: Partial<ClipDeps> = {}): ClipDeps {
    return {
      agentEnabled: false,
      ctx,
      readBase64: vi.fn(async () => 'AAAA'),
      callAgent: vi.fn(async () => ({ kind: 'error' as const })),
      transcribe: vi.fn(async () => '500 for tea'),
      ...over,
    };
  }

  it('uses on-device transcription and never the agent when Pro is off', async () => {
    const d = deps();
    const out = await processClip(clip, d);
    expect(d.callAgent).not.toHaveBeenCalled();
    expect(d.transcribe).toHaveBeenCalledWith(clip.uri);
    expect(out.result.status).toBe('added');
  });

  it('sends the audio to the agent when Pro is on', async () => {
    const d = deps({
      agentEnabled: true,
      callAgent: vi.fn(async () => ({
        kind: 'ok' as const,
        response: agent([
          { type: 'add_personal', description: 'tea', amountMinor: '50000', currency: 'INR' },
        ]),
      })),
    });
    const out = await processClip(clip, d);
    expect(d.callAgent).toHaveBeenCalledWith({ audioBase64: 'AAAA', durationMs: 4000 });
    expect(d.transcribe).not.toHaveBeenCalled();
    expect(out.captures[0]?.amountMinor).toBe(50000n);
  });

  it('falls back to on-device when the agent is over quota or down', async () => {
    const d = deps({
      agentEnabled: true,
      callAgent: vi.fn(async () => ({ kind: 'quota' as const })),
    });
    const out = await processClip(clip, d);
    expect(d.transcribe).toHaveBeenCalled();
    expect(out.result.status).toBe('added');
  });

  it('falls back when the file cannot be read', async () => {
    const d = deps({
      agentEnabled: true,
      readBase64: vi.fn(async () => {
        throw new Error('gone');
      }),
    });
    expect((await processClip(clip, d)).result.status).toBe('added');
  });

  it('fails when recognition cannot run at all', async () => {
    const out = await processClip(clip, deps({ transcribe: vi.fn(async () => null) }));
    expect(out.result).toMatchObject({ status: 'error', error: 'failed' });
  });
});

describe('placeForCapture', () => {
  const fix = { lat: 1, lng: 2, name: null };
  it('returns the place when granted and quick', async () => {
    expect(await placeForCapture(async () => fix)).toEqual(fix);
  });
  it('is null when not granted, on error, and on timeout', async () => {
    expect(await placeForCapture(async () => null)).toBeNull();
    expect(await placeForCapture(async () => Promise.reject(new Error('x')))).toBeNull();
    expect(await placeForCapture(() => new Promise<typeof fix>(() => {}), 20)).toBeNull();
  });
});

describe('watch clip metadata', () => {
  it('carries the watch time and location from the clip metadata', () => {
    const clip = parseWatchClip({
      uri: 'file:///c/a.m4a',
      metadata: {
        t: 'voiceClip',
        id: 'c1',
        durationMs: 3000,
        madeAt: 1_764_183_000_000,
        tzOffsetMin: 330,
        location: { lat: 12.9, lng: 77.6 },
      },
    });
    expect(clip).toMatchObject({
      madeAt: 1_764_183_000_000,
      tzOffsetMin: 330,
      location: { lat: 12.9, lng: 77.6 },
    });
  });
});

describe('placeForWatchAdd', () => {
  const phone = { lat: 1, lng: 2, name: null };

  it('uses the watch fix without reading the phone', async () => {
    const read = vi.fn(async () => phone);
    const place = await placeForWatchAdd({ madeAt: 0, location: { lat: 9, lng: 8 } }, 1e9, read);
    expect(place).toEqual({ lat: 9, lng: 8, name: null });
    expect(read).not.toHaveBeenCalled();
  });

  it('reads the phone only for a delivery within two minutes', async () => {
    const read = vi.fn(async () => phone);
    expect(await placeForWatchAdd({ madeAt: 1_000_000 }, 1_060_000, read)).toEqual(phone);
    expect(await placeForWatchAdd({ madeAt: 1_000_000 }, 1_200_000, read)).toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
  });
});

describe('watch capture marker', () => {
  it('marks a draft as from the watch', () => {
    expect(isFromWatch(watchCaptureParsed('voice', 'c1', 5))).toBe(true);
    expect(isFromWatch({ source: 'sms' })).toBe(false);
    expect(isFromWatch(null)).toBe(false);
  });
});

describe('kept watch clip', () => {
  it('names the file after the clip and carries it in parsed', () => {
    expect(clipFileName('c1')).toBe('c1.m4a');
    const parsed = watchCaptureParsed('voice', 'c1', 5, 'c1.m4a');
    expect(parsed.clip).toBe('c1.m4a');
    expect(clipOfParsed(parsed)).toBe('c1.m4a');
    expect(watchCaptureParsed('voice', 'c1', 5)).not.toHaveProperty('clip');
  });

  it('only accepts a bare file name from parsed', () => {
    expect(clipOfParsed({ clip: '../x.m4a' })).toBeNull();
    expect(clipOfParsed({ clip: 3 })).toBeNull();
    expect(clipOfParsed(null)).toBeNull();
  });

  const DAY = 24 * 60 * 60 * 1000;
  const now = 100 * DAY;
  it('sweeps clips past 30 days or whose capture is gone', () => {
    const files = [
      { name: 'old.m4a', modifiedMs: now - 31 * DAY },
      { name: 'kept.m4a', modifiedMs: now - 2 * DAY },
      { name: 'orphan.m4a', modifiedMs: now - 2 * DAY },
      { name: 'fresh.m4a', modifiedMs: now - 1000 },
    ];
    expect(clipsToSweep(files, new Set(['old.m4a', 'kept.m4a']), now).sort()).toEqual([
      'old.m4a',
      'orphan.m4a',
    ]);
  });

  it('shows the player only with a clip name, the file and the module', () => {
    expect(showClipPlayer({ clip: 'c1.m4a', fileExists: true, moduleLoaded: true })).toBe(true);
    expect(showClipPlayer({ clip: null, fileExists: true, moduleLoaded: true })).toBe(false);
    expect(showClipPlayer({ clip: 'c1.m4a', fileExists: false, moduleLoaded: true })).toBe(false);
    expect(showClipPlayer({ clip: 'c1.m4a', fileExists: true, moduleLoaded: false })).toBe(false);
  });
});
