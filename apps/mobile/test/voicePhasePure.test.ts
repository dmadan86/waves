import { describe, expect, it } from 'vitest';

import { drawablePhase } from '../src/lib/voicePhasePure';

const none = { drafts: 0, answer: false, saved: false, agent: false };

describe('drawablePhase', () => {
  it('falls back to the input state when a phase has nothing to draw', () => {
    expect(drawablePhase('review', none)).toBe('listening');
    expect(drawablePhase('answer', none)).toBe('listening');
    expect(drawablePhase('saved', none)).toBe('listening');
    expect(drawablePhase('agent', none)).toBe('listening');
  });
  it('keeps a phase that has its data', () => {
    expect(drawablePhase('review', { ...none, drafts: 1 })).toBe('review');
    expect(drawablePhase('saved', { ...none, saved: true })).toBe('saved');
    expect(drawablePhase('thinking', none)).toBe('thinking');
  });
});
