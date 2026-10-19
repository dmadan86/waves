/**
 * The typed composer (MC-TY-*): what gets sent, and who reads it.
 *
 *  MC-TY-01  typed text is cleaned like a transcript and capped
 *  MC-TY-02  nothing is sendable while empty or busy
 *  MC-TY-03  typed text goes to the agent when it is on, even for a Pro person
 *            whose mic streams to the cloud
 *  MC-TY-04  typed text the phone already understands takes the fast path
 *  MC-TY-05  typed text never rides the agent when it is off, appending, or from a link
 */

import { describe, expect, it, vi } from 'vitest';

import {
  MAX_TYPED_CHARS,
  canSendTyped,
  cleanTyped,
  transcriptRoute,
} from '../src/lib/assistantComposerPure';

const base = {
  agentOn: true,
  streamed: false,
  phoneToAgent: false,
  typed: true,
  appending: false,
  heardFromLink: false,
  answeringAgent: false,
  localConfident: () => false,
};

describe('MC-TY-01 cleaning typed text', () => {
  it('trims and collapses whitespace', () => {
    expect(cleanTyped('  800   lunch \n with Anu ')).toBe('800 lunch with Anu');
  });

  it('caps at 300 characters, counting characters not units', () => {
    expect(cleanTyped('a'.repeat(500))).toHaveLength(MAX_TYPED_CHARS);
    expect(Array.from(cleanTyped('🍽'.repeat(500)) ?? '')).toHaveLength(MAX_TYPED_CHARS);
  });

  it('keeps Hindi, Tamil and Arabic text intact', () => {
    expect(cleanTyped('अनु के साथ 800 का खाना')).toBe('अनु के साथ 800 का खाना');
    expect(cleanTyped('அனுவுடன் 800')).toBe('அனுவுடன் 800');
    expect(cleanTyped('٨٠٠ غداء')).toBe('٨٠٠ غداء');
  });

  it('is null for nothing, whitespace or a non-string', () => {
    expect(cleanTyped('')).toBeNull();
    expect(cleanTyped('   \n\t ')).toBeNull();
    expect(cleanTyped(undefined)).toBeNull();
    expect(cleanTyped(null)).toBeNull();
    expect(cleanTyped(42 as never)).toBeNull();
  });
});

describe('MC-TY-02 when send is enabled', () => {
  it('needs words and an idle screen', () => {
    expect(canSendTyped('lunch 800', false)).toBe(true);
    expect(canSendTyped('lunch 800', true)).toBe(false);
    expect(canSendTyped('   ', false)).toBe(false);
    expect(canSendTyped('', false)).toBe(false);
  });
});

describe('MC-TY-03 typed text reaches the agent', () => {
  it('goes to the agent for a Free phone-to-agent person', () => {
    expect(transcriptRoute({ ...base, phoneToAgent: true })).toBe('agent');
  });

  it('goes to the agent for a Pro person whose mic would stream (no audio involved)', () => {
    expect(transcriptRoute({ ...base, streamed: false, phoneToAgent: false })).toBe('agent');
  });

  it('goes back to the agent when it is the answer to the agent’s own question', () => {
    const confident = vi.fn(() => true);
    expect(transcriptRoute({ ...base, answeringAgent: true, localConfident: confident })).toBe(
      'agent',
    );
    expect(confident).not.toHaveBeenCalled();
  });
});

describe('MC-TY-04 the fast path still applies', () => {
  it('uses the phone’s parser when it is fully confident, without waiting on the agent', () => {
    expect(transcriptRoute({ ...base, localConfident: () => true })).toBe('fast');
  });
});

describe('MC-TY-05 when typed text stays on the phone', () => {
  it('is basic when the agent is off', () => {
    expect(transcriptRoute({ ...base, agentOn: false })).toBe('basic');
  });

  it('is basic when adding another to a batch', () => {
    expect(transcriptRoute({ ...base, appending: true })).toBe('basic');
  });

  it('is basic for words that came in on a link', () => {
    expect(transcriptRoute({ ...base, heardFromLink: true })).toBe('basic');
  });

  it('does not run the parser when the agent cannot be used', () => {
    const confident = vi.fn(() => true);
    transcriptRoute({ ...base, agentOn: false, localConfident: confident });
    expect(confident).not.toHaveBeenCalled();
  });

  it('keeps the spoken paths as they were: streamed or phone-heard, never typed', () => {
    expect(transcriptRoute({ ...base, typed: false, streamed: true })).toBe('agent');
    expect(transcriptRoute({ ...base, typed: false, phoneToAgent: true })).toBe('agent');
    expect(transcriptRoute({ ...base, typed: false })).toBe('basic');
  });
});
