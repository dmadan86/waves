import { describe, expect, it } from 'vitest';

import { friendsMomentFor } from '@/lib/friendsScene';
import { Scene } from '@/lib/scene';

describe('friendsMomentFor', () => {
  it('maps each of the five daily scenes to its own shot', () => {
    expect(friendsMomentFor(Scene.Morning)).toBe('morning');
    expect(friendsMomentFor(Scene.Afternoon)).toBe('midday');
    expect(friendsMomentFor(Scene.Sunset)).toBe('sunset');
    expect(friendsMomentFor(Scene.Evening)).toBe('dusk');
    expect(friendsMomentFor(Scene.Night)).toBe('night');
  });

  it('borrows midday for winter, the pick the art has no shot of', () => {
    // Winter is only ever reached by a person's own choice on the Background
    // screen, never by the clock — but `useHeroScene` can still hand it to
    // Friends, and the five-shot photo has nothing of its own for it.
    expect(friendsMomentFor(Scene.Winter)).toBe('midday');
  });
});
